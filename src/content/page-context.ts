// Pure DOM helpers for describing the page to the agent. No chrome APIs here so
// this module is unit-testable under jsdom.
//
// Two layers:
//   1. Generic structural helpers (describeLayout, findRepeaters, sampleChild,
//      findShell, findRegions): work on any DOM, no host-specific knowledge.
//   2. buildSnapshot: the entry point used by the content script. Combines the
//      helpers + visibility filtering into the PageSnapshot the agent consumes.

import type {
  AffectedElement,
  BBox,
  ElementInfo,
  LayoutInfo,
  PageSnapshot,
  RegionInfo,
  RepeaterInfo,
  ShellRegion,
} from '@/lib/messaging'
import { findContrastIssues } from './contrast'

const MAX_SAMPLE_LEN = 1500
const MAX_STYLE_ATTR_LEN = 80
const MAX_NOISY_ATTR_LEN = 120

export function buildSnapshot(): PageSnapshot {
  const viewport = {
    width: window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.innerHeight || document.documentElement.clientHeight || 0,
  }

  const repeaters = findRepeaters(document.body)
    .filter((r) => isVisible(resolve(r.selector)))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 20)

  const shell = findShell()
  const regions = findRegions()
  const elements = collectElements()
  const outline = buildOutline()

  return {
    url: location.href,
    title: document.title,
    viewport,
    outline,
    shell,
    regions,
    repeaters,
    elements,
  }
}

function score(r: RepeaterInfo): number {
  const area = Math.max(1, r.bbox.width) * Math.max(1, r.bbox.height)
  return r.childCount * Math.log2(area + 2)
}

function buildOutline(): string {
  const lines: string[] = []
  document.querySelectorAll('h1, h2, h3').forEach((h) => {
    lines.push(`${h.tagName.toLowerCase()}: ${truncate(h.textContent ?? '', 80)}`)
  })
  for (const tag of ['header', 'nav', 'main', 'footer', 'aside']) {
    if (document.querySelector(tag)) lines.push(`landmark: <${tag}>`)
  }
  lines.push(
    `counts: ${document.querySelectorAll('a').length} links, ` +
      `${document.querySelectorAll('button, a[role="button"]').length} buttons, ` +
      `${document.querySelectorAll('img').length} images, ` +
      `${document.querySelectorAll('table').length} tables`,
  )
  return lines.join('\n').slice(0, 4000)
}

// A bounded set of notable, visible elements with unique-ish selectors. Kept as
// a secondary list — the structural pieces (repeaters/regions/shell) carry the
// heavy information now.
export function collectElements(): ElementInfo[] {
  const out: ElementInfo[] = []
  const seen = new Set<Element>()
  const push = (el: Element, role?: string) => {
    if (seen.has(el) || !isVisible(el)) return
    seen.add(el)
    out.push({
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      role: role ?? el.getAttribute('role') ?? undefined,
      text: truncate(el.textContent ?? '', 60) || undefined,
    })
  }

  for (const tag of ['header', 'nav', 'main', 'footer', 'aside']) {
    const el = document.querySelector(tag)
    if (el) push(el, 'landmark')
  }
  collect('h1, h2, h3', 10, push)
  collect('button, a[role="button"], [type="submit"]', 12, (el) => push(el, 'button'))
  collect('table', 6, push)
  collect('ul, ol', 6, push)
  collect('form, input, select, textarea', 10, push)
  collect('img', 8, push)
  collect('a', 12, (el) => push(el, 'link'))

  return out.slice(0, 50)
}

function collect(sel: string, limit: number, push: (el: Element) => void) {
  for (const el of Array.from(document.querySelectorAll(sel)).slice(0, limit)) push(el)
}

// Re-inspect a set of selectors AFTER a tweak ran. Returns the same shape of
// info the snapshot carries (layout / bbox / childCount / childSample), so the
// model can compare "what I asked for" against "what is there now" with concrete
// numbers, not just a screenshot.
export function captureAffected(selectors: string[]): AffectedElement[] {
  const dedup = Array.from(new Set(selectors))
  return dedup.map((selector) => {
    let el: Element | null = null
    try {
      el = document.querySelector(selector)
    } catch {
      return { selector, found: false }
    }
    if (!el) return { selector, found: false }

    const out: AffectedElement = {
      selector,
      found: true,
      tag: el.tagName.toLowerCase(),
      bbox: rectOf(el),
      layout: describeLayout(el),
    }
    const kids = el.children
    if (kids.length > 0) {
      out.childCount = kids.length
      out.childSample = sampleChild(kids[0])
    } else {
      const text = truncate(el.textContent ?? '', 120)
      if (text) out.text = text
    }
    const issues = findContrastIssues(el)
    if (issues.length > 0) out.contrastIssues = issues
    return out
  })
}

// --- Generic structural helpers -------------------------------------------

