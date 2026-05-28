# Evaluation Report — Iteration 2

**Commit**: 629f2b2 (anterior: 45fc697)
**Mode**: code-only
**Date**: 2026-05-28

## Scores by Section

### Sección 1: Diagnóstico y fix (weight 0.4)

| Check | Score (0-2) | Notes |
|-------|-------------|-------|
| `mediaType` en cada ImagePart | 2 | Sin cambios respecto a iter 1, `chat-transport.ts:149` (strokes `image/png` hardcoded) y `:160` (`composite.mediaType`). Tests originales (`mediaType is always set on every image part`, jpeg fallback) siguen verdes. |
| Logging estructurado con 6 campos | 2 | **FIX aplicado**. `chat-transport.ts:107-119`: `screenshotBytes` ahora se calcula del PNG raw devuelto por `captureActiveTab` vía `estimateBase64Bytes(screenshot.data)` en el camino inline, y queda `undefined` en el camino precomputed (con `precomputed: true` en el log para señalar el gap — decisión honesta, mejor que mentir con `compositeBytes`). Test #11 nuevo (`screenshotBytes reflects the captured PNG size and stays below compositeBytes on the in-line path`) valida `screenshotBytes > 0 && screenshotBytes < compositeBytes` con un mock que devuelve `'SHOT'.repeat(50)` (200 chars → 150 bytes) y composite de `'X'.repeat(8000)` (6000 bytes). Test #12 nuevo (`marks screenshotBytes as undefined and precomputed=true when the composite is supplied by the caller`) valida la otra rama. Los 6 campos del rubric están todos presentes. |
| Validación tamaños mínimos | 2 | Sin cambios, `compositeBytes < 5000` y `strokesBytes < 500` → warn + drop, tests originales verdes. |
| Tests de chat-transport verdes y completos | 2 | 14/14 verdes en `chat-transport.test.ts` (12 originales del iter 1 + 2 nuevos screenshotBytes + 1 nuevo e2e cache contract). |
| `debug` vs `warn` severity | 2 | Sin cambios. `console.debug` solo en el happy path final (`:165`), `console.warn` en los 4 caminos degradados. |

**Section avg**: (2 + 2 + 2 + 2 + 2) / 5 = **2.00**

### Sección 2: Preview con contexto (weight 0.3)

| Check | Score (0-2) | Notes |
|-------|-------------|-------|
| `DrawingPreviewCard` renderiza el composite | 2 | Sin cambios. |
| Thumbnail aspect ratio del viewport y ≥80px en dim menor | 2 | **FIX aplicado**. `DrawingPreviewCard.tsx:44-47`: `width: 144px, maxHeight: 96px`. Con viewport 1280×720, altura efectiva = 144 / (16/9) = **81px** — pasa el piso de 80px. **Nuevo test** `thumbnail honors the viewport aspect ratio inline` valida que `button.style.aspectRatio` matchea `/^[0-9.]+(\s*\/\s*[0-9.]+)?$/` (acepta tanto `'1.77'` como `'1.77 / 1'` que es como jsdom lo normaliza). El test no verifica el valor 80px numérico (jsdom no resuelve `width:144px` a px reales sin layout engine), pero el check del rubric pide "test que verifica `aspect-video` o `aspectRatio` inline" y eso está cubierto literalmente. |
| Estado "componiendo…" | 2 | Sin cambios. |
| Fallback "sin screenshot" | 2 | Sin cambios. |
| Zoom modal funcional (4 caminos) | 2 | **FIX aplicado**. Dos nuevos tests sumados: `closes the zoom modal when clicking the backdrop` y `closes the zoom modal when clicking the X button`. Ambos: abren el modal con click en el trigger, luego disparan el evento sobre el target específico (`[data-testid="zoom-modal"]` y `[data-testid="zoom-close"]` respectivamente) y verifican `document.querySelector('[data-testid="zoom-modal"]') === null` tras el click. Los 4 caminos están cubiertos: click→abre (iter 1), ESC→cierra (iter 1), click backdrop→cierra (nuevo), click X→cierra (nuevo). Nota técnica: el backdrop test funciona porque `onClick={onClose}` está en el div con `data-testid="zoom-modal"` y `stopPropagation` solo en el div hijo. |

**Section avg**: (2 + 2 + 2 + 2 + 2) / 5 = **2.00**

### Sección 3: Una sola fuente de verdad (weight 0.2)

