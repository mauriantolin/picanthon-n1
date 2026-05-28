// Content script (ISOLATED world): the only context with direct DOM access.
// Handles GET_SNAPSHOT (page context for diagnostics), APPLY_TWEAKS (single
// setAttr from the Tailwind editor), CLEAR_TWEAKS, the picker, and the
// scribble overlay. Persisted tweaks are restored on page load so changes
// survive reloads.

import type { Message } from '@/lib/messaging'
import { clearTweaks, loadTweaks, saveTweaks } from '@/lib/persisted-tweaks'
import { buildSnapshot, captureAffected } from './page-context'
import { cancelPick, startPick } from './picker'
import { cancelDraw, startDraw } from './scribble'
import { TweakPersistence } from './persistence'

const persistence = new TweakPersistence()

loadTweaks(location.href)
  .then((tweaks) => {
    if (tweaks.length) persistence.apply(tweaks)
  })
  .catch(() => {})

chrome.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
  switch (msg.type) {
    case 'GET_SNAPSHOT':
      sendResponse(buildSnapshot())
      return true

    case 'APPLY_TWEAKS': {
      const results = persistence.apply(msg.tweaks)
      saveTweaks(location.href, persistence.getAll()).catch(() => {})
      sendResponse(results)
      return true
    }

    case 'CLEAR_TWEAKS':
      persistence.clear()
      clearTweaks(location.href)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }))
      return true

    case 'START_PICK':
      cancelDraw()
      startPick().then(sendResponse)
      return true

    case 'CANCEL_PICK':
      cancelPick()
      sendResponse({ ok: true })
      return true

    case 'START_DRAW':
      cancelPick()
      startDraw().then(sendResponse)
      return true

    case 'CANCEL_DRAW':
      cancelDraw()
      sendResponse({ ok: true })
      return true

    case 'CAPTURE_AFFECTED':
      sendResponse(captureAffected(msg.selectors))
      return true

    case 'BEGIN_FULL_CAPTURE': {
      const body = document.body
      const html = document.documentElement
      const pageHeight = Math.max(
        body?.scrollHeight ?? 0,
        html.scrollHeight,
        html.clientHeight,
      )
      const pageWidth = Math.max(
        body?.scrollWidth ?? 0,
        html.scrollWidth,
        html.clientWidth,
      )
      sendResponse({
        pageWidth,
        pageHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        originalScrollY: window.scrollY,
      })
      return true
    }

    case 'SCROLL_TO': {
      window.scrollTo({ top: msg.y, left: 0, behavior: 'instant' as ScrollBehavior })
      // Two rAFs so the engine has actually painted at the new offset before
      // the side panel calls chrome.tabs.captureVisibleTab.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => sendResponse({ actualY: window.scrollY }))
      })
      return true
    }

    case 'END_FULL_CAPTURE':
      window.scrollTo({
        top: msg.restoreY,
        left: 0,
        behavior: 'instant' as ScrollBehavior,
      })
      sendResponse({ ok: true })
      return true

    case 'ENSURE_TAILWIND_RUNTIME':
      ensureTailwindRuntime().then(sendResponse)
      return true

    default:
      return false
  }
})

const TW_RUNTIME_MARKER = 'data-picanthon-tw-runtime'

// Inject Tailwind Play CDN once. The CDN bundles a JIT compiler + a
// MutationObserver, so any class added later via setAttr (including arbitrary
// variants) gets compiled into a runtime <style> tag. Returns once the script
// has actually loaded — the caller can then apply the tweak and trust the
// classes will paint.
function ensureTailwindRuntime(): Promise<{
  ok: boolean
  alreadyPresent?: boolean
  error?: string
}> {
  const existing = document.querySelector(`script[${TW_RUNTIME_MARKER}]`)
  if (existing) {
    return Promise.resolve({ ok: true, alreadyPresent: true })
  }
  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = 'https://cdn.tailwindcss.com'
    script.setAttribute(TW_RUNTIME_MARKER, '1')
    script.onload = () => {
      console.debug('[picanthon/content] Tailwind runtime loaded')
      // Give the CDN one tick to attach its MutationObserver before resolving.
      setTimeout(() => resolve({ ok: true }), 30)
    }
    script.onerror = () => {
      console.warn('[picanthon/content] Tailwind runtime failed to load (CSP?)')
      script.remove()
      resolve({ ok: false, error: 'Tailwind CDN load failed (probable CSP block)' })
    }
    ;(document.head || document.documentElement).appendChild(script)
  })
}
