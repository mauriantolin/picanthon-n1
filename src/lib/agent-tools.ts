// Agent tools. Built per-run as a closure over the model + page context. They
// run in the side panel and reach the page DOM by messaging the active tab's
// content script. The model never runs arbitrary code — it can only request the
// structured ops defined here (tweaks) or mount an allowlisted component.
//
// Two-model split:
//   • `model`         — the agent loop. Cheap. Used by `apply_tweaks` and the
//                       small tools (search_shadcn_docs, query_network_capture,
//                       replace_component).
//   • `designerModel` — the strong, vision-capable model. Used only by
//                       `plan_design` and `design_component`, the two stages
//                       where output quality matters most. Falls back to
//                       `model` if no designer was set.

import { tool, type LanguageModel } from 'ai'
import { z } from 'zod'
import {
  sendToActiveTab,
  type AffectedElement,
  type NetworkCapture,
  type PageSnapshot,
  type ReplaceResult,
} from './messaging'
import { generateDesignBrief } from './design'
import { searchComponents } from './component-registry'
import { generateComponentHtml } from './ui-generator'
import { captureActiveTab, type Screenshot } from './screenshot'
import type { TableData } from './correlation'
import type { Tweak, TweakResult } from './tweaks'

const tweakSchema = z.object({
  op: z.enum([
    'setStyle',
    'setText',
    'setAttr',
    'addClass',
    'removeClass',
    'remove',
    'insertHTML',
    'highlight',
  ]),
  selector: z.string().describe('CSS selector targeting the element(s) to change.'),
  styles: z.record(z.string(), z.string()).optional(),
  text: z.string().optional(),
  name: z.string().optional(),
  value: z.string().optional(),
  className: z.string().optional(),
  position: z.enum(['beforebegin', 'afterbegin', 'beforeend', 'afterend']).optional(),
  html: z.string().optional(),
  color: z.string().optional(),
})

