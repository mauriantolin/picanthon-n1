# GAN Harness Build Report

**Brief**: Fix scribble preview (no page context) + "no llegó ninguna imagen" bug in Picanthon
**Result**: **PASS (perfect score)**
**Iterations**: 2 / 4
**Final Score**: **2.00 / 2.0** (threshold: 1.7)
**Eval mode**: code-only

## Score Progression

| Iter | Sec 1 (Fix, w=0.4) | Sec 2 (Preview, w=0.3) | Sec 3 (Single source, w=0.2) | Sec 4 (Craft, w=0.1) | Total |
|------|--------------------|------------------------|-------------------------------|----------------------|-------|
| 1    | 1.80               | 1.60                   | 1.80                          | 2.00                 | **1.76** |
| 2    | 2.00               | 2.00                   | 2.00                          | 2.00                 | **2.00** |

**Δ**: +0.24 (+0.20 sec 1, +0.40 sec 2, +0.20 sec 3, 0 sec 4)

## Cambios commiteados

Commit `45fc697`: `fix(scribble): pass mediaType to image parts; preview shows composite over screenshot`

### Fixes funcionales
- **`mediaType` explícito** en cada `ImagePart` de `injectScribbleImages` (hipótesis C, causa raíz del bug "no llegó imagen").
- **Logging estructurado** `[picanthon/scribble]` con los 6 campos del rubric.
- **Validación de bytes**: drop + warn si composite < 5KB o strokes < 500 bytes.
- **Composite único** (`compositePng?`, `screenshotAvailable?` en `DrawnPayload`), computado una sola vez en `toggleScribble` y reusado en `injectScribbleImages`.

### UI
- `DrawingPreviewCard` extraído a archivo propio.
- Preview muestra composite (screenshot + strokes) con aspect ratio del viewport.
- Estado "componiendo…" sin spinner.
- Fallback "sin screenshot" con patrón de cuadrícula + pill amarilla.
- `DrawingZoomModal` (ESC / click afuera / botón X).
- Pill threshold de bytes (muy chica / muy grande).

### Tests (20 nuevos, 130 total PASS, 1 SKIP, 0 FAIL)
- `chat-transport.test.ts` +5
- `screenshot.test.ts` (nuevo) 5 + 1 `.skip`
- `DrawingPreviewCard.test.tsx` (nuevo) 6
- `scribble.test.ts` +2

### Doc
- `docs/scribble-manual-test.md` (5 pasos smoke test).

## Iteración 2 — Polish (commit `629f2b2`)

Aplicó los 4 follow-ups detectados por el evaluator de iter 1:

1. **`screenshotBytes` honesto** (`chat-transport.ts:107-119`): captura los bytes del PNG raw del screenshot ANTES de componer; en camino precomputed deja `undefined` con flag `precomputed: true`. Restaura discriminación A vs D.
2. **4 caminos del modal cubiertos**: tests para click-en-backdrop y botón X (sumados a click+ESC ya existentes).
3. **Thumbnail ≥80px**: `width: 144px` → altura efectiva 81px en viewport 16:9. Test que valida `aspectRatio` inline.
4. **Test e2e genuino** (`chat-transport.test.ts:261-269`): `enrichWithComposite → injectScribbleImages` con `compositeWithStrokes` invocado exactamente 1 vez total en la cadena.

**Bonus**: extracción de `enrichWithComposite` a `src/lib/composite-cache.ts` (función pura, 31 líneas). `App.tsx` -26 líneas. Export de `estimateBase64Bytes` desde `screenshot.ts`.

## Issues residuales

**Ninguno bloqueante.** Posibles Sprint 2 (no urgentes):
- Bajar `MAX_COMPOSITE_BYTES` de 1MB a 800KB si el smoke real revela hipótesis D (composite cap-eado por el provider).
- Cache del composite en IndexedDB para preservar entre reloads del side panel.
- Telemetría de drops por threshold (sumar contador a un panel debug).

## Smoke test manual

No verificable en modo `code-only` (requiere extensión cargada en Chrome con API key de Vercel AI Gateway). Documentado en `docs/scribble-manual-test.md`. Hay que correrlo manualmente para confirmar:
- En consola aparece `[picanthon/scribble]` con `compositeBytes > 50_000`.
- Sonnet responde con referencia visual al dibujo (no "no llegó imagen").

## Files Created/Modified (iter 1 + iter 2)

```
src/lib/chat-transport.ts            (modificado iter 1 + 2)
src/lib/screenshot.ts                (modificado iter 1 + 2)
src/lib/messaging.ts                 (modificado iter 1)
src/lib/composite-cache.ts           (nuevo iter 2)
src/sidepanel/App.tsx                (modificado iter 1 + 2)
src/sidepanel/DrawingPreviewCard.tsx (nuevo iter 1, ajustado iter 2)
src/lib/chat-transport.test.ts       (extendido iter 1 + 2)
src/lib/screenshot.test.ts           (nuevo iter 1)
src/sidepanel/DrawingPreviewCard.test.tsx (nuevo iter 1, extendido iter 2)
src/content/scribble.test.ts         (extendido iter 1)
docs/scribble-manual-test.md         (nuevo iter 1)
vitest.config.ts                     (incluir *.test.tsx + plugin React)

gan-harness/spec.md
gan-harness/eval-rubric.md
gan-harness/generator-state.md
gan-harness/feedback/feedback-001.md
gan-harness/feedback/feedback-002.md
gan-harness/build-report.md          (este archivo)
```

## Build verification (final)

- `npm test` → **136 PASS, 1 SKIP, 0 FAIL** (13 archivos)
- `npm run build` → **PASS** (warning preexistente de chunk size > 500 KB, no regresión)

## Commits

- `45fc697` — fix(scribble): pass mediaType to image parts; preview shows composite over screenshot
- `629f2b2` — fix(scribble): honest screenshotBytes log + complete modal tests + thumbnail >=80px
