import { beforeEach, describe, expect, it } from 'vitest'
import {
  captureAffected,
  cssPath,
  describeLayout,
  findRepeaters,
  sampleChild,
} from './page-context'

beforeEach(() => {
  document.body.innerHTML = `
    <main>
      <section>
        <p>a</p>
        <p id="target">b</p>
        <p>c</p>
      </section>
    </main>
  `
})

describe('cssPath', () => {
  it('uses a unique id directly', () => {
    const el = document.querySelector('#target')!
    expect(cssPath(el)).toBe('#target')
  })

  it('builds a selector that resolves back to the same element', () => {
    const el = document.querySelectorAll('main p')[2] // third <p>, no id
    const selector = cssPath(el)
    const resolved = document.querySelectorAll(selector)
    expect(resolved.length).toBe(1)
    expect(resolved[0]).toBe(el)
  })

  it('disambiguates same-tag siblings with nth-of-type', () => {
    const first = document.querySelectorAll('main p')[0]
    const selector = cssPath(first)
    expect(selector).toContain(':nth-of-type(1)')
    expect(document.querySelector(selector)).toBe(first)
  })

  it('produces a selector that matches exactly one element even on deep, idless trees', () => {
    // Two sibling subtrees with identical shape. The naive nth-of-type-only
    // path matched both because it wasn't anchored to body.
    document.body.innerHTML = `
      <div>
        <div>
          <div>
            <div><a>plan A</a></div>
          </div>
          <div>
            <div><a>plan B</a></div>
          </div>
        </div>
      </div>
      <div>
        <div>
          <div>
            <div><a>plan X</a></div>
          </div>
          <div>
            <div><a>plan Y</a></div>
          </div>
        </div>
      </div>`
    const all = document.querySelectorAll('a')
    for (const a of Array.from(all)) {
      const selector = cssPath(a)
      const matches = document.querySelectorAll(selector)
      expect(matches.length, `selector "${selector}" matched ${matches.length} elements`).toBe(1)
      expect(matches[0]).toBe(a)
    }
  })

  it('anchors to body when no id is found on the way up', () => {
    document.body.innerHTML = `<section><div><a>x</a></div></section>`
    const a = document.querySelector('a')!
    const selector = cssPath(a)
    // Either explicit "body > ..." or a unique enough path; what we require
    // is that it matches exactly one element from document scope.
    expect(document.querySelectorAll(selector)).toHaveLength(1)
    expect(document.querySelector(selector)).toBe(a)
  })

  it('does not truncate the path on very deep idless trees', () => {
    // 10 nested divs, then a leaf. With the old 6-segment cap the leaf path
    // matched many ancestors of unrelated subtrees.
    let html = '<span>leaf</span>'
    for (let i = 0; i < 10; i++) html = `<div>${html}</div>`
    document.body.innerHTML = `${html}<div><div><div><span>decoy</span></div></div></div>`
    const leaf = document.querySelectorAll('span')[0]
    const selector = cssPath(leaf)
    const resolved = document.querySelectorAll(selector)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toBe(leaf)
  })

  it('keeps selectors unique when two parallel deep subtrees share the tail shape', () => {
    // Real-world bug repro: two idless subtrees ~12 levels under body with the
    // same final shape. The original 6-segment cap truncated the path and
    // dropped the body anchor, so the selectors for two unrelated leaves
    // collided.
    const tail = '<div><div><div><div><div><a>x</a></div></div></div></div></div>'
    let chunk = tail
    for (let i = 0; i < 6; i++) chunk = `<div>${chunk}</div>`
    document.body.innerHTML = chunk + chunk
    const links = document.querySelectorAll('a')
    expect(links).toHaveLength(2)
    for (const a of Array.from(links)) {
      const sel = cssPath(a)
      const hits = document.querySelectorAll(sel)
      expect(hits.length, `selector "${sel}" matched ${hits.length} elements`).toBe(1)
      expect(hits[0]).toBe(a)
    }
  })

  it('survives the pricing-card scenario: three symmetric cards 8 levels deep', () => {
    // Reproduces the bug seen on a pricing page: three structurally identical
    // cards live 8+ levels deep from <body>, with no ids anywhere. The naive
    // selector ended up matching multiple unrelated subtrees.
    const card = (label: string) => `
      <div>
        <div>
          <h2>${label}</h2>
          <div><a>Empezar con ${label}</a></div>
        </div>
      </div>`
    document.body.innerHTML = `
      <div>
        <div>
          <main>
            <div>
              <section>
                <div>
                  <div>
                    ${card('Lite')}
                    ${card('Plus')}
                    ${card('Ultra')}
                  </div>
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>`
    const ctas = document.querySelectorAll('a')
    expect(ctas).toHaveLength(3)
    for (const a of Array.from(ctas)) {
      const selector = cssPath(a)
      const hits = document.querySelectorAll(selector)
      expect(
        hits.length,
        `selector "${selector}" matched ${hits.length} elements, expected 1`,
      ).toBe(1)
      expect(hits[0]).toBe(a)
    }
  })
})

