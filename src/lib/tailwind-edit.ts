// One-shot edit pipeline. ONE LLM call that takes a body screenshot, the
// edit scope (a picked element's outerHTML OR the full body HTML when nothing
// was picked) and the user's request, and returns a list of Tweak operations
// to apply. The user's prompt rules: the model decides whether to replace,
// insert, modify a sub-part, delete or restyle — it is not forced to swap the
// whole target.

import { generateText, Output, type LanguageModel } from 'ai'
import { z } from 'zod'
import type { PickedElement } from './messaging'
import type { Tweak } from './tweaks'
import {
  captureActiveTab,
  downscaleForLLM,
  estimateBase64Bytes,
  type Screenshot,
} from './screenshot'

const SYSTEM = `Edit a live web page to satisfy ONE user request.

Inputs you receive:
- A screenshot of the page (source of truth for the design system).
- Either ONE picked target (its CSS selector + outerHTML) OR, when the user did not pick anything, the full <body> HTML. The picked target — when present — is a HINT about scope, NOT an order to replace it.
- The user's request.

The user's request rules. Read it literally:
- "change X to Y", "make it red", "rewrite this section" → modify the relevant element(s).
- "add ...", "agregar ...", "insert ..." → INSERT new markup, do not replace what exists.
- "remove ...", "hide ..." → delete or hide the matching element(s).
- "make the button inside this card bigger" → operate on the BUTTON inside the target, not the whole card.
- When nothing is picked, the request may target any descendant of <body>; pick the smallest element(s) that satisfy the request.
Never silently restyle, rewrite or "improve" things the user did not mention.

Design-system rules for any new or modified markup:
- Treat the screenshot as the source of truth. Reuse the page's existing background colors, borders, text colors, corner radius, shadows, spacing and typography. Match the page's theme (dark page → use the page's dark surfaces, never off-theme gray boxes).
- Reuse the EXACT Tailwind classes already present on the elements you touch; only add/remove/change a class when strictly required by the request.
- Contrast is mandatory: every text element you produce must have an EXPLICIT Tailwind text-color class that clearly contrasts with its background. Never rely on inherited colors.
- Accessibility (WCAG 2.2 AA): meet AA contrast; use semantic HTML and correct ARIA roles/labels; keep interactive elements keyboard-focusable with a visible focus ring; give images/icons alt or aria-label; touch targets ≥ 44×44px.

Output: a list of "tweaks" to apply, plus a one-sentence "summary" in the user's language.

Tweak operations available (pick the one that fits the user's intent):
- replaceOuterHTML { selector, html }      — swap an element's full outerHTML. Use ONLY when the user wants to rewrite that element.
- insertHTML      { selector, position, html } — add new markup near an existing element. position: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend'. Use this for "add", "agregar", "insertar".
- setAttr         { selector, name, value } — set a single attribute (e.g. class, href, src, aria-label).
- setText         { selector, text }        — replace text content only.
- setStyle        { selector, styles }      — set inline CSS properties (object of camelCased or kebab-cased CSS keys → string values).
- remove          { selector }              — delete the element.
- addClass        { selector, className }   — append one class.
- removeClass     { selector, className }   — remove one class.

Selector rules:
- Prefer the exact selector you were given when the user's request is scoped to that element.
- When the user's request is scoped to a CHILD of the target (or to something else entirely), produce a selector that resolves uniquely from the document root. Combine the given selector with a descendant selector when useful (e.g. "<given> button.primary").
- Every selector must resolve to at least one element on the live page.

Prefer the minimum number of tweaks. Multiple tweaks are fine when the request naturally calls for several edits (e.g. "add a banner and hide the footer" → one insertHTML + one remove).

JSON SHAPE (return EXACTLY this — every tweak is one object with an "op" string and the fields listed for that op):
{
  "tweaks": [
    { "op": "replaceOuterHTML", "selector": "...", "html": "..." },
    { "op": "insertHTML",       "selector": "...", "position": "beforebegin|afterbegin|beforeend|afterend", "html": "..." },
    { "op": "setAttr",          "selector": "...", "name": "...", "value": "..." },
    { "op": "setText",          "selector": "...", "text": "..." },
    { "op": "setStyle",         "selector": "...", "styles": { "color": "...", "background-color": "..." } },
    { "op": "remove",           "selector": "..." },
    { "op": "addClass",         "selector": "...", "className": "..." },
    { "op": "removeClass",      "selector": "...", "className": "..." }
  ],
  "summary": "one short sentence in the user's language"
}
Every tweak object MUST have an "op" string and a "selector" string. Do not nest tweaks. Do not invent new ops.`

// Permissive schema: many models choke on discriminated unions when the
// payload is large. We accept any object that *has* an op + selector and
// validate/normalize tweaks in code below. Unknown fields are kept and the
// runtime `applyTweaks` ignores them.
const rawTweakSchema = z
  .object({
    op: z.string(),
    selector: z.string(),
    html: z.string().optional(),
    position: z.string().optional(),
    name: z.string().optional(),
    value: z.string().optional(),
    text: z.string().optional(),
    className: z.string().optional(),
    styles: z.record(z.string(), z.string()).optional(),
  })
  .loose()

