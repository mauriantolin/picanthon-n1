// One-shot element edit: ONE LLM call that takes a body screenshot + the
// picked element's outerHTML and returns the new outerHTML for that element.
// The replacement can be a class-only tweak or a full restructure (e.g. a
// <table> rewritten as a grid of cards) — same contract either way.

import { generateText, Output, type LanguageModel } from 'ai'
import { z } from 'zod'
import type { PickedElement } from './messaging'
import { captureActiveTab, downscaleForLLM, estimateBase64Bytes, type Screenshot } from './screenshot'

const SYSTEM = `Rewrite one element on a live web page.

Inputs: a body screenshot, the target's current outerHTML, the user's request.

Treat the screenshot as the source of truth for the page's design system. The rewritten element must look native to the page: reuse the same background colors, borders, text colors, corner radius, shadows, spacing and typography you can see around it. Match the page's theme (e.g. if the page is dark, use the page's dark surfaces — never plain off-theme gray boxes). Only change what the user asked; keep everything else visually consistent.

Output: "html" (the full replacement outerHTML for the target — root tag plus children, Tailwind-only styling) and "summary" (one short sentence in the user's language).`

const outputSchema = z.object({
  html: z
    .string()
    .describe(
      "The full replacement outerHTML for the target element — must be a single root element, Tailwind classes only.",
    ),
  summary: z
    .string()
    .describe('One short sentence telling the user what changed, in their language.'),
})

export interface ElementEditResult {
  selector: string
  oldOuterHTML: string
  newOuterHTML: string
  summary: string
}

export interface ElementEditOutcome {
  result: ElementEditResult
  bodyShot: Screenshot | null
}

export function extractClassAttr(outerHTML: string): string {
  const m = outerHTML.match(/^<[^>]*?\sclass=["']([^"']*)["']/i)
  return m ? m[1] : ''
}

export async function runElementEdit(
  model: LanguageModel,
  pinned: PickedElement,
  request: string,
  abortSignal?: AbortSignal,
): Promise<ElementEditOutcome> {
  const rawShot = await captureActiveTab().catch(() => null)
  const bodyShot = rawShot ? await downscaleForLLM(rawShot) : null

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
      `User request: ${request}\n\n` +
      `Target selector: ${pinned.selector}\n` +
      `Target tag: <${pinned.tag}>\n\n` +
      `Target outerHTML:\n${pinned.outerHTML}`,
  })

  console.info('[picanthon] sending to LLM', {
    request,
    selector: pinned.selector,
    tag: pinned.tag,
    outerHTMLChars: pinned.outerHTML.length,
    screenshot: bodyShot
      ? { mediaType: bodyShot.mediaType, bytes: estimateBase64Bytes(bodyShot.data) }
      : null,
    parts: userParts.map((p) =>
      p.type === 'image'
        ? { type: 'image', mediaType: p.mediaType, bytes: estimateBase64Bytes(p.image) }
        : { type: 'text', chars: p.text.length },
    ),
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
      oldOuterHTML: pinned.outerHTML,
      newOuterHTML: output.html.trim(),
      summary: output.summary.trim(),
    },
    bodyShot,
  }
}
