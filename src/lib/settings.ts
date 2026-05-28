// Persisted config (chrome.storage.local). Only the gateway API key is user-
// configurable; the model is locked.

export const MODEL = 'google/gemini-3-pro-preview'

export interface Settings {
  apiKey: string
  model: string
}

const DEFAULTS: Settings = { apiKey: '', model: MODEL }

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get({ apiKey: '' })
  return { apiKey: stored.apiKey ?? '', model: MODEL }
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const { model: _ignored, ...rest } = patch
  await chrome.storage.local.set(rest)
}

export { DEFAULTS }
