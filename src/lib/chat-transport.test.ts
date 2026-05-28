import { describe, it, expect, vi, beforeEach } from 'vitest'
import { injectScribbleImages } from './chat-transport'
import { enrichWithComposite } from './composite-cache'
import type { DrawnPayload } from './messaging'
import type { ModelMessage } from 'ai'

vi.mock('./screenshot', async () => {
  const actual =
    await vi.importActual<typeof import('./screenshot')>('./screenshot')
  return {
    ...actual,
    captureActiveTab: vi.fn(async () => ({
      data: 'SHOT'.repeat(50),
      mediaType: 'image/png',
    })),
    compositeWithStrokes: vi.fn(async () => ({
      data: 'X'.repeat(8000),
      mediaType: 'image/png' as const,
      width: 1280,
      height: 720,
    })),
  }
})

const drawing: DrawnPayload = {
  strokesPng: 'S'.repeat(1200),
  bbox: { x: 0, y: 0, width: 50, height: 50 },
  viewport: { width: 1280, height: 720 },
  coveredElements: [{ selector: '#x', tag: 'div', coverage: 0.9 }],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('injectScribbleImages', () => {
  it('returns the prompt unchanged when drawing is null', async () => {
    const prompt: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    const out = await injectScribbleImages(prompt, null)
    expect(out).toBe(prompt)
  })

  it('appends strokes + composite image parts as data: URLs (Anthropic adapter never drops this form)', async () => {
    const prompt: ModelMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ]
    const out = await injectScribbleImages(prompt, drawing)
    expect(out).not.toBe(prompt)
    const last = out[out.length - 1]
    expect(last.role).toBe('user')
    expect(Array.isArray(last.content)).toBe(true)
    const parts = last.content as Array<{ type: string; image?: string }>
    const imageParts = parts.filter((p) => p.type === 'image')
    expect(imageParts).toHaveLength(2)
    expect(imageParts[0].image).toBe(`data:image/png;base64,${drawing.strokesPng}`)
    expect(imageParts[1].image).toBe(`data:image/png;base64,${'X'.repeat(8000)}`)
    expect(imageParts[0].image?.startsWith('data:image/')).toBe(true)
    expect(imageParts[1].image?.startsWith('data:image/')).toBe(true)
  })

  it('still composes when the screenshot fails (composite uses white background)', async () => {
    const screenshot = await import('./screenshot')
    vi.mocked(screenshot.captureActiveTab).mockResolvedValueOnce(null)
    const prompt: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    const out = await injectScribbleImages(prompt, drawing)
    const last = out[out.length - 1]
    const parts = last.content as Array<{ type: string }>
    const imageParts = parts.filter((p) => p.type === 'image')
    expect(imageParts).toHaveLength(2)
    const withImage = imageParts as Array<{ type: string; image?: string }>
    expect(withImage[0].image?.startsWith('data:image/png;base64,')).toBe(true)
    expect(vi.mocked(screenshot.compositeWithStrokes)).toHaveBeenCalledWith(null, drawing.strokesPng)
  })

  it('falls back to strokes-only when both screenshot and composite fail', async () => {
    const screenshot = await import('./screenshot')
    vi.mocked(screenshot.captureActiveTab).mockResolvedValueOnce(null)
    vi.mocked(screenshot.compositeWithStrokes).mockRejectedValueOnce(new Error('boom'))
    const prompt: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    const out = await injectScribbleImages(prompt, drawing)
    const last = out[out.length - 1]
    const parts = last.content as Array<{ type: string }>
    const imageParts = parts.filter((p) => p.type === 'image')
    expect(imageParts).toHaveLength(1)
  })

  it('preserves prior structured content of the user message', async () => {
    const prompt: ModelMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'movelo acá' }],
      },
    ]
    const out = await injectScribbleImages(prompt, drawing)
    const parts = out[0].content as Array<{ type: string; text?: string }>
    expect(parts[0].type).toBe('text')
    expect(parts[0].text).toBe('movelo acá')
    expect(parts.filter((p) => p.type === 'image').length).toBeGreaterThan(0)
  })

  it('returns the original prompt when no user message exists', async () => {
    const prompt: ModelMessage[] = [{ role: 'assistant', content: 'hi' }]
    const out = await injectScribbleImages(prompt, drawing)
    expect(out).toBe(prompt)
  })

  it('mediaType is always set on every image part', async () => {
    const prompt: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    const out = await injectScribbleImages(prompt, drawing)
    const last = out[out.length - 1]
    const parts = last.content as Array<{ type: string; mediaType?: string }>
    const imageParts = parts.filter((p) => p.type === 'image')
    expect(imageParts).toHaveLength(2)
    expect(imageParts[0].mediaType).toBe('image/png')
    expect(imageParts[1].mediaType).toBe('image/png')
    for (const part of imageParts) {
      expect(part.mediaType).toBeDefined()
    }
  })

  it('mediaType reflects the value returned by compositeWithStrokes (jpeg fallback)', async () => {
    const screenshot = await import('./screenshot')
    vi.mocked(screenshot.compositeWithStrokes).mockResolvedValueOnce({
      data: 'Y'.repeat(8000),
      mediaType: 'image/jpeg',
      width: 1600,
      height: 900,
    })
    const prompt: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    const out = await injectScribbleImages(prompt, drawing)
    const parts = out[out.length - 1].content as Array<{ type: string; mediaType?: string }>
    const imageParts = parts.filter((p) => p.type === 'image')
    expect(imageParts[1].mediaType).toBe('image/jpeg')
  })

  it('reuses pre-computed composite from drawing payload without re-invoking compositeWithStrokes', async () => {
    const screenshot = await import('./screenshot')
    const drawingWithComposite: DrawnPayload = {
      ...drawing,
      compositePng: {
        data: 'Z'.repeat(8000),
        mediaType: 'image/png',
        width: 1280,
        height: 720,
      },
      screenshotAvailable: true,
    }
    const prompt: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    const out = await injectScribbleImages(prompt, drawingWithComposite)
    expect(vi.mocked(screenshot.compositeWithStrokes)).toHaveBeenCalledTimes(0)
    expect(vi.mocked(screenshot.captureActiveTab)).toHaveBeenCalledTimes(0)
    const parts = out[out.length - 1].content as Array<{ type: string; image?: string }>
    const imageParts = parts.filter((p) => p.type === 'image')
    expect(imageParts[1].image).toBe(`data:image/png;base64,${'Z'.repeat(8000)}`)
  })

  it('logs structured diagnostics with all 6 fields under [picanthon/scribble] tag', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const prompt: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    await injectScribbleImages(prompt, drawing)
    const call = debugSpy.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('[picanthon/scribble]'),
    )
    expect(call).toBeDefined()
    const payload = call![1] as Record<string, unknown>
    expect(payload).toHaveProperty('screenshotBytes')
    expect(payload).toHaveProperty('strokesBytes')
    expect(payload).toHaveProperty('compositeBytes')
    expect(payload).toHaveProperty('compositeMediaType')
    expect(payload).toHaveProperty('compositeDimensions')
    expect(payload).toHaveProperty('screenshotNull')
    debugSpy.mockRestore()
  })

  it('drops near-empty composite (< 5KB) and warns with all diagnostics', async () => {
    const screenshot = await import('./screenshot')
    vi.mocked(screenshot.compositeWithStrokes).mockResolvedValueOnce({
      data: 'A'.repeat(100),
      mediaType: 'image/png',
      width: 100,
      height: 100,
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const prompt: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    const out = await injectScribbleImages(prompt, drawing)
    const parts = out[out.length - 1].content as Array<{ type: string; image?: string }>
    const imageParts = parts.filter((p) => p.type === 'image')
    expect(imageParts).toHaveLength(1)
    expect(imageParts[0].image).toBe(`data:image/png;base64,${drawing.strokesPng}`)
    const warnCall = warnSpy.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('[picanthon/scribble]'),
    )
    expect(warnCall).toBeDefined()
    warnSpy.mockRestore()
  })

  it('screenshotBytes reflects the captured PNG size and stays below compositeBytes on the in-line path', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const prompt: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    await injectScribbleImages(prompt, drawing)
    const call = debugSpy.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('[picanthon/scribble]'),
    )
    expect(call).toBeDefined()
    const payload = call![1] as {
      screenshotBytes: number
      compositeBytes: number
      precomputed: boolean
    }
    expect(payload.precomputed).toBe(false)
    expect(payload.screenshotBytes).toBeGreaterThan(0)
    expect(payload.screenshotBytes).toBeLessThan(payload.compositeBytes)
    debugSpy.mockRestore()
  })

  it('marks screenshotBytes as undefined and precomputed=true when the composite is supplied by the caller', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const drawingWithComposite: DrawnPayload = {
      ...drawing,
      compositePng: {
        data: 'Z'.repeat(8000),
        mediaType: 'image/png',
        width: 1280,
        height: 720,
      },
      screenshotAvailable: true,
    }
    const prompt: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    await injectScribbleImages(prompt, drawingWithComposite)
    const call = debugSpy.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('[picanthon/scribble]'),
    )
    expect(call).toBeDefined()
    const payload = call![1] as {
      screenshotBytes: number | undefined
      precomputed: boolean
    }
    expect(payload.precomputed).toBe(true)
    expect(payload.screenshotBytes).toBeUndefined()
    debugSpy.mockRestore()
  })

  it('drops empty strokes (< 500 bytes) and warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const drawingEmptyStrokes: DrawnPayload = {
      ...drawing,
      strokesPng: '',
    }
    const prompt: ModelMessage[] = [{ role: 'user', content: 'hi' }]
    const out = await injectScribbleImages(prompt, drawingEmptyStrokes)
    const parts = out[out.length - 1].content as Array<{ type: string; image?: string }>
    const imageParts = parts.filter((p) => p.type === 'image')
    const strokesPart = imageParts.find((p) => p.image === 'data:image/png;base64,')
    expect(strokesPart).toBeUndefined()
    const warnCall = warnSpy.mock.calls.find((args) =>
      typeof args[0] === 'string' && args[0].includes('[picanthon/scribble]') && args[0].includes('strokes near-empty'),
    )
    expect(warnCall).toBeDefined()
    warnSpy.mockRestore()
  })
})

describe('enrichWithComposite + injectScribbleImages (end-to-end cache contract)', () => {
  it('calls compositeWithStrokes exactly once across the full enrich → inject pipeline', async () => {
    const screenshot = await import('./screenshot')
    const enriched = await enrichWithComposite(drawing)
    await injectScribbleImages([{ role: 'user', content: 'hi' }], enriched)
    expect(vi.mocked(screenshot.compositeWithStrokes)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(screenshot.captureActiveTab)).toHaveBeenCalledTimes(1)
  })
})
