// The Picanthon agent: a ToolLoopAgent that modifies the live page. It handles
// two kinds of request:
//   • styling/visual  -> plan_design (concrete brief) then apply_tweaks
//   • component swap   -> search_shadcn_docs then replace_component (reuses data)
// It runs in the side panel and is consumed by useChat via the transport.
//
// Two models are supplied:
//   • `model`         — the agent loop (cheap; the loop's reasoning + the small
//                       tools live here).
//   • `designerModel` — used by plan_design + design_component (strong, vision-
//                       capable). When the user did not set one, the caller
//                       passes the main model in both slots.

import { ToolLoopAgent, stepCountIs, type InferAgentUIMessage, type LanguageModel } from 'ai'
import { buildTools } from './agent-tools'
import { formatContext } from './design'
import type { DrawnPayload, PageSnapshot, PickedElement } from './messaging'
export type { DrawnPayload } from './messaging'

const MAX_STYLES_JSON = 60_000

export function renderInstructions(
  context: PageSnapshot,
  pinned: PickedElement | null,
  drawing: DrawnPayload | null = null,
): string {
  const focus = pinned ? renderFocusedBlock(pinned) : ''
  const scribble = drawing ? renderScribbleBlock(drawing) : ''
  const focusRule = pinned
    ? `\n- The focused element above is authoritative: every tweak op in this turn MUST use its exact selector verbatim, unless the user explicitly names a different element. Do not infer, generalize, climb to a parent, or substitute a selector you think is "better".`
    : ''
  const scribbleRule = drawing
    ? `\n- The scribble block above carries the user's drawn intent. Two images accompany this turn: the strokes alone and the composite over the page screenshot. Treat the gesture as the primary signal — an arrow between A and B means move/copy, a scratch over X means remove, a rectangle in empty space means insert. The covered_elements list ranks selectors the strokes touched; prefer them as targets. If the user's text contradicts the gesture, the text wins.`
    : ''
  return `${focus}${scribble}You are Picanthon, an agent that modifies the user's current web page live, without touching its source.

Decide the request type and follow the matching workflow:

1) VISUAL / STYLING ("make it look like X", "dark mode", "improve hierarchy"):
   - Call plan_design first to commit to a concrete, consistent design (palette, scales, specific changes).
   - Then call apply_tweaks with tweaks that realize the brief. Reuse the brief's palette/values consistently.

2) COMPONENT REPLACEMENT, standard shadcn look ("turn this table into a shadcn table"):
   - Call search_shadcn_docs to find a matching component id.
   - Optionally call query_network_capture to see what data backs the element.
   - Call replace_component with the target selector and the component id. It reuses the page's real data.

3) COMPONENT REPLACEMENT, custom look ("make this table look like X", any non-shadcn / specific visual style):
   - Call design_component with the target selector and a free-form style brief.
   - A self-contained HTML+CSS fragment is generated through the same Gateway model and mounted (sanitized, in a Shadow DOM) with the page's real data. Use this when the user wants a particular aesthetic rather than the default shadcn style.

Visual feedback (REQUIRED after every apply_tweaks):
- The FIRST apply_tweaks result of the turn includes TWO screenshots — a BEFORE
  shot (taken before the first tweak ran, your baseline) and an AFTER shot.
  Subsequent calls in the same turn return only the AFTER shot — keep the
  original BEFORE in mind as your reference.
- Each result also carries a focused snapshot of every selector you touched
  (new bbox, layout, child count, sample of one child) and the per-tweak match
  counts.

Before reporting the change as done, you MUST verify every one of the
following against the BEFORE/AFTER screenshots. If any check fails, call
apply_tweaks AGAIN with corrective tweaks.

  1. Scope. Only the elements your brief asked about should differ between
     BEFORE and AFTER. If any other region of the page also changed visually,
     your selector is too broad and matched things you did not intend — narrow
     it (more specific ancestors, an id, a nearby unique landmark) and re-apply.
     The applied/matched count in the result is a hint: if it is higher than the
     number of distinct targets in your brief, you almost certainly over-matched.

  2. Legibility (deterministic check). Every affected selector in 'observed'
     now carries a 'contrastIssues' array. The platform computes WCAG contrast
     ratios for every visible text node inside that element and lists any pair
     that falls below WCAG AA (4.5:1 body text, 3:1 large text). If ANY
     observed entry has a non-empty 'contrastIssues', the text is unreadable.
     This is not a judgment call — the ratio is a number. You MUST call
     apply_tweaks again with a corrective tweak (change the text color, or
     darken/lighten the background) until every observed.contrastIssues is
     empty. Do not declare success while contrastIssues is present anywhere.

  3. Preservation of pre-existing UI. Anything that was visible in the BEFORE
     and is NOT something your brief asked to remove must remain visible and
     uncovered in the AFTER: corner ribbons, "best seller" / "most picked"
     tags, status pills, hover affordances, icons, decorative badges. Do not
     paint over or hide them.

  4. Layout integrity. No clipped content, no horizontal overflow, no element
     poking out of its container, no overlapping that was not present BEFORE.
     If a new container has a 16:9 aspect set but its child is taller, expect
     clipping.

  5. Goal alignment. The AFTER actually matches the brief's intent: right
     layout direction (row/column), right number of columns, right palette,
     right hierarchy. Counts, not vibes — count columns, count visible items.

Iteration cap: at most TWO follow-up corrective apply_tweaks calls (three total
per turn). When all five checks pass, stop calling tools and tell the user
what changed.

Rules:${focusRule}${scribbleRule}
- Use ONLY selectors that appear in the PAGE CONTEXT below${pinned ? ', in the focused element block above' : ''}${drawing ? ', or in the scribble block above' : ''}. Never invent selectors.
- Keep changes minimal and targeted.
- After acting, briefly tell the user what changed (in their language). Report counts / data source when relevant.

PAGE CONTEXT:
${formatContext(context)}`
}

