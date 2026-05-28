// Model factory — the single place that knows *which* provider backs the agent.
// Today: Vercel AI Gateway, called with the user's gateway API key. The gateway
// fronts Anthropic/OpenAI/Google behind one endpoint, so model IDs are in
// `provider/model` form (e.g. "anthropic/claude-sonnet-4.6").
//
// From a Chrome extension page (the side panel) the request to the gateway is
// allowed by our `<all_urls>` host permission — no CORS dance needed. To swap to
// a provider called directly (e.g. @ai-sdk/anthropic), change only this file.

import { createGateway, type LanguageModel } from 'ai'

export function buildModel(apiKey: string, model: string): LanguageModel {
  const gateway = createGateway({ apiKey })
  return gateway(model)
}
