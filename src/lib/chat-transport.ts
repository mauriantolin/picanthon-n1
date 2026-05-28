// Builds the ChatTransport that useChat consumes. With a key we run the agent
// in-process (no backend): fetch the page context once, then stream the
// multi-tool agent, which decides whether to style (plan_design + apply_tweaks)
// or replace a component (search_shadcn_docs + replace_component). Without a key
// we fall back to a deterministic mock so the pipeline is testable offline.

import {
  convertToModelMessages,
  createUIMessageStream,
  validateUIMessages,
  type ChatTransport,
  type ModelMessage,
} from 'ai'
import { buildModel } from './model'
import { buildAgent, type PicanthonUIMessage } from './agent'
import {
  sendToActiveTab,
  type DrawnPayload,
  type PageSnapshot,
  type PickedElement,
} from './messaging'
import type { Tweak, TweakResult } from './tweaks'
import type { Settings } from './settings'
import { captureActiveTab, compositeWithStrokes, estimateBase64Bytes } from './screenshot'

export interface ChatContext {
  pinned: PickedElement | null
  drawing: DrawnPayload | null
}

export function createChatTransport(
  settings: Settings,
  context: ChatContext = { pinned: null, drawing: null },
): ChatTransport<PicanthonUIMessage> {
  if (!settings.apiKey) return new MockChatTransport()
  return new PicanthonChatTransport(settings, context)
}

class PicanthonChatTransport implements ChatTransport<PicanthonUIMessage> {
  constructor(
    private readonly settings: Settings,
    private readonly ctx: ChatContext,
  ) {}

  async sendMessages({
    messages,
    abortSignal,
  }: Parameters<ChatTransport<PicanthonUIMessage>['sendMessages']>[0]) {
    const model = buildModel(this.settings.apiKey, this.settings.model)
    // Designer model: separate Gateway model when the user configured one,
    // otherwise share the cheap agent model.
    const designerModel = this.settings.designerModel
      ? buildModel(this.settings.apiKey, this.settings.designerModel)
      : model
    const context = await sendToActiveTab<PageSnapshot>({ type: 'GET_SNAPSHOT' })
    const agent = buildAgent(model, designerModel, context, this.ctx.pinned, this.ctx.drawing)

    const validated = await validateUIMessages<PicanthonUIMessage>({
      messages,
      tools: agent.tools,
    })
    const prompt = await convertToModelMessages(validated, { tools: agent.tools })
    const finalPrompt = await injectScribbleImages(prompt, this.ctx.drawing)

    const result = await agent.stream({ prompt: finalPrompt, abortSignal })
    return result.toUIMessageStream({ sendReasoning: true })
  }

  async reconnectToStream() {
    return null
  }
}

interface CompositeInfo {
  data: string
  mediaType: 'image/png' | 'image/jpeg'
  width: number
  height: number
}

