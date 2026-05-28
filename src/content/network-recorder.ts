// Runs in the page's MAIN world (document_start) so it can patch the page's own
// fetch / XMLHttpRequest and observe the JSON responses the page already
// received. It has NO access to chrome.* (MAIN world) — it talks to the ISOLATED
// content script purely via window.postMessage. It never re-issues requests; it
// only buffers what the page itself fetched.

interface Capture {
  id: number
  url: string
  method: string
  status: number
  contentType?: string
  json?: unknown
  ts: number
}

const MAX = 25
const MAX_BODY = 1_000_000 // skip bodies larger than ~1MB
const buffer: Capture[] = []
let nextId = 1

function record(url: string, method: string, status: number, contentType: string | null, text: string) {
  if (!text || text.length > MAX_BODY) return
  const ct = contentType ?? ''
  const looksJson = ct.includes('json') || /^[\[{]/.test(text.trim())
  if (!looksJson) return
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return
  }
  buffer.push({ id: nextId++, url, method, status, contentType: ct || undefined, json, ts: Date.now() })
  if (buffer.length > MAX) buffer.shift()
}

// --- patch fetch ---
const origFetch = window.fetch
window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
  const res = await origFetch.apply(this, args)
  try {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request | URL).toString()
    const method =
      (args[1]?.method ?? (args[0] instanceof Request ? args[0].method : 'GET')) || 'GET'
    const ct = res.headers.get('content-type')
    res
      .clone()
      .text()
      .then((t) => record(url, method.toUpperCase(), res.status, ct, t))
      .catch(() => {})
  } catch {
    /* never break the page's fetch */
  }
  return res
}

// --- patch XMLHttpRequest ---
const XHR = XMLHttpRequest.prototype
const origOpen = XHR.open
const origSend = XHR.send
XHR.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  ;(this as unknown as { __picMethod?: string; __picUrl?: string }).__picMethod = method
  ;(this as unknown as { __picUrl?: string }).__picUrl = String(url)
  // @ts-expect-error pass through original signature
  return origOpen.call(this, method, url, ...rest)
}
XHR.send = function (this: XMLHttpRequest, ...args: unknown[]) {
  this.addEventListener('load', () => {
    try {
      const meta = this as unknown as { __picMethod?: string; __picUrl?: string }
      const type = this.responseType
      if (type === '' || type === 'text' || type === 'json') {
        const text =
          type === 'json' ? JSON.stringify(this.response) : (this.responseText ?? '')
        record(
          meta.__picUrl ?? this.responseURL,
          (meta.__picMethod ?? 'GET').toUpperCase(),
          this.status,
          this.getResponseHeader('content-type'),
          text,
        )
      }
    } catch {
      /* ignore */
    }
  })
  // @ts-expect-error pass through original signature
  return origSend.apply(this, args)
}

// --- respond to capture requests from the ISOLATED content script ---
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const data = event.data as { source?: string; kind?: string; nonce?: number }
  if (data?.source !== 'picanthon-cs' || data.kind !== 'net:req') return
  window.postMessage(
    { source: 'picanthon-rec', kind: 'net:res', nonce: data.nonce, captures: buffer },
    '*',
  )
})
