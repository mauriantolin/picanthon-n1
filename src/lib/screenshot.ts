// Screenshot helpers. Two entry points:
//   • captureActiveTab — fast, viewport-only.
//   • captureFullPage  — scrolls the page in viewport-sized steps and stitches
//                        the slices into one image. Used for design context so
//                        the LLM sees the WHOLE document, not just what was on
//                        screen when the user hit "send".
// captureVisibleTab is rate-limited to ~2/sec by Chrome — the full-page loop
// paces itself accordingly.

import { sendToActiveTab, type FullCaptureDims, type ScrollToResult } from './messaging'

export interface Screenshot {
  data: string // raw base64 (no `data:` prefix)
  mediaType: 'image/png' | 'image/jpeg'
}

export async function captureActiveTab(): Promise<Screenshot | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.windowId) {
      console.debug('[picanthon/shot] captureActiveTab: no active tab windowId')
      return null
    }
    // JPEG q=0.7 instead of PNG: a typical retina viewport PNG is 2–4 MB and
    // dominates the round-trip latency to Gemini; JPEG cuts that ~10× with no
    // visible quality loss for the design-system cues the model needs.
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 70,
    })
    const comma = dataUrl.indexOf(',')
    if (comma === -1) {
      console.debug('[picanthon/shot] captureActiveTab: malformed dataUrl')
      return null
    }
    return { data: dataUrl.slice(comma + 1), mediaType: 'image/jpeg' }
  } catch (err) {
    console.warn('[picanthon/shot] captureActiveTab failed:', err)
    return null
  }
}

const FULL_PAGE_MAX_STEPS = 6
// captureVisibleTab is throttled to ~2/sec by Chrome MV3.
const CAPTURE_THROTTLE_MS = 550
// First step doesn't need to wait the throttle window — only a paint frame.
const FIRST_STEP_DELAY_MS = 120
const FULL_PAGE_MAX_LONG_EDGE = 1600
const FULL_PAGE_MAX_PNG_BYTES = 1_500_000

// Full-page screenshot. Asks the content script for dimensions, scrolls in
// viewport-sized steps, captures each, and stitches the slices into one
// canvas. Falls back to a single-viewport capture when the page already fits.
export async function captureFullPage(): Promise<Screenshot | null> {
  const t0 = performance.now()
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.windowId) {
      console.debug('[picanthon/shot] captureFullPage: no active tab')
      return null
    }

    const dims = await sendToActiveTab<FullCaptureDims>({ type: 'BEGIN_FULL_CAPTURE' })
    console.info('[picanthon/shot] full-page dims', dims)

    const { pageHeight, viewportHeight, originalScrollY } = dims

    if (pageHeight <= viewportHeight + 4) {
      console.info('[picanthon/shot] page fits in one viewport — fast path')
      return captureActiveTab()
    }

    const steps = Math.min(FULL_PAGE_MAX_STEPS, Math.ceil(pageHeight / viewportHeight))
    console.info('[picanthon/shot] full-page plan', { steps, viewportHeight, pageHeight })

    const shots: { actualY: number; data: string }[] = []

    try {
      for (let i = 0; i < steps; i++) {
        const y = i * viewportHeight
        const { actualY } = await sendToActiveTab<ScrollToResult>({ type: 'SCROLL_TO', y })
        await sleep(i === 0 ? FIRST_STEP_DELAY_MS : CAPTURE_THROTTLE_MS)
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
        const comma = dataUrl.indexOf(',')
        if (comma === -1) {
          console.warn('[picanthon/shot] step', i, 'malformed dataUrl, skipping')
          continue
        }
        const data = dataUrl.slice(comma + 1)
        shots.push({ actualY, data })
        console.debug('[picanthon/shot] step', i, {
          requestedY: y,
          actualY,
          bytes: estimateBase64Bytes(data),
        })
      }
    } finally {
      await sendToActiveTab({ type: 'END_FULL_CAPTURE', restoreY: originalScrollY }).catch(
        (err) => console.warn('[picanthon/shot] restore scroll failed', err),
      )
    }

    if (shots.length === 0) {
      console.warn('[picanthon/shot] no shots captured, returning null')
      return null
    }

    const stitched = await stitchShots(shots, viewportHeight)
    console.info('[picanthon/shot] full-page done', {
      ms: Math.round(performance.now() - t0),
      shots: shots.length,
      finalBytes: stitched ? estimateBase64Bytes(stitched.data) : 0,
      mediaType: stitched?.mediaType,
    })
    return stitched
  } catch (err) {
    console.warn('[picanthon/shot] captureFullPage failed:', err)
    return null
  }
}

