// ISOLATED-world side of the MAIN<->ISOLATED bridge. Asks the network recorder
// (MAIN world) for the JSON responses the page already received, correlating
// request/response with a nonce and giving up after a timeout.

import type { NetworkCapture } from './messaging'

export function requestNetworkCaptures(timeoutMs = 1500): Promise<NetworkCapture[]> {
  return new Promise((resolve) => {
    const nonce = Math.floor(Math.random() * 1e9)

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return
      const d = event.data as {
        source?: string
        kind?: string
        nonce?: number
        captures?: NetworkCapture[]
      }
      if (d?.source === 'picanthon-rec' && d.kind === 'net:res' && d.nonce === nonce) {
        cleanup()
        resolve(d.captures ?? [])
      }
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve([])
    }, timeoutMs)

    function cleanup() {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
    }

    window.addEventListener('message', onMessage)
    window.postMessage({ source: 'picanthon-cs', kind: 'net:req', nonce }, '*')
  })
}
