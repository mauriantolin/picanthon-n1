# Product Specification: Scribble Fix — "What you draw is what the model sees"

> Generated from brief: "Fix scribble preview (no page context) + 'no llegó ninguna imagen' bug in Picanthon"

## Vision

El scribble es la feature más expresiva de Picanthon: el usuario garabatea sobre la página y el agente interpreta su gesto. Hoy esa promesa se rompe en dos lugares — el usuario no puede confirmar visualmente qué dibujó (ve trazos flotando sobre transparente) y el modelo dice que no recibió la imagen. Este sprint cierra el loop de feedback: **lo que el usuario ve en el preview es exactamente el composite que recibe el modelo**, generado una sola vez, validado por tamaño y tipo, y con logging suficiente para que un bug futuro no nos haga adivinar.

## Design Direction

- **Color palette**: heredada del side panel (`bg-background`, `border-primary/30`, `bg-primary/10`, `text-muted-foreground`). Acento de aviso `text-amber-600` / `dark:text-amber-400` para estados degradados ("sin screenshot", "no vision"). Nada de gradientes nuevos.
- **Typography**: Inter/system, `text-xs` para meta info de la card, `text-[11px]` para hints secundarios, `font-mono` para el conteo de bytes en modo debug.
- **Layout philosophy**: la card de preview crece de un thumbnail decorativo (56x40) a un **preview funcional** con aspect ratio del viewport (`aspect-video` aprox, máx ~96px de alto). El usuario tiene que reconocer la página de un vistazo.
- **Visual identity**:
  - El composite se renderiza con un **inset shadow sutil** (`shadow-inner`) y un borde 1px para diferenciarlo del fondo de la card.
  - Click sobre el thumbnail = **zoom modal** (popover con la imagen a tamaño real, dismiss con ESC o click afuera). Nada de tooltips genéricos.
  - Badge inferior derecho con el conteo de elementos cubiertos, en `bg-primary text-primary-foreground` redondeado, estilo notificación.
  - Estado "sin screenshot" (chrome://, captura falló): el composite cae a strokes sobre fondo `bg-muted` con un patrón de cuadrícula sutil (`bg-[linear-gradient(...)]`) — comunica "esto es lo que se manda, pero sin contexto de página".
- **Anti-AI-slop directives**:
  - Nada de "Vista previa del dibujo" con emoji + glow.
  - Nada de skeletons genéricos mientras se compone — el composite es síncrono-ish (50-200ms); si tarda más, mostramos el strokes solo y reemplazamos cuando llega, sin spinner.
  - Nada de modals con overlay 50% black opaco genérico — el zoom usa `bg-background/95 backdrop-blur-sm`.
- **Inspiración**: la card de "screenshot attached" de Linear cuando pegás una imagen, el preview de Cursor cuando seleccionás región, el "drawn snippet" de tldraw.

## Features (prioritized)

### Must-Have (Sprint 1)

1. **Diagnóstico instrumentado de `injectScribbleImages`** (hipótesis A-E)
   - Agregar logging estructurado *antes* y *después* del composite con: `screenshotBytes`, `strokesBytes`, `compositeBytes`, `compositeMediaType`, `compositeDimensions { w, h }`, `screenshotNull: boolean`, `screenshotReason?: string` (de `chrome.runtime.lastError`).
   - Validación dura: si `compositeBytes < 5_000` (umbral arbitrario de "casi vacío"), loguear `WARN` con todos los datos y NO inyectar la image part — mejor que el modelo no la vea a que vea bytes basura.
   - Validación dura: si `strokesBytes < 500` (placeholder `data:,` da ~0 bytes), loguear `WARN` y no enviar la strokes-only part.
   - Tag de log unificado: `[picanthon/scribble]` (no `[picanthon]` genérico) — facilita filtrar en DevTools.
   - **Acceptance**: cualquier envío con dibujo deja en consola una línea JSON con los seis campos arriba; los warnings disparan solo en los casos degradados.

2. **Fix: `mediaType` explícito en `ImagePart`**
   - Cambiar la construcción de `imageParts` en `chat-transport.ts` para incluir `mediaType` en cada part:
     - Strokes: siempre `'image/png'`.
     - Composite: el que devuelve `compositeWithStrokes` (`'image/png'` o `'image/jpeg'`).
   - Esta es la **hipótesis C** (causa más probable, justificada abajo) y el fix mínimo de impacto que probablemente resuelve el bug del usuario.
   - **Acceptance**: el test `chat-transport.test.ts` valida que cada `ImagePart` tiene `mediaType` definido y que coincide con el del provider (`'image/png'` para strokes; cualquiera de los dos para composite).

3. **Composite único, calculado una vez, compartido entre UI y modelo**
   - Nuevo tipo en `messaging.ts`: extender `DrawnPayload` (o crear `EnrichedDrawing` en `App.tsx`/state) con:
     ```ts
     compositePng?: { data: string; mediaType: 'image/png' | 'image/jpeg' }
     screenshotAvailable: boolean
     ```
   - Cuándo se calcula: **al recibir el `DrawResult` en `toggleScribble`**, justo después de `setDrawing(result)`. Async, sin bloquear UI; mientras tanto el preview muestra strokes solos como ahora.
   - Una vez listo, se hace `setDrawing(prev => ({ ...prev, compositePng, screenshotAvailable }))`.
   - `injectScribbleImages` lee el composite **del state** si está disponible; si no (race condition: usuario manda muy rápido), cae al path actual (recomputar). Esto garantiza que **el composite del preview es bit-exacto al que ve el modelo**.
   - **Acceptance**: en un envío con dibujo, `compositeWithStrokes` se llama 1 (una) vez, no 2. Test unitario lo verifica con un spy.

4. **`DrawingPreviewCard` muestra el composite**
   - Reemplazar el `<img>` actual (56x40, strokes transparentes) por un container con `aspect-video` o ratio del viewport real (`drawing.viewport.width / drawing.viewport.height`), max-height ~88px, max-width ~140px.
   - Si `compositePng` está listo → mostrarlo (`src="data:{mediaType};base64,{data}"`).
   - Si todavía no → mostrar strokes solos sobre `bg-muted` con leyenda "componiendo…" (sin spinner).
   - Si `screenshotAvailable === false` → mostrar strokes sobre el patrón de cuadrícula y agregar pill `<span class="text-amber-600">sin screenshot</span>` al lado del nombre.
   - **Acceptance**: visualmente reconocible la página dibujada. RTL test (`@testing-library/react`) verifica que el `img.src` arranca con `data:image/png;base64,` o `data:image/jpeg;base64,` cuando `compositePng` está presente.

5. **Zoom modal en click del thumbnail**
   - Click (no hover, para accesibilidad táctil) abre un overlay centrado con la imagen full-size (`max-w-[90vw] max-h-[80vh] object-contain`).
   - Dismiss: ESC, click afuera, o botón X arriba a la derecha.
   - **Acceptance**: el modal aparece, muestra la misma imagen del thumbnail, se cierra con ESC.

### Should-Have (Sprint 1, si entra)

6. **Threshold de bytes y aviso al usuario**
   - Si el composite final pesa < 5 KB o > 4.5 MB (cerca del límite de Anthropic), mostrar pill amarilla en la card: "imagen muy chica / muy grande, el modelo podría ignorarla".
   - **Acceptance**: simular un composite < 5 KB → la pill aparece.

7. **Decisión arquitectónica: NO crear thumbnail separado**
   - `compositeWithStrokes` ya hace downscale a `MAX_LONG_EDGE = 1600`. Para la UI no necesitamos 1600px; suficiente ~320px. Pero la spec dice "una sola fuente de verdad" → mantenemos UN composite, el del modelo (1600px), y dejamos al `<img>` que el browser lo escale (es performante con `image-rendering: auto`).
   - Si memoria es un problema (medirlo), Sprint 2 podría introducir un thumbnail separado.
   - **Acceptance**: ninguno separado — esto es decisión arquitectónica documentada.

8. **Test e2e manual scriptable**
   - Documentar en `docs/scribble-manual-test.md` un flujo de 5 pasos para verificar manualmente: cargar una página real, dibujar una flecha, ver el composite en la card, mandar, ver en consola los logs con bytes, recibir respuesta del modelo que referencia algo de la imagen.
   - **Acceptance**: doc existe y los 5 pasos son ejecutables sin ambigüedad.

### Nice-to-Have (no en este sprint, dejar TODO)

9. Cache del composite en `IndexedDB` para preservar entre reloads del side panel.
10. Animación de "fly-in" del composite cuando cierra el scribble (Framer Motion).
11. Soporte para múltiples dibujos pendientes (queue).

## Technical Stack

- **Frontend**: React 18 + TypeScript, Tailwind (ya en uso), `@ai-sdk/react` v6.
- **Side panel logic**: AI SDK v6 (`ai`, `convertToModelMessages`, `validateUIMessages`).
- **Canvas**: `HTMLCanvasElement` nativo en el side panel (DOM real, no jsdom).
- **Testing**: Vitest + jsdom para unit, `@testing-library/react` para el preview card.
- **Sin nuevas dependencias.**

## Diagnóstico raíz del Problema 2 — análisis de hipótesis

Repaso de cada hipótesis con evidencia del código actual y veredicto:

| Hip | Descripción | Evidencia a favor | Evidencia en contra | Veredicto |
|-----|-------------|-------------------|---------------------|-----------|
| A | `captureActiveTab` devuelve `null`, composite queda casi-blanco | `compositeWithStrokes` con `screenshot=null` pinta fondo `#ffffff` + trazos rosados que tras downscale 1:1600 pueden quedar finos | El usuario reporta que dibujó "en una página normal", no chrome://. `captureVisibleTab` normalmente funciona. | **Poco probable como causa única.** Cubrir con logging y validación de bytes. |
| B | `strokesPng` viene vacío (`data:,`) | `extractPngBase64('data:,')` devuelve `''`. Si por race el canvas se limpió antes del `toDataURL`, queda vacío. | En `scribble.ts` el `rasterize` se llama dentro de `trySubmit` *antes* de `detach()`, mientras el canvas todavía existe y los strokes están dibujados. Hay un `render` previo agendado por `rAF` pero el `toDataURL` no depende de eso — lee del canvas state actual. | **Poco probable.** El render del último frame podría no haber corrido pero el último `onPointerMove` ya pintó. Validar con bytes > 500 igual. |
| C | image parts sin `mediaType` | Mirando `chat-transport.ts:97-102`: `{ type: 'image', image: drawing.strokesPng }` — **no hay `mediaType`**. El tipo `ImagePart` lo marca opcional, pero Anthropic via Gateway necesita saber si es PNG/JPEG para construir el bloque `{ type: 'image', source: { type: 'base64', media_type, data } }`. Sin `mediaType` y con `image` como **base64 raw sin prefijo `data:`**, el provider no puede detectar el formato. | El test actual valida explícitamente `!startsWith('data:')`, confirmando que se manda crudo. | **CAUSA MÁS PROBABLE.** El comentario en el código dice "no mediaType needed" — eso es incorrecto cuando `image` es un string base64 sin prefijo. |
| D | Composite > límite del provider | El composite se cap-ea a 1 MB; Anthropic permite ~5 MB. | Sin evidencia de overflow. | **Improbable.** Cubrir con log de bytes igual. |
| E | El modelo dice "no recibí imagen" porque el prompt anuncia 2 imágenes pero llegan 0 | El system prompt en `agent.ts:147` dice literalmente "Two images are attached to this user turn". Si Sonnet ve esa frase pero no ve imágenes, va a reportar exactamente "no llegó ninguna imagen". | Esto es un **síntoma**, no la causa. La causa subyacente es C (o A/B/D). | **Síntoma de C.** Confirma que el modelo está leyendo el system prompt correctamente y que la parte multimodal es la que falla. |

**Recomendación**: implementar el fix de **C primero** (es 2 líneas de código + el cambio en el test). Si tras eso el bug persiste, los logs estructurados (Feature 1) discriminan entre A/B/D en una sola sesión de usuario.

**Justificación del veredicto C**: el contrato de `ImagePart` en AI SDK v6 (`node_modules/@ai-sdk/provider-utils/dist/index.d.ts:573-594`) marca `mediaType?: string` como opcional, pero el provider Anthropic dentro del SDK construye el bloque `{ type: 'image', source: { type: 'base64', media_type, data } }` — sin `media_type` el bloque queda mal formado y el AI Gateway puede degradarlo o dropearlo silenciosamente. El comentario en el código actual ("no mediaType needed for image parts") es una creencia incorrecta heredada de versiones anteriores donde `image` aceptaba `data:image/...` URLs (con mediaType embebido).

## Evaluation Criteria

### Diagnóstico y fix (weight: 0.4)
- ¿El fix mínimo (`mediaType` en cada `ImagePart`) está aplicado en `injectScribbleImages`?
- ¿El logging estructurado de `[picanthon/scribble]` aparece con los 6 campos (screenshotBytes, strokesBytes, compositeBytes, compositeMediaType, compositeDimensions, screenshotNull)?
- ¿Hay validación de tamaño mínimo (`compositeBytes > 5000`, `strokesBytes > 500`) con warnings claros?
- ¿Los tests verifican que `mediaType` está presente en las parts generadas?

### Preview con contexto (weight: 0.3)
- ¿El `DrawingPreviewCard` muestra el composite (screenshot + strokes) y no solo strokes?
- ¿El thumbnail tiene un tamaño usable (no 56x40) y respeta el aspect ratio del viewport?
- ¿Hay fallback visible cuando `screenshotAvailable === false`?
- ¿Hay zoom modal funcional al hacer click?

### Una sola fuente de verdad (weight: 0.2)
- ¿`compositeWithStrokes` se llama **exactamente una vez** por dibujo (verificado con spy en test)?
- ¿El composite que ve el usuario en el preview es el MISMO bytes-a-bytes que se envía al modelo?
- ¿El composite se computa al cerrar el scribble (no en cada render del preview)?

### Craft (weight: 0.1)
- ¿Hay estado intermedio "componiendo…" mientras el composite está pendiente, sin spinner cutre?
- ¿El zoom modal cierra con ESC, click afuera Y botón X?
- ¿El badge de elementos cubiertos no se superpone con el thumbnail?
- ¿No hay regresión en los tests existentes de `chat-transport.test.ts` y `scribble.test.ts`?

## Tests a agregar/extender

### `src/lib/chat-transport.test.ts` (extender)
1. **`mediaType is always set on every image part`**: existente + asserts `imageParts[0].mediaType === 'image/png'` y `imageParts[1].mediaType` matchea lo que devolvió el mock de `compositeWithStrokes`.
2. **`reuses pre-computed composite from drawing payload`**: pasar un `drawing` con `compositePng` ya seteado → `compositeWithStrokes` NO se llama (spy con `toHaveBeenCalledTimes(0)`).
3. **`logs structured diagnostics with all 6 fields`**: spy en `console.debug`, verificar que la primera llamada contiene `{ screenshotBytes, strokesBytes, compositeBytes, compositeMediaType, compositeDimensions, screenshotNull }`.
4. **`drops near-empty composite (< 5KB) with warning`**: mock `compositeWithStrokes` devuelve 100 bytes → `console.warn` se llama, la composite part NO se agrega al prompt (queda solo la strokes part o cero).
5. **`drops empty strokes (data:,) with warning`**: drawing con `strokesPng: ''` → no se agrega strokes part, warn loggeado.

### `src/lib/screenshot.test.ts` (nuevo archivo)
1. **`compositeWithStrokes returns PNG when under 1MB`**: canvas pequeño (200x200) → mediaType `'image/png'`.
2. **`compositeWithStrokes falls back to JPEG when over 1MB`**: usar `vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')` para retornar un PNG > 1MB la primera vez → mediaType `'image/jpeg'`.
3. **`compositeWithStrokes uses white background when screenshot is null`**: spy en `ctx.fillRect` con `fillStyle='#ffffff'`.
4. **`compositeWithStrokes downscales when long edge > 1600`**: pasar screenshot de 3200x1800 → output dimensions <= 1600 en la dimensión mayor.
5. **`compositeWithStrokes returns non-empty bytes for non-trivial input`**: verificar que el resultado tiene length > 500 (anti-regression para hip B).

Nota: jsdom no implementa canvas; usar `vi.stubGlobal('document', ...)` con un canvas mock o saltar tests que necesitan render real (los marcamos `.skip` con un comentario sobre por qué).

### `src/content/scribble.test.ts` (extender)
1. **`buildPayload rasterizes strokes to non-empty base64`**: con `rasterize` mockeado a `'BASE64DATA'`, el payload incluye `strokesPng === 'BASE64DATA'`.
2. **`rasterize is called exactly once per submit`**: spy en el callback de options.rasterize, `toHaveBeenCalledTimes(1)`.

### `src/sidepanel/DrawingPreviewCard.test.tsx` (nuevo, RTL)
1. **`renders composite image when present`**: pasar `drawing.compositePng = { data: 'XYZ', mediaType: 'image/png' }` → `<img src="data:image/png;base64,XYZ">`.
2. **`shows "sin screenshot" pill when screenshotAvailable is false`**: matcher `getByText(/sin screenshot/i)`.
3. **`shows strokes-only with composing label when compositePng is undefined`**: matcher `getByText(/componiendo/i)`.
4. **`opens zoom modal on click and closes on ESC`**: fireEvent.click + verify modal visible, dispatchKey('Escape') + verify modal gone.

## Sprint Plan

### Sprint 1: "Cierro el loop visual y arreglo el bug de imágenes"

**Goals**:
- Resolver el bug del usuario ("no llegó ninguna imagen") con un fix mínimo + telemetría suficiente para descartar el resto de hipótesis sin nueva sesión.
- Convertir el preview en un componente útil que muestre EXACTAMENTE lo que se manda al modelo.
- Garantizar que la generación del composite ocurre una sola vez.

**Features**: 1, 2, 3, 4, 5 (must-have). Si entra: 6, 8.

**Orden de implementación**:
1. Feature 2 (fix `mediaType`) → 5 minutos, desbloquea testing manual.
2. Feature 1 (logging estructurado + validaciones) → 30 min.
3. Feature 3 (composite único en state) → 1h, modificación de `messaging.ts`, `App.tsx`, `chat-transport.ts`.
4. Feature 4 (preview muestra composite) → 45 min.
5. Feature 5 (zoom modal) → 30 min.
6. Tests (extender + nuevos) → 1h.
7. Feature 6 (threshold de bytes) → 20 min.
8. Feature 8 (doc manual test) → 15 min.

**Definition of done**:
- `npm test` verde, incluyendo los nuevos tests.
- `npm run build` sin errores TypeScript.
- Smoke test manual en una página real (ej: news.ycombinator.com o un Notion público):
  - Dibujar una flecha entre dos elementos.
  - Cerrar scribble → ver el composite en la card (no solo strokes).
  - Click en el thumbnail → ver zoom modal.
  - Mandar → en consola, ver el log `[picanthon/scribble]` con los 6 campos.
  - Recibir respuesta del modelo que **referencia visualmente** algo del dibujo o la página ("vi que dibujaste una flecha del botón Submit al header") — NO el mensaje de "no llegó ninguna imagen".
- En caso de fallar: los logs estructurados deben hacer obvio cuál hipótesis aplica (A/B/D residual), y queda como follow-up de Sprint 2.

**Riesgos / mitigaciones**:
- *Riesgo*: el fix de `mediaType` no es suficiente y la causa real es D (límite del provider) → los logs lo capturan; agregamos un cap más agresivo (~800 KB) si se confirma.
- *Riesgo*: pre-computar el composite al cerrar scribble añade latencia perceptible → si > 300 ms en pruebas, async el preview (mostrar strokes primero, swap cuando llega).
- *Riesgo*: tests de canvas en jsdom no son fiables → marcamos los críticos como `.skip` con un comentario y dependemos del smoke manual; alternativa es usar `node-canvas` en devDeps pero suma 30 MB.

## Archivos a tocar

- `src/lib/chat-transport.ts` — fix de `mediaType`, logging estructurado, validaciones de bytes, lectura de `compositePng` precomputado.
- `src/lib/screenshot.ts` — agregar dimensiones al resultado (`{ data, mediaType, width, height }`).
- `src/lib/messaging.ts` — extender `DrawnPayload` con `compositePng?` y `screenshotAvailable?` (opcionales, retrocompat).
- `src/sidepanel/App.tsx` — en `toggleScribble`, después de `setDrawing(result)`, lanzar el composite async y hacer `setDrawing(prev => ...)`. Reescribir `DrawingPreviewCard`. Nuevo componente `DrawingZoomModal`.
- `src/lib/chat-transport.test.ts` — extender con 5 tests nuevos.
- `src/lib/screenshot.test.ts` — **nuevo**, 5 tests.
- `src/sidepanel/DrawingPreviewCard.test.tsx` — **nuevo**, 4 tests con RTL.
- `src/content/scribble.test.ts` — 2 tests adicionales.
- `docs/scribble-manual-test.md` — **nuevo**, 5 pasos de smoke test.

## Out of scope (explícito)

- Reescribir el sistema de scribble (el módulo `content/scribble.ts` queda intacto salvo tests).
- Cambiar el system prompt en `agent.ts` (el texto "Two images are attached" es correcto, no es el bug).
- Soporte multi-dibujo, undo entre cierres, persistencia.
- Cambios en el agente o herramientas del modelo.
