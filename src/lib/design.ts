// Design-refinement stage. Before the agent touches the DOM, we turn the user's
// (often vague) request + the real page context into a concrete, structured
// DesignBrief: a small design system (palette/scales) plus specific changes that
// reference selectors that actually exist. This is what makes the output
// specific, UI-focused and internally consistent instead of generic guesswork.

import { generateText, Output, type LanguageModel } from 'ai'
import { z } from 'zod'
import type {
  BBox,
  LayoutInfo,
  PageSnapshot,
  RegionInfo,
  RepeaterInfo,
  ShellRegion,
} from './messaging'

export const designBriefSchema = z.object({
  goal: z
    .string()
    .describe('The user request restated as a specific, concrete UI objective.'),
  palette: z
    .array(
      z.object({
        token: z.string().describe('Role, e.g. background, surface, text, accent, border.'),
        value: z.string().describe('CSS color, e.g. #0f0f12 or oklch(...).'),
      }),
    )
    .describe('A small, cohesive palette (4–6 tokens) used consistently.'),
  typography: z.string().optional().describe('Font family / size scale decision, if relevant.'),
  spacing: z.string().optional().describe('Spacing/density decision, if relevant.'),
  radius: z.string().optional().describe('Corner radius decision, if relevant.'),
  changes: z
    .array(
      z.object({
        selector: z.string().describe('Exact selector taken from the page context.'),
        change: z.string().describe('Concrete visual change (what + values).'),
        rationale: z.string().describe('Why this serves the goal and the design system.'),
      }),
    )
    .describe('Specific changes. Use ONLY selectors present in the page context.'),
})

export type DesignBrief = z.infer<typeof designBriefSchema>

const DESIGN_SYSTEM_PROMPT = `You are a senior product designer. Given a user request and the real structure of a web page, you produce a precise, opinionated design brief — never vague.

Principles:
- Commit to ONE cohesive design system: a small palette (4–6 tokens with concrete CSS values), and decisions on typography/spacing/radius when relevant. Reuse those tokens across every change so the result is consistent.
- Be specific: concrete colors, sizes and values — not "make it nicer".
- Respect any existing brand cues visible in the page; improve, don't randomize.
- Avoid AI-slop: no gratuitous gradients, no drop-shadows everywhere, no rainbow palettes. Favor restraint, clear hierarchy, generous spacing, 1px borders.
- Ground every change on a selector that appears in the provided page context. Never invent selectors.
- Keep the change set minimal and targeted — only what the goal needs.

How to read the page context:
- The "Page shell" lists framing regions (header, nav, sidebars, footer, sticky/fixed). Don't override their layout (display, width, flex direction, position) unless the user explicitly asks to rework the chrome — you risk breaking the rest of the page.
- "Repeating containers" are the heart of feeds/grids/lists. The "sample" is the prototype of one item — design the card from it. The container's existing layout (grid Ncols, flex-row, gap) is the right target to modify when the user asks for a different layout (e.g. a 2-column mobile grid).
- Prefer targeting the child tag (e.g. \`<li>\`, \`<article>\`, \`<my-card>\`) of a repeater rather than nth-of-type chains: the rule applies to every item automatically.
- Use the bounding boxes to sanity-check size: if a container is 320px wide, don't ask for 4 columns.`

// Render the snapshot as plain text for the model. Sections are ordered by
// usefulness for a design task: viewport → shell (what NOT to touch) → regions
// (the page skeleton) → repeaters (lists/grids, the heaviest signal) →
// notable semantic elements → outline.
export function formatContext(ctx: PageSnapshot): string {
  const parts: string[] = []
  parts.push(`URL: ${ctx.url}`)
  parts.push(`Title: ${ctx.title}`)
  parts.push(`Viewport: ${ctx.viewport.width}x${ctx.viewport.height}`)

  if (ctx.shell.length) {
    parts.push('\nPage shell (frames the site — change cautiously):')
    parts.push(ctx.shell.map(formatShell).join('\n'))
  }

  if (ctx.regions.length) {
    parts.push('\nContent regions:')
    parts.push(ctx.regions.map(formatRegion).join('\n'))
  }

  if (ctx.repeaters.length) {
    parts.push('\nRepeating containers (lists / grids / feeds — the main targets):')
    parts.push(ctx.repeaters.map(formatRepeater).join('\n\n'))
  }

  if (ctx.elements.length) {
    parts.push('\nNotable elements (use these EXACT selectors):')
    parts.push(
      ctx.elements
        .map(
          (e) =>
            `- ${e.selector}  [${e.tag}${e.role ? '/' + e.role : ''}]` +
            (e.text ? `  "${e.text}"` : ''),
        )
        .join('\n'),
    )
  }

  parts.push(`\nOutline:\n${ctx.outline}`)
  return parts.join('\n')
}

function formatShell(s: ShellRegion): string {
  return `- ${s.selector}  [${s.tag} · ${s.role}]  ${formatLayout(s.layout)}  ${formatBBox(s.bbox)}`
}

function formatRegion(r: RegionInfo): string {
  return `- ${r.selector}  [${r.tag}]  ${formatLayout(r.layout)}  ${formatBBox(r.bbox)}`
}

function formatRepeater(r: RepeaterInfo): string {
  const header =
    `- ${r.selector}  [${r.containerTag}]  ${formatLayout(r.layout)}  ${formatBBox(r.bbox)}\n` +
    `    items: ${r.childCount} × <${r.childTag}>`
  return `${header}\n    sample: ${oneLine(r.childSample)}`
}

function formatLayout(l: LayoutInfo): string {
  const parts = [l.display]
  if (l.columns) parts.push(`${l.columns}cols`)
  if (l.direction) parts.push(l.direction)
  if (l.gapPx !== undefined) parts.push(`gap=${l.gapPx}px`)
  return parts.join(' ')
}

function formatBBox(b: BBox): string {
  return `(${b.width}x${b.height} @ ${b.x},${b.y})`
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

export async function generateDesignBrief(
  model: LanguageModel,
  request: string,
  ctx: PageSnapshot,
): Promise<DesignBrief> {
  const { output } = await generateText({
    model,
    system: DESIGN_SYSTEM_PROMPT,
    output: Output.object({ schema: designBriefSchema }),
    prompt: `User request:\n${request}\n\nPage context:\n${formatContext(ctx)}`,
  })
  return output
}
