// One-shot Tailwind edit: a single LLM call takes a full-page screenshot plus
// the picked element's outerHTML and returns the new class string.

import { generateText, Output, type LanguageModel } from 'ai'
import { z } from 'zod'
import type { PickedElement } from './messaging'
import { captureFullPage, type Screenshot } from './screenshot'

const SYSTEM = `You edit a live Tailwind-styled page. Inputs: full-page screenshot, target outerHTML, user request.

Return "classes" (full replacement for the target's class attribute, Tailwind only) and "summary" (one short sentence in the user's language).

Rules: Tailwind only, no inline styles. Match the screenshot's palette/scale. Minimal diff — preserve layout/data-*/state classes unrelated to the request. Keep accessible contrast.`

const outputSchema = z.object({
  classes: z.string().describe("Full replacement class attribute (Tailwind, space-separated)."),
  summary: z.string().describe("One short sentence in the user's language."),
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
  const bodyShot = await captureFullPage().catch(() => null)
  const oldClasses = extractClassAttr(pinned.outerHTML)

  const userParts: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; image: string; mediaType: 'image/png' | 'image/jpeg' }
  > = []

  if (bodyShot) {
    userParts.push({
      type: 'image',
      image: `data:${bodyShot.mediaType};base64,${bodyShot.data}`,
      mediaType: bodyShot.mediaType,
    })
  }

  userParts.push({
    type: 'text',
    text:
      `Request: ${request}\n` +
      `Target: ${pinned.selector} <${pinned.tag}>\n` +
      `Current classes: ${oldClasses || '(empty)'}\n` +
      `outerHTML:\n${pinned.outerHTML}`,
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
