import { beforeEach, describe, expect, it } from 'vitest'
import {
  contrastRatio,
  findContrastIssues,
  getEffectiveBackground,
  parseColor,
} from './contrast'

describe('parseColor', () => {
  it('parses rgb()', () => {
    expect(parseColor('rgb(255, 0, 128)')).toEqual({ r: 255, g: 0, b: 128 })
  })

  it('parses rgba()', () => {
    expect(parseColor('rgba(0, 128, 255, 0.5)')).toEqual({ r: 0, g: 128, b: 255 })
  })

  it('returns null for unparseable strings', () => {
    expect(parseColor('inherit')).toBeNull()
    expect(parseColor('')).toBeNull()
  })
})

describe('relativeLuminance and contrastRatio (WCAG fixtures)', () => {
  it('black vs white = 21', () => {
    const ratio = contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })
    expect(ratio).toBeCloseTo(21, 0)
  })

  it('white vs white = 1', () => {
    const ratio = contrastRatio({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 })
    expect(ratio).toBe(1)
  })

  it('grey #767676 on white passes WCAG AA normal (~4.54)', () => {
    const ratio = contrastRatio({ r: 0x76, g: 0x76, b: 0x76 }, { r: 255, g: 255, b: 255 })
    expect(ratio).toBeGreaterThanOrEqual(4.5)
    expect(ratio).toBeLessThan(5)
  })

  it('grey #999 on white fails WCAG AA normal (~2.85)', () => {
    const ratio = contrastRatio({ r: 0x99, g: 0x99, b: 0x99 }, { r: 255, g: 255, b: 255 })
    expect(ratio).toBeLessThan(4.5)
    expect(ratio).toBeGreaterThan(2.5)
  })

  it('light grey #ccc on white is barely visible (~1.6)', () => {
    const ratio = contrastRatio({ r: 0xcc, g: 0xcc, b: 0xcc }, { r: 255, g: 255, b: 255 })
    expect(ratio).toBeLessThan(2)
  })

  it('order of arguments does not matter', () => {
    const a = contrastRatio({ r: 50, g: 50, b: 50 }, { r: 200, g: 200, b: 200 })
    const b = contrastRatio({ r: 200, g: 200, b: 200 }, { r: 50, g: 50, b: 50 })
    expect(a).toBe(b)
  })
})

describe('getEffectiveBackground', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('returns the elements own opaque background', () => {
    document.body.innerHTML = `<div id="t" style="background-color: rgb(255, 255, 255)"></div>`
    const bg = getEffectiveBackground(document.getElementById('t')!)
    expect(bg).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('walks up to find an opaque ancestor when the element is transparent', () => {
    document.body.innerHTML = `
      <div style="background-color: rgb(20, 20, 30)">
        <div>
          <p id="t">text</p>
        </div>
      </div>`
    const bg = getEffectiveBackground(document.getElementById('t')!)
    expect(bg).toEqual({ r: 20, g: 20, b: 30 })
  })

  it('defaults to white when nothing opaque is found', () => {
    document.body.innerHTML = `<div id="t"></div>`
    const bg = getEffectiveBackground(document.getElementById('t')!)
    expect(bg).toEqual({ r: 255, g: 255, b: 255 })
  })
})

describe('findContrastIssues', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('flags light grey text on white background', () => {
    // The pricing-card scenario the user hit: white cards, light grey description text
    document.body.innerHTML = `
      <div id="card" style="background-color: rgb(255, 255, 255)">
        <p style="color: rgb(204, 204, 204)">Es la revolución financiera para las pymes.</p>
      </div>`
    const card = document.getElementById('card')!
    const issues = findContrastIssues(card)
    expect(issues).toHaveLength(1)
    expect(issues[0].ratio).toBeLessThan(2)
    expect(issues[0].wcag).toBe('AA-fail')
    expect(issues[0].text).toContain('revolución')
  })

  it('does not flag passing pairs', () => {
    document.body.innerHTML = `
      <div id="card" style="background-color: rgb(255, 255, 255)">
        <p style="color: rgb(34, 34, 34)">Texto legible</p>
      </div>`
    const issues = findContrastIssues(document.getElementById('card')!)
    expect(issues).toHaveLength(0)
  })

  it('detects multiple offenders across descendants', () => {
    document.body.innerHTML = `
      <div id="card" style="background-color: rgb(255, 255, 255)">
        <h3 style="color: rgb(34, 34, 34)">Título legible</h3>
        <p style="color: rgb(220, 220, 220)">Descripción ilegible</p>
        <span style="color: rgb(240, 240, 240)">Etiqueta ilegible</span>
      </div>`
    const issues = findContrastIssues(document.getElementById('card')!)
    expect(issues).toHaveLength(2)
    const texts = issues.map((i) => i.text)
    expect(texts.some((t) => t.includes('ilegible'))).toBe(true)
  })

  it('treats large bold text with a looser threshold (AA large = 3:1)', () => {
    // grey #888 on white: ratio ~3.5 — fails normal AA (4.5) but passes large AA (3.0)
    document.body.innerHTML = `
      <div id="card" style="background-color: rgb(255, 255, 255)">
        <h1 style="color: rgb(136, 136, 136); font-size: 32px; font-weight: 700">Título grande</h1>
      </div>`
    const issues = findContrastIssues(document.getElementById('card')!)
    expect(issues).toHaveLength(0)
  })

  it('ignores hidden elements', () => {
    document.body.innerHTML = `
      <div id="card" style="background-color: rgb(255, 255, 255)">
        <p style="color: rgb(255, 255, 255); display: none">invisible y oculto</p>
      </div>`
    const issues = findContrastIssues(document.getElementById('card')!)
    expect(issues).toHaveLength(0)
  })

  it('caps the number of reported issues', () => {
    let html = ''
    for (let i = 0; i < 20; i++) {
      html += `<p style="color: rgb(230, 230, 230)">item ${i}</p>`
    }
    document.body.innerHTML = `<div id="card" style="background-color: rgb(255, 255, 255)">${html}</div>`
    const issues = findContrastIssues(document.getElementById('card')!, { max: 5 })
    expect(issues).toHaveLength(5)
  })
})
