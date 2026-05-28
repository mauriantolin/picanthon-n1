// Persisted config, stored in chrome.storage.local. Keys never leave the user's
// browser; they're read only inside the side panel when calling the models.
// `apiKey` is a Vercel AI Gateway key — the single provider for both the agent
// and the UI-generation step of design_component.
//
// Two model slots, by design:
//   • `model` — the main agent loop, called on every step. Optimize for cost.
//   • `designerModel` — the "expensive" model used only by the design-quality
//     stages: plan_design (the brief) and design_component (the HTML/CSS).
//     Falls back to `model` when empty. Must be vision-capable if you want
//     the post-apply screenshot feedback to be inspected by a strong model.

export interface Settings {
  apiKey: string
  model: string
  designerModel: string
}

const DEFAULTS: Settings = {
  apiKey: '',
  model: 'anthropic/claude-sonnet-4.6',
  designerModel: '',
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(DEFAULTS)
  return { ...DEFAULTS, ...stored } as Settings
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch)
}
