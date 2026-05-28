// Content script (ISOLATED world): the only context with direct DOM access.
// Handles GET_SNAPSHOT, APPLY_TWEAKS, GET_NETWORK_CAPTURE (via the MAIN-world
// recorder bridge), REPLACE_COMPONENT, and CLEAR_TWEAKS. Keeps applied tweaks
// alive across re-renders, and restores persisted tweaks on page load so they
// survive reloads, navigation and the side panel / extension closing.

import type { Message, ReplaceResult } from '@/lib/messaging'
import { requestNetworkCaptures } from '@/lib/net-bridge'
import { clearTweaks, loadTweaks, saveTweaks } from '@/lib/persisted-tweaks'
import { correlateTable, type TableData } from '@/lib/correlation'
import { buildSnapshot, captureAffected } from './page-context'
import { cancelPick, startPick } from './picker'
import { cancelDraw, startDraw } from './scribble'
import { TweakPersistence } from './persistence'

const persistence = new TweakPersistence()

// Restore previously-applied tweaks for this URL.
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

    case 'GET_NETWORK_CAPTURE':
      requestNetworkCaptures().then(sendResponse)
      return true // async response

    case 'REPLACE_COMPONENT':
      handleReplace(msg.selector, msg.componentId).then(sendResponse)
      return true // async response

    case 'GET_ELEMENT_DATA':
      getElementData(msg.selector).then(sendResponse)
      return true // async response

    case 'MOUNT_HTML':
      handleMountHtml(msg.selector, msg.html).then(sendResponse)
      return true // async response

    case 'CLEAR_TWEAKS':
      persistence.clear()
      clearTweaks(location.href)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }))
      return true // async response

    case 'START_PICK':
      cancelDraw()
      startPick().then(sendResponse)
      return true // async response

    case 'CANCEL_PICK':
      cancelPick()
      sendResponse({ ok: true })
      return true

    case 'START_DRAW':
      cancelPick()
      startDraw().then(sendResponse)
      return true // async response

    case 'CANCEL_DRAW':
      cancelDraw()
      sendResponse({ ok: true })
      return true

    case 'CAPTURE_AFFECTED':
      sendResponse(captureAffected(msg.selectors))
      return true

    default:
      return false
  }
})

async function handleReplace(selector: string, componentId: string): Promise<ReplaceResult> {
  try {
    const captures = await requestNetworkCaptures()
    // Lazily load the mount module (pulls in React) only when actually needed.
    const { replaceComponent } = await import('./mount')
    return replaceComponent(selector, componentId, captures)
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

async function getElementData(selector: string): Promise<TableData | { error: string }> {
  const el = document.querySelector(selector)
  if (!el) return { error: `No encontré el elemento: ${selector}` }
  const captures = await requestNetworkCaptures()
  return correlateTable(el, captures)
}

async function handleMountHtml(selector: string, html: string): Promise<ReplaceResult> {
  try {
    const { mountHtml } = await import('./mount')
    return mountHtml(selector, html)
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
