// Deterministic legibility check for the visual feedback loop. We compute
// WCAG contrast ratios over the AFTER state and surface concrete numbers
// ("ratio: 1.6 → AA-fail") to the model in the tool result. The model can
// no longer eyeball the screenshot and say "looks fine" when text is invisible.
//
// Pure functions only: no chrome APIs, no global state. Easily testable.

export interface RGB {
  r: number
  g: number
  b: number
}

export interface ContrastIssue {
  text: string // truncated sample of the offending text
  fg: string // 'rgb(r,g,b)'
  bg: string // 'rgb(r,g,b)'
  ratio: number // computed WCAG ratio, rounded to 2 decimals
  wcag: 'AA-fail' | 'AAA-fail' // which threshold it falls under
}

// rgb(r,g,b) and rgba(r,g,b,a) — what getComputedStyle returns in any browser.
export function parseColor(str: string): RGB | null {
  if (!str) return null
  const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (!m) return null
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) }
}

function parseColorWithAlpha(str: string): { rgb: RGB; a: number } | null {
  if (!str) return null
  const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/i)
  if (!m) return null
  return {
    rgb: { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) },
    a: m[4] !== undefined ? Number(m[4]) : 1,
  }
}

function srgbChannelToLinear(c: number): number {
  const cs = c / 255
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(rgb: RGB): number {
  const R = srgbChannelToLinear(rgb.r)
  const G = srgbChannelToLinear(rgb.g)
  const B = srgbChannelToLinear(rgb.b)
  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

export function contrastRatio(a: RGB, b: RGB): number {
  const La = relativeLuminance(a)
  const Lb = relativeLuminance(b)
  const lighter = Math.max(La, Lb)
  const darker = Math.min(La, Lb)
  return (lighter + 0.05) / (darker + 0.05)
}

// CSS doesn't track an "effective" background — transparent backgrounds inherit
// from the parent's painted layer. To compute a real contrast ratio we have to
// walk up the DOM and find the first opaque ancestor. If a non-trivial
// background-image is on the way up we bail out and treat it as white (we
// can't sample a CSS image deterministically without a canvas pass).
export function getEffectiveBackground(el: Element): RGB {
  let node: Element | null = el
  while (node) {
    const s = getComputedStyle(node)
    const parsed = parseColorWithAlpha(s.backgroundColor || '')
    if (parsed && parsed.a > 0.95) return parsed.rgb
    const bgImg = s.backgroundImage
    if (bgImg && bgImg !== 'none' && bgImg !== '') {
      return { r: 255, g: 255, b: 255 }
    }
    node = node.parentElement
  }
  return { r: 255, g: 255, b: 255 }
}

const AA_NORMAL = 4.5
const AA_LARGE = 3.0
const AAA_NORMAL = 7.0
const AAA_LARGE = 4.5

export interface FindContrastOptions {
  max?: number
  // text >= this size (in CSS pixels) counts as "large" and gets the looser
  // threshold. Default 18px, plus the WCAG carve-out for bold 14px+.
  largeTextPx?: number
}

// Walk a subtree, find every text node where the visible color/background
// pair falls below WCAG AA. We only report failures; passing pairs are silent
// to keep the payload small and the signal sharp.
export function findContrastIssues(
  root: Element,
  opts: FindContrastOptions = {},
): ContrastIssue[] {
  const max = opts.max ?? 8
  const largeTextPx = opts.largeTextPx ?? 18
  const issues: ContrastIssue[] = []

  const walk = (el: Element) => {
    if (issues.length >= max) return
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden') return

    const ownText = directTextOf(el)
    if (ownText) {
      const fg = parseColor(s.color || '')
      if (fg) {
        const bg = getEffectiveBackground(el)
        const ratio = contrastRatio(fg, bg)
        const fontPx = parseFloat(s.fontSize || '16') || 16
        const weight = Number(s.fontWeight) || (s.fontWeight === 'bold' ? 700 : 400)
        const isLarge = fontPx >= largeTextPx || (fontPx >= 14 && weight >= 700)
        const failThreshold = isLarge ? AA_LARGE : AA_NORMAL
        if (ratio < failThreshold) {
          const aaaThreshold = isLarge ? AAA_LARGE : AAA_NORMAL
          issues.push({
            text: truncate(ownText, 60),
            fg: `rgb(${fg.r},${fg.g},${fg.b})`,
            bg: `rgb(${bg.r},${bg.g},${bg.b})`,
            ratio: Math.round(ratio * 100) / 100,
            wcag: ratio < aaaThreshold ? 'AA-fail' : 'AAA-fail',
          })
        }
      }
    }

    for (const child of Array.from(el.children)) walk(child)
  }
  walk(root)
  return issues
}

function directTextOf(el: Element): string {
  let text = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) text += node.textContent || ''
  }
  return text.trim().replace(/\s+/g, ' ')
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