function renderFocusedBlock(pin: PickedElement): string {
  let stylesJson = JSON.stringify(pin.computedStyles, null, 2)
  if (stylesJson.length > MAX_STYLES_JSON) {
    stylesJson = stylesJson.slice(0, MAX_STYLES_JSON) + '\n… [truncated]'
  }
  const { x, y, width, height } = pin.boundingBox
  return `<focused_element>
CRITICAL: The user has explicitly picked this element with the page picker.
You MUST use the exact selector below for every tweak op in this turn, unless
the user explicitly names a different element. Do not infer a parent, sibling,
or "more semantic" selector — the picked selector is authoritative even if it
looks long, brittle, or non-obvious.

Treat any deictic reference ("this", "esto", "este", "este botón", "acá",
"aquí", "ahí") as referring to this element.

selector: ${pin.selector}
tag: ${pin.tag}
boundingBox: ${Math.round(width)}x${Math.round(height)} at (${Math.round(x)},${Math.round(y)})
text: ${pin.text ?? ''}

outerHTML:
${pin.outerHTML}

computedStyles:
${stylesJson}
</focused_element>

`
}

function renderScribbleBlock(drawing: DrawnPayload): string {
  const covered = drawing.coveredElements
    .map(
      (e, i) =>
        `  ${i + 1}. ${e.selector}  (${e.tag}, coverage=${(e.coverage * 100).toFixed(0)}%)`,
    )
    .join('\n')
  const { x, y, width, height } = drawing.bbox
  return `<scribble>
CRITICAL: The user has drawn freehand strokes on the page. Two images are
attached to this user turn:
  • the strokes alone over a transparent background.
  • the composite of those strokes painted over a screenshot of the page.

Treat the gesture as the primary intent signal. Map gestures to ops:
  • arrow A → B          : move or copy A toward B (B may be empty space).
  • scratch / scribble   : remove the covered element.
  • rectangle in empty   : insert a new element in that area.
  • circle around X      : focus / emphasize X (border, highlight, scale).

strokes_bbox: ${Math.round(width)}x${Math.round(height)} at (${Math.round(x)},${Math.round(y)})
viewport: ${drawing.viewport.width}x${drawing.viewport.height}

covered_elements (selectors the strokes intersected, ordered by coverage):
${covered || '  (none)'}
</scribble>

`
}

export function buildAgent(
  model: LanguageModel,
  designerModel: LanguageModel,
  context: PageSnapshot,
  pinned: PickedElement | null = null,
  drawing: DrawnPayload | null = null,
) {
  return new ToolLoopAgent({
    model,
    instructions: renderInstructions(context, pinned, drawing),
    tools: buildTools(designerModel, context),
    // Up to 3 apply_tweaks iterations + the surrounding plan / verify / report
    // steps need a higher cap than the original 12.
    stopWhen: stepCountIs(18),
    providerOptions: {
      // `display: 'summarized'` is required for the model to stream reasoning
      // text — without it, thinking blocks come back empty.
      anthropic: { thinking: { type: 'adaptive', display: 'summarized' } },
    },
  })
}

// Stable UIMessage type for useChat. Tool names/shapes are fixed, so the type is
// stable regardless of the per-message model/context.
export type PicanthonAgent = ReturnType<typeof buildAgent>
export type PicanthonUIMessage = InferAgentUIMessage<PicanthonAgent>
