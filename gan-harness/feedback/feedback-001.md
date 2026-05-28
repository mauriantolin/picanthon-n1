# Evaluation Report — Iteration 1

**Commit**: 45fc697
**Mode**: code-only
**Date**: 2026-05-28

## Scores by Section

### Sección 1: Diagnóstico y fix (weight 0.4)

| Check | Score (0-2) | Notes |
|-------|-------------|-------|
| `mediaType` en cada ImagePart | 2 | `chat-transport.ts:146` (strokes = `'image/png'` hardcoded) y `:157` (composite = `composite.mediaType` del result). Test explícito `mediaType is always set on every image part` (asserts ambos) + test `mediaType reflects the value returned by compositeWithStrokes (jpeg fallback)`. Causa raíz hipótesis C cubierta. |
| Logging estructurado con 6 campos | 1 | `chat-transport.ts:162` loguea bajo `[picanthon/scribble]` y el payload tiene los 6 nombres requeridos. **Problema serio**: `screenshotBytes` está mal calculado — la spec lo define como "bytes del screenshot crudo" (lo que devolvió `captureActiveTab`) y acá se usa `compositeBytes` como proxy en ambas ramas (`precomputed ? compositeBytes : (composite && !screenshotNull ? compositeBytes : 0)`, líneas 127-129). Esto inutiliza el campo para distinguir hipótesis A (`captureActiveTab → null`) de D (composite cap-eado): si A pasa, los bytes del screenshot serían 0 pero `screenshotBytes` igualmente reporta `compositeBytes` (que es el composite con fondo blanco). El test #11 (`logs structured diagnostics with all 6 fields`) solo hace `toHaveProperty(...)`, no valida el valor — por eso el bug pasa. |
| Validación tamaños mínimos | 2 | `compositeBytes < 5000` → warn + drop (`:151`), `strokesBytes < 500` → warn + drop (`:140`). Tests #13 y #14 cubren ambos drops. |
| Tests de chat-transport verdes y completos | 2 | Los 5 nuevos descritos en la spec están presentes y verdes; los 6 originales siguen pasando. 12/12 verdes en `chat-transport.test.ts`. |
| `debug` vs `warn` severity | 2 | `console.debug` solo en el camino feliz (`:162`), `console.warn` en los 3 caminos degradados (strokes vacíos, composite chico, compositeWithStrokes failed, no user message). Buena separación. |

**Section avg**: (2 + 1 + 2 + 2 + 2) / 5 = **1.80**

### Sección 2: Preview con contexto (weight 0.3)

