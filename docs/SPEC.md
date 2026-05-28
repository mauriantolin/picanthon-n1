# Especificación de producto: Picanthon — Live DOM Agent

> Generado desde el brief: evolución de la extensión Chrome MV3 "Picanthon" para reemplazar componentes del DOM en vivo vía chat de agente, replicando comportamiento y datos del original, con razonamiento (AI SDK + AI Elements), canvas de boceto, verificación post-cambio y una barra de tweaks como variables ajustables.

## Visión

Picanthon convierte cualquier página de terceros en un lienzo editable por lenguaje natural. El usuario abre el side panel, describe un cambio ("convertí esta tabla nativa en una tabla tipo shadcn con sort y paginación"), y un agente con razonamiento reemplaza el DOM en vivo. La pieza diferencial: el componente nuevo **no es un mockup vacío** — se alimenta de los **datos reales** que la página ya recibió (capturados de la red) y conserva la interacción (ordenar, filtrar, paginar). Sin tocar el código de la página y sin re-disparar requests.

Se construye **sobre el scaffold MV3 existente** (TypeScript + React + Vite/crxjs). No se rediseña desde cero: `tweaks.ts` sigue siendo la fuente de verdad del schema, el content script sigue siendo el único contexto con acceso al DOM, y el service worker (SW) sigue siendo el orquestador y dueño de la API key.

## Revisión de arquitectura (Opción A — VIGENTE, sustituye a la restricción 1)

> Tras leer la API real del AI SDK v6 se eligió la **Opción A**: el agente corre **en el side panel** vía el transporte oficial **`DirectChatTransport`** (in-process, sin HTTP), no en el service worker con un port custom. El side panel es un contexto de extensión privilegiado (`chrome-extension://`), igual de seguro que el SW para la API key, y puede mensajear al content script con `chrome.tabs.sendMessage`. Esto elimina un subsistema riesgoso completo (transporte port custom, reconstrucción manual del `ReadableStream`, heartbeat anti-sleep del SW, reconexión). Sigue siendo "cliente puro, sin backend". El SW queda reducido a tareas de fondo reales (p.ej. `captureVisibleTab` en la fase del canvas).
>
> Donde el spec de abajo diga "el SW hostea el agente" o "PortChatTransport custom", léase: **agente en el side panel con `DirectChatTransport`**. La llamada al modelo vive detrás de una factory chica (`src/lib/model.ts`) para migrar a Vercel AI Gateway sin reescribir.

## Restricciones de arquitectura ya decididas (NO reabrir)

1. **Transporte AI: cliente puro, sin backend.** Ver la *Revisión de arquitectura (Opción A)* de arriba: agente en el side panel con `DirectChatTransport`, streaming nativo del AI SDK, AI Elements para UI. AI SDK core (`@ai-sdk/anthropic`, `ToolLoopAgent`) corre en el side panel (fetch-based, header `anthropic-dangerous-direct-browser-access`).
2. **Datos del componente reemplazado: clonar lo visible + leer el response YA recibido.** En MV3 los response bodies no se leen por `webRequest`. Se diseña un **network recorder en mundo MAIN** (inyectado a `document_start`, `world: "MAIN"`) que parchea `window.fetch` y `XMLHttpRequest` y bufferea respuestas JSON ya recibidas. Al reemplazar, el agente correlaciona filas visibles con el response capturado (mismo shape/longitud); fallback a scraping del DOM. **NO se replayean requests nuevos.**
3. **Contexto de página: HTML primario + imagen del DOM anexable a demanda.** El outline HTML es la fuente principal (preciso para selectores). La imagen (captura + boceto del canvas) va solo cuando el usuario la anexa.

---

## Arquitectura objetivo

### Diagrama de flujo

