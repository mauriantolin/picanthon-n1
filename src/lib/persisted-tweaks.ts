// Persists applied tweaks per-URL in chrome.storage.local so they survive page
// reloads, navigation, side-panel close and extension reload. The content script
// restores them on load. (Usable from any extension context with the `storage`
// permission, including the content script's ISOLATED world.)

import type { Tweak } from './tweaks'

// chrome.storage.local total quota is 10 MB. Cap a single URL's entry well below
// that so an agent that emits huge insertHTML cards can't blow the storage and
// poison every other URL's entry. If we'd cross the cap, we drop the write and
// warn — the in-memory tweaks still apply for the current session.
const MAX_BYTES_PER_KEY = 4 * 1024 * 1024

function keyFor(url: string): string {
  try {
    const u = new URL(url)
    return `tweaks:${u.origin}${u.pathname}`
  } catch {
    return `tweaks:${url}`
  }
}

export async function loadTweaks(url: string): Promise<Tweak[]> {
  const key = keyFor(url)
  const got = await chrome.storage.local.get(key)
  const value = got[key]
  return Array.isArray(value) ? (value as Tweak[]) : []
}

export async function saveTweaks(url: string, tweaks: Tweak[]): Promise<void> {
  const key = keyFor(url)
  const size = new Blob([JSON.stringify(tweaks)]).size
  if (size > MAX_BYTES_PER_KEY) {
    console.warn(
      `[picanthon] tweaks for ${key} are ${size} bytes (>${MAX_BYTES_PER_KEY}); skipping persistence`,
    )
    return
  }
  try {
    await chrome.storage.local.set({ [key]: tweaks })
  } catch (err) {
    console.warn(`[picanthon] saveTweaks failed for ${key}: ${String(err)}`)
  }
}

export async function clearTweaks(url: string): Promise<void> {
  await chrome.storage.local.remove(keyFor(url))
}
