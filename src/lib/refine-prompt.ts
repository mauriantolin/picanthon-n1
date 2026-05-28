// Pre-pass that rewrites the user's raw request into a precise editing
// instruction BEFORE the (slower, vision) editor model runs. It uses the
// cheapest/fastest Google model so it adds minimal latency. Its only job is to
// sharpen intent — never to invent changes.
//
// Goals:
//   - Pin down exactly which element/section the user means (the picker already
//     selected it; the refiner restates the change scoped to that target).
//   - Forbid edits the user did not ask for (no drive-by restyling).
//   - Think like a UX/UI designer so colors/spacing/typography stay coherent.

import { generateText, type LanguageModel } from 'ai'
import type { PickedElement } from './messaging'

// Fast + cheap Google model on the AI Gateway. Text-only, low latency.
export const REFINE_MODEL = 'google/gemini-2.5-flash-lite'

const SYSTEM = `You are a senior UX/UI designer turning a user's rough request into a precise, single-element editing instruction for another model.

The user already picked the exact target element. Your job is ONLY to clarify their intent — never to add scope.

Rules:
- Keep the change scoped to the picked element and what the user literally asked. Do NOT introduce changes they did not mention (no extra colors, spacing, fonts, layout, copy).
- If the request is vague, make it concrete using good design judgment: harmonious colors, consistent spacing, readable contrast, sensible hierarchy — but stay minimal.
- Preserve the element's content and structure unless the user clearly asked to change them.
- Output ONLY the refined instruction, one short imperative paragraph, in the user's language. No preamble, no options, no markdown.`

export async function refineRequest(
  model: LanguageModel,
  pinned: PickedElement,
  rawRequest: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const { text } = await generateText({
    model,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          `User request: ${rawRequest}\n\n` +
          `Picked target tag: <${pinned.tag}>\n` +
          `Picked target outerHTML:\n${pinned.outerHTML}`,
      },
    ],
    providerOptions: {
      google: { thinkingConfig: { thinkingLevel: 'low' } },
    },
    abortSignal,
  })

  const refined = text.trim()
  return refined || rawRequest
}