| Check | Score (0-2) | Notes |
|-------|-------------|-------|
| `compositeWithStrokes` se llama exactamente 1 vez por dibujo | 2 | **FIX aplicado**. Nuevo `describe` en `chat-transport.test.ts:261-269`: `enrichWithComposite + injectScribbleImages (end-to-end cache contract)` con un test que llama secuencialmente `enrichWithComposite(drawing)` y luego `injectScribbleImages(prompt, enriched)`, y verifica `expect(vi.mocked(screenshot.compositeWithStrokes)).toHaveBeenCalledTimes(1)` y `captureActiveTab` también `toHaveBeenCalledTimes(1)`. Esto es genuinamente e2e (la misma instancia de mock cruza ambos módulos vía `vi.mock('./screenshot', ...)`), no dos asserts separados en aislamiento como en iter 1. El `beforeEach(vi.clearAllMocks)` (línea 32-34) garantiza que los counters arrancan en 0. |
| Composite computado al cerrar scribble (no al render del preview) | 2 | Sin regresión. La lógica se movió a `composite-cache.ts:9-30` (función pura) y `App.tsx:174-179` la consume vía `enrichAndMerge`. `DrawingPreviewCard.tsx` sigue siendo solo render — no llama `compositeWithStrokes`. |
| `DrawnPayload` con `compositePng` y `screenshotAvailable` opcionales | 2 | Sin cambios. |
| `injectScribbleImages` lee composite precomputado | 2 | Sin cambios, lógica intacta en `chat-transport.ts:100-115`. Cubierto por test #9 original y reforzado por el nuevo e2e. |
| Bytes idénticos: preview === modelo | 2 | Sin cambios. El nuevo `composite-cache.ts:18-23` setea `compositePng.data = composite.data` (string base64 idéntico) que `chat-transport.ts:111` reusa por referencia. |

**Section avg**: (2 + 2 + 2 + 2 + 2) / 5 = **2.00**

### Sección 4: Craft (weight 0.1)

| Check | Score (0-2) | Notes |
|-------|-------------|-------|
| Sin regresiones en tests existentes | 2 | `npm test` → **136 passed, 1 skipped, 0 failed** (vs 130/1/0 en iter 1 — los 6 tests nuevos son aditivos). Los 12 tests originales de `chat-transport.test.ts` siguen verdes; los 5 tests originales de `DrawingPreviewCard.test.tsx` también. |
| Build TypeScript limpio | 2 | `npm run build` → `tsc --noEmit` PASS, `vite build` PASS en 12.21s. El warning de chunk >500KB sigue siendo preexistente. Exportar `estimateBase64Bytes` desde `screenshot.ts` (antes era función privada en `chat-transport.ts`) está justificado en el comentario del export (`:106-108`). |
| Badge no tapa el thumbnail | 2 | Sin cambios. |
| Doc `scribble-manual-test.md` con 5 pasos | 2 | Sin cambios desde iter 1, sigue existiendo. |
| Sin emojis nuevos, sin gradientes nuevos, sin spinners cutres | 2 | El nuevo `composite-cache.ts` es lógica pura, no UI. Diff de `DrawingPreviewCard.tsx` solo cambia 3 valores numéricos del style (144/160/96 px) — ningún elemento visual nuevo. |

**Section avg**: (2 + 2 + 2 + 2 + 2) / 5 = **2.00**

## Weighted Total

```
score = 0.4 · 2.00 + 0.3 · 2.00 + 0.2 · 2.00 + 0.1 · 2.00
      = 0.800 + 0.600 + 0.400 + 0.200
      = 2.00 / 2.0
```

## Δ vs iteration 1

| Sección | Iter 1 | Iter 2 | Δ |
|---------|--------|--------|---|
| 1 (fix, w=0.4) | 1.80 | 2.00 | +0.20 |
| 2 (preview, w=0.3) | 1.60 | 2.00 | +0.40 |
| 3 (single src, w=0.2) | 1.80 | 2.00 | +0.20 |
| 4 (craft, w=0.1) | 2.00 | 2.00 | +0.00 |
| **Total** | **1.76** | **2.00** | **+0.24** |

## Verdict

**PASS** — score perfecto (2.00/2.00), umbral de merge (1.7) ampliamente superado, 0 regresiones.

Los 4 follow-ups del feedback-001.md están aplicados de manera fiel y completa:

1. `screenshotBytes` honesto (no más usar `compositeBytes` como proxy mentiroso).
2. Tests modal completos los 4 caminos (click, ESC, backdrop, botón X).
3. Thumbnail 144×96 → altura efectiva 81px sobre 16:9, por encima del piso de 80.
4. Test e2e genuino del invariante "1 sola llamada a `compositeWithStrokes`" vía `enrichWithComposite → injectScribbleImages`.

Además, la extracción de `enrichWithComposite` a `composite-cache.ts` mejora la arquitectura: la función pura es testeable sin React Testing Library, y `App.tsx` queda más corto (38 líneas borradas, 12 agregadas).