// Detect a container's CSS layout (grid / flex / block) by reading computed
// styles. Returns a small structured hint, not a full inventory.
export function describeLayout(el: Element): LayoutInfo {
  const s = getComputedStyle(el)
  const display = s.display || 'block'
  const layout: LayoutInfo = { display: normalizeDisplay(display) }

  if (layout.display === 'grid') {
    const cols = parseGridColumns(s.gridTemplateColumns, el)
    if (cols > 0) layout.columns = cols
  }
  if (layout.display === 'flex') {
    const dir = s.flexDirection || 'row'
    layout.direction = dir.startsWith('column') ? 'column' : 'row'
  }

  const gap = parseFirstPx(s.gap || s.rowGap || s.columnGap)
  if (gap !== undefined && gap > 0) layout.gapPx = gap

  return layout
}

function normalizeDisplay(d: string): string {
  if (d.includes('grid')) return 'grid'
  if (d.includes('flex')) return 'flex'
  if (d === '' || d === 'block') return 'block'
  return d
}

function parseGridColumns(template: string | undefined, el: Element): number {
  if (!template || template === 'none') {
    // fall back to direct child count if the browser couldn't resolve it
    return 0
  }
  // `repeat(4, 1fr)` shows up as either the literal or expanded into N tracks.
  const repeatMatch = template.match(/repeat\(\s*(\d+)/)
  if (repeatMatch) return Number(repeatMatch[1])
  const tracks = template.trim().split(/\s+/).filter(Boolean)
  // ignore the "subgrid" / "none" sentinel and pure-keyword templates
  if (tracks.length >= 1 && /\d|fr|px|%|auto|minmax/.test(template)) {
    // count tokens that look like a track size
    const sized = tracks.filter((t) => /^(\d|auto|minmax|fit-content|fr|px|%)/i.test(t))
    if (sized.length > 0) return sized.length
  }
  // Final fallback: count first row of children, capped
  return Math.min(el.children.length, 12)
}

function parseFirstPx(value: string | undefined): number | undefined {
  if (!value) return undefined
  const m = value.match(/(-?\d+(?:\.\d+)?)px/)
  return m ? Number(m[1]) : undefined
}

// Walk the tree under `root` and return every container whose direct children
// repeat a single tag at least 3 times. Pure structural detection — no
// knowledge of class names, custom elements, or host site conventions.
export function findRepeaters(root: Element): RepeaterInfo[] {
  const out: RepeaterInfo[] = []
  const walk = (el: Element) => {
    const kids = Array.from(el.children)
    if (kids.length >= 3) {
      const first = kids[0].tagName
      const allSame = kids.every((k) => k.tagName === first)
      if (allSame) {
        out.push({
          selector: cssPath(el),
          containerTag: el.tagName.toLowerCase(),
          childTag: first.toLowerCase(),
          childCount: kids.length,
          layout: describeLayout(el),
          bbox: rectOf(el),
          childSample: sampleChild(kids[0]),
        })
        // Do not descend into a confirmed repeater — its children are uniform
        // and we already captured the prototype.
        return
      }
    }
    for (const k of kids) walk(k)
  }
  walk(root)
  return out
}

// outerHTML of an element, with noisy long attributes elided and the whole
// string truncated. Keeps the structural shape visible without paying for the
// site's full inline styling.
export function sampleChild(el: Element): string {
  let html = el.outerHTML
  html = elideAttribute(html, 'style', MAX_STYLE_ATTR_LEN)
  html = elideAttribute(html, 'srcset', MAX_NOISY_ATTR_LEN)
  html = elideAttribute(html, 'src', MAX_NOISY_ATTR_LEN)
  // also elide data-* attributes whose value is very long
  html = html.replace(/(data-[\w-]+)="([^"]{120,})"/g, '$1="…"')
  if (html.length > MAX_SAMPLE_LEN) {
    html = html.slice(0, MAX_SAMPLE_LEN) + '…'
  }
  return html
}

function elideAttribute(html: string, name: string, maxLen: number): string {
  const re = new RegExp(`${name}="([^"]*)"`, 'g')
  return html.replace(re, (full, value: string) =>
    value.length > maxLen ? `${name}="…"` : full,
  )
}

// Top-level descendants that act as the page shell: header, nav, sidebar,
// footer, or anything sticky/fixed/large near the edges of the viewport.
export function findShell(): ShellRegion[] {
  const out: ShellRegion[] = []
  const seen = new Set<Element>()
  const push = (el: Element, role: ShellRegion['role']) => {
    if (seen.has(el) || !isVisible(el)) return
    seen.add(el)
    out.push({
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      role,
      bbox: rectOf(el),
      layout: describeLayout(el),
    })
  }

  document.querySelectorAll('header').forEach((el) => push(el, 'header'))
  document.querySelectorAll('nav').forEach((el) => push(el, 'nav'))
  document.querySelectorAll('aside').forEach((el) => push(el, 'sidebar'))
  document.querySelectorAll('footer').forEach((el) => push(el, 'footer'))

  // Sticky / fixed positioned blocks anywhere in the tree.
  const all = document.body.querySelectorAll('*')
  let scanned = 0
  for (const el of Array.from(all)) {
    if (++scanned > 2000) break
    const s = getComputedStyle(el)
    if (s.position === 'fixed') push(el, 'fixed')
    else if (s.position === 'sticky') push(el, 'sticky')
  }

  return out.slice(0, 12)
}