async function stitchShots(
  shots: { actualY: number; data: string }[],
  viewportHeightLogical: number,
): Promise<Screenshot | null> {
  const images = await Promise.all(
    shots.map((s) => loadImage(`data:image/png;base64,${s.data}`)),
  )
  if (images.length === 0) return null

  const pixelRatio = images[0].naturalHeight / viewportHeightLogical
  const maxBottom = shots.reduce(
    (m, s) => Math.max(m, s.actualY + viewportHeightLogical),
    0,
  )

  const canvas = document.createElement('canvas')
  canvas.width = images[0].naturalWidth
  canvas.height = Math.round(maxBottom * pixelRatio)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    console.warn('[picanthon/shot] stitch: no 2D context')
    return null
  }

  for (let i = 0; i < images.length; i++) {
    ctx.drawImage(images[i], 0, Math.round(shots[i].actualY * pixelRatio))
  }

  const longEdge = Math.max(canvas.width, canvas.height)
  let out: HTMLCanvasElement = canvas
  if (longEdge > FULL_PAGE_MAX_LONG_EDGE) {
    const scale = FULL_PAGE_MAX_LONG_EDGE / longEdge
    const scaled = document.createElement('canvas')
    scaled.width = Math.max(1, Math.round(canvas.width * scale))
    scaled.height = Math.max(1, Math.round(canvas.height * scale))
    const sctx = scaled.getContext('2d')
    if (sctx) {
      sctx.drawImage(canvas, 0, 0, scaled.width, scaled.height)
      out = scaled
      console.debug('[picanthon/shot] downscaled', {
        from: { w: canvas.width, h: canvas.height },
        to: { w: scaled.width, h: scaled.height },
      })
    }
  }

  const png = out.toDataURL('image/png')
  if (estimateBase64Bytes(png) <= FULL_PAGE_MAX_PNG_BYTES) {
    return stripToScreenshot(png, 'image/png')
  }
  const jpeg = out.toDataURL('image/jpeg', 0.85)
  return stripToScreenshot(jpeg, 'image/jpeg')
}

function stripToScreenshot(
  dataUrl: string,
  mediaType: 'image/png' | 'image/jpeg',
): Screenshot | null {
  const comma = dataUrl.indexOf(',')
  if (comma === -1) return null
  return { data: dataUrl.slice(comma + 1), mediaType }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

function stripDataPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? '' : dataUrl.slice(comma + 1)
}

// Exported so chat-transport and composite-cache can report consistent byte
// sizes in diagnostics (raw screenshot vs composite vs strokes), without each
// caller rolling its own off-by-one.
export function estimateBase64Bytes(data: string): number {
  const comma = data.indexOf(',')
  const len = comma === -1 ? data.length : data.length - comma - 1
  return Math.floor((len * 3) / 4)
}

const LLM_MAX_EDGE = 1280
const LLM_JPEG_QUALITY = 0.7

// Downscale the captured tab screenshot before sending it to the LLM. Retina
// captures are often 2880×1800; nothing the model uses (palette, scale,
// hierarchy) needs more than ~1280px long edge. Cuts upload + image-processing
// time substantially without hurting quality.
export async function downscaleForLLM(shot: Screenshot): Promise<Screenshot> {
  try {
    const img = await loadImage(`data:${shot.mediaType};base64,${shot.data}`)
    if (Math.max(img.naturalWidth, img.naturalHeight) <= LLM_MAX_EDGE) return shot
    const scale = LLM_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight)
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return shot
    ctx.drawImage(img, 0, 0, w, h)
    const jpeg = canvas.toDataURL('image/jpeg', LLM_JPEG_QUALITY)
    return { data: stripDataPrefix(jpeg), mediaType: 'image/jpeg' }
  } catch (err) {
    console.warn('[picanthon] downscaleForLLM failed:', err)
    return shot
  }
}

const THUMB_MAX_EDGE = 480
const THUMB_JPEG_QUALITY = 0.7

export interface Thumbnail {
  data: string
  mediaType: 'image/jpeg'
  width: number
  height: number
}

// Downscale a captured screenshot to a small JPEG for the chat UI preview.
// Purely for keeping message history light.
export async function makeThumbnail(
  data: string,
  mediaType: 'image/png' | 'image/jpeg' = 'image/jpeg',
): Promise<Thumbnail | null> {
  try {
    const img = await loadImage(`data:${mediaType};base64,${data}`)
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const jpeg = canvas.toDataURL('image/jpeg', THUMB_JPEG_QUALITY)
    return { data: stripDataPrefix(jpeg), mediaType: 'image/jpeg', width: w, height: h }
  } catch (err) {
    console.warn('[picanthon] makeThumbnail failed:', err)
    return null
  }
}
