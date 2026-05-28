# Smoke test manual: scribble multimodal

Verificación end-to-end de que el dibujo llega al modelo y la respuesta lo
referencia visualmente. Tiempo estimado: 3 minutos.

## Prerrequisitos

- Extensión instalada en Chrome (cargada desde `dist/` tras `npm run build`).
- API key del Vercel AI Gateway configurada en **Settings**.
- Modelo seleccionado: `anthropic/claude-sonnet-4.6` (o cualquier modelo
  vision-capable; ver `isVisionCapable` en `App.tsx`).

## Pasos

1. **Abrir una página real con contenido visible**. Por ejemplo
   `https://news.ycombinator.com`. Activar el side panel de Picanthon
   (clic en el icono de la extensión, "Open side panel").

2. **Activar el modo scribble**. Hacer clic en el botón con icono de lápiz
   en el toolbar del prompt. El cursor se transforma en pluma sobre la
   página y aparece un HUD inferior derecho con los botones
   `↶`/`✕`/`Esc`/`Enviar`.

3. **Dibujar un círculo sobre el primer título visible de la página**
   (un `<a class="storylink">` en HN). Apretar `Enter` o el botón
   `Enviar`. El overlay desaparece y la card de preview aparece encima
   del input.

4. **Verificar la card de preview**.
   - El thumbnail (≈128×72 px) debe mostrar el composite: el screenshot
     de la página con el círculo rosa encima. Si la card aún muestra
     "componiendo…" esperar 1-2 segundos.
   - Hacer clic en el thumbnail → debe abrirse un modal de zoom con la
     imagen a tamaño completo. Cerrar con `Esc`.
   - El badge circular `1` (o el número de elementos cubiertos) debe
     aparecer al lado de "Dibujo", **sin tapar** el thumbnail.

5. **Mandar el mensaje**. Tipear `qué dibujé?` en el textarea y mandar.
   Abrir la consola del side panel (clic derecho dentro del side panel →
   `Inspeccionar`) y filtrar por `[picanthon/scribble]`. Verificar:
   - **Una sola** línea `debug` con `screenshotBytes`, `strokesBytes`,
     `compositeBytes` (> 50_000), `compositeMediaType` igual a `image/png`
     o `image/jpeg`, `compositeDimensions { w, h }`, `screenshotNull: false`.
   - La respuesta del modelo describe **visualmente** lo dibujado
     (ej: "veo un círculo rosa alrededor del título 'Show HN…'") y
     **no** dice "no llegó ninguna imagen".

## Resultado esperado

- ✅ Composite visible en la card y en el zoom modal.
- ✅ Log estructurado bajo `[picanthon/scribble]` con los 6 campos.
- ✅ Modelo confirma haber visto el dibujo.

Si alguno falla, capturar el contenido del log y archivar en
`gan-harness/feedback/` para análisis (descartar hipótesis A/B/D
residuales con los bytes y dimensiones de la línea de debug).
