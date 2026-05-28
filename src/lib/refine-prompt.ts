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

const SYSTEM = `You are a senior UX/UI designer. Rewrite the user's rough request into ONE precise editing instruction for the already-picked element.

Rules:
- Scope strictly to what the user asked. Never add changes they did not mention.
- The result MUST stay congruent with the page's existing design system: reuse the same background colors, borders, text colors, radius, shadows and typography seen elsewhere on the page. Never invent off-theme colors (e.g. no plain gray boxes on a dark page).
- Keep the existing fonts and colors; only change them if the user explicitly asked. Prioritize visibility: every text must keep an explicit, high-contrast color against its background (light text on dark surfaces, dark text on light) — never dark-on-dark or light-on-light.
- Accessibility is a must: the result must follow WCAG 2.2 AA — AA contrast, semantic markup and ARIA labels, keyboard focusability with a visible focus state, alt/aria-label for images and icons, and touch targets of at least 44x44px.
- Preserve content and structure unless the user clearly wanted them changed.
- Output ONLY the refined instruction: one short imperative sentence in the user's language. No preamble, options, or markdown.`

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
    abortSignal,
  })

  const refined = text.trim()
  return refined || rawRequest
}
