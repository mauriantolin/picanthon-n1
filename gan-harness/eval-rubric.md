# Evaluation Rubric — Scribble Fix Sprint

Scoring: 0 (ausente) | 1 (parcial) | 2 (completo y correcto). Total ponderado sobre 10.

## 1. Diagnóstico y fix del bug "no llegó ninguna imagen" (weight: 0.4)

| Check | Cómo verificar | Score |
|-------|----------------|-------|
| `mediaType` presente en TODAS las `ImagePart` generadas por `injectScribbleImages` | Leer `chat-transport.ts`: ambas parts (`strokes` y `composite`) tienen `mediaType` explícito. Strokes = `'image/png'`. Composite = el devuelto por `compositeWithStrokes`. | / 2 |
| Logging estructurado bajo tag `[picanthon/scribble]` | `console.debug` con un objeto que contiene los 6 campos: `screenshotBytes`, `strokesBytes`, `compositeBytes`, `compositeMediaType`, `compositeDimensions`, `screenshotNull`. | / 2 |
| Validación de tamaños mínimos | Composite < 5000 bytes → warn + no inyectar. Strokes < 500 bytes → warn + no inyectar. Cubierto por test unitario. | / 2 |
| Tests de chat-transport actualizados y verdes | `npm test src/lib/chat-transport.test.ts` pasa con los 5 tests nuevos descritos en la spec. | / 2 |
| `console.debug` separado de `console.warn` (severity correcto) | Casos normales en `debug`, casos degradados (bytes bajos, screenshot null inesperado) en `warn`. | / 2 |

## 2. Preview con contexto visual (weight: 0.3)

| Check | Cómo verificar | Score |
|-------|----------------|-------|
| `DrawingPreviewCard` renderiza el composite (no solo strokes) cuando disponible | Test RTL: `<img>` con `src` matcheando `data:image/(png|jpeg);base64,`. | / 2 |
| Thumbnail respeta aspect ratio del viewport y es ≥ 80px en su dimensión menor | Inspección visual + test que verifica clase CSS `aspect-video` o `aspectRatio` inline. | / 2 |
| Estado "componiendo…" mientras el composite está pendiente | Test RTL: con `compositePng=undefined` aparece el texto "componiendo" (o equivalente i18n). | / 2 |
| Fallback "sin screenshot" para chrome:// o captura fallida | Test RTL: con `screenshotAvailable=false` aparece pill amarilla con texto correspondiente. | / 2 |
| Zoom modal funcional | Click abre, ESC cierra, click afuera cierra, botón X cierra. Cubierto por test RTL. | / 2 |

## 3. Una sola fuente de verdad para el composite (weight: 0.2)

| Check | Cómo verificar | Score |
|-------|----------------|-------|
| `compositeWithStrokes` se llama exactamente 1 vez por dibujo | Test con `vi.spyOn`: tras `toggleScribble` exitoso + `sendMessage`, el spy registra 1 call, no 2. | / 2 |
| Composite se computa al cerrar el scribble (no al render del preview) | Inspección de `App.tsx`: el cómputo arranca dentro de `toggleScribble`, no dentro de `DrawingPreviewCard`. | / 2 |
| `DrawnPayload` tiene campos `compositePng` y `screenshotAvailable` (retrocompat opcional) | Leer `messaging.ts`: tipos actualizados, campos opcionales para no romper tests viejos. | / 2 |
| `injectScribbleImages` lee composite precomputado del payload si existe | Test: con `drawing.compositePng` seteado, `compositeWithStrokes` no se invoca. | / 2 |
| Bytes idénticos: el composite del preview === el composite enviado al modelo | Test conceptual: la image part de composite en el prompt usa exactamente `drawing.compositePng.data`. | / 2 |

## 4. Craft (weight: 0.1)

| Check | Cómo verificar | Score |
|-------|----------------|-------|
| No hay regresiones en tests existentes | `npm test` verde en `chat-transport.test.ts` (6 viejos) y `scribble.test.ts` (todos). | / 2 |
| Build TypeScript limpio | `npm run build` sin errores ni warnings nuevos. | / 2 |
| Badge de elementos cubiertos no tapa el thumbnail | Inspección CSS / test que verifica posicionamiento razonable. | / 2 |
| Doc `docs/scribble-manual-test.md` existe con 5 pasos ejecutables | Existe el archivo, contiene pasos numerados, sin ambigüedad. | / 2 |
| Sin emojis nuevos, sin gradientes nuevos, sin spinners cutres | Inspección visual del diff. | / 2 |

## Pesos finales

```
score = 0.4 * (avg sección 1) + 0.3 * (avg sección 2) + 0.2 * (avg sección 3) + 0.1 * (avg sección 4)
```

- **≥ 1.7** = Sprint completado, listo para mergear.
- **1.3 – 1.7** = Aceptable, dejar follow-ups específicos.
- **< 1.3** = Rechazar, regenerar.

## Smoke test manual obligatorio (gate, no entra en el score)

El evaluator debe confirmar (o marcar como no-verificable si no tiene API key) que:

1. En una página real (ej: `https://news.ycombinator.com`), abriendo el side panel, activando scribble, dibujando un círculo sobre un título y mandando "qué dibujé?" → la respuesta del modelo Sonnet referencia **visualmente** el dibujo o la página (no dice "no llegó ninguna imagen").
2. La consola del side panel muestra una línea `[picanthon/scribble]` con `compositeBytes` > 50000 y `compositeMediaType` en `['image/png', 'image/jpeg']`.

Si el smoke falla pero el código está bien hecho (mediaType presente, logging completo): puntaje sección 1 igual = 8/10, dejando follow-up para investigar D (límite provider) o A residual en Sprint 2.
