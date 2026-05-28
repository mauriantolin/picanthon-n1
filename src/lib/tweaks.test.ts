import { beforeEach, describe, expect, it } from 'vitest'
import { applyTweaks } from './tweaks'

beforeEach(() => {
  document.body.innerHTML = `
    <h1 id="title">Hello</h1>
    <p class="x">one</p>
    <p class="x">two</p>
    <img src="a.png" />
  `
})

describe('applyTweaks', () => {
  it('setStyle sets inline styles and reports matches', () => {
    const [r] = applyTweaks([
      { op: 'setStyle', selector: 'p.x', styles: { color: 'red' } },
    ])
    expect(r.matched).toBe(2)
    expect(document.querySelectorAll('p.x')[0].getAttribute('style')).toContain('color: red')
  })

  it('addClass / setText / setAttr apply', () => {
    applyTweaks([
      { op: 'addClass', selector: '#title', className: 'big' },
      { op: 'setText', selector: '#title', text: 'Hola' },
      { op: 'setAttr', selector: 'img', name: 'alt', value: 'pic' },
    ])
    const h1 = document.querySelector('#title')!
    expect(h1.classList.contains('big')).toBe(true)
    expect(h1.textContent).toBe('Hola')
    expect(document.querySelector('img')!.getAttribute('alt')).toBe('pic')
  })

  it('remove deletes matching nodes', () => {
    const [r] = applyTweaks([{ op: 'remove', selector: 'img' }])
    expect(r.matched).toBe(1)
    expect(document.querySelector('img')).toBeNull()
  })

  it('reports an error for an invalid selector without throwing', () => {
    const [r] = applyTweaks([{ op: 'remove', selector: '::::' }])
    expect(r.matched).toBe(0)
    expect(r.error).toBeTruthy()
  })
})