```
┌─────────────────────────────── SIDE PANEL (React + AI Elements) ───────────────────────────────┐
│  useChat({ transport: PortChatTransport })                                                       │
│    Conversation · Message · Reasoning · Response · Tool parts · PromptInput                       │
│    SketchCanvas (overlay sobre captura)   ·   TweakBar (variables sobre cambios aplicados)        │
└───────────────┬──────────────────────────────────────────────────────────▲─────────────────────┘
                │ port "picanthon-chat" (long-lived)                         │ UI message stream
                │  send: { messages, attachments? }                         │  (text-delta, reasoning,
                ▼                                                            │   tool-call, tool-result)
┌─────────────────────────────── SERVICE WORKER (orquestador) ─────────────────────────────────────┐
│  onConnect(port) → bridge a streamText()                                                          │
│  LlmClient (interfaz)  ──▶  AnthropicLlmClient (@ai-sdk/anthropic, streaming)                      │
│  Tools del agente:                                                                                │
│    get_page_context · query_network_capture · search_shadcn_docs ·                                │
│    replace_component · apply_tweaks · verify_change · define_tweak_vars                            │
│  toUIMessageStream() → port.postMessage(chunk)                                                     │
└───────┬───────────────────────────────┬───────────────────────────────────┬─────────────────────┘
        │ GET_SNAPSHOT / CAPTURE_TAB     │ GET_NETWORK_CAPTURE               │ APPLY_TWEAKS / MOUNT_COMPONENT
        │ (HTML outline + screenshot)    │                                   │ VERIFY_CHANGE / SET_TWEAK_VAR
        ▼                                ▼                                   ▼
┌─────────────────────────────── CONTENT SCRIPT (ISOLATED · único con DOM) ─────────────────────────┐
│  buildSnapshot() (outline enriquecido) · applyTweaks() · mountReplacement() (shadow DOM)          │
│  verifyChange() · setTweakVar()                                                                    │
│  Puente con MAIN world vía window.postMessage  ◀────────────┐                                     │
└─────────────────────────────────────────────────────────────┼─────────────────────────────────────┘
                                                               │ CustomEvent / postMessage
┌─────────────────────────────── NETWORK RECORDER (MAIN world, document_start) ─────────────────────┐
│  monkey-patch window.fetch + XMLHttpRequest → buffer ring de respuestas JSON ya recibidas          │
│  expone capturas (url, método, status, shape, length, body) al content script bajo demanda         │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Contextos y responsabilidades

| Contexto | Mundo | Responsabilidad nueva |
|---|---|---|
| Side panel | — | UI con AI Elements, `useChat` + transporte port, canvas de boceto, tweak-bar |
| Service worker | — | Streaming con AI SDK core, agente multi-tool, puente port↔stream, `tabs.captureVisibleTab` |
| Content script | ISOLATED | Snapshot HTML enriquecido, montaje de componentes en shadow DOM, verificación, aplicar variables, puente con MAIN |
| Network recorder | MAIN | Parchea fetch/XHR a `document_start`, bufferea responses JSON |

---

## Evolución del scaffold archivo por archivo

### Archivos existentes a modificar

- **`src/manifest.ts`**
  - Agregar segundo `content_scripts` entry para el recorder MAIN-world: `{ matches: ['<all_urls>'], js: ['src/content/network-recorder.ts'], run_at: 'document_start', world: 'MAIN' }`.
  - El content script ISOLATED actual sube a `run_at: 'document_start'` también (para registrar el listener del puente antes que la página corra) o se mantiene un segundo entry; documentar el orden.
  - Agregar `web_accessible_resources` para los assets del componente montado si se necesitan (CSS del bundle shadcn).
  - Permisos: ya tiene `scripting`, `tabs`, `activeTab`, `<all_urls>`. Confirmar que alcanza para `captureVisibleTab` (requiere `activeTab` o `<all_urls>` + `tabs`).

- **`src/background/index.ts`**
  - Reemplazar el patrón request/response único (`onMessage` + `RUN_INSTRUCTION`) por `chrome.runtime.onConnect` con un port `picanthon-chat` de larga vida.
  - Nuevo loop: recibe `messages` del port → arma el run del agente con `streamText` (multi-step / tool loop) → reemite cada chunk del UI message stream por `port.postMessage`.
  - Sigue siendo el dueño de la API key (la lee de settings, nunca la expone al DOM).
  - Conserva `tabs.sendMessage` hacia el content script para `GET_SNAPSHOT`, `APPLY_TWEAKS`, y los nuevos mensajes (`CAPTURE_TAB` usa `chrome.tabs.captureVisibleTab` directo en el SW).

- **`src/content/index.ts`**
  - Mantener `GET_SNAPSHOT` y `APPLY_TWEAKS`.
  - Enriquecer `buildSnapshot()`: además del outline, devolver para nodos candidatos (tablas, listas, grids) un fragmento de **HTML real recortado** con selectores estables y un hash de estructura, para que el agente pueda razonar sobre el shape.
  - Agregar handlers nuevos: `GET_NETWORK_CAPTURE`, `MOUNT_COMPONENT`, `VERIFY_CHANGE`, `SET_TWEAK_VAR`.
  - Implementar el puente con el MAIN world (request/response sobre `window.postMessage` con un nonce por request).

- **`src/lib/tweaks.ts`** (FUENTE DE VERDAD — extender, no romper)
  - Mantener el union `Tweak` actual.
  - Agregar nuevas ops para el reemplazo y las variables:
    - `{ op: 'mountComponent'; selector: string; componentId: string; props: ComponentProps; mode: 'replace' | 'after' }`
    - `{ op: 'setVar'; mountId: string; key: string; value: string | number | boolean }`
  - Agregar tipos `ComponentProps`, `TweakVar` (ver "Tweak-bar como variables").
  - `applyTweaks()` delega las ops nuevas a funciones del nuevo módulo de montaje (sigue corriendo en el content script).

- **`src/lib/llm.ts`**
  - Refactor a la interfaz `LlmClient` (ver módulos nuevos). El cliente actual (fetch directo a Messages API, no-stream) se conserva como fallback `LegacyAnthropicClient`, pero el camino principal pasa a AI SDK core con streaming.

- **`src/lib/agent.ts`**
  - Pasar de "instrucción → tweaks (un shot)" a un **loop de agente con tools** orquestado en el SW mediante `streamText` con `maxSteps`. El `mockAgent` offline se mantiene para test sin key (mapea a tools deterministas).

- **`src/lib/messaging.ts`**
  - Agregar los nuevos message types: `GetNetworkCaptureMsg`, `NetworkCaptureResult`, `CaptureTabMsg`, `MountComponentMsg`, `VerifyChangeMsg`, `VerifyResult`, `SetTweakVarMsg`, `PageContext` (extiende `PageSnapshot` con `htmlFragments` y `screenshotDataUrl?`).
  - Definir el protocolo del puente MAIN↔ISOLATED (eventos `picanthon:net:request` / `picanthon:net:response`).

- **`src/lib/settings.ts`**
  - Agregar `provider: 'anthropic' | 'gateway'`, `gatewayUrl?`, flags de features (canvas on/off). Defaults compatibles.

- **`src/sidepanel/App.tsx`**
  - Reescribir la UI de chat a AI Elements + `useChat` con el transporte port. Integrar `SketchCanvas` y `TweakBar`. Settings se mantiene.

- **`package.json`**
  - Dependencias nuevas: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/react` (useChat), AI Elements (componentes vía registry shadcn o paquete), `zod` (schemas de tools), `@tanstack/react-table` (tabla del componente reemplazo). Posibles: `comlink` (opcional, para el puente). Tailwind/clsx/tailwind-merge si AI Elements los requiere.

