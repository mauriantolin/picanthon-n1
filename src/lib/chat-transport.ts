// One-shot Tailwind edit pipeline. Requires a picked target and an API key;
// without a key, a deterministic mock transport is returned instead.

import { createUIMessageStream, type ChatTransport } from 'ai'
import { buildModel } from './model'
import type { PicanthonUIMessage } from './agent'
import {
  sendToActiveTab,
  type DrawnPayload,
  type PickedElement,
  type TailwindRuntimeResult,
} from './messaging'
import type { Tweak, TweakResult } from './tweaks'
import type { Settings } from './settings'
import { runTailwindEdit } from './tailwind-edit'

// Getters (not raw values) so the memoized transport always reads the latest
// pinned/drawing state at send time.
export interface ChatContext {
  getPinned: () => PickedElement | null
  getDrawing: () => DrawnPayload | null
}

export function createChatTransport(
  settings: Settings,
  context: ChatContext = { getPinned: () => null, getDrawing: () => null },
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

        if (!pinned) {
          writer.write({
            type: 'text-delta',
            id: textId,
            delta:
              'Elegí un elemento con el picker (🎯) antes de pedir un cambio.',
          })
          writer.write({ type: 'text-end', id: textId })
          writer.write({ type: 'finish' })
          return
        }

        const toolCallId = crypto.randomUUID()
        writer.write({
          type: 'tool-input-available',
          toolCallId,
          toolName: 'edit_tailwind',
          input: { request: userText, selector: pinned.selector },
        })

        // Inject the Tailwind runtime in parallel — it usually finishes before
        // the LLM call returns.
        const runtimeP = sendToActiveTab<TailwindRuntimeResult>({
          type: 'ENSURE_TAILWIND_RUNTIME',
        }).catch((err) => ({ ok: false, error: String(err) } as TailwindRuntimeResult))

        try {
          const model = buildModel(settings.apiKey, settings.model)
          const { result } = await runTailwindEdit(model, pinned, userText, abortSignal)
          const runtime = await runtimeP

          const tweak: Tweak = {
            op: 'setAttr',
            selector: result.selector,
            name: 'class',
            value: result.newClasses,
          }
          const tweakResults = await sendToActiveTab<TweakResult[]>({
            type: 'APPLY_TWEAKS',
            tweaks: [tweak],
          })
          const applied = tweakResults.reduce((n, r) => n + r.matched, 0)

          writer.write({
            type: 'tool-output-available',
            toolCallId,
            output: {
              selector: result.selector,
              oldClasses: result.oldClasses,
              newClasses: result.newClasses,
              applied,
              summary: result.summary,
            },
          })

          const noMatchTail =
            applied === 0
              ? `\n\n(El selector \`${result.selector}\` no matcheó. Repickeá el target.)`
              : ''
          const runtimeTail =
            runtime && !runtime.ok
              ? `\n\n(⚠️ No pude inyectar el runtime de Tailwind: ${runtime.error ?? 'unknown'}.)`
              : ''
          writer.write({
            type: 'text-delta',
            id: textId,
            delta: result.summary + noMatchTail + runtimeTail,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          writer.write({ type: 'tool-output-error', toolCallId, errorText: msg })
          writer.write({ type: 'text-delta', id: textId, delta: `Error: ${msg}` })
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
            'Agregá tu API key del AI Gateway en **Settings**.',
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
