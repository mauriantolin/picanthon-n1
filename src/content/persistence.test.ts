import { beforeEach, describe, expect, it } from 'vitest'
import { TweakPersistence } from './persistence'

beforeEach(() => {
  document.body.innerHTML = `<div id="host"><span id="x">hi</span></div>`
})

describe('TweakPersistence', () => {
  it('applies tweaks and remembers them', () => {
    const p = new TweakPersistence()
    const results = p.apply([
      { op: 'setStyle', selector: '#x', styles: { color: 'red' } },
    ])
    expect(results[0].matched).toBe(1)
    expect(document.querySelector('#x')!.getAttribute('style')).toContain('color: red')
    p.stop()
  })

  it('re-applies after the page wipes the change (SPA re-render)', () => {
    const p = new TweakPersistence()
    p.apply([{ op: 'setStyle', selector: '#x', styles: { color: 'red' } }])

    // Simulate the site re-rendering and replacing our styled node.
    document.querySelector('#host')!.innerHTML = `<span id="x">hi</span>`
    expect(document.querySelector('#x')!.getAttribute('style')).toBeNull()

    p.reapply()
    expect(document.querySelector('#x')!.getAttribute('style')).toContain('color: red')
    p.stop()
  })

  it('does not duplicate insertHTML on re-apply', () => {
    const p = new TweakPersistence()
    p.apply([
      {
        op: 'insertHTML',
        selector: '#host',
        position: 'beforeend',
        html: '<b class="ins">!</b>',
      },
    ])
    expect(document.querySelectorAll('.ins').length).toBe(1)

    p.reapply()
    expect(document.querySelectorAll('.ins').length).toBe(1)
    p.stop()
  })

  it('observer re-applies asynchronously on DOM mutation', async () => {
    const p = new TweakPersistence()
    p.apply([{ op: 'setStyle', selector: '#x', styles: { color: 'red' } }])

    document.querySelector('#host')!.innerHTML = `<span id="x">hi</span>`
    await new Promise((r) => setTimeout(r, 250))

    expect(document.querySelector('#x')!.getAttribute('style')).toContain('color: red')
    p.stop()
  })
})
