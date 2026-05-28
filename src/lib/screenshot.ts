// Capture the visible area of the active tab as a PNG. Runs in the side panel
// (chrome.tabs.captureVisibleTab requires either `<all_urls>` host permission
// or `activeTab` — we have both via the manifest). Returns the raw base64 PNG
// + mediaType so it can be fed back to the agent via a tool result's
// `toModelOutput`, which lets vision-capable models see the result of their
// own tweaks and self-correct.

export interface Screenshot {
  data: string // raw base64 (no `data:` prefix)
  mediaType: 'image/png'
}

export async function captureActiveTab(): Promise<Screenshot | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.windowId) {
      console.debug('[picanthon] captureActiveTab: no active tab windowId')
      return null
    }
    // PNG is lossless and avoids JPEG artifacts on UI screenshots.
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png',
    })
    // dataUrl looks like "data:image/png;base64,iVBORw0KGgo..." — strip the prefix.
    const comma = dataUrl.indexOf(',')
    if (comma === -1) {
      console.debug('[picanthon] captureActiveTab: malformed dataUrl')
      return null
    }
    return { data: dataUrl.slice(comma + 1), mediaType: 'image/png' }
  } catch (err) {
    console.warn('[picanthon] captureActiveTab failed:', err)
    return null
  }
}

const MAX_COMPOSITE_BYTES = 1_000_000
const MAX_LONG_EDGE = 1600

// Compose strokes PNG over a viewport screenshot. Returns a base64 image, JPEG
// at q=0.85 if the PNG would exceed 1 MB. Runs in the side panel where canvas
// is real (the content script can't get the screenshot anyway). When the
// screenshot is null (captureVisibleTab failed), pad the strokes with a white
// background at the strokes' own resolution — the model still gets the gesture
// with readable strokes, just without page context.
export interface CompositeResult {
  data: string
  mediaType: 'image/png' | 'image/jpeg'
  width: number
  height: number
}

export async function compositeWithStrokes(
  screenshotPngBase64: string | null,
  strokesPngBase64: string,
): Promise<CompositeResult> {
  const strokes = await loadImage(`data:image/png;base64,${strokesPngBase64}`)

  const screenshot = screenshotPngBase64
    ? await loadImage(`data:image/png;base64,${screenshotPngBase64}`).catch(() => null)
    : null

  const baseW = screenshot?.naturalWidth ?? strokes.naturalWidth
  const baseH = screenshot?.naturalHeight ?? strokes.naturalHeight

  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(baseW, baseH))
  const w = Math.max(1, Math.round(baseW * scale))
  const h = Math.max(1, Math.round(baseH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return { data: stripDataPrefix(strokes.src), mediaType: 'image/png', width: w, height: h }

  if (screenshot) {
    ctx.drawImage(screenshot, 0, 0, w, h)
  } else {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
  }
  ctx.drawImage(strokes, 0, 0, w, h)

  const png = canvas.toDataURL('image/png')
  if (estimateBase64Bytes(png) <= MAX_COMPOSITE_BYTES) {
    return { data: stripDataPrefix(png), mediaType: 'image/png', width: w, height: h }
  }
  const jpeg = canvas.toDataURL('image/jpeg', 0.85)
  return { data: stripDataPrefix(jpeg), mediaType: 'image/jpeg', width: w, height: h }
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