export function buildTools(
  designerModel: LanguageModel,
  context: PageSnapshot,
) {
  // Closure state for this turn. `buildTools` is called once per user message,
  // so this flag flips false after the first apply_tweaks of the turn and stays
  // false for any follow-up corrective calls within the same turn.
  let captureBeforeNext = true

  return {
    plan_design: tool({
      description:
        'For visual/styling requests: turn the request + page into a concrete, ' +
        'consistent design brief (palette, scales, specific changes with selectors). ' +
        'Call this BEFORE apply_tweaks for any "make it look like X" request.',
      inputSchema: z.object({
        request: z.string().describe('The user request to refine into a design brief.'),
      }),
      execute: async ({ request }) => generateDesignBrief(designerModel, request, context),
    }),

    apply_tweaks: tool({
      description:
        'Apply DOM modifications ("tweaks") to the page. Use selectors from the ' +
        'page context. Returns how many elements each tweak matched, two ' +
        'screenshots (BEFORE the very first call of this turn + AFTER every ' +
        'call), and a focused snapshot of every affected selector. Inspect them ' +
        'to decide whether to call apply_tweaks again with corrections.',
      inputSchema: z.object({ tweaks: z.array(tweakSchema) }),
      execute: async ({ tweaks }) => {
        // Capture BEFORE only on the first apply_tweaks of the turn, since the
        // model will then own that baseline and any later AFTER shot can be
        // diffed against it (or against the previous AFTER, kept in context).
        let before: Screenshot | null = null
        if (captureBeforeNext) {
          before = await captureActiveTab().catch((err) => {
            console.warn('[picanthon] BEFORE screenshot failed:', err)
            return null
          })
          captureBeforeNext = false
        }

        const results = await sendToActiveTab<TweakResult[]>({
          type: 'APPLY_TWEAKS',
          tweaks: tweaks as Tweak[],
        })
        const applied = results.reduce((n, r) => n + r.matched, 0)

        // Re-inspect the elements we just touched + screenshot the visible area.
        // Both are surfaced to the model via toModelOutput below.
        const selectors = Array.from(new Set((tweaks as Tweak[]).map((t) => t.selector)))
        const [observed, after] = await Promise.all([
          sendToActiveTab<AffectedElement[]>({
            type: 'CAPTURE_AFFECTED',
            selectors,
          }).catch(() => [] as AffectedElement[]),
          captureActiveTab().catch((err) => {
            console.warn('[picanthon] AFTER screenshot failed:', err)
            return null
          }),
        ])

        console.debug('[picanthon] apply_tweaks:', {
          tweakCount: (tweaks as Tweak[]).length,
          applied,
          selectorsTouched: selectors.length,
          observedCount: observed.length,
          beforeBytes: before ? Math.floor((before.data.length * 3) / 4) : 0,
          afterBytes: after ? Math.floor((after.data.length * 3) / 4) : 0,
        })

        return { applied, results, observed, before, after }
      },
      toModelOutput: ({ output }) => {
        const { applied, results, observed, before, after } = output
        const parts: Array<
          | { type: 'text'; text: string }
          | { type: 'image-data'; data: string; mediaType: string }
        > = [{ type: 'text', text: JSON.stringify({ applied, results, observed }) }]
        if (before) {
          parts.push({ type: 'text', text: '--- BEFORE screenshot (state before this turn started) ---' })
          parts.push({
            type: 'image-data',
            data: before.data,
            mediaType: before.mediaType,
          })
        }
        if (after) {
          parts.push({ type: 'text', text: '--- AFTER screenshot (state after the tweaks just applied) ---' })
          parts.push({
            type: 'image-data',
            data: after.data,
            mediaType: after.mediaType,
          })
        }

        console.debug('[picanthon] apply_tweaks toModelOutput:', {
          partCount: parts.length,
          types: parts.map((p) => p.type),
          imagePartCount: parts.filter((p) => p.type === 'image-data').length,
          totalImageBytes: parts
            .filter((p): p is { type: 'image-data'; data: string; mediaType: string } => p.type === 'image-data')
            .reduce((n, p) => n + Math.floor((p.data.length * 3) / 4), 0),
        })

        return { type: 'content', value: parts }
      },
    }),

    query_network_capture: tool({
      description:
        'List the JSON responses the page already received (from the network ' +
        'recorder). Useful to understand what data backs a table/list before replacing it.',
      inputSchema: z.object({}),
      execute: async () => {
        const caps = await sendToActiveTab<NetworkCapture[]>({ type: 'GET_NETWORK_CAPTURE' })
        return caps.map((c) => ({
          id: c.id,
          url: c.url,
          method: c.method,
          status: c.status,
          kind: Array.isArray(c.json) ? 'array' : typeof c.json,
          length: Array.isArray(c.json) ? c.json.length : undefined,
          keys: sampleKeys(c.json),
        }))
      },
    }),

    search_shadcn_docs: tool({
      description:
        'Search the allowlist of mountable shadcn-style components. Returns ' +
        'component ids you can pass to replace_component.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => searchComponents(query),
    }),

    replace_component: tool({
      description:
        'Replace a native element (e.g. a <table>) with a built-in shadcn-style ' +
        'component that reuses the real data. Use for a standard shadcn look. Pass a ' +
        'selector from the page context and a componentId from search_shadcn_docs.',
      inputSchema: z.object({
        selector: z.string().describe('Selector of the native element to replace.'),
        componentId: z.string().describe('Component id from the registry, e.g. "data-table".'),
      }),
      execute: async ({ selector, componentId }): Promise<ReplaceResult> =>
        sendToActiveTab<ReplaceResult>({ type: 'REPLACE_COMPONENT', selector, componentId }),
    }),

    design_component: tool({
      description:
        'Replace an element (e.g. a <table>) with a CUSTOM UI generated from a ' +
        'free-form style brief, reusing the page\'s real data. Use this when the ' +
        'user wants a specific or non-shadcn look ("like a dashboard card", "neon", ' +
        '"compact", etc.). The HTML is generated through the designer model and ' +
        'mounted sanitized (no scripts) in a Shadow DOM.',
      inputSchema: z.object({
        selector: z.string().describe('Selector of the native element to replace.'),
        prompt: z.string().describe('Free-form visual/style brief for the new component.'),
      }),
      execute: async ({ selector, prompt }): Promise<ReplaceResult> => {
        const data = await sendToActiveTab<TableData | { error: string }>({
          type: 'GET_ELEMENT_DATA',
          selector,
        })
        if ('error' in data) return { ok: false, error: data.error }
        if (data.rows.length === 0) return { ok: false, error: 'No pude extraer datos del elemento.' }

        const html = await generateComponentHtml(designerModel, prompt, data)
        const res = await sendToActiveTab<ReplaceResult>({ type: 'MOUNT_HTML', selector, html })
        return { ...res, source: data.source, rows: data.rows.length, columns: data.columns }
      },
    }),
  }
}

function sampleKeys(json: unknown): string[] | undefined {
  if (Array.isArray(json) && json[0] && typeof json[0] === 'object') {
    return Object.keys(json[0] as object).slice(0, 20)
  }
  if (json && typeof json === 'object') return Object.keys(json as object).slice(0, 20)
  return undefined
}