### Módulos / archivos nuevos a crear

| Archivo | Rol |
|---|---|
| `src/content/network-recorder.ts` | Recorder MAIN-world: parchea fetch/XHR, ring buffer, expone capturas |
| `src/lib/net-bridge.ts` | Protocolo tipado del puente MAIN↔ISOLATED (nonce, timeout, eventos) |
| `src/lib/llm-client.ts` | Interfaz `LlmClient` + `AnthropicLlmClient` (AI SDK) + `LegacyAnthropicClient` |
| `src/lib/agent-tools.ts` | Definición (zod) de todas las tools del agente y sus handlers |
| `src/lib/chat-transport.ts` | `PortChatTransport`: implementación de `ChatTransport` de AI SDK sobre `chrome.runtime` port |
| `src/lib/component-registry.ts` | Catálogo de componentes "tipo shadcn" montables (id → factory + props schema + tweak-vars) |
| `src/lib/shadcn-docs.ts` | Búsqueda/lookup en doc de shadcn (ver "Buscar el componente") |
| `src/lib/correlation.ts` | Correlación filas visibles ↔ response capturado (shape/length match), fallback scraping |
| `src/content/mount.ts` | `mountReplacement()`: monta React en shadow DOM dentro de la página, aislamiento de estilos |
| `src/content/verify.ts` | `verifyChange()`: chequea aplicación + paridad de datos/comportamiento |
| `src/components/replacements/DataTable.tsx` | Componente tabla tipo shadcn (TanStack Table) con sort/filter/paginate |
| `src/sidepanel/SketchCanvas.tsx` | Canvas/lápiz sobre la captura de pestaña |
| `src/sidepanel/TweakBar.tsx` | Barra de variables ajustables sobre los cambios aplicados |
| `src/sidepanel/ai-elements/*` | Componentes AI Elements (Conversation, Message, Reasoning, Response, PromptInput, Tool) |

