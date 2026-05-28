// Devtools-style element picker. Mounts a Shadow-DOM overlay on the page, lets
// the user hover and click an element, and resolves with the selected element's
// stable selector + outerHTML + computedStyles. No chrome.* here — this is a
// pure DOM module so it stays unit-testable under jsdom.

import type { PickedElement, PickResult } from '@/lib/messaging'
import { cssPath } from './page-context'

const PICKER_ATTR = 'data-picanthon'
const PICKER_VALUE = 'picker'
const MAX_OUTER_HTML = 50_000

interface ActiveSession {
  host: HTMLElement
  resolve: (result: PickResult) => void
  previousCursor: string
  detach: () => void
}

let active: ActiveSession | null = null

export function startPick(): Promise<PickResult> {
  if (active) cancelPick()

  return new Promise<PickResult>((resolve) => {
    const host = document.createElement('div')
    host.setAttribute(PICKER_ATTR, PICKER_VALUE)
    host.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:2147483647;'
    const shadow = host.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = `
      .outline {
        position: fixed;
        pointer-events: none;
        outline: 2px solid rgba(239, 68, 68, .9);
        background: rgba(239, 68, 68, .1);
        box-sizing: border-box;
        display: none;
      }
      .label {
        position: fixed;
        pointer-events: none;
        background: rgba(239, 68, 68, .95);
        color: white;
        font: 600 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        padding: 2px 6px;
        border-radius: 3px;
        white-space: nowrap;
        display: none;
      }
    `
    const outline = document.createElement('div')
    outline.className = 'outline'
    const label = document.createElement('div')
    label.className = 'label'
    shadow.append(style, outline, label)

    document.body.appendChild(host)

    const previousCursor = document.body.style.cursor
    document.body.style.cursor = 'crosshair'

    const finish = (result: PickResult) => {
      detach()
      resolve(result)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        finish({ cancelled: true })
      }
    }
    // Capture-phase swallow: stops the page from acting on the pick click.
    const swallow = (e: Event) => {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (!target || target.closest(`[${PICKER_ATTR}="${PICKER_VALUE}"]`)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      finish(extract(target))
    }
    // Repositions the outline + label on every mousemove. The host has
    // `pointer-events: none` so `elementFromPoint` naturally skips it; we still
    // belt-and-suspenders filter via `closest` in case the page mutates styles.
    const onMouseMove = (e: MouseEvent) => {
      const target = document.elementFromPoint(e.clientX, e.clientY) as Element | null
      if (!target || target.closest(`[${PICKER_ATTR}="${PICKER_VALUE}"]`)) {
        outline.style.display = 'none'
        label.style.display = 'none'
        return
      }
      const r = target.getBoundingClientRect()
      outline.style.display = 'block'
      outline.style.left = `${r.x}px`
      outline.style.top = `${r.y}px`
      outline.style.width = `${r.width}px`
      outline.style.height = `${r.height}px`

      const labelTop = r.y > 18 ? r.y - 18 : r.y + r.height + 2
      label.style.display = 'block'
      label.style.left = `${r.x}px`
      label.style.top = `${labelTop}px`
      label.textContent = `${target.tagName.toLowerCase()} · ${Math.round(r.width)}×${Math.round(r.height)}`
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', swallow, true)
    document.addEventListener('mouseup', swallow, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('mousemove', onMouseMove, true)

    const detach = () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', swallow, true)
      document.removeEventListener('mouseup', swallow, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('mousemove', onMouseMove, true)
      host.remove()
      document.body.style.cursor = previousCursor
      active = null
    }

    active = { host, resolve, previousCursor, detach }
  })
}

export function cancelPick(): void {
  if (!active) return
  const { resolve, detach } = active
  detach()
  resolve({ cancelled: true })
}

function extract(el: Element): PickedElement {
  const rect = el.getBoundingClientRect()
  const computedStyles = collectComputedStyles(el)
  let outerHTML = el.outerHTML
  if (outerHTML.length > MAX_OUTER_HTML) {
    outerHTML = outerHTML.slice(0, MAX_OUTER_HTML) + '… [truncated]'
  }
  const text = truncate(el.textContent ?? '', 200)
  return {
    selector: cssPath(el),
    tag: el.tagName.toLowerCase(),
    outerHTML,
    computedStyles,
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    text: text || undefined,
  }
}

function collectComputedStyles(el: Element): Record<string, string> {
  const styles = getComputedStyle(el)
  const out: Record<string, string> = {}
  for (let i = 0; i < styles.length; i++) {
    const prop = styles.item(i)
    const value = styles.getPropertyValue(prop)
    if (value !== '') out[prop] = value
  }
  return out
}

function truncate(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > n ? t.slice(0, n) + '…' : t
}
