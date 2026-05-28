// Generates a self-contained HTML+CSS fragment for the custom-look component
// replacement path (the `design_component` tool). Runs through the same Vercel
// AI Gateway model the agent already uses — no extra key, no extra provider.
// Anthropic Claude is strong enough at UI markup for this and keeps the stack
// single-provider. Output is always plain HTML so it slots into the existing
// `mountHtml` flow (sanitized + Shadow DOM, no scripts).

import { generateText, type LanguageModel } from 'ai'
import type { TableData } from './correlation'

const SYSTEM = `You are an expert UI engineer specialized in semantic, accessible, well-crafted HTML and CSS. Given a style brief and the page's real data, output ONE self-contained HTML fragment that renders ALL of the data with a refined, intentional design.

Hard rules:
- Output ONLY raw HTML — no markdown, no code fences, no prose, no commentary.
- Put all CSS in a single <style> block. Use simple class names. No external stylesheets, fonts, images or URLs. Tailwind class names are forbidden (there is no compiler at mount time) — write real CSS.
- NO <script>, no inline event handlers (onclick, onload, …), no "javascript:" URLs. Static markup only.
- Render EVERY row provided. Do not truncate or sample.
- Follow the style brief precisely. Anti-AI-slop: no gratuitous gradients, no drop-shadows everywhere, no rainbow palettes. Favor restraint, clear hierarchy, generous spacing, 1px borders, well-chosen type scale.
- Use semantic HTML (<article>, <section>, <h2>, <table>, …) and accessible color contrast.
- Mobile-first responsive: use clamp()/media queries; don't assume desktop width.`

export async function generateComponentHtml(
  model: LanguageModel,
  prompt: string,
  data: TableData,
): Promise<string> {
  const rows = data.rows.slice(0, 100)

  const { text } = await generateText({
    model,
    system: SYSTEM,
    prompt:
      `Style brief: ${prompt}\n\n` +
      `Columns: ${JSON.stringify(data.columns)}\n` +
      `Data (${rows.length} rows):\n${JSON.stringify(rows)}`,
  })

  return stripFences(text)
}

// Strip accidental ```html fences if the model adds them despite instructions.
function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```[a-zA-Z]*\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim()
}