---

## Feature 1 — Chat de agente con razonamiento (AI SDK + AI Elements)

**Qué.** La UI del side panel usa AI Elements: `Conversation` + `Message` para el hilo, `Reasoning` para mostrar el pensamiento del modelo (colapsable, streaming), `Response` para el markdown de la respuesta, partes de `Tool` para mostrar cada llamada a tool (get_page_context, search_shadcn_docs, replace_component, verify_change…) con su estado (pending/result), y `PromptInput` para el compositor con soporte de adjuntos.

**Transporte.** `PortChatTransport` implementa la interfaz `ChatTransport` de AI SDK pero, en vez de `fetch(url)`, abre/usa un `chrome.runtime.connect({ name: 'picanthon-chat' })` y traduce el flujo de chunks del SW al `UIMessageStream` que `useChat` consume. Reconexión si el SW se duerme (MV3 mata el SW; el port se recrea y el run se reanuda o se marca interrumpido).

**Razonamiento sobre el DOM.** El agente recibe el HTML como contexto **primario** (preciso para selectores). La imagen (captura + boceto) se anexa **solo** cuando el usuario la adjunta; entonces se envía como parte de imagen en el mensaje multimodal.

**Criterios de aceptación.**
- El reasoning se muestra en streaming y es colapsable.
- Cada tool-call aparece como una parte con nombre + input + resultado.
- El stream sobrevive a navegación dentro del side panel (no se pierde el hilo).
- Si el SW se reinicia mid-stream, la UI muestra estado "interrumpido" sin romper.

## Feature 2 — Reemplazo de componentes que replica comportamiento + datos

**El mayor riesgo técnico. Desglose:**

### 2a. Montar un componente "tipo shadcn" en página de terceros sin romper su CSS

- **Aislamiento por Shadow DOM.** `mountReplacement()` (content script, ISOLATED) crea un host element, le adjunta un `shadowRoot` (`mode: 'open'`), y monta React (`createRoot`) **dentro del shadow root**. El CSS del componente (Tailwind/shadcn compilado) se inyecta como un `<style>` o `adoptedStyleSheets` dentro del shadow root, de modo que **ni la página filtra estilos al componente ni el componente filtra a la página**.
- **Posicionamiento.** Modo `replace`: el host se inserta en la posición del nodo original y el original se oculta (`display:none`, no se elimina) para poder revertir y para conservar referencias del recorder. Modo `after`: se inserta adyacente.
- **Variables CSS de tema** se exponen en el `:host` del shadow root para que la tweak-bar pueda ajustarlas en vivo.
- **CSP de terceros.** Como React y el CSS van en archivos del bundle de la extensión (no `eval`, no inline-script inyectado), el CSP de la página **no** bloquea el montaje (el content script corre en su propio mundo con su propio acceso a `web_accessible_resources`). Evitar `insertHTML` con `<script>`; todo el comportamiento vive en el componente React de la extensión.

### 2b. Buscar el componente en la doc de shadcn