// Append the strokes-alone PNG and a composite-over-screenshot PNG to the last
// user message as image parts. Use the `data:image/png;base64,…` URL form for
// `image`: AI SDK v6 + the Anthropic Gateway adapter accept both base64-raw +
// mediaType AND the data-URL form, but the data-URL form is the only one the
// adapter never silently drops — observed root cause of "no llegó ninguna
// imagen" with opus and sonnet alike. We still set `mediaType` as a belt-and-
// suspenders for any adapter that prefers explicit metadata over parsing the
// data URL prefix. When `drawing.compositePng` is already present we reuse it
// — guarantees the bytes in the preview === the bytes in the prompt and avoids
// running compositeWithStrokes twice.
export async function injectScribbleImages(
  prompt: ModelMessage[],
  drawing: DrawnPayload | null,
): Promise<ModelMessage[]> {
  if (!drawing) return prompt
  const lastUserIdx = findLastUserIndex(prompt)
  if (lastUserIdx === -1) {
    console.warn('[picanthon/scribble] no user message to attach images to')
    return prompt
  }

  const precomputed = drawing.compositePng
  let composite: CompositeInfo | null = null
  let screenshotNull = drawing.screenshotAvailable === false
  let screenshotReason: string | undefined
  // `undefined` (not 0) on the precomputed path: the raw screenshot wasn't
  // preserved through the cache, and lying with compositeBytes here would
  // defeat the diagnostic — `precomputed: true` in the log signals the gap.
  let screenshotBytes: number | undefined

  if (precomputed) {
    composite = {
      data: precomputed.data,
      mediaType: precomputed.mediaType,
      width: precomputed.width,
      height: precomputed.height,
    }
  } else {
    const screenshot = await captureActiveTab()
    screenshotNull = !screenshot
    screenshotBytes = screenshot ? estimateBase64Bytes(screenshot.data) : 0
    if (!screenshot) screenshotReason = 'captureActiveTab returned null'
    try {
      const result = await compositeWithStrokes(screenshot?.data ?? null, drawing.strokesPng)
      composite = result
    } catch (err) {
      console.warn('[picanthon/scribble] compositeWithStrokes failed:', err)
    }
  }

  const strokesBytes = estimateBase64Bytes(drawing.strokesPng)
  const compositeBytes = composite ? estimateBase64Bytes(composite.data) : 0
  const diag = {
    screenshotBytes,
    strokesBytes,
    compositeBytes,
    compositeMediaType: composite?.mediaType ?? null,
    compositeDimensions: composite ? { w: composite.width, h: composite.height } : { w: 0, h: 0 },
    screenshotNull,
    screenshotReason,
  }

  const imageParts: { type: 'image'; image: string; mediaType: 'image/png' | 'image/jpeg' }[] = []

  if (strokesBytes < 500) {
    console.warn('[picanthon/scribble] strokes near-empty, dropping strokes part', diag)
  } else {
    imageParts.push({
      type: 'image',
      image: `data:image/png;base64,${drawing.strokesPng}`,
      mediaType: 'image/png',
    })
  }

  if (composite) {
    if (compositeBytes < 5000) {
      console.warn('[picanthon/scribble] composite near-empty (< 5KB), dropping composite part', diag)
    } else {
      imageParts.push({
        type: 'image',
        image: `data:${composite.mediaType};base64,${composite.data}`,
        mediaType: composite.mediaType,
      })
    }
  }

  console.debug('[picanthon/scribble]', {
    ...diag,
    imagePartCount: imageParts.length,
    imagePrefixes: imageParts.map((p) => p.image.slice(0, 32)),
    imageLengths: imageParts.map((p) => p.image.length),
    coveredElements: drawing.coveredElements.length,
    precomputed: !!precomputed,
  })

  if (imageParts.length === 0) return prompt

  const original = prompt[lastUserIdx]
  // findLastUserIndex guarantees original.role === 'user', so its content can
  // hold text + image parts. TS can't infer that from the role check alone, so
  // we narrow with an explicit cast on the final object.
  const existingContent = Array.isArray(original.content)
    ? original.content
    : [{ type: 'text', text: typeof original.content === 'string' ? original.content : '' }]
  const augmented = {
    ...original,
    content: [...existingContent, ...imageParts],
  } as ModelMessage
  const next = prompt.slice()
  next[lastUserIdx] = augmented
  return next
}

function findLastUserIndex(prompt: ModelMessage[]): number {
  for (let i = prompt.length - 1; i >= 0; i--) {
    if (prompt[i].role === 'user') return i
  }
  return -1
}

function lastUserText(messages: PicanthonUIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  return (last?.parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join(' ')
}

class MockChatTransport implements ChatTransport<PicanthonUIMessage> {
  async sendMessages({
    messages,
  }: Parameters<ChatTransport<PicanthonUIMessage>['sendMessages']>[0]) {
    const tweaks = keywordTweaks(lastUserText(messages))
    let summary: string
    try {
      const results = await sendToActiveTab<TweakResult[]>({ type: 'APPLY_TWEAKS', tweaks })
      const applied = results.reduce((n, r) => n + r.matched, 0)
      summary =
        `**Modo mock** (sin API key). Apliqué ${tweaks.length} tweak(s), ` +
        `${applied} elemento(s) afectado(s).\n\n` +
        'Agregá tu API key del AI Gateway en **Settings** para el agente real ' +
        '(refinamiento de diseño + reemplazo de componentes).'
    } catch (err) {
      summary = `**Modo mock**: no pude tocar la página (${String(err)}).`
    }

    return createUIMessageStream<PicanthonUIMessage>({
      execute: async ({ writer }) => {
        const id = crypto.randomUUID()
        writer.write({ type: 'start' })
        writer.write({ type: 'text-start', id })
        writer.write({ type: 'text-delta', id, delta: summary })
        writer.write({ type: 'text-end', id })
        writer.write({ type: 'finish' })
      },
    })
  }

  async reconnectToStream() {
    return null
  }
}

function keywordTweaks(instruction: string): Tweak[] {
  const t = instruction.toLowerCase()
  const tweaks: Tweak[] = []
  if (/(oscuro|dark)/.test(t)) {
    tweaks.push({ op: 'setStyle', selector: 'body', styles: { background: '#111', color: '#eee' } })
  }
  if (/(rojo|red|rosa|pink)/.test(t)) {
    tweaks.push({ op: 'setStyle', selector: 'body', styles: { background: '#ffe5ec' } })
  }
  if (/(ocultar imagenes|hide images|sin imagenes)/.test(t)) {
    tweaks.push({ op: 'remove', selector: 'img' })
  }
  if (/(resaltar|highlight|titulo|heading|h1)/.test(t)) {
    tweaks.push({ op: 'highlight', selector: 'h1, h2', color: '#ff3e7f' })
  }
  if (tweaks.length === 0) {
    tweaks.push({ op: 'highlight', selector: 'h1, h2', color: '#ff3e7f' })
  }
  return tweaks
}
