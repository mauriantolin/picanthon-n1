// Mounts a registry component into the page inside a Shadow DOM host, so the
// component's CSS is fully isolated from the page (and vice-versa). The original
// element is hidden (not removed) so a revert is one step. Lives on the content
// side and is loaded lazily (dynamic import) so React isn't shipped to every
// page until a replacement actually happens.

import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DataTable } from '@/components/replacements/DataTable'
import { correlateTable } from '@/lib/correlation'
import { getComponent } from '@/lib/component-registry'
import type { NetworkCapture, ReplaceResult } from '@/lib/messaging'

interface MountRecord {
  host: HTMLElement
  root?: Root // present for React mounts; absent for raw-HTML (model-generated) mounts
  original: HTMLElement
}

const mounts = new Map<string, MountRecord>()
let counter = 0

export function replaceComponent(
  selector: string,
  componentId: string,
  captures: NetworkCapture[],
): ReplaceResult {
  const meta = getComponent(componentId)
  if (!meta) return { ok: false, error: `Componente desconocido: ${componentId}` }

  const el = document.querySelector(selector) as HTMLElement | null
  if (!el) return { ok: false, error: `No encontré el elemento: ${selector}` }

  if (componentId !== 'data-table') {
    return { ok: false, error: `Montaje no soportado aún para: ${componentId}` }
  }

  const data = correlateTable(el, captures)
  if (data.rows.length === 0) {
    return { ok: false, error: 'No pude extraer datos de la tabla (ni del DOM ni de la red).' }
  }

  const mountId = `picanthon-mount-${++counter}`
  const host = document.createElement('div')
  host.id = mountId
  host.setAttribute('data-picanthon', 'mount')

  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = DATA_TABLE_CSS
  const container = document.createElement('div')
  shadow.append(style, container)

  el.parentElement?.insertBefore(host, el)
  el.style.display = 'none'

  const root = createRoot(container)
  root.render(createElement(DataTable, { columns: data.columns, rows: data.rows }))
  mounts.set(mountId, { host, root, original: el })

  return {
    ok: true,
    mountId,
    rows: data.rows.length,
    columns: data.columns,
    source: data.source,
  }
}

// Mount a model-generated, self-contained HTML fragment in an isolated Shadow DOM.
// The HTML is sanitized (no scripts / event handlers / javascript: URLs) before
// injection — we never execute model-generated code.
export function mountHtml(selector: string, html: string): ReplaceResult {
  const el = document.querySelector(selector) as HTMLElement | null
  if (!el) return { ok: false, error: `No encontré el elemento: ${selector}` }

  const mountId = `picanthon-mount-${++counter}`
  const host = document.createElement('div')
  host.id = mountId
  host.setAttribute('data-picanthon', 'mount')

  const shadow = host.attachShadow({ mode: 'open' })
  const reset = document.createElement('style')
  reset.textContent = ':host { all: initial; }'
  const container = document.createElement('div')
  container.appendChild(sanitizeHtml(html))
  shadow.append(reset, container)

  el.parentElement?.insertBefore(host, el)
  el.style.display = 'none'
  mounts.set(mountId, { host, original: el })

  return { ok: true, mountId }
}

// Parse + strip anything executable, then import the safe nodes into our doc.
function sanitizeHtml(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  parsed.querySelectorAll('script, iframe, object, embed, link').forEach((n) => n.remove())
  parsed.querySelectorAll('*').forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) node.removeAttribute(attr.name)
      if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
        node.removeAttribute(attr.name)
      }
    }
  })

  const frag = document.createDocumentFragment()
  parsed.head.querySelectorAll('style').forEach((s) => frag.appendChild(document.importNode(s, true)))
  Array.from(parsed.body.childNodes).forEach((n) => frag.appendChild(document.importNode(n, true)))
  return frag
}

export function revertMount(mountId: string): boolean {
  const m = mounts.get(mountId)
  if (!m) return false
  m.root?.unmount()
  m.host.remove()
  m.original.style.removeProperty('display')
  mounts.delete(mountId)
  return true
}

const DATA_TABLE_CSS = `
:host { all: initial; }
.pic-dt {
  font-family: system-ui, -apple-system, sans-serif;
  color: #18181b;
  border: 1px solid #e4e4e7;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
  font-size: 13px;
}
.pic-dt-table { width: 100%; border-collapse: collapse; }
.pic-dt-th {
  text-align: left;
  padding: 8px 12px;
  background: #fafafa;
  border-bottom: 1px solid #e4e4e7;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.pic-dt-th:hover { background: #f4f4f5; }
.pic-dt-sort { color: #ff3e7f; }
.pic-dt-tr:hover { background: #fafafa; }
.pic-dt-td {
  padding: 8px 12px;
  border-bottom: 1px solid #f1f1f4;
  vertical-align: top;
}
.pic-dt-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #fafafa;
  border-top: 1px solid #e4e4e7;
}
.pic-dt-count { color: #71717a; }
.pic-dt-pager { display: flex; align-items: center; gap: 8px; }
.pic-dt-page { color: #71717a; min-width: 48px; text-align: center; }
.pic-dt-btn {
  border: 1px solid #e4e4e7;
  background: #fff;
  border-radius: 6px;
  padding: 2px 10px;
  cursor: pointer;
  font-size: 14px;
}
.pic-dt-btn:disabled { opacity: 0.4; cursor: default; }
.pic-dt-btn:not(:disabled):hover { background: #f4f4f5; }
`