- Tool `search_shadcn_docs(query)`: el agente consulta un índice. Dos estrategias (la fase 4 elige):
  - **Índice local empaquetado** (preferido para demo offline-friendly): un JSON curado en `src/lib/shadcn-docs.ts` con los componentes soportados (table, data-table, card, tabs, badge…), su descripción, props y el `componentId` del registry montable. El agente matchea intención → componentId.
  - **Fetch a la doc pública** (opcional, requiere host permission al dominio): trae el snippet de referencia. No se ejecuta código traído; solo informa la elección del `componentId` del registry interno.
- Regla dura: **solo se montan componentes del `component-registry.ts` interno** (allowlist). El agente elige cuál, nunca inyecta código arbitrario. Esto acota el riesgo de seguridad y de CSP.

### 2c. Cablear el componente nuevo a los datos reales (recorder)

- Tool `query_network_capture()` devuelve las capturas JSON del recorder (url, status, shape resumido, length).
- `correlation.ts`: dado el nodo objetivo (p.ej. la tabla nativa) y las capturas, encuentra el response cuyo array tiene **la misma longitud y un shape de columnas compatible** con las filas/columnas visibles. Heurística: match por nº de filas, por textos de celdas presentes en el JSON, por keys ↔ headers.
- Si hay match → el componente se monta con `props.data = capturedJson` (datos limpios y completos, no truncados por el render).
- Si **no** hay match → fallback: scraping del DOM de la tabla original (parsear `<tr>/<td>`) y montar con esos datos. La UI marca "datos por scraping (menor fidelidad)".
- **NO** se re-disparan requests: solo se usa lo ya recibido y bufferado.

### 2d. Comportamiento replicado

- El `DataTable.tsx` (TanStack Table) provee sort, filtro y paginación client-side sobre `props.data`. Eso **es** el comportamiento replicado para el caso canónico (la tabla nativa típicamente ya tenía estos datos en memoria).
- Si el original tenía paginación server-side, se documenta como limitación (no se replayea): se pagina client-side sobre lo capturado.

**Criterios de aceptación.**
- Tabla nativa → DataTable montada en shadow root, **sin** alterar el resto del CSS de la página.
- La DataTable muestra **las mismas filas y columnas** que la original (verificable: nº filas y headers coinciden).
- Sort por columna funciona; paginación funciona.
- Revert restaura el nodo original (un click).

## Feature 3 — Canvas/lápiz para boceto en vivo

**Qué.** Botón "anexar boceto" en `PromptInput`. Al activarlo: el SW hace `chrome.tabs.captureVisibleTab` y devuelve la captura; `SketchCanvas` la muestra como fondo y el usuario dibuja encima (lápiz, color, borrar, undo). Al confirmar, se compone captura + trazos en un solo `dataURL` (PNG) que se anexa al próximo mensaje + un comentario de texto describiendo la necesidad funcional.

**Es opcional por turno** — no se adjunta imagen salvo que el usuario lo pida.

**Criterios de aceptación.**
- Captura de la pestaña visible correcta (resolución y recorte razonables).
- Trazos suaves; undo/clear; selector de color/grosor mínimo.
- La imagen compuesta llega al agente como parte multimodal junto al texto.
- Sin boceto adjunto, el flujo de chat funciona igual (HTML-only).

## Feature 4 — Verificación de cambios

**Qué.** Tras `apply_tweaks` / `replace_component`, el agente llama `verify_change`. `verify.ts` (content script) corre chequeos:
- **Aplicación:** el selector objetivo existe / fue ocultado; el host del componente está montado en el shadow root.
- **Paridad de datos:** nº de filas del componente nuevo == nº de filas/registros del original (o del JSON capturado); headers/keys coinciden.
- **Comportamiento:** smoke test programático — disparar un sort y confirmar que el orden de la primera columna cambió; confirmar que la paginación cambia el set visible.
- Devuelve `VerifyResult { ok, checks: [{name, passed, detail}] }`. El agente lo reporta en el chat (parte de tool-result) y, si falla, reintenta o explica.

**Criterios de aceptación.**
- `verify_change` produce un reporte con checks individuales visibles en el chat.
- Detecta correctamente un reemplazo con menos filas que el original (falla paridad).
- El smoke test de sort/paginación se ejecuta sin intervención del usuario.

