// One-shot Tailwind edit: ONE LLM call that takes a body screenshot + the
// picked element's outerHTML (already Tailwind-styled) and returns the new
// class string for that element. No agent loop, no tool-call round trips.

import { generateText, Output, type LanguageModel } from 'ai'
import { z } from 'zod'
import type { PickedElement } from './messaging'
import { captureActiveTab, type Screenshot } from './screenshot'

const SYSTEM = `You are a senior UI engineer editing a live web page styled exclusively with Tailwind.

You receive:
1. A screenshot of the page body — read the existing design system from it (palette, type scale, spacing density, radius, border weight).
2. The outerHTML of ONE picked target element, including its current Tailwind class string.
3. The user's free-form request.

Return:
- "classes": the FULL new value for the target's class attribute (Tailwind tokens, space-separated). It REPLACES the old class attribute — preserve any layout / data-* / state classes that are not the subject of the request.
- "summary": one short sentence (in the user's language) describing what changed.

Hard rules:
- Tailwind only. No inline styles, no custom CSS, no arbitrary values unless strictly needed.
- Stay coherent with the design system visible in the screenshot. Reuse its palette/scales.
- Anti-AI-slop: no gratuitous gradients, no neon shadows, no rainbow palettes. Restraint, clear hierarchy, generous spacing, 1px borders.
- Minimal diff: change only what the request demands.
- Maintain accessible contrast (text vs background) and readable font sizes.`

const outputSchema = z.object({
  classes: z.string().describe("The full new value for the target's class attribute (Tailwind tokens, space-separated)."),
  summary: z.string().describe('One short sentence telling the user what changed, in their language.'),
})

export interface TailwindEditResult {
  selector: string
  oldClasses: string
  newClasses: string
  summary: string
}

export interface TailwindEditOutcome {
  result: TailwindEditResult
  bodyShot: Screenshot | null
}

export function extractClassAttr(outerHTML: string): string {
  const m = outerHTML.match(/^<[^>]*?\sclass=["']([^"']*)["']/i)
  return m ? m[1] : ''
}

export async function runTailwindEdit(
  model: LanguageModel,
  pinned: PickedElement,
  request: string,
  abortSignal?: AbortSignal,
): Promise<TailwindEditOutcome> {
  const bodyShot = await captureActiveTab().catch(() => null)
  const oldClasses = extractClassAttr(pinned.outerHTML)

  const userParts: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; image: string; mediaType: 'image/png' }
  > = []

  if (bodyShot) {
    userParts.push({
      type: 'image',
      image: `data:${bodyShot.mediaType};base64,${bodyShot.data}`,
      mediaType: 'image/png',
    })
  }

  userParts.push({
    type: 'text',
    text:
      `User request: ${request}\n\n` +
      `Target selector: ${pinned.selector}\n` +
      `Target tag: <${pinned.tag}>\n` +
      `Current class attribute: ${oldClasses || '(empty)'}\n\n` +
      `Target outerHTML:\n${pinned.outerHTML}`,
  })

  const { output } = await generateText({
    model,
    system: SYSTEM,
    output: Output.object({ schema: outputSchema }),
    messages: [{ role: 'user', content: userParts }],
    abortSignal,
  })

  return {
    result: {
      selector: pinned.selector,
      oldClasses,
      newClasses: output.classes.trim(),
      summary: output.summary.trim(),
    },
    bodyShot,
  }
}
