// Persisted config, stored in chrome.storage.local. Keys never leave the user's
// browser; they're read only inside the side panel when calling the model.
// `apiKey` is a Vercel AI Gateway key; `model` is the single vision-capable
// model used for the one-shot Tailwind edit.

export interface Settings {
  apiKey: string
  model: string
}

const DEFAULTS: Settings = {
  apiKey: '',
  model: 'google/gemini-3-pro-preview',
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(DEFAULTS)
  return { ...DEFAULTS, ...stored } as Settings
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch)
}