## What's strong

- **Decisión honesta en `screenshotBytes`**: dejar `undefined` cuando el camino es precomputed, con `precomputed: true` en el log para que el operador pueda discriminar, en vez de poner un `0` o un proxy mentiroso. El comentario en `chat-transport.ts:104-106` documenta la decisión. El test #12 lo verifica explícitamente.

- **Test e2e real, no dos asserts en paralelo**: el nuevo `describe` de `chat-transport.test.ts:261` encadena `enrichWithComposite(drawing) → injectScribbleImages(prompt, enriched)` con la misma instancia de mock cruzando ambos módulos. El conteo de llamadas refleja el flujo real de la app (`toggleScribble` → `enrichAndMerge` → `setDrawing` → `sendMessage` → `injectScribbleImages`). Esto es lo que pedía la spec en su redacción original.

- **Refactor con buen gusto**: mover `enrichWithComposite` a un módulo aparte (`composite-cache.ts`, 31 líneas) deja `App.tsx` más legible (de 174-203 a un wrapper de 6 líneas `enrichAndMerge`) y permite testear el invariante "1 llamada por drawing" sin RTL. La función pura no toca state; el state se mergea afuera con un guard de identidad (`prev.strokesPng === result.strokesPng`).

- **Export de `estimateBase64Bytes` correctamente justificado**: el comentario en `screenshot.ts:106-108` explica por qué se exporta (consistencia de bytes entre chat-transport y composite-cache, sin off-by-one repetido). Y el cambio de la firma de `(dataUrl: string)` a `(data: string)` con `comma === -1` como caso esperado (no excepcional) es más correcto.

- **`maxWidth: 160px` + `width: 144px`**: el ajuste no rompe el layout porque `width` es la baseline efectiva; `maxWidth: 160px` da headroom si el padre se estira. `maxHeight: 96px` clampa cuando el viewport es portrait. Bien pensado.

- **El mock de `screenshot` ahora usa `vi.importActual`**: `chat-transport.test.ts:11-16` mockea sólo `captureActiveTab` y `compositeWithStrokes` pero preserva `estimateBase64Bytes` del módulo real. Esto es necesario porque el nuevo test #11 depende del valor real de `estimateBase64Bytes` para calcular `screenshotBytes`. Detalle pulido.

## What's weak / missing

Nada material. Todos los items de iter 1 están cerrados. Tres notas menores sin impacto en score:

1. **`screenshotBytes` undefined en precomputed**: la spec del rubric dice "screenshotBytes" como uno de los 6 campos requeridos. Estrictamente el diag log lo emite siempre (es una key del objeto), pero su valor es `undefined` cuando precomputed. Esto es semánticamente más correcto que `0` (que se confundiría con "screenshot falló") pero un operador desprevenido podría leer el log y no entender por qué falta el dato. El comentario `precomputed: true` lo subsana. Sin descuento — la decisión es defendible y mejor que la alternativa.

2. **Test de aspect ratio no verifica el valor 80px numérico**: el rubric pide "≥80px en su dimensión menor" — el test sólo verifica que el style `aspectRatio` está presente como ratio numérico. La verificación de "≥80px" se queda en cálculo de cabeza (144 / 1.7778 = 81). En jsdom es inviable computar layout real, así que se acepta. Sin descuento.

3. **Smoke test manual no verificable en code-only**: el documento existe y los pasos son claros, pero no hay manera de validar la respuesta del modelo Sonnet desde acá. Por inspección de código, el camino feliz está más sólido que en iter 1 (logging honesto facilita el debug si vuelve a fallar). Sin descuento.

## Final recommendation

**Luz verde para mergear `629f2b2`.**

El sprint cumple los criterios de la spec original y los follow-ups del primer evaluator. La cobertura de tests subió de 130 a 136 sin perder ninguno, y los nuevos son sustantivos (no smoke). El refactor de `enrichWithComposite` a módulo pura es una mejora estructural que paga dividendos para tests futuros.

No hay follow-ups bloqueantes para iter 3. Posibles mejoras Sprint 2 (no urgentes):

- Si el smoke real falla con un log de `compositeBytes ≈ 1_000_000` y respuesta "no llegó imagen", bajar `MAX_COMPOSITE_BYTES` en `screenshot.ts` a 800_000 (hipótesis D del análisis original).
- Cachear el composite en `IndexedDB` (feature 9 nice-to-have de la spec) para sobrevivir reloads del side panel.
- Telemetría opcional: contador de drops (`compositeBytes < 5KB` y `strokesBytes < 500`) en `localStorage` para detectar si el threshold de 5KB es demasiado conservador.