## Feature 5 — Tweak-bar como variables sobre los cambios aplicados

**Modelo.** Cada cambio aplicado puede declarar **variables ajustables**. El agente, al montar/aplicar, llama `define_tweak_vars(mountId, vars)` donde cada var es:

```ts
type TweakVar =
  | { kind: 'color'; key: string; label: string; value: string }
  | { kind: 'number'; key: string; label: string; value: number; min: number; max: number; step: number }
  | { kind: 'boolean'; key: string; label: string; value: boolean }
  | { kind: 'enum'; key: string; label: string; value: string; options: string[] }
```

Ejemplos para la DataTable: `accentColor` (color), `density` (enum compact/normal/comfortable), `pageSize` (number), `showPagination` (boolean), `striped` (boolean).

**Relación con el schema de tweaks.** La `TweakBar` (side panel) renderiza un control por `TweakVar`. Al cambiar un control, emite un tweak `{ op: 'setVar', mountId, key, value }` → SW → content script → `setTweakVar()` actualiza las props del componente montado (re-render del React en el shadow root) o una CSS var del `:host`. Es decir: **las variables son tweaks de grano fino con feedback inmediato**, persistidas en el estado del mount. Para cambios sobre DOM nativo (no componentes), las vars mapean a `setStyle` (ej. color de fondo → CSS var).

**Criterios de aceptación.**
- Tras un reemplazo, aparece automáticamente una TweakBar con las vars declaradas.
- Mover un slider/cambiar un color refleja el cambio en <100ms en la página, sin re-llamar al LLM.
- Las vars persisten mientras el mount viva; revert las limpia.

---

## Stack técnico

- **Frontend (side panel):** React 18, AI Elements (sobre shadcn/Radix), `@ai-sdk/react` (`useChat`), Tailwind para el panel. Canvas con `<canvas>` nativo.
- **Agente/LLM (SW):** `ai` (core `streamText`, tools con `zod`), `@ai-sdk/anthropic`. Interfaz `LlmClient` para futuro Vercel AI Gateway.
- **Componentes de reemplazo:** React + `@tanstack/react-table`, montados en Shadow DOM con Tailwind compilado e inyectado al shadow root.
- **Recorder:** vanilla TS, mundo MAIN, sin dependencias.
- **Build:** Vite + crxjs (ya existente). Tailwind para panel y para el bundle de shadow-root (dos pipelines de CSS o uno con scoping).

---

## Criterios de evaluación medibles por feature

| Feature | Métrica objetiva |
|---|---|
| 1. Chat + razonamiento | Reasoning y tool-calls visibles en streaming; el hilo sobrevive reinicio del SW; latencia primer token < 2s |
| 2. Reemplazo datos+comportamiento | nº filas(nuevo) == nº filas(original); set de headers idéntico; sort y paginación funcionales; 0 estilos de la página alterados fuera del host |
| 2c. Correlación | En el caso canónico, match con el response capturado (no fallback scraping) ≥ 90% de las veces cuando el response existe |
| 3. Canvas | Captura + trazos compuestos llegan como imagen multimodal; flujo HTML-only intacto sin adjunto |
| 4. Verificación | `verify_change` reporta checks individuales; detecta paridad rota; smoke test de sort ejecuta automáticamente |
| 5. Tweak-bar | Ajuste en vivo < 100ms sin llamada al LLM; vars declaradas por el agente aparecen automáticamente |

**Prueba dura de "replica comportamiento de verdad":** abrir una página con tabla nativa que pintó datos desde un fetch JSON; pedir el reemplazo; comprobar (a) misma data fila a fila contra el JSON capturado, (b) sort por una columna numérica reordena correctamente, (c) el CSS del resto de la página no cambió (snapshot visual del header/footer idéntico).

---

## Estado de implementación (al día)

