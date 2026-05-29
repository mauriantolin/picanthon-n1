// Pre-pass that rewrites the user's raw request into a precise editing
// instruction BEFORE the (slower, vision) editor model runs. It uses the
// cheapest/fastest Google model so it adds minimal latency. Its only job is to
// sharpen intent — never to invent changes and never to change WHAT operation
// the user asked for (add vs replace vs delete vs restyle).
//
// Goals:
//   - Restate the user's intent precisely while preserving the operation type:
//     "add X" stays an addition, "replace Y" stays a replacement, "remove Z"
//     stays a removal, "make X red" stays a restyle. The refiner never turns
//     one into another.
//   - Keep things scoped to what the user mentioned (no drive-by restyling).
//   - Think like a UX/UI designer so colors/spacing/typography stay coherent.

import { generateText, type LanguageModel } from 'ai'
import type { PickedElement } from './messaging'

// Fast + cheap Google model on the AI Gateway. Text-only, low latency.
export const REFINE_MODEL = 'google/gemini-2.5-flash-lite'

const SYSTEM = `You are a senior UX/UI designer. Rewrite the user's rough request into ONE precise editing instruction.

Critical: preserve the user's intent and the TYPE of operation they asked for. Do not turn an "add" into a "replace", a "remove" into a "modify", or a restyle into a rewrite. Mirror the verb the user used:
- "add", "agregar", "insertar", "append" → keep it an INSERTION.
- "replace", "rewrite", "swap", "cambiá esto por" → keep it a REPLACEMENT.
- "remove", "hide", "delete", "ocultar", "borrar" → keep it a REMOVAL.
- "make X red", "bigger", "rounder", "change color" → keep it a STYLE/ATTR change.
- When the user references a SUB-PART of the picked target ("the button inside this card", "the title of this section"), keep that scoping — do not promote the change to the whole target.
- When no element is picked, the scope is the whole page; restate which element the request refers to without inventing a target.

Other rules:
- Scope strictly to what the user asked. Never add changes they did not mention.
- The result MUST stay congruent with the page's existing design system: reuse the same background colors, borders, text colors, radius, shadows and typography seen elsewhere on the page. Never invent off-theme colors (e.g. no plain gray boxes on a dark page).
- Keep existing fonts and colors; only change them if the user explicitly asked. Every text must keep an explicit, high-contrast color against its background (light text on dark surfaces, dark text on light) — never dark-on-dark or light-on-light.
- Accessibility is a must: WCAG 2.2 AA — AA contrast, semantic markup and ARIA labels, keyboard focusability with a visible focus state, alt/aria-label for images and icons, and touch targets of at least 44x44px.
- Preserve content and structure unless the user clearly wanted them changed.
- Reuse the exact Tailwind classes already present on the affected elements; only change classes strictly required by the request.

Output ONLY the refined instruction: one short imperative sentence in the user's language. No preamble, options, or markdown.`

export async function refineRequest(
  model: LanguageModel,
  pinned: PickedElement | null,
  rawRequest: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  const context = pinned
    ? `Picked target tag: <${pinned.tag}>\n` +
      `Picked target outerHTML:\n${pinned.outerHTML}`
    : 'No element was picked — the user is asking for a change on the page as a whole. Restate which element they mean without inventing one.'

  const { text } = await generateText({
    model,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `User request: ${rawRequest}\n\n${context}`,
      },
    ],
    abortSignal,
  })

  const refined = text.trim()
  return refined || rawRequest
}
