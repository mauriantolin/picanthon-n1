// Scribble overlay. Mounts a transparent Shadow-DOM host over the viewport that
// captures pointer events on a <canvas>, lets the user draw strokes, and resolves
// with a DrawnPayload (PNG + strokes bbox + covered elements). The composite
// PNG with the page screenshot is built later in the side panel — this module
// stays free of chrome.* so it remains unit-testable under jsdom.

import type { DrawnPayload, DrawResult } from '@/lib/messaging'
import {
  bboxOfStrokes,
  extractCoveredElements,
  smoothPath,
  widthsBySpeed,
  type Point,
  type Stroke,
} from './scribble-paths'

const HOST_ATTR = 'data-picanthon'
const HOST_VALUE = 'scribble'
const COLOR_PRIMARY = '#FF3E7F'
const COLOR_SECONDARY = 'rgba(71, 85, 105, 0.7)'
const PEN_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23FF3E7F' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 19l7-7 3 3-7 7-3-3z'/><path d='M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z'/><path d='M2 2l7.586 7.586'/><circle cx='11' cy='11' r='2'/></svg>\") 2 22, crosshair"

interface ActiveSession {
  host: HTMLElement
  shadow: ShadowRoot
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D | null
  strokes: Stroke[]
  currentStroke: Stroke | null
  currentTimestamps: number[]
  color: string
  rafScheduled: boolean
  resolve: (result: DrawResult) => void
  detach: () => void
  rasterize: () => string
}

let active: ActiveSession | null = null

export interface StartDrawOptions {
  // Test-only: override elementFromPoint when sampling coveredElements.
  elementFromPoint?: (x: number, y: number) => Element | null
  // Test-only: override the PNG rasterizer (jsdom canvas returns 'data:,').
  rasterize?: (canvas: HTMLCanvasElement, strokes: Stroke[]) => string
}

