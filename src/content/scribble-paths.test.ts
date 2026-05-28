import { describe, it, expect } from 'vitest'
import {
  simplifyPath,
  smoothPath,
  samplePointsAlongPath,
  bboxOfStrokes,
  widthsBySpeed,
  extractCoveredElements,
  type Point,
  type Stroke,
} from './scribble-paths'

function line(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }))
}

describe('simplifyPath', () => {
  it('keeps both endpoints', () => {
    const pts = line(10)
    const out = simplifyPath(pts, 0.5)
    expect(out[0]).toEqual(pts[0])
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1])
  })

  it('collapses a straight line to its endpoints', () => {
    const pts = line(20)
    const out = simplifyPath(pts, 0.5)
    expect(out).toHaveLength(2)
  })

  it('returns input as-is when ≤2 points', () => {
    expect(simplifyPath([])).toEqual([])
    expect(simplifyPath([{ x: 0, y: 0 }])).toEqual([{ x: 0, y: 0 }])
  })

  it('reduces noisy paths by ≥40%', () => {
    const pts: Point[] = []
    for (let i = 0; i < 200; i++) {
      pts.push({ x: i, y: Math.sin(i / 5) * 0.2 })
    }
    const out = simplifyPath(pts, 0.5)
    expect(out.length).toBeLessThan(pts.length * 0.6)
  })

  it('preserves a sharp corner', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
    ]
    const out = simplifyPath(pts, 0.5)
    const hasCorner = out.some((p) => p.x === 10 && p.y === 0)
    expect(hasCorner).toBe(true)
  })
})

describe('smoothPath', () => {
  it('returns input for paths shorter than 3 points', () => {
    expect(smoothPath([])).toEqual([])
    const one = [{ x: 0, y: 0 }]
    expect(smoothPath(one)).toEqual(one)
    const two = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]
    expect(smoothPath(two)).toEqual(two)
  })

  it('passes through the first and last points', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ]
    const out = smoothPath(pts, 4)
    expect(out[0]).toEqual(pts[0])
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1])
  })

  it('multiplies point count by ~steps per segment', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]
    const out = smoothPath(pts, 6)
    expect(out.length).toBeGreaterThan(pts.length * 2)
  })
})

describe('samplePointsAlongPath', () => {
  it('returns the only point when input has length 1', () => {
    expect(samplePointsAlongPath([{ x: 5, y: 5 }])).toEqual([{ x: 5, y: 5 }])
  })

  it('returns empty for empty input', () => {
    expect(samplePointsAlongPath([])).toEqual([])
  })

  it('samples roughly every stepPx along a straight line', () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const out = samplePointsAlongPath(pts, 20)
    // first + 5 step samples (20,40,60,80,100) — endpoint hit exactly
    expect(out.length).toBeGreaterThanOrEqual(5)
    expect(out[0]).toEqual({ x: 0, y: 0 })
    expect(out[1]).toEqual({ x: 20, y: 0 })
  })
})

describe('bboxOfStrokes', () => {
  it('returns zeros for no strokes', () => {
    expect(bboxOfStrokes([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('computes the union bbox across strokes', () => {
    const strokes: Stroke[] = [
      {
        points: [
          { x: 10, y: 20 },
          { x: 30, y: 40 },
        ],
        color: '#000',
        widths: [2, 2],
      },
      {
        points: [
          { x: 5, y: 50 },
          { x: 100, y: 5 },
        ],
        color: '#000',
        widths: [2, 2],
      },
    ]
    expect(bboxOfStrokes(strokes)).toEqual({ x: 5, y: 5, width: 95, height: 45 })
  })
})

describe('widthsBySpeed', () => {
  it('returns max width for the first sample', () => {
    const w = widthsBySpeed(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      [0, 100],
      1.5,
      4,
    )
    expect(w[0]).toBe(4)
  })

  it('produces a thinner width when moving fast', () => {
    const slow = widthsBySpeed(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      [0, 100],
      1.5,
      4,
    )
    const fast = widthsBySpeed(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [0, 50],
      1.5,
      4,
    )
    expect(fast[1]).toBeLessThan(slow[1])
  })
})

describe('extractCoveredElements', () => {
  it('groups hits by element, sorts by coverage desc', () => {
    document.body.innerHTML = `
      <div id="a" style="width:100px;height:100px;"></div>
      <div id="b" style="width:100px;height:100px;"></div>
    `
    const a = document.getElementById('a')!
    const b = document.getElementById('b')!
    const stroke: Stroke = {
      points: [
        { x: 10, y: 10 },
        { x: 200, y: 10 },
      ],
      color: '#000',
      widths: [2, 2],
    }
    // Mock elementFromPoint: first 8 samples → a, last 3 → b
    let i = 0
    const out = extractCoveredElements([stroke], {
      stepPx: 20,
      elementFromPoint: () => {
        const el = i < 8 ? a : b
        i++
        return el
      },
    })
    expect(out[0].selector).toBe('#a')
    expect(out[1].selector).toBe('#b')
    expect(out[0].coverage).toBeGreaterThan(out[1].coverage)
  })

  it('skips elements inside the host overlay', () => {
    document.body.innerHTML = `
      <div data-picanthon="scribble" id="host"><div id="inside"></div></div>
      <div id="real"></div>
    `
    const inside = document.getElementById('inside')!
    const real = document.getElementById('real')!
    const stroke: Stroke = {
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ],
      color: '#000',
      widths: [2, 2],
    }
    let i = 0
    const out = extractCoveredElements([stroke], {
      stepPx: 20,
      rootHostAttr: 'data-picanthon',
      elementFromPoint: () => (i++ % 2 === 0 ? inside : real),
    })
    expect(out.every((e) => e.selector !== '#inside')).toBe(true)
    expect(out.some((e) => e.selector === '#real')).toBe(true)
  })

  it('drops elements below minCoverage', () => {
    document.body.innerHTML = `<div id="a"></div><div id="b"></div>`
    const a = document.getElementById('a')!
    const b = document.getElementById('b')!
    const stroke: Stroke = {
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      color: '#000',
      widths: [2, 2],
    }
    // 19 hits on a, 1 on b → b coverage = 1/20 = 0.05 (at threshold, kept).
    // With minCoverage = 0.1 b should be dropped.
    let i = 0
    const out = extractCoveredElements([stroke], {
      stepPx: 20,
      minCoverage: 0.1,
      elementFromPoint: () => (i++ < 19 ? a : b),
    })
    expect(out.find((e) => e.selector === '#b')).toBeUndefined()
  })
})
