// Pure helpers for the scribble overlay. No DOM, no chrome.* — just math on
// point arrays. Lives separate from scribble.ts so simplify/smooth/sample stay
// trivially unit-testable. extractCoveredElements does touch the DOM via
// document.elementFromPoint, but only as a pure consumer of an element factory
// pattern that jsdom can drive.

import { cssPath } from './page-context'

export interface Point {
  x: number
  y: number
}

export interface Stroke {
  points: Point[]
  color: string
  // Per-segment widths sampled at each point (1.5..4 px), so render can taper.
  widths: number[]
}

export interface StrokesBBox {
  x: number
  y: number
  width: number
  height: number
}

// Ramer–Douglas–Peucker. Drops collinear points within `epsilon` perpendicular
// distance of the segment joining their neighbours. Keeps endpoints exact.
export function simplifyPath(points: Point[], epsilon = 0.5): Point[] {
  if (points.length <= 2) return points.slice()
  const keep = new Array(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  rdp(points, 0, points.length - 1, epsilon, keep)
  const out: Point[] = []
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i])
  return out
}

function rdp(
  pts: Point[],
  start: number,
  end: number,
  epsilon: number,
  keep: boolean[],
): void {
  let maxDist = 0
  let index = start
  for (let i = start + 1; i < end; i++) {
    const d = perpendicularDistance(pts[i], pts[start], pts[end])
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }
  if (maxDist > epsilon) {
    keep[index] = true
    rdp(pts, start, index, epsilon, keep)
    rdp(pts, index, end, epsilon, keep)
  }
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  const cx = a.x + t * dx
  const cy = a.y + t * dy
  return Math.hypot(p.x - cx, p.y - cy)
}

// Catmull–Rom spline subdivided into `steps` segments between each pair of
// control points. Tension 0.5 (uniform). Endpoints are duplicated so the curve
// passes through the first and last control points.
export function smoothPath(points: Point[], steps = 6): Point[] {
  if (points.length < 2) return points.slice()
  if (points.length === 2) return points.slice()
  const ctrl: Point[] = [points[0], ...points, points[points.length - 1]]
  const out: Point[] = []
  for (let i = 0; i < ctrl.length - 3; i++) {
    const p0 = ctrl[i],
      p1 = ctrl[i + 1],
      p2 = ctrl[i + 2],
      p3 = ctrl[i + 3]
    for (let j = 0; j < steps; j++) {
      const t = j / steps
      out.push(catmullRom(p0, p1, p2, p3, t))
    }
  }
  out.push(points[points.length - 1])
  return out
}

function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const t2 = t * t
  const t3 = t2 * t
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  }
}

// One sample every `stepPx` along the polyline. Used to query elementFromPoint
// at a roughly-uniform density regardless of how fast the user drew.
export function samplePointsAlongPath(points: Point[], stepPx = 20): Point[] {
  if (points.length === 0) return []
  if (points.length === 1) return [points[0]]
  const out: Point[] = [points[0]]
  let carry = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const segLen = Math.hypot(b.x - a.x, b.y - a.y)
    if (segLen === 0) continue
    let dist = stepPx - carry
    while (dist <= segLen) {
      const t = dist / segLen
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      dist += stepPx
    }
    carry = (carry + segLen) % stepPx
  }
  return out
}

export function bboxOfStrokes(strokes: Stroke[]): StrokesBBox {
  if (strokes.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

// Variable width by pointer speed: faster = thinner. Returns a width per point.
// Smoothed by EMA so micro-jitter doesn't flicker the stroke.
export function widthsBySpeed(
  points: Point[],
  timestamps: number[],
  min = 1.5,
  max = 4,
): number[] {
  if (points.length === 0) return []
  const widths = new Array(points.length).fill(max)
  let ema = max
  for (let i = 1; i < points.length; i++) {
    const dt = Math.max(1, timestamps[i] - timestamps[i - 1])
    const dist = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    const speed = dist / dt // px/ms
    // Map speed 0..2 px/ms to width max..min.
    const t = Math.min(1, speed / 2)
    const w = max + (min - max) * t
    ema = ema * 0.6 + w * 0.4
    widths[i] = ema
  }
  return widths
}

export interface DrawnElement {
  selector: string
  tag: string
  coverage: number
}

// For each sampled point of every stroke, call elementFromPoint and tally hits
// per element. Returns elements sorted by coverage desc, filtered by minCoverage,
// capped at `limit`. The overlay MUST be removed (or pointer-events disabled)
// before calling this — otherwise every sample resolves to the overlay host.
export function extractCoveredElements(
  strokes: Stroke[],
  options: {
    elementFromPoint?: (x: number, y: number) => Element | null
    rootHostAttr?: string
    minCoverage?: number
    limit?: number
    stepPx?: number
  } = {},
): DrawnElement[] {
  const fromPoint =
    options.elementFromPoint ??
    ((x, y) => document.elementFromPoint(x, y))
  const ignoreAttr = options.rootHostAttr
  const minCoverage = options.minCoverage ?? 0.05
  const limit = options.limit ?? 10
  const stepPx = options.stepPx ?? 20

  const hits = new Map<Element, number>()
  let total = 0
  for (const stroke of strokes) {
    const samples = samplePointsAlongPath(stroke.points, stepPx)
    for (const p of samples) {
      total++
      const el = fromPoint(p.x, p.y)
      if (!el) continue
      if (ignoreAttr && el.closest(`[${ignoreAttr}]`)) continue
      hits.set(el, (hits.get(el) ?? 0) + 1)
    }
  }
  if (total === 0) return []

  const out: DrawnElement[] = []
  for (const [el, count] of hits) {
    const coverage = count / total
    if (coverage < minCoverage) continue
    out.push({
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      coverage,
    })
  }
  out.sort((a, b) => b.coverage - a.coverage)
  return out.slice(0, limit)
}