export function startDraw(options: StartDrawOptions = {}): Promise<DrawResult> {
  if (active) cancelDraw()

  return new Promise<DrawResult>((resolve) => {
    const viewport = {
      width: window.innerWidth || document.documentElement.clientWidth || 0,
      height: window.innerHeight || document.documentElement.clientHeight || 0,
    }

    const host = document.createElement('div')
    host.setAttribute(HOST_ATTR, HOST_VALUE)
    host.style.cssText =
      'position:fixed;inset:0;pointer-events:auto;z-index:2147483647;'
    const shadow = host.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = stylesheet()
    shadow.appendChild(style)

    const canvas = document.createElement('canvas')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.round(viewport.width * dpr))
    canvas.height = Math.max(1, Math.round(viewport.height * dpr))
    canvas.style.cssText = `position:absolute;inset:0;width:${viewport.width}px;height:${viewport.height}px;cursor:${PEN_CURSOR};touch-action:none;`
    shadow.appendChild(canvas)

    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(dpr, dpr)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
    }

    const hud = buildHud()
    shadow.appendChild(hud.root)

    document.body.appendChild(host)
    const previousCursor = document.body.style.cursor
    document.body.style.cursor = 'none'

    const rasterize = () =>
      options.rasterize
        ? options.rasterize(canvas, session.strokes)
        : extractPngBase64(canvas.toDataURL('image/png'))

    const session: ActiveSession = {
      host,
      shadow,
      canvas,
      ctx,
      strokes: [],
      currentStroke: null,
      currentTimestamps: [],
      color: COLOR_PRIMARY,
      rafScheduled: false,
      resolve,
      detach: () => {},
      rasterize,
    }

    const scheduleRender = () => {
      if (session.rafScheduled) return
      session.rafScheduled = true
      requestAnimationFrame(() => {
        session.rafScheduled = false
        render(session)
      })
    }

    const onPointerDown = (e: PointerEvent | MouseEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
      const { x, y } = pointFromEvent(e, canvas)
      session.currentStroke = { points: [{ x, y }], color: session.color, widths: [4] }
      session.currentTimestamps = [eventTimestamp(e)]
      if ('pointerId' in e && (canvas as HTMLCanvasElement).setPointerCapture) {
        try {
          canvas.setPointerCapture((e as PointerEvent).pointerId)
        } catch {
          /* ignore — not all environments support pointer capture */
        }
      }
    }
    const onPointerMove = (e: PointerEvent | MouseEvent) => {
      if (!session.currentStroke) return
      e.preventDefault()
      const { x, y } = pointFromEvent(e, canvas)
      session.currentStroke.points.push({ x, y })
      session.currentTimestamps.push(eventTimestamp(e))
      const ws = widthsBySpeed(
        session.currentStroke.points,
        session.currentTimestamps,
      )
      session.currentStroke.widths = ws
      scheduleRender()
    }
    const onPointerUp = (e: PointerEvent | MouseEvent) => {
      if (!session.currentStroke) return
      e.preventDefault()
      if (session.currentStroke.points.length >= 2) {
        session.strokes.push(session.currentStroke)
      }
      session.currentStroke = null
      session.currentTimestamps = []
      scheduleRender()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        finish({ cancelled: true })
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopImmediatePropagation()
        trySubmit()
        return
      }
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        session.strokes.pop()
        scheduleRender()
        return
      }
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        session.strokes.length = 0
        scheduleRender()
        return
      }
      if (e.key === 'x' || e.key === 'X') {
        e.preventDefault()
        session.color = session.color === COLOR_PRIMARY ? COLOR_SECONDARY : COLOR_PRIMARY
        hud.updateColor(session.color)
        return
      }
    }

    const onVisibilityChange = () => {
      if (document.hidden) finish({ cancelled: true })
    }

    // HUD buttons
    hud.onUndo(() => {
      session.strokes.pop()
      scheduleRender()
    })
    hud.onClear(() => {
      session.strokes.length = 0
      scheduleRender()
    })
    hud.onToggleColor(() => {
      session.color = session.color === COLOR_PRIMARY ? COLOR_SECONDARY : COLOR_PRIMARY
      hud.updateColor(session.color)
    })
    hud.onCancel(() => finish({ cancelled: true }))
    hud.onSubmit(() => trySubmit())

    canvas.addEventListener('pointerdown', onPointerDown as EventListener)
    canvas.addEventListener('pointermove', onPointerMove as EventListener)
    canvas.addEventListener('pointerup', onPointerUp as EventListener)
    canvas.addEventListener('pointercancel', onPointerUp as EventListener)
    // Fallback for environments without PointerEvent (some jsdom setups).
    canvas.addEventListener('mousedown', onPointerDown as EventListener)
    canvas.addEventListener('mousemove', onPointerMove as EventListener)
    canvas.addEventListener('mouseup', onPointerUp as EventListener)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('visibilitychange', onVisibilityChange)

    const detach = () => {
      canvas.removeEventListener('pointerdown', onPointerDown as EventListener)
      canvas.removeEventListener('pointermove', onPointerMove as EventListener)
      canvas.removeEventListener('pointerup', onPointerUp as EventListener)
      canvas.removeEventListener('pointercancel', onPointerUp as EventListener)
      canvas.removeEventListener('mousedown', onPointerDown as EventListener)
      canvas.removeEventListener('mousemove', onPointerMove as EventListener)
      canvas.removeEventListener('mouseup', onPointerUp as EventListener)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      host.remove()
      document.body.style.cursor = previousCursor
      active = null
    }
    session.detach = detach

    const finish = (result: DrawResult) => {
      detach()
      resolve(result)
    }

    const trySubmit = () => {
      if (session.strokes.length === 0) return
      const payload = buildPayload(session, viewport, options.elementFromPoint)
      detach()
      resolve(payload)
    }

    active = session
  })
}

export function cancelDraw(): void {
  if (!active) return
  const { resolve, detach } = active
  detach()
  resolve({ cancelled: true })
}

function buildPayload(
  session: ActiveSession,
  viewport: { width: number; height: number },
  elementFromPoint?: (x: number, y: number) => Element | null,
): DrawnPayload {
  const strokesPng = session.rasterize()
  const bbox = bboxOfStrokes(session.strokes)
  // Host is already detached by the caller — elementFromPoint resolves real
  // page elements, not the overlay.
  const coveredElements = extractCoveredElements(session.strokes, {
    elementFromPoint,
    rootHostAttr: HOST_ATTR,
  })
  return {
    strokesPng,
    bbox,
    viewport,
    coveredElements,
  }
}

function extractPngBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? '' : dataUrl.slice(comma + 1)
}

