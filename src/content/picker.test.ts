import { describe, it, expect, afterEach, vi } from 'vitest'
import { startPick, cancelPick } from './picker'

afterEach(() => {
  // belt-and-braces: ensure no leftover overlay between tests
  cancelPick()
  document.body.innerHTML = ''
  document.body.style.cursor = ''
  vi.useRealTimers()
})

function pickerHost(): HTMLElement | null {
  return document.querySelector('[data-picanthon="picker"]')
}

describe('picker overlay lifecycle', () => {
  it('mounts a Shadow DOM host while picking and removes it on cancel', () => {
    expect(pickerHost()).toBeNull()
    const promise = startPick()
    expect(pickerHost()).not.toBeNull()
    expect(pickerHost()!.shadowRoot).not.toBeNull()
    cancelPick()
    return promise.then((result) => {
      expect(result).toEqual({ cancelled: true })
      expect(pickerHost()).toBeNull()
    })
  })

  it('sets and restores the body cursor', () => {
    document.body.style.cursor = 'auto'
    const promise = startPick()
    expect(document.body.style.cursor).toBe('crosshair')
    cancelPick()
    return promise.then(() => {
      expect(document.body.style.cursor).toBe('auto')
    })
  })
})

describe('picker ESC cancellation', () => {
  it('resolves with { cancelled: true } when Escape is pressed', async () => {
    const promise = startPick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await expect(promise).resolves.toEqual({ cancelled: true })
    expect(pickerHost()).toBeNull()
  })
})

describe('picker click extraction', () => {
  it('resolves with a PickedElement whose selector resolves back to the same node', async () => {
    document.body.innerHTML = `
      <main>
        <section id="hero">
          <h1>Hello</h1>
          <button class="cta">Buy</button>
        </section>
      </main>
    `
    const btn = document.querySelector('button.cta') as HTMLElement
    const promise = startPick()

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const result = await promise

    expect('cancelled' in result).toBe(false)
    if ('cancelled' in result) return
    expect(result.tag).toBe('button')
    expect(result.text).toBe('Buy')
    expect(document.querySelector(result.selector)).toBe(btn)
    expect(result.outerHTML).toContain('Buy')
    expect(result.boundingBox).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })
  })

  it('prevents the page from receiving the click', async () => {
    document.body.innerHTML = `<a id="link" href="#after">Go</a>`
    const link = document.getElementById('link') as HTMLAnchorElement
    let pageSawClick = false
    link.addEventListener('click', () => {
      pageSawClick = true
    })
    const promise = startPick()
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await promise
    expect(pageSawClick).toBe(false)
  })
})

describe('picker payload caps', () => {
  it('truncates outerHTML when it exceeds the 50KB cap', async () => {
    const big = 'x'.repeat(60_000)
    document.body.innerHTML = `<div id="big">${big}</div>`
    const promise = startPick()
    document.getElementById('big')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    const result = await promise
    if ('cancelled' in result) throw new Error('expected pick')
    expect(result.outerHTML.endsWith('… [truncated]')).toBe(true)
    expect(result.outerHTML.length).toBeLessThanOrEqual(50_000 + '… [truncated]'.length)
  })
})

describe('picker computedStyles filter', () => {
  it('omits properties whose computed value is the empty string', async () => {
    document.body.innerHTML = `<div id="d" style="color: rgb(255, 0, 0);">x</div>`
    const promise = startPick()
    document.getElementById('d')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    const result = await promise
    if ('cancelled' in result) throw new Error('expected pick')
    for (const v of Object.values(result.computedStyles)) {
      expect(v).not.toBe('')
    }
    // jsdom returns this for inline styles
    expect(result.computedStyles.color).toBe('rgb(255, 0, 0)')
  })
})

describe('picker concurrent sessions', () => {
  it('cancels a prior session when startPick is called again', async () => {
    document.body.innerHTML = `<button id="a">A</button><button id="b">B</button>`
    const first = startPick()
    const second = startPick()
    await expect(first).resolves.toEqual({ cancelled: true })

    document.getElementById('b')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    const result = await second
    if ('cancelled' in result) throw new Error('expected pick')
    expect(result.text).toBe('B')
  })
})