- **Fase 1 ✅** — chat con AI Elements + streaming + tweaks. Provider: **Vercel AI Gateway** (`model.ts`), no Anthropic directo.
- **Fase 2 ✅** — network recorder en mundo MAIN (`network-recorder.ts`) + bridge (`net-bridge.ts`) + contexto enriquecido con selectores (`page-context.ts`).
- **Fase 3 ✅** — reemplazo de componentes: correlación (`correlation.ts`), registry/allowlist (`component-registry.ts`), montaje en Shadow DOM (`mount.ts`), `DataTable.tsx` (TanStack). Disparado por la tool `replace_component`.
- **Fase 3+ ✅ (v0)** — diseño custom no atado a shadcn: la tool `design_component` manda los datos reales a **v0** (`v0.ts`, `api.v0.dev`, key aparte), v0 genera HTML+CSS autocontenido y se monta **sanitizado** (sin scripts) en el Shadow DOM. No se ejecuta código generado (CSP-safe). Limitación v1: estático (sin sort/paginación en el render de v0).
- **Persistencia ✅** — tweaks guardados por URL en `chrome.storage.local` (`persisted-tweaks.ts`), restaurados por el content script al cargar; botón Reset. (Los reemplazos de componente aún no se auto-restauran.)
- **Cambio de arquitectura vs. spec original:** en vez de un pre-paso de diseño forzado en el transporte, hay **un único `ToolLoopAgent` multi-tool** (`plan_design`, `apply_tweaks`, `query_network_capture`, `search_shadcn_docs`, `replace_component`) con el contexto inyectado; el agente decide estilar vs. reemplazar. El reemplazo de componentes se maneja por un mensaje `REPLACE_COMPONENT` async (no por el `applyTweaks` síncrono) para code-split de React.
- Persistencia de tweaks vía `MutationObserver` (`persistence.ts`) para sobrevivir re-renders de SPAs.
- **Pendiente:** Fase 4 (verificación), Fase 5 (tweak-bar), Fase 6 (canvas).

## Sprints / fases (orden de construcción)

### Fase 1 — Streaming end-to-end (Opción A, sin features nuevas de DOM)
- `src/lib/model.ts`: factory del modelo (`createAnthropic` con header de browser) — punto de swap a Gateway.
- `src/lib/agent.ts`: `buildAgent()` con `ToolLoopAgent`, `providerOptions.anthropic.thinking` (reasoning), `stopWhen: stepCountIs(n)`. Exporta `PicanthonUIMessage = InferAgentUIMessage<...>`.
- `src/lib/agent-tools.ts`: tools `get_page_context` (lee snapshot) y `apply_tweaks` (aplica `Tweak[]` vía content script). `execute` mensajea al content script con `sendToActiveTab`.
- `src/lib/chat-transport.ts`: `createChatTransport(settings)` → `DirectChatTransport({ agent, sendReasoning:true })` con key, o `MockChatTransport` (offline, `createUIMessageStream`) sin key.
- `src/sidepanel/ai-elements/*`: componentes (Conversation, Message, Response, Reasoning, PromptInput, Tool) autoreados, Tailwind v4, sin Radix.
- `src/sidepanel/App.tsx`: `useChat<PicanthonUIMessage>({ transport })`, input manual, render de parts tipadas. Settings se mantiene.
- SW reducido: solo `setPanelBehavior`; ya no hostea el agente.
- **Demo:** chat con razonamiento en streaming que aplica los tweaks básicos de hoy (fondo oscuro, highlight) — con UI rica, streaming y tool-calls visibles. Sin key, el mock sigue aplicando tweaks por keyword.

### Fase 2 — Network recorder + contexto enriquecido
- `network-recorder.ts` (MAIN) + `net-bridge.ts` + handler `GET_NETWORK_CAPTURE`.
- Enriquecer `buildSnapshot()` con fragmentos HTML reales + selectores estables.
- Tools `get_page_context`, `query_network_capture`.
- **Demo:** el agente lista en el chat las respuestas JSON que la página recibió y razona sobre la estructura de una tabla.

### Fase 3 — Reemplazo de componente con datos reales (núcleo)
- `component-registry.ts`, `shadcn-docs.ts`, `correlation.ts`, `mount.ts`, `DataTable.tsx`.
- Ops `mountComponent` en `tweaks.ts`; tools `search_shadcn_docs`, `replace_component`.
- Montaje en Shadow DOM con CSS aislado.
- **Demo (caso canónico):** "convertí esta tabla en una tabla tipo shadcn" → DataTable montada con los datos reales del response, con sort y paginación, sin romper la página.

