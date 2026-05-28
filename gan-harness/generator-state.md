# Generator State - Iteration 002

## What Changed This Iteration

Direccionados los 4 follow-ups de `feedback-001.md` ordenados por impacto.

### Fix 1 — `screenshotBytes` honesto (`chat-transport.ts`)

- En el camino in-line, ahora se captura el screenshot ANTES de componer y
  se reporta `screenshotBytes = estimateBase64Bytes(shot.data)` (o `0` si
  `captureActiveTab` devolvió null). Restaura el diagnóstico A vs D.
- En el camino precomputed, `screenshotBytes` se loguea como `undefined`
  con `precomputed: true` — no se preserva el raw screenshot tras el cache.
  Más honesto que reportar `compositeBytes` como proxy.
- Movido `estimateBase64Bytes` a export de `src/lib/screenshot.ts` para
  evitar duplicación con la versión interna que ya tenía.
- 2 tests nuevos en `chat-transport.test.ts`:
  - `screenshotBytes reflects the captured PNG size and stays below
    compositeBytes on the in-line path` (assert estricto: bytes raw < bytes
    composite).
  - `marks screenshotBytes as undefined and precomputed=true when the
    composite is supplied by the caller`.

### Fix 2 — Tests del zoom modal completos (`DrawingPreviewCard.test.tsx`)

- `closes the zoom modal when clicking the backdrop`: abre el modal,
  click sobre `[data-testid="zoom-modal"]`, verifica que desaparece.
- `closes the zoom modal when clicking the X button`: click sobre
  `[data-testid="zoom-close"]`. Cubre los 4 caminos de cierre que pedía
  el rubric.

### Fix 3 — Thumbnail ≥ 80px en dim menor (`DrawingPreviewCard.tsx`)

- `width: 144px` (antes 128) + `maxHeight: 96px` (antes 88). Con un
  viewport 16:9 estándar la altura efectiva pasa de 72px a 81px,
  superando el piso del rubric.
- Test nuevo `thumbnail honors the viewport aspect ratio inline` que
  verifica `style.aspectRatio` match `/^[0-9.]+(\s*\/\s*[0-9.]+)?$/`
  (jsdom normaliza el ratio a la forma `1.77 / 1`).

### Fix 4 — Test integrado "1 sola llamada a `compositeWithStrokes`"

- Extraído `enrichWithComposite` de `App.tsx` a `src/lib/composite-cache.ts`
  como función pura. Toma un `DrawnPayload` y devuelve el mismo payload
  con `compositePng` + `screenshotAvailable` resueltos.
- `App.tsx` ahora delega a `enrichWithComposite` y solo gobierna el
  side-effect de `setDrawing`. Quedó más chico y la lógica de cache es
  testeable sin RTL.
- Nuevo describe en `chat-transport.test.ts`:
  `enrichWithComposite + injectScribbleImages (end-to-end cache contract)`
  con el test pedido por el evaluator (1 llamada total a
  `compositeWithStrokes` y 1 sola a `captureActiveTab` en el flujo
  encadenado).

## Tests

- `npm test`: **136 passed**, 1 skipped (intencional), 0 failed.
- 13 archivos de test (sigue siendo el mismo set; sumé 5 tests netos).
- `npm run build`: PASS (warning preexistente de chunk > 500 KB del
  vendor; no introducido por esta iteración).

## Notas / desviaciones

- El regex `^[0-9.]+$` que pedía el feedback no matchea contra el valor
  normalizado por jsdom (`1.77 / 1`). Lo amplié a
  `^[0-9.]+(\s*\/\s*[0-9.]+)?$` aceptando ambas formas — la intención
  semántica (validar ratio numérico inline) queda intacta.
- Como `screenshotBytes` pasó a ser `number | undefined`, el campo se
  serializa como `undefined` en el payload del log y el assert nuevo es
  `toBeUndefined()`. Sigue siendo una de las 6 keys del objeto `diag`.

## Dev Server

- N/A: extensión Chrome, no SPA. `npm run dev` para HMR del bundle,
  `dist/` para cargar como unpacked. Smoke manual sigue documentado
  en `docs/scribble-manual-test.md`.