const outputSchema = z.object({
  tweaks: z
    .array(rawTweakSchema)
    .min(1)
    .describe('Ordered list of DOM operations to apply on the live page.'),
  summary: z
    .string()
    .describe('One short sentence in the user’s language describing what changed.'),
})

const VALID_POSITIONS = new Set<InsertPosition>([
  'beforebegin',
  'afterbegin',
  'beforeend',
  'afterend',
])

// Map a loose object from the LLM into a strict Tweak. Returns null when the
// op is unknown or required fields are missing — caller drops it.
function normalizeTweak(raw: z.infer<typeof rawTweakSchema>): Tweak | null {
  if (!raw.selector) return null
  switch (raw.op) {
    case 'replaceOuterHTML':
      return raw.html != null
        ? { op: 'replaceOuterHTML', selector: raw.selector, html: raw.html }
        : null
    case 'insertHTML': {
      const pos = (raw.position ?? 'beforeend') as InsertPosition
      if (!VALID_POSITIONS.has(pos) || raw.html == null) return null
      return { op: 'insertHTML', selector: raw.selector, position: pos, html: raw.html }
    }
    case 'setAttr':
      return raw.name && raw.value != null
        ? { op: 'setAttr', selector: raw.selector, name: raw.name, value: raw.value }
        : null
    case 'setText':
      return raw.text != null
        ? { op: 'setText', selector: raw.selector, text: raw.text }
        : null
    case 'setStyle':
      return raw.styles
        ? { op: 'setStyle', selector: raw.selector, styles: raw.styles }
        : null
    case 'remove':
      return { op: 'remove', selector: raw.selector }
    case 'addClass':
      return raw.className
        ? { op: 'addClass', selector: raw.selector, className: raw.className }
        : null
    case 'removeClass':
      return raw.className
        ? { op: 'removeClass', selector: raw.selector, className: raw.className }
        : null
    default:
      return null
  }
}

export interface EditScope {
  // When the user picked an element, this is its selector + outerHTML.
  // When the user did not pick anything, `pinned` is null and `bodyHTML`
  // carries the full <body> as the editable scope.
  pinned: PickedElement | null
  bodyHTML: string | null
  url: string | null
  title: string | null
}

export interface ElementEditResult {
  tweaks: Tweak[]
  summary: string
}

export interface ElementEditOutcome {
  result: ElementEditResult
  bodyShot: Screenshot | null
}

// Kept for backwards compat with existing tests.
export function extractClassAttr(outerHTML: string): string {
  const m = outerHTML.match(/^<[^>]*?\sclass=["']([^"']*)["']/i)
  return m ? m[1] : ''
}

export async function runElementEdit(
  model: LanguageModel,
  scope: EditScope,
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

  userParts.push({ type: 'text', text: buildScopeText(scope, request) })

  console.info('[picanthon] sending to LLM', {
    request,
    mode: scope.pinned ? 'pinned' : 'full-body',
    selector: scope.pinned?.selector ?? null,
    tag: scope.pinned?.tag ?? null,
    htmlChars:
      scope.pinned?.outerHTML.length ?? scope.bodyHTML?.length ?? 0,
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

  const normalized: Tweak[] = []
  const dropped: Array<{ op: string; reason: 'missing-field' | 'unknown-op' }> = []
  for (const raw of output.tweaks) {
    const tw = normalizeTweak(raw)
    if (tw) {
      normalized.push(tw)
    } else {
      dropped.push({
        op: raw.op,
        reason:
          [
            'replaceOuterHTML',
            'insertHTML',
            'setAttr',
            'setText',
            'setStyle',
            'remove',
            'addClass',
            'removeClass',
          ].includes(raw.op)
            ? 'missing-field'
            : 'unknown-op',
      })
    }
  }
  if (dropped.length) {
    console.warn('[picanthon] dropped malformed tweaks', dropped)
  }
  if (!normalized.length) {
    throw new Error(
      'El modelo no devolvió ningún tweak válido. Intenta reformular el pedido.',
    )
  }

  return {
    result: {
      tweaks: normalized,
      summary: output.summary.trim(),
    },
    bodyShot,
  }
}

function buildScopeText(scope: EditScope, request: string): string {
  if (scope.pinned) {
    return (
      `User request: ${request}\n\n` +
      `Picked target selector: ${scope.pinned.selector}\n` +
      `Picked target tag: <${scope.pinned.tag}>\n\n` +
      `Picked target outerHTML (this is a scope HINT — operate on it, on a child of it, or insert near it, depending on the request):\n${scope.pinned.outerHTML}`
    )
  }
  const title = scope.title ? `Page title: ${scope.title}\n` : ''
  const url = scope.url ? `Page URL: ${scope.url}\n` : ''
  return (
    `User request: ${request}\n\n` +
    `No element was picked — the editable scope is the full <body> below. Pick the smallest selector(s) that satisfy the request.\n\n` +
    title +
    url +
    `\nFull <body> outerHTML:\n${scope.bodyHTML ?? ''}`
  )
}