function pointFromEvent(e: PointerEvent | MouseEvent, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function eventTimestamp(e: Event): number {
  return typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : performance.now()
}

function render(session: ActiveSession): void {
  const ctx = session.ctx
  if (!ctx) return
  const w = session.canvas.width
  const h = session.canvas.height
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.restore()

  const all = session.currentStroke
    ? [...session.strokes, session.currentStroke]
    : session.strokes
  for (const stroke of all) {
    drawStroke(ctx, stroke)
  }
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  if (stroke.points.length < 2) return
  const smoothed = smoothPath(stroke.points, 6)
  ctx.strokeStyle = stroke.color
  // Average width gives a stable look; per-segment tapering is best-effort.
  const avgWidth =
    stroke.widths.length > 0
      ? stroke.widths.reduce((a, b) => a + b, 0) / stroke.widths.length
      : 3
  ctx.lineWidth = avgWidth
  ctx.beginPath()
  ctx.moveTo(smoothed[0].x, smoothed[0].y)
  for (let i = 1; i < smoothed.length; i++) {
    ctx.lineTo(smoothed[i].x, smoothed[i].y)
  }
  ctx.stroke()
}

function stylesheet(): string {
  return `
    :host { all: initial; }
    .hud {
      position: fixed;
      right: 16px;
      bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: rgba(17, 17, 19, 0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      color: rgba(255, 255, 255, 0.92);
      font: 600 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
      pointer-events: auto;
      user-select: none;
    }
    .hud button {
      all: unset;
      cursor: pointer;
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      color: rgba(255, 255, 255, 0.85);
      border: 1px solid transparent;
    }
    .hud button:hover { background: rgba(255, 255, 255, 0.08); }
    .hud .send {
      background: ${COLOR_PRIMARY};
      color: white;
      padding: 0 12px;
      width: auto;
      height: 28px;
      font-weight: 700;
    }
    .hud .send:hover { background: #ff528e; }
    .hud .legend {
      color: rgba(255, 255, 255, 0.55);
      padding-left: 4px;
      letter-spacing: 0.02em;
    }
    .color-swatch {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.85);
    }
  `
}

interface Hud {
  root: HTMLElement
  updateColor: (color: string) => void
  onUndo: (cb: () => void) => void
  onClear: (cb: () => void) => void
  onToggleColor: (cb: () => void) => void
  onCancel: (cb: () => void) => void
  onSubmit: (cb: () => void) => void
}

function buildHud(): Hud {
  const root = document.createElement('div')
  root.className = 'hud'

  const colorBtn = document.createElement('button')
  colorBtn.title = 'Cambiar color (X)'
  const swatch = document.createElement('span')
  swatch.className = 'color-swatch'
  swatch.style.background = COLOR_PRIMARY
  colorBtn.appendChild(swatch)

  const undoBtn = iconButton(
    '↶',
    'Deshacer (Z)',
  )
  const clearBtn = iconButton('✕', 'Limpiar (C)')
  const cancelBtn = iconButton('Esc', 'Cancelar')
  cancelBtn.style.width = 'auto'
  cancelBtn.style.padding = '0 10px'
  cancelBtn.style.fontSize = '11px'

  const legend = document.createElement('span')
  legend.className = 'legend'
  legend.textContent = 'ESC cancela · Enter envía'

  const sendBtn = document.createElement('button')
  sendBtn.className = 'send'
  sendBtn.textContent = 'Enviar'
  sendBtn.title = 'Enviar dibujo (Enter)'

  root.append(colorBtn, undoBtn, clearBtn, legend, cancelBtn, sendBtn)

  return {
    root,
    updateColor: (color) => {
      swatch.style.background = color
    },
    onUndo: (cb) => undoBtn.addEventListener('click', cb),
    onClear: (cb) => clearBtn.addEventListener('click', cb),
    onToggleColor: (cb) => colorBtn.addEventListener('click', cb),
    onCancel: (cb) => cancelBtn.addEventListener('click', cb),
    onSubmit: (cb) => sendBtn.addEventListener('click', cb),
  }
}

function iconButton(label: string, title: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.title = title
  btn.textContent = label
  return btn
}

// Test-only: inject a finished stroke into the active session. jsdom does not
// implement layout for pointer event coordinates well enough to make a realistic
// stroke; this lets the test suite cover Enter-with-strokes and undo/clear.
export function _appendStrokeForTest(stroke: Stroke): void {
  if (!active) throw new Error('no active scribble session')
  active.strokes.push(stroke)
}