describe('describeLayout', () => {
  it('reads a grid container with explicit columns and gap', () => {
    document.body.innerHTML = `
      <div id="g" style="display:grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">
        <div></div><div></div><div></div><div></div>
      </div>`
    const el = document.getElementById('g')!
    const layout = describeLayout(el)
    expect(layout.display).toBe('grid')
    expect(layout.columns).toBe(4)
    expect(layout.gapPx).toBe(8)
  })

  it('reads a flex row container with gap', () => {
    document.body.innerHTML = `
      <div id="f" style="display:flex; flex-direction:row; gap:12px;">
        <span></span><span></span>
      </div>`
    const layout = describeLayout(document.getElementById('f')!)
    expect(layout.display).toBe('flex')
    expect(layout.direction).toBe('row')
    expect(layout.gapPx).toBe(12)
  })

  it('reads a flex column container without gap', () => {
    document.body.innerHTML = `<div id="f" style="display:flex; flex-direction:column;"></div>`
    const layout = describeLayout(document.getElementById('f')!)
    expect(layout.display).toBe('flex')
    expect(layout.direction).toBe('column')
    expect(layout.gapPx).toBeUndefined()
  })

  it('falls back to block for plain elements', () => {
    document.body.innerHTML = `<div id="b"></div>`
    const layout = describeLayout(document.getElementById('b')!)
    expect(layout.display).toBe('block')
  })
})

describe('findRepeaters', () => {
  it('detects a container with N children of the same tag', () => {
    document.body.innerHTML = `
      <ul id="list" style="display:flex; flex-direction:column;">
        <li>a</li><li>b</li><li>c</li><li>d</li>
      </ul>`
    const reps = findRepeaters(document.body)
    expect(reps).toHaveLength(1)
    expect(reps[0].selector).toBe('#list')
    expect(reps[0].containerTag).toBe('ul')
    expect(reps[0].childTag).toBe('li')
    expect(reps[0].childCount).toBe(4)
  })

  it('ignores containers with fewer than 3 same-tag children', () => {
    document.body.innerHTML = `<ul><li>a</li><li>b</li></ul>`
    expect(findRepeaters(document.body)).toHaveLength(0)
  })

  it('ignores containers whose children mix tags', () => {
    document.body.innerHTML = `
      <div id="mix"><article></article><article></article><article></article><p></p></div>`
    expect(findRepeaters(document.body)).toHaveLength(0)
  })

  it('detects custom-element children (e.g. <my-card>)', () => {
    document.body.innerHTML = `
      <div id="grid"><my-card></my-card><my-card></my-card><my-card></my-card></div>`
    const reps = findRepeaters(document.body)
    expect(reps).toHaveLength(1)
    expect(reps[0].childTag).toBe('my-card')
    expect(reps[0].childCount).toBe(3)
  })

  it('includes a sample of the first child outerHTML', () => {
    document.body.innerHTML = `
      <div id="grid">
        <article class="card"><h3>Title</h3><p>Body</p></article>
        <article class="card"><h3>Title 2</h3><p>Body 2</p></article>
        <article class="card"><h3>Title 3</h3><p>Body 3</p></article>
      </div>`
    const reps = findRepeaters(document.body)
    expect(reps[0].childSample).toContain('<article class="card">')
    expect(reps[0].childSample).toContain('<h3>Title</h3>')
  })

  it('finds multiple repeaters when there are sibling grids', () => {
    document.body.innerHTML = `
      <ul id="a"><li></li><li></li><li></li></ul>
      <ul id="b"><li></li><li></li><li></li><li></li></ul>`
    const reps = findRepeaters(document.body)
    expect(reps.map((r) => r.selector).sort()).toEqual(['#a', '#b'])
  })
})

describe('captureAffected', () => {
  it('returns observations for each found selector', () => {
    document.body.innerHTML = `
      <div id="grid" style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 4px;">
        <div class="card">a</div>
        <div class="card">b</div>
        <div class="card">c</div>
      </div>`
    const out = captureAffected(['#grid', '.card'])
    expect(out).toHaveLength(2)
    const grid = out.find((o) => o.selector === '#grid')!
    expect(grid.found).toBe(true)
    expect(grid.tag).toBe('div')
    expect(grid.layout?.display).toBe('grid')
    expect(grid.layout?.columns).toBe(2)
    expect(grid.childCount).toBe(3)
    expect(grid.childSample).toContain('<div class="card">a</div>')
  })

  it('marks missing selectors as not found', () => {
    document.body.innerHTML = `<div></div>`
    const out = captureAffected(['#missing'])
    expect(out).toEqual([{ selector: '#missing', found: false }])
  })

  it('reports text content for leaf elements without children', () => {
    document.body.innerHTML = `<h1 id="t">Hello world</h1>`
    const out = captureAffected(['#t'])
    expect(out[0].text).toBe('Hello world')
    expect(out[0].childCount).toBeUndefined()
  })
})

describe('sampleChild', () => {
  it('strips long style attributes', () => {
    const long = 'x:1;'.repeat(200) // 800 chars
    document.body.innerHTML = `<div id="x" style="${long}">hi</div>`
    const out = sampleChild(document.getElementById('x')!)
    expect(out).not.toContain('x:1;x:1;x:1;')
    expect(out).toContain('style="…"')
    expect(out).toContain('>hi</div>')
  })

  it('truncates very long outerHTML', () => {
    document.body.innerHTML = `<div id="x">${'<span>a</span>'.repeat(500)}</div>`
    const out = sampleChild(document.getElementById('x')!)
    expect(out.length).toBeLessThanOrEqual(1600)
    expect(out).toContain('…')
  })

  it('leaves short outerHTML untouched', () => {
    document.body.innerHTML = `<div id="x"><span>a</span></div>`
    const out = sampleChild(document.getElementById('x')!)
    expect(out).toBe('<div id="x"><span>a</span></div>')
  })
})