### Fase 4 — Verificación
- `verify.ts` + tool `verify_change`; reporte en el chat.
- **Demo:** tras el reemplazo, el agente verifica paridad de datos y corre smoke test de sort, mostrando checks verdes/rojos.

### Fase 5 — Tweak-bar como variables
- `TweakBar.tsx`, op `setVar`, tool `define_tweak_vars`, handler `SET_TWEAK_VAR`.
- **Demo:** ajustar color de acento, densidad, pageSize de la DataTable en vivo desde la barra, sin re-llamar al LLM.

### Fase 6 — Canvas/lápiz (anexo opcional)
- `SketchCanvas.tsx` + `CAPTURE_TAB` (captureVisibleTab) + adjunto multimodal en PromptInput.
- **Demo:** dibujar sobre una captura, anexar con comentario, el agente usa la imagen + HTML para decidir el cambio.

> Orden elegido: el canvas va al final porque es independiente del núcleo (reemplazo+datos) y aporta menos riesgo; las fases 3–5 son el corazón del valor y van primero tras tener streaming y datos.

---

## Riesgos técnicos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| **CSP de páginas de terceros** bloquea inline scripts/eval | Todo el comportamiento vive en componentes React de la extensión (web_accessible_resources), no en HTML inyectado. Nunca `<script>` en `insertHTML`. Solo allowlist del registry. |
| **MAIN vs ISOLATED** (recorder vs DOM) | El recorder (MAIN) solo bufferea y responde por `window.postMessage` con nonce; el content script (ISOLATED) es el único que toca el DOM. Protocolo tipado en `net-bridge.ts` con timeout y validación de origen. |
| **Streaming en SW que se duerme** (MV3 mata el SW ~30s idle) | Port de larga vida re-conectable; el run se marca interrumpido si el SW muere mid-stream; `useChat` muestra estado y permite reintentar. Heartbeat por el port mientras hay stream activo. |
| **Montar React en página ajena rompe estilos** | Shadow DOM (`mode:'open'`) con `adoptedStyleSheets`; el original se oculta (no se borra) para revert; tema vía CSS vars en `:host`. |
| **Correlación tabla↔response falla** | Heurística multi-señal (length + textos + keys↔headers); fallback explícito a scraping del DOM marcado en la UI como "menor fidelidad". Nunca re-disparar requests. |
| **API key en cliente** | Se mantiene en `chrome.storage.local`, leída solo por el SW, nunca expuesta al DOM ni al MAIN world. Interfaz `LlmClient` lista para mover a Gateway con auth de servidor. |
| **Datos sensibles en capturas/bocetos** | El recorder bufferea en memoria (ring, no persistido); las capturas/bocetos solo se envían si el usuario adjunta explícitamente. |

---

## Dirección de diseño de la UI (side panel)

- **Layout:** columna vertical densa pero respirada. Top bar con marca "🌶️ Picanthon" + settings. Centro: `Conversation` scrolleable. Abajo fijo: `PromptInput` con botones de adjuntar boceto y enviar. La `TweakBar` aparece como panel contextual encima del compositor cuando hay un mount activo.
- **Paleta:** acento picante `#ff3e7f` (ya usado en el scaffold para highlight) como color de marca; superficie clara `#fafafa` / oscura `#0f0f12`; texto `#18181b`. Soporte light/dark siguiendo `prefers-color-scheme`.
- **Tipografía:** sans del sistema para UI; mono (`ui-monospace`) para selectores, nombres de tools y fragmentos de JSON capturado.
- **Razonamiento:** `Reasoning` colapsado por defecto, con un sutil shimmer mientras streamea; tool-calls como chips/acordeones con icono por tool (lupa para search_shadcn_docs, tabla para replace_component, check para verify_change).
- **Anti-AI-slop:** nada de gradientes genéricos ni tarjetas con sombras flotantes por todos lados; bordes finos de 1px, estados de hover/active definidos, microinteracción en la TweakBar (el valor cambia y la página responde al instante). El boceto usa un trazo tipo marcador, no un lápiz fino genérico.