| Check | Score (0-2) | Notes |
|-------|-------------|-------|
| `DrawingPreviewCard` renderiza el composite | 2 | `DrawingPreviewCard.tsx:48-54`. Test #1 `renders composite image when present with a data:image/png|jpeg URL` valida regex y data inline. |
| Thumbnail aspect ratio del viewport y ≥80px en dim menor | 1 | `aspectRatio: ${viewport.width / viewport.height}` inline (línea 42) y `width: 128px, maxWidth: 140px, maxHeight: 88px`. Con un viewport 1280×720 la altura efectiva es 128/(16/9) = 72px — **por debajo de los 80px que pide el rubric** en su dimensión menor. Además no hay test que verifique la presencia de `aspectRatio` inline o `aspect-video` (el rubric pide explícitamente "test que verifica clase CSS aspect-video o aspectRatio inline"). |
| Estado "componiendo…" | 2 | Renderiza strokes-only + label `componiendo…` (`:78`). Test #3 valida `data-testid="composing-label"` y matcher `/componiendo/i`. Sin spinner. |
| Fallback "sin screenshot" | 2 | Pill con `data-testid="no-screenshot-pill"` + patrón de cuadrícula sobre `bg-muted` cuando `screenshotAvailable === false` (`:124-131` y `:60-66`). Test #2 lo cubre. |
| Zoom modal funcional (click abre, ESC cierra, click afuera cierra, botón X cierra) | 1 | Implementación completa: ESC en `:189`, click backdrop en `:203` (con `stopPropagation` en el contenido para no auto-cerrar), botón X con `data-testid="zoom-close"` en `:216`. **Tests sólo cubren click→abrir y ESC→cerrar** (test #4). Falta assert de click afuera y de botón X — el rubric pide "Cubierto por test RTL" para los 4 caminos. |

**Section avg**: (2 + 1 + 2 + 2 + 1) / 5 = **1.60**

### Sección 3: Una sola fuente de verdad (weight 0.2)

| Check | Score (0-2) | Notes |
|-------|-------------|-------|
| `compositeWithStrokes` se llama exactamente 1 vez por dibujo | 1 | Hay un test que verifica que `injectScribbleImages` no la llama cuando viene precomputado (`toHaveBeenCalledTimes(0)`, línea 139), y la lógica del happy path en `App.tsx:174-203` la invoca 1 sola vez (en `enrichWithComposite`). **Pero no hay un test integrado que verifique "1 llamada total desde toggleScribble + sendMessage"** como pedía la spec literal — son dos asserts en aislamiento. El comportamiento correcto está garantizado por la separación de paths, pero el test no es el que pidió el rubric. |
| Composite computado al cerrar scribble (no al render del preview) | 2 | `App.tsx:165` (`void enrichWithComposite(result)` dentro de `toggleScribble`, post-`setDrawing`). `DrawingPreviewCard.tsx` solo lee `drawing.compositePng`, nunca llama a `compositeWithStrokes`. |
| `DrawnPayload` con `compositePng` y `screenshotAvailable` opcionales | 2 | `messaging.ts:140-146`. Ambos opcionales (retrocompat OK con `scribble.test.ts`, que no los setea y pasa). |
| `injectScribbleImages` lee composite precomputado | 2 | `chat-transport.ts:100-111`. Test #9 (`reuses pre-computed composite from drawing payload`) lo valida con `toHaveBeenCalledTimes(0)` en ambos `captureActiveTab` y `compositeWithStrokes`, y verifica que `imageParts[1].image === 'Z'.repeat(8000)`. |
| Bytes idénticos: preview === modelo | 2 | Cuando `precomputed`, `composite.data = precomputed.data` (línea 107) y `imageParts.push({ image: composite.data, ... })` (línea 156) — referencia directa al mismo string que renderiza el `<img>` en la card. Test #9 lo asegura por contenido. |

**Section avg**: (1 + 2 + 2 + 2 + 2) / 5 = **1.80**

### Sección 4: Craft (weight 0.1)

| Check | Score (0-2) | Notes |
|-------|-------------|-------|
| Sin regresiones en tests existentes | 2 | `npm test` → 130 passed, 1 skipped (intencional), 0 failed. 12 archivos. Los tests originales de `chat-transport.test.ts` (6) y `scribble.test.ts` siguen verdes. |
| Build TypeScript limpio | 2 | `npm run build` → `tsc --noEmit` PASS, `vite build` PASS. El warning de chunk >500KB es preexistente. Buen detalle: eliminaron import unused (`relativeLuminance`) que rompía `noUnusedLocals`. |
| Badge no tapa el thumbnail | 2 | El badge circular `bg-primary text-primary-foreground` va **al lado del nombre "Dibujo"** en la columna de texto (`:96-101`), no superpuesto al thumbnail. El thumbnail solo tiene un overlay `zoom` que aparece on hover, posicionado en bottom-right con `pointer-events-none`. Limpio. |
| Doc `scribble-manual-test.md` con 5 pasos | 2 | Existe (56 líneas), 5 pasos numerados, prerrequisitos, resultado esperado. Los pasos son ejecutables sin ambigüedad (sitio sugerido, qué dibujar, qué buscar en consola). |
| Sin emojis nuevos, sin gradientes nuevos, sin spinners cutres | 2 | El componente nuevo no introduce emojis ni gradientes; el patrón "sin screenshot" es checkered (autorizado por spec). El estado "componiendo…" usa label `font-mono text-[10px]` sin spinner. Iconos SVG inline para X de cerrar y de cierre del modal — bien. |

**Section avg**: (2 + 2 + 2 + 2 + 2) / 5 = **2.00**

## Weighted Total

```
score = 0.4 · 1.80 + 0.3 · 1.60 + 0.2 · 1.80 + 0.1 · 2.00
      = 0.720 + 0.480 + 0.360 + 0.200
      = 1.76 / 2.0
```

**Verdict**: **PASS** (≥1.7)

## What's strong

- **Fix del bug raíz aplicado y testeado**: `mediaType` explícito en ambas image parts, con test que cubre tanto el caso PNG-PNG como el jpeg-fallback. Esto es el cambio que con mayor probabilidad resuelve "no llegó ninguna imagen".
- **Bit-exactitud preview↔modelo lograda**: el composite se computa 1 sola vez en `enrichWithComposite` y se reusa en `injectScribbleImages` por referencia directa al string base64 (sin re-serialización). El test #9 lo verifica fehacientemente.
- **Separación correcta de severity**: `debug` para casos normales, `warn` para los 3 caminos degradados. No hay logs ruidosos en el happy path.
- **Retrocompatibilidad limpia**: `compositePng` y `screenshotAvailable` son opcionales en `DrawnPayload`, así que los tests viejos de `scribble.test.ts` (que no los setean) siguen pasando.
- **Validaciones de tamaño implementadas**: composite < 5KB y strokes < 500 bytes → drop con warning, con tests específicos. Esto previene que el modelo reciba bytes basura.
- **Tooling fix incidental**: eliminar el import unused en `contrast.test.ts` desbloqueó el `tsc --noEmit`. No estaba pedido pero estaba bloqueando el build.
- **Doc manual claro y ejecutable**, con cuáles bytes esperar en consola (>50_000) y qué texto del modelo cuenta como pass.

## What's weak / missing

1. **`screenshotBytes` mal calculado** (`chat-transport.ts:127-129`). El campo reporta los bytes del **composite**, no los del **screenshot crudo** que devolvió `captureActiveTab`. Eso anula el propósito diagnóstico de discriminar hipótesis A (screenshot null) vs D (composite cap-eado por el provider). El test #11 sólo valida la *presencia* del campo, no su semántica — falla en spirit del rubric.

2. **Test de zoom modal incompleto** (`DrawingPreviewCard.test.tsx:92-123`). Cubre click→abre y ESC→cierra, pero NO el click-afuera ni el botón X. La implementación existe y se ve correcta, pero el rubric pide cobertura de los 4 caminos.

3. **Thumbnail height marginal** (`DrawingPreviewCard.tsx:42-46`). Con un viewport 1280×720, la altura efectiva del thumbnail es 72px (= 128 / (1280/720)), por debajo del piso de 80px del rubric. En viewports más altos (móviles emulados) el área se hace aún más pequeña porque `maxHeight: 88px` clampea.

4. **No hay test de inspección de aspect-ratio** (rubric sec 2 check 2 pide explícitamente "test que verifica clase CSS `aspect-video` o `aspectRatio` inline").

5. **No hay test integrado de "1 sola llamada a compositeWithStrokes"** desde el flujo completo `toggleScribble + sendMessage`. El comportamiento es correcto por construcción, pero los asserts son aislados (`toHaveBeenCalledTimes(0)` en `injectScribbleImages` con composite ya seteado, y separadamente la lógica en `App.tsx`).

6. **Smoke test manual no verificable en code-only** — esperable. La spec gate-no-score, así que no descuenta. Por inspección del código sí se puede afirmar con razonable confianza que el camino feliz funcionará en browser real (la lógica está bien encadenada y los tipos cierran).

## Feedback for next iteration (if not PASS)

> Pasaste con 1.76. Los items abajo son follow-ups que llevarían el score a 1.9+; ninguno es bloqueante para mergear.

Ordenado por impacto en score:

### 1. Arreglar `screenshotBytes` real (impacto sec 1, +0.2 sec → +0.08 final)
- **Archivo**: `src/lib/chat-transport.ts:127-136`
- **Qué falta**: el campo debe reflejar los bytes del PNG raw del screenshot, no del composite.
- **Fix mínimo**:
  ```ts
  let screenshotBytes = 0
  if (precomputed) {
    // unknown unless tracked in payload — leave 0 or extend DrawnPayload
    screenshotBytes = 0
  } else {
    const shot = await captureActiveTab()
    screenshotNull = !shot
    screenshotBytes = shot ? estimateBase64Bytes(shot.data) : 0
    // … then call compositeWithStrokes(shot?.data ?? null, drawing.strokesPng)
  }
  ```
  Reestructurar la función para capturar el screenshot ANTES de decidir entre precomputed/recompute. Para el camino precomputed, considerar extender `DrawnPayload.compositePng` con `screenshotBytes?: number` o agregar `compositePng.screenshotBytes` para preservar el valor.
- **Test a sumar** en `chat-transport.test.ts`:
  ```ts
  it('screenshotBytes reflects the captured PNG size when computed in-line', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    await injectScribbleImages([{ role: 'user', content: 'hi' }], drawing)
    const payload = debugSpy.mock.calls[0][1] as any
    // SHOT mock returns 'SHOT' → 4 chars base64 → 3 bytes
    expect(payload.screenshotBytes).toBeGreaterThan(0)
    expect(payload.screenshotBytes).toBeLessThan(payload.compositeBytes)
  })
  ```

### 2. Cubrir los 4 caminos de cierre del zoom modal (impacto sec 2, +0.2 sec → +0.06 final)
- **Archivo**: `src/sidepanel/DrawingPreviewCard.test.tsx`
- **Qué falta**: tests de "cierre por click afuera" y "cierre por botón X".
- **Fix mínimo**: agregar al test #4 dos sub-cases:
  ```ts
  it('closes when clicking the backdrop', () => {
    // … mount with composite present, open modal
    const backdrop = document.querySelector('[data-testid="zoom-modal"]') as HTMLElement
    act(() => backdrop.click())
    expect(document.querySelector('[data-testid="zoom-modal"]')).toBeNull()
  })
  it('closes when clicking the X button', () => {
    // … open modal
    const closeBtn = document.querySelector('[data-testid="zoom-close"]') as HTMLButtonElement
    act(() => closeBtn.click())
    expect(document.querySelector('[data-testid="zoom-modal"]')).toBeNull()
  })
  ```

### 3. Aspect ratio: garantizar ≥80px en la dimensión menor (impacto sec 2, +0.1 sec → +0.03 final)
- **Archivo**: `src/sidepanel/DrawingPreviewCard.tsx:41-46`
- **Qué falta**: con viewport 16:9 estándar la altura termina en 72px.
- **Fix mínimo**: ajustar uno de los dos extremos:
  - Subir `width` a 144px → altura efectiva 81px.
  - O cambiar el constraint a `minHeight: 80px` cap por encima por `maxWidth: 160px`.
- **Test a sumar**:
  ```ts
  it('thumbnail honors the viewport aspect ratio inline', () => {
    const h = mount(<DrawingPreviewCard drawing={drawingWithComposite} … />)
    const btn = h.container.querySelector('button[aria-label*="previsualización"]') as HTMLButtonElement
    expect(btn.style.aspectRatio).toMatch(/^[0-9.]+$/)
  })
  ```

### 4. Test integrado "1 sola llamada a compositeWithStrokes" (impacto sec 3, +0.2 sec → +0.04 final)
- **Archivo**: nuevo o en `chat-transport.test.ts`
- **Qué falta**: un test que simule el flujo `enrichWithComposite → injectScribbleImages` con el mismo `DrawnPayload` y verifique 1 total call.
- **Fix mínimo**: extraer `enrichWithComposite` a `src/lib/composite-cache.ts` (función pura) y testear:
  ```ts
  const enriched = await enrichWithComposite(rawDrawing)
  await injectScribbleImages([{ role: 'user', content: 'hi' }], enriched)
  expect(vi.mocked(compositeWithStrokes)).toHaveBeenCalledTimes(1)
  ```

### 5. (Cosmético) Nombre del campo `screenshotReason` en `diag`
- Está presente cuando aplica pero no listado en la spec entre los 6 campos. Está bien que esté de extra, pero el doc del log podría documentarlo. Sin impacto en score.

## Smoke test manual

**No verificable en modo code-only**. Sin embargo, por inspección de código se puede inferir con confianza alta que:

- El log esperado en consola (paso 5 del doc) saldrá tal cual descrito porque `console.debug('[picanthon/scribble]', diag)` ejecuta siempre en el happy path con todos los campos.
- El composite aparecerá en la card porque `enrichWithComposite` corre async post-`setDrawing` y dispara `setDrawing(prev => …)` con `compositePng` poblado; el render condicional en `DrawingPreviewCard.tsx:48` lo recoge.
- El modelo debería referenciar visualmente el dibujo: la image part ahora lleva `mediaType: 'image/png' | 'image/jpeg'` que es lo que pedía el bloque `{ source: { type: 'base64', media_type, data } }` del provider Anthropic vía AI Gateway.

Único riesgo residual no descartable sin smoke real:
- Hipótesis D (límite del provider) sigue posible si el composite cap a 1 MB es mucho para alguna versión del Gateway. Los logs estructurados van a hacer obvio si se da: `compositeBytes ≈ 1_000_000` y la respuesta del modelo igual dice "no llegó imagen" → bajar el `MAX_COMPOSITE_BYTES` en `screenshot.ts:37` a 800_000 en Sprint 2.
