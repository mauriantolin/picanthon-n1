import { describe, it, expect, afterEach, vi } from 'vitest'
import { startDraw, cancelDraw, _appendStrokeForTest } from './scribble'
import type { Stroke } from './scribble-paths'

afterEach(() => {
  cancelDraw()
  document.body.innerHTML = ''
  document.body.style.cursor = ''
})

function host(): HTMLElement | null {
  return document.querySelector('[data-picanthon="scribble"]')
}

function dispatchKey(key: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

function fakeStroke(): Stroke {
  return {
    points: [
      { x: 10, y: 10 },
      { x: 50, y: 50 },
      { x: 90, y: 10 },
    ],
    color: '#FF3E7F',
    widths: [3, 3, 3],
  }
}

describe('scribble overlay lifecycle', () => {
  it('mounts a Shadow DOM host while drawing and removes it on cancel', async () => {
    expect(host()).toBeNull()
    const promise = startDraw({ rasterize: () => '' })
    expect(host()).not.toBeNull()
    expect(host()!.shadowRoot).not.toBeNull()
    cancelDraw()
    await expect(promise).resolves.toEqual({ cancelled: true })
    expect(host()).toBeNull()
  })

  it('sets and restores the body cursor', async () => {
    document.body.style.cursor = 'auto'
    const promise = startDraw({ rasterize: () => '' })
    expect(document.body.style.cursor).toBe('none')
    cancelDraw()
    await promise
    expect(document.body.style.cursor).toBe('auto')
  })

  it('renders the HUD with send/undo/clear/cancel buttons', () => {
    startDraw({ rasterize: () => '' })
    const shadow = host()!.shadowRoot!
    const buttons = shadow.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThanOrEqual(5)
    const send = shadow.querySelector('button.send')
    expect(send?.textContent).toBe('Enviar')
    cancelDraw()
  })
})

describe('scribble ESC and Enter', () => {
  it('resolves with { cancelled: true } when Escape is pressed', async () => {
    const promise = startDraw({ rasterize: () => '' })
    dispatchKey('Escape')
    await expect(promise).resolves.toEqual({ cancelled: true })
    expect(host()).toBeNull()
  })

  it('Enter with no strokes is a noop (overlay stays mounted)', async () => {
    let settled = false
    const promise = startDraw({ rasterize: () => '' })
    promise.then(() => {
      settled = true
    })
    dispatchKey('Enter')
    await new Promise((r) => setTimeout(r, 0))
    expect(settled).toBe(false)
    expect(host()).not.toBeNull()
    cancelDraw()
    await promise
  })

  it('Enter with ≥1 stroke resolves with a DrawnPayload', async () => {
    const promise = startDraw({
      rasterize: () => 'PNGDATA',
      elementFromPoint: () => document.body,
    })
    _appendStrokeForTest(fakeStroke())
    dispatchKey('Enter')
    const result = await promise
    if ('cancelled' in result) throw new Error('expected DrawnPayload')
    expect(result.strokesPng).toBe('PNGDATA')
    expect(result.bbox.width).toBeGreaterThan(0)
    expect(result.viewport.width).toBeGreaterThanOrEqual(0)
    expect(host()).toBeNull()
  })
})

describe('scribble concurrent sessions', () => {
  it('cancels a prior session when startDraw is called again', async () => {
    const first = startDraw({ rasterize: () => '' })
    const second = startDraw({ rasterize: () => '' })
    await expect(first).resolves.toEqual({ cancelled: true })
    cancelDraw()
    await expect(second).resolves.toEqual({ cancelled: true })
  })
})

describe('scribble keyboard shortcuts', () => {
  it('Z removes the last stroke; C clears all strokes', async () => {
    const promise = startDraw({ rasterize: () => '' })
    _appendStrokeForTest(fakeStroke())
    _appendStrokeForTest(fakeStroke())
    dispatchKey('z')
    dispatchKey('c')
    // After clear, Enter should noop because there are zero strokes.
    let settled = false
    promise.then(() => {
      settled = true
    })
    dispatchKey('Enter')
    await new Promise((r) => setTimeout(r, 0))
    expect(settled).toBe(false)
    cancelDraw()
    await promise
  })
})

describe('scribble visibility change', () => {
  it('cancels the session when the document becomes hidden', async () => {
    const promise = startDraw({ rasterize: () => '' })
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await expect(promise).resolves.toEqual({ cancelled: true })
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  })
})

describe('scribble payload composition', () => {
  it('includes coveredElements via the injected elementFromPoint', async () => {
    document.body.innerHTML = '<div id="target" style="width:100px;height:100px"></div>'
    const target = document.getElementById('target')!
    const promise = startDraw({
      rasterize: () => 'PNG',
      elementFromPoint: () => target,
    })
    _appendStrokeForTest({
      points: [
        { x: 10, y: 10 },
        { x: 90, y: 90 },
      ],
      color: '#FF3E7F',
      widths: [3, 3],
    })
    dispatchKey('Enter')
    const result = await promise
    if ('cancelled' in result) throw new Error('expected DrawnPayload')
    expect(result.coveredElements[0]?.selector).toBe('#target')
    expect(result.coveredElements[0]?.coverage).toBeGreaterThan(0)
  })

  it('buildPayload rasterizes strokes to non-empty base64', async () => {
    const promise = startDraw({
      rasterize: () => 'BASE64DATA',
      elementFromPoint: () => document.body,
    })
    _appendStrokeForTest(fakeStroke())
    dispatchKey('Enter')
    const result = await promise
    if ('cancelled' in result) throw new Error('expected DrawnPayload')
    expect(result.strokesPng).toBe('BASE64DATA')
    expect(result.strokesPng.length).toBeGreaterThan(0)
  })

  it('rasterize is called exactly once per submit', async () => {
    const rasterize = vi.fn(() => 'BASE64DATA')
    const promise = startDraw({
      rasterize,
      elementFromPoint: () => document.body,
    })
    _appendStrokeForTest(fakeStroke())
    dispatchKey('Enter')
    await promise
    expect(rasterize).toHaveBeenCalledTimes(1)
  })
})
