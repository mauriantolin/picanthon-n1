// One-shot edit pipeline. With an API key:
//   1. Build the edit scope: a picked element when present, otherwise the
//      full <body> HTML pulled from the active tab.
//   2. Refine the user's request (preserving intent: add / replace / modify /
//      delete / restyle).
//   3. Run a single LLM call (body screenshot + scope HTML + refined request →
//      a list of Tweak operations).
//   4. Apply those tweaks via the existing APPLY_TWEAKS pipeline.
// Without a key, falls back to a tiny deterministic mock.

import { createUIMessageStream, type ChatTransport } from 'ai'
import { buildModel } from './model'
import type { PicanthonTools, PicanthonUIMessage } from './agent'
import {
  sendToActiveTab,
  type BodyHTMLResult,
  type PickedElement,
} from './messaging'
import type { TweakResult } from './tweaks'
import type { Settings } from './settings'
import { runElementEdit, type EditScope } from './tailwind-edit'
import { refineRequest, REFINE_MODEL } from './refine-prompt'
import { estimateBase64Bytes, makeThumbnail } from './screenshot'

// Getter (not a raw value) so the transport — which useChat caches across
// renders — always reads the freshest pinned state at send time.
export interface ChatContext {
  getPinned: () => PickedElement | null
}

export function createChatTransport(
  settings: Settings,
  context: ChatContext = { getPinned: () => null },
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
    const userText = lastUserText(messages)
    const pinned = this.ctx.getPinned()
    const settings = this.settings

    return createUIMessageStream<PicanthonUIMessage>({
      execute: async ({ writer }) => {
        const textId = crypto.randomUUID()
        writer.write({ type: 'start' })
        writer.write({ type: 'text-start', id: textId })

        const toolCallId = crypto.randomUUID()

        try {
          const scope = await buildScope(pinned)

          const toolInput: PicanthonTools['edit_element']['input'] = {
            request: userText,
            scope: pinned
              ? { mode: 'pinned', selector: pinned.selector, tag: pinned.tag }
              : { mode: 'full-body', url: scope.url ?? '', title: scope.title ?? '' },
          }
          writer.write({
            type: 'tool-input-available',
            toolCallId,
            toolName: 'edit_element',
            input: toolInput,
          })

          const refineModel = buildModel(settings.apiKey, REFINE_MODEL)
          const refined = await refineRequest(refineModel, pinned, userText, abortSignal)
          console.info('[picanthon] refined request', {
            refineModel: REFINE_MODEL,
            raw: userText,
            refined,
            mode: pinned ? 'pinned' : 'full-body',
          })

          const model = buildModel(settings.apiKey, settings.model)
          const { result, bodyShot } = await runElementEdit(
            model,
            scope,
            refined,
            abortSignal,
          )

          const tweakResults = await sendToActiveTab<TweakResult[]>({
            type: 'APPLY_TWEAKS',
            tweaks: result.tweaks,
          })
          const applied = tweakResults.reduce((n, r) => n + r.matched, 0)
          const unmatched = tweakResults
            .filter((r) => r.matched === 0)
            .map((r) => r.tweak.selector)

          const thumbnail = bodyShot
            ? await makeThumbnail(bodyShot.data, bodyShot.mediaType)
            : null
          console.info('[picanthon] edit_element result', {
            model: settings.model,
            mode: pinned ? 'pinned' : 'full-body',
            tweakCount: result.tweaks.length,
            tweakOps: result.tweaks.map((t) => t.op),
            applied,
            unmatched,
            screenshotSentToLLM: bodyShot
              ? {
                  mediaType: bodyShot.mediaType,
                  bytes: estimateBase64Bytes(bodyShot.data),
                }
              : null,
            thumbnailForUI: thumbnail
              ? {
                  mediaType: thumbnail.mediaType,
                  width: thumbnail.width,
                  height: thumbnail.height,
                  bytes: estimateBase64Bytes(thumbnail.data),
                }
              : null,
          })

          const toolOutput: PicanthonTools['edit_element']['output'] = {
            tweaks: result.tweaks.map((t) => ({ op: t.op, selector: t.selector })),
            applied,
            summary: result.summary,
            screenshot: thumbnail,
          }
          writer.write({
            type: 'tool-output-available',
            toolCallId,
            output: toolOutput,
          })

          const tail =
            applied === 0
              ? `\n\n(Ningún selector propuesto matcheó. ${
                  unmatched.length
                    ? 'Probá repickear el target. Selectores: ' + unmatched.join(', ')
                    : ''
                })`
              : ''
          writer.write({ type: 'text-delta', id: textId, delta: result.summary + tail })
        } catch (err) {
          if (abortSignal?.aborted) {
            writer.write({
              type: 'tool-output-error',
              toolCallId,
              errorText: 'Cancelado',
            })
            writer.write({ type: 'text-delta', id: textId, delta: 'Cancelado.' })
          } else {
            const msg = err instanceof Error ? err.message : String(err)
            writer.write({
              type: 'tool-output-error',
              toolCallId,
              errorText: msg,
            })
            writer.write({ type: 'text-delta', id: textId, delta: `Error: ${msg}` })
          }
        }

        writer.write({ type: 'text-end', id: textId })
        writer.write({ type: 'finish' })
      },
      onError: (err) => (err instanceof Error ? err.message : String(err)),
    })
  }

  async reconnectToStream() {
    return null
  }
}

async function buildScope(pinned: PickedElement | null): Promise<EditScope> {
  if (pinned) {
    return { pinned, bodyHTML: null, url: null, title: null }
  }
  const body = await sendToActiveTab<BodyHTMLResult>({ type: 'GET_BODY_HTML' })
  return {
    pinned: null,
    bodyHTML: body.bodyHTML,
    url: body.url,
    title: body.title,
  }
}

function lastUserText(messages: PicanthonUIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  return (last?.parts ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join(' ')
    .trim()
}

class MockChatTransport implements ChatTransport<PicanthonUIMessage> {
  async sendMessages({
    messages,
  }: Parameters<ChatTransport<PicanthonUIMessage>['sendMessages']>[0]) {
    const text = lastUserText(messages)
    return createUIMessageStream<PicanthonUIMessage>({
      execute: async ({ writer }) => {
        const id = crypto.randomUUID()
        writer.write({ type: 'start' })
        writer.write({ type: 'text-start', id })
        writer.write({
          type: 'text-delta',
          id,
          delta:
            `**Modo mock** (sin API key). Tu pedido: "${text || '(vacío)'}".\n\n` +
            'Agregá tu API key del AI Gateway en **Settings** para que el agente edite la página.',
        })
        writer.write({ type: 'text-end', id })
        writer.write({ type: 'finish' })
      },
    })
  }

  async reconnectToStream() {
    return null
  }
}
