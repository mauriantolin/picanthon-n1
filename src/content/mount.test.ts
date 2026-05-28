import { beforeEach, describe, expect, it } from 'vitest'
import { mountHtml, revertMount } from './mount'

beforeEach(() => {
  document.body.innerHTML = `<div id="wrap"><table id="t"><tbody><tr><td>x</td></tr></tbody></table></div>`
})

describe('mountHtml (model-generated HTML)', () => {
  it('mounts sanitized HTML in a shadow root and hides the original', () => {
    const html =
      `<style>.c{color:red}</style>` +
      `<div class="c">hi</div>` +
      `<script>window.__pwned = 1</script>` +
      `<a href="javascript:alert(1)" onclick="boom()">link</a>`

    const res = mountHtml('#t', html)
    expect(res.ok).toBe(true)

    const host = document.getElementById(res.mountId!)!
    const sr = host.shadowRoot!
    expect(sr).toBeTruthy()
    // Script stripped, never executed.
    expect(sr.querySelector('script')).toBeNull()
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
    // Safe content kept.
    expect(sr.querySelector('.c')?.textContent).toBe('hi')
    expect(sr.querySelector('style')).toBeTruthy()
    // Event handler + javascript: URL stripped.
    const a = sr.querySelector('a')!
    expect(a.getAttribute('onclick')).toBeNull()
    expect(a.getAttribute('href')).toBeNull()
    // Original hidden, not removed.
    const original = document.getElementById('t') as HTMLElement
    expect(original.style.display).toBe('none')
  })

  it('errors on a missing selector', () => {
    expect(mountHtml('#nope', '<div></div>').ok).toBe(false)
  })

  it('revert restores the original element', () => {
    const res = mountHtml('#t', '<div>hi</div>')
    expect(revertMount(res.mountId!)).toBe(true)
    expect(document.getElementById(res.mountId!)).toBeNull()
    expect((document.getElementById('t') as HTMLElement).style.display).toBe('')
  })
})
