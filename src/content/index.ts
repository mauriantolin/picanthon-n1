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

    default:
      return false
  }
})
