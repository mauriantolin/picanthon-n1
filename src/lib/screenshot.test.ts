import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// jsdom does not implement HTMLCanvasElement.prototype.getContext for real 2D
// rendering, so most of these tests mock toDataURL + the HTMLImageElement
// `onload` callback to exercise the branching logic of compositeWithStrokes
// without depending on actual pixel composition. Tests that need real canvas
// rendering are marked `.skip` with the reason inline.

interface MockImage {
  src: string
  naturalWidth: number
  naturalHeight: number
  onload: (() => void) | null
  onerror: (() => void) | null
}

let imageDimensions: { width: number; height: number }

function stubCanvasContext(): { fillRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn>; fakeCtx: Partial<CanvasRenderingContext2D> } {
  const fillRect = vi.fn()
  const drawImage = vi.fn()
  const fakeCtx: Partial<CanvasRenderingContext2D> = {
    drawImage,
    fillRect,
    fillStyle: '#000000',
  }
  type Ctx2D = ReturnType<HTMLCanvasElement['getContext']>
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    fakeCtx as unknown as Ctx2D,
  )
  return { fillRect, drawImage, fakeCtx }
}

beforeEach(() => {
  imageDimensions = { width: 800, height: 600 }
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = imageDimensions.width
      naturalHeight = imageDimensions.height
      private _src = ''
      get src() {
        return this._src
      }
      set src(value: string) {
        this._src = value
        Promise.resolve().then(() => this.onload?.())
      }
    } as unknown as typeof Image,
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('compositeWithStrokes', () => {
  it('returns PNG when the resulting bytes are under the 1 MB threshold', async () => {
    stubCanvasContext()
    const toDataURLSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/png;base64,' + 'A'.repeat(2000))
    const { compositeWithStrokes } = await import('./screenshot')
    const result = await compositeWithStrokes('SHOT', 'STROKES')
    expect(result.mediaType).toBe('image/png')
    expect(result.data).toBe('A'.repeat(2000))
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
    expect(toDataURLSpy).toHaveBeenCalled()
  })

  it('falls back to JPEG when the PNG would exceed 1 MB', async () => {
    stubCanvasContext()
    const png = 'data:image/png;base64,' + 'P'.repeat(2_000_000)
    const jpeg = 'data:image/jpeg;base64,' + 'J'.repeat(500_000)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
      (type?: string) => (type === 'image/jpeg' ? jpeg : png),
    )
    const { compositeWithStrokes } = await import('./screenshot')
    const result = await compositeWithStrokes('SHOT', 'STROKES')
    expect(result.mediaType).toBe('image/jpeg')
    expect(result.data).toBe('J'.repeat(500_000))
  })

  it('uses a white background when screenshot is null', async () => {
    const { fakeCtx, fillRect } = stubCanvasContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,WHITE',
    )
    const { compositeWithStrokes } = await import('./screenshot')
    await compositeWithStrokes(null, 'STROKES')
    expect(fakeCtx.fillStyle).toBe('#ffffff')
    expect(fillRect).toHaveBeenCalledWith(0, 0, expect.any(Number), expect.any(Number))
  })

  it('downscales when the long edge exceeds 1600', async () => {
    imageDimensions = { width: 3200, height: 1800 }
    stubCanvasContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,SMALL',
    )
    const { compositeWithStrokes } = await import('./screenshot')
    const result = await compositeWithStrokes('SHOT', 'STROKES')
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(1600)
    expect(result.width).toBe(1600)
    expect(result.height).toBe(900)
  })

  it('returns non-empty bytes for a non-trivial input (anti-regression for hypothesis B)', async () => {
    stubCanvasContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,' + 'X'.repeat(2000),
    )
    const { compositeWithStrokes } = await import('./screenshot')
    const result = await compositeWithStrokes('SHOT', 'STROKES')
    expect(result.data.length).toBeGreaterThan(500)
  })

  // Real canvas rendering tests are intentionally skipped: jsdom does not
  // implement the 2D rendering context, so any assertion on actual pixel
  // contents would be meaningless. The smoke test in
  // docs/scribble-manual-test.md covers this path in a real browser.
  it.skip('actually composes strokes over the screenshot (requires real canvas)', () => {
    expect(true).toBe(true)
  })
})

// Silence unused warning for the imported type at the top of the test.
export type _Unused = MockImage
