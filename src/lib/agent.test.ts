import { describe, it, expect } from 'vitest'
import { renderInstructions } from './agent'
import type { DrawnPayload, PageSnapshot, PickedElement } from './messaging'

const ctx: PageSnapshot = {
  url: 'https://example.com/',
  title: 'Example',
  viewport: { width: 1280, height: 720 },
  outline: 'h1: Hello',
  shell: [],
  regions: [],
  repeaters: [],
  elements: [],
}

const pin: PickedElement = {
  selector: 'button.cta',
  tag: 'button',
  outerHTML: '<button class="cta">Buy</button>',
  computedStyles: { color: 'rgb(255,0,0)' },
  boundingBox: { x: 0, y: 0, width: 100, height: 30 },
  text: 'Buy',
}

describe('renderInstructions', () => {
  it('does not include a focused_element block when pinned is null', () => {
    const out = renderInstructions(ctx, null)
    expect(out).not.toContain('<focused_element>')
  })

  it('prepends a focused_element block when pinned is present', () => {
    const out = renderInstructions(ctx, pin)
    expect(out.indexOf('<focused_element>')).toBeLessThan(out.indexOf('PAGE CONTEXT'))
    expect(out).toContain('selector: button.cta')
    expect(out).toContain('<button class="cta">Buy</button>')
    expect(out).toContain('"color": "rgb(255,0,0)"')
  })

  it('truncates a huge computedStyles JSON to keep the block bounded', () => {
    const big: Record<string, string> = {}
    for (let i = 0; i < 5000; i++) big[`prop-${i}`] = 'x'.repeat(50)
    const out = renderInstructions(ctx, { ...pin, computedStyles: big })
    expect(out.length).toBeLessThan(150_000) // safety bound
    expect(out).toContain('… [truncated]')
  })

  it('mandates the focused selector instead of merely preferring it', () => {
    const out = renderInstructions(ctx, pin)
    // The earlier wording ("Prefer this exact selector") let the model
    // substitute a "better" selector. Lock in the stronger language.
    expect(out).not.toMatch(/Prefer this exact selector/i)
    expect(out).toMatch(/MUST use the exact selector/i)
    expect(out).toMatch(/picked selector is authoritative/i)
  })

  it('emits a rule that binds tweak ops to the focused selector', () => {
    const out = renderInstructions(ctx, pin)
    expect(out).toMatch(/focused element above is authoritative.*MUST use its exact selector/s)
  })

  it('omits the focused-selector rule when nothing is pinned', () => {
    const out = renderInstructions(ctx, null)
    expect(out).not.toMatch(/focused element above is authoritative/i)
    expect(out).not.toMatch(/MUST use its exact selector/i)
  })
})

const draw: DrawnPayload = {
  strokesPng: 'AAAA',
  bbox: { x: 100, y: 200, width: 50, height: 60 },
  viewport: { width: 1280, height: 720 },
  coveredElements: [
    { selector: '#hero', tag: 'section', coverage: 0.8 },
    { selector: 'button.cta', tag: 'button', coverage: 0.15 },
  ],
}

describe('renderInstructions — scribble', () => {
  it('does not include a scribble block when drawing is null', () => {
    const out = renderInstructions(ctx, null, null)
    expect(out).not.toContain('<scribble>')
  })

  it('prepends a scribble block with covered_elements ordered by coverage', () => {
    const out = renderInstructions(ctx, null, draw)
    expect(out.indexOf('<scribble>')).toBeLessThan(out.indexOf('PAGE CONTEXT'))
    expect(out).toContain('#hero')
    expect(out).toContain('button.cta')
    expect(out.indexOf('#hero')).toBeLessThan(out.indexOf('button.cta'))
    expect(out).toMatch(/strokes_bbox: 50x60 at \(100,200\)/)
  })

  it('emits a scribble rule that primes the model to read the gesture', () => {
    const out = renderInstructions(ctx, null, draw)
    expect(out).toMatch(/scribble block above carries the user's drawn intent/i)
  })

  it('omits the scribble rule when no drawing is present', () => {
    const out = renderInstructions(ctx, null, null)
    expect(out).not.toMatch(/scribble block above carries/i)
  })

  it('combines focused element + scribble blocks when both are present', () => {
    const out = renderInstructions(ctx, pin, draw)
    expect(out).toContain('<focused_element>')
    expect(out).toContain('<scribble>')
  })
})