// Top-level content regions: <main>, <section>, or large block children of
// <body>. Helps the model see the page skeleton without naming any host.
export function findRegions(): RegionInfo[] {
  const out: RegionInfo[] = []
  const seen = new Set<Element>()
  const push = (el: Element) => {
    if (seen.has(el) || !isVisible(el)) return
    seen.add(el)
    out.push({
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      bbox: rectOf(el),
      layout: describeLayout(el),
    })
  }

  document.querySelectorAll('main, section[role="main"]').forEach(push)
  document.querySelectorAll('main section, main article, main > div').forEach(push)
  // If we still have nothing, fall back to direct body children
  if (out.length === 0) {
    Array.from(document.body.children).forEach(push)
  }
  return out.slice(0, 8)
}

function rectOf(el: Element): BBox {
  const r = el.getBoundingClientRect()
  return {
    x: Math.round(r.x ?? r.left ?? 0),
    y: Math.round(r.y ?? r.top ?? 0),
    width: Math.round(r.width ?? 0),
    height: Math.round(r.height ?? 0),
  }
}

function resolve(selector: string): Element {
  return document.querySelector(selector) ?? document.body
}

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  // In jsdom every rect is zero. Treat zero-rect as "unknown, keep" so the
  // filter is a no-op in tests; in real browsers it removes hidden nodes.
  if (r.width === 0 && r.height === 0) return typeof window === 'undefined' ? true : isJsdom()
  const s = getComputedStyle(el)
  return s.display !== 'none' && s.visibility !== 'hidden'
}

function isJsdom(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)
}

// Build a selector that resolves uniquely. Prefer a unique id; otherwise walk up
// the tree using :nth-of-type, stopping at the nearest ancestor with a unique id.
// Build a selector that resolves uniquely. Strategy:
//   1. If the element itself has a unique id, return `#id`.
//   2. Walk up. The first ancestor with a unique id becomes the root anchor.
//   3. If we reach <body> without finding any id, anchor the selector with
//      `body > …`. Without this, an idless path is just a free-floating
//      "div > div > nth-of-type(...)" that matches *any* subtree of the same
//      shape — exactly the bug that made pricing tweaks paint sibling cards.
//   4. As a final safety net, if the resulting selector resolves to more than
//      one element, append :nth-of-type discriminators to ancestors that lacked
//      one until the selector becomes unique.
export function cssPath(el: Element): string {
  if (el.id && isUniqueId(el.id)) return `#${cssEscape(el.id)}`

  const segments: Segment[] = []
  let node: Element | null = el
  let rootedById = false
  while (node && node.nodeType === 1 && node !== document.body) {
    if (node.id && isUniqueId(node.id)) {
      segments.unshift({ kind: 'id', text: `#${cssEscape(node.id)}`, node })
      rootedById = true
      break
    }
    segments.unshift(segmentFor(node))
    node = node.parentElement
  }
  if (!rootedById) segments.unshift({ kind: 'tag', text: 'body', node: document.body })

  let selector = segments.map((s) => s.text).join(' > ')
  // If something resolves to multiple, sharpen ancestors with nth-of-type.
  if (document.querySelectorAll(selector).length > 1) {
    selector = sharpen(segments)
  }
  return selector
}

interface Segment {
  kind: 'id' | 'tag'
  text: string
  node: Element
}

function segmentFor(node: Element): Segment {
  const tag = node.tagName.toLowerCase()
  const parent: Element | null = node.parentElement
  if (parent) {
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName)
    if (sameTag.length > 1) {
      return { kind: 'tag', text: `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})`, node }
    }
  }
  return { kind: 'tag', text: tag, node }
}

// Walk ancestors and add :nth-of-type to segments that lacked one until the
// selector becomes unique. We touch the deepest non-id segments first since
// those discriminate the most.
function sharpen(segments: Segment[]): string {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]
    if (seg.kind === 'id' || seg.text.includes(':nth-of-type(')) continue
    const node = seg.node
    const parent = node.parentElement
    if (!parent) continue
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName)
    const idx = sameTag.indexOf(node)
    if (idx < 0) continue
    seg.text = `${node.tagName.toLowerCase()}:nth-of-type(${idx + 1})`
    const candidate = segments.map((s) => s.text).join(' > ')
    if (document.querySelectorAll(candidate).length === 1) return candidate
  }
  return segments.map((s) => s.text).join(' > ')
}

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s)
  return s.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

function isUniqueId(id: string): boolean {
  try {
    return document.querySelectorAll(`#${cssEscape(id)}`).length === 1
  } catch {
    return false
  }
}

function truncate(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > n ? t.slice(0, n) + '…' : t
}
