// One-shot Tailwind edit pipeline. With an API key:
//   1. require a picked target (the picker is mandatory).
//   2. run a single LLM call (body screenshot + outerHTML + user request →
//      new Tailwind class string).
//   3. apply the result as a single setAttr tweak on the target's selector.
// Without a key, falls back to a tiny deterministic mock.

import { createUIMessageStream, type ChatTransport } from 'ai'
import { buildModel } from './model'
import type { PicanthonTools, PicanthonUIMessage } from './agent'
import {
  sendToActiveTab,
  type DrawnPayload,
  type PickedElement,
  type TailwindRuntimeResult,
} from './messaging'
import type { Tweak, TweakResult } from './tweaks'
import type { Settings } from './settings'
import { runTailwindEdit } from './tailwind-edit'

// Getters (not raw values) so the transport — which useChat caches across
// renders — always reads the freshest pinned/drawing state at send time.
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

    console.info('[picanthon/transport] sendMessages', {
      userText,
      hasPinned: !!pinned,
      pinnedSelector: pinned?.selector,
      pinnedTag: pinned?.tag,
      pinnedOuterHtmlBytes: pinned?.outerHTML.length,
      model: settings.model,
    })

    return createUIMessageStream<PicanthonUIMessage>({
      execute: async ({ writer }) => {
        const textId = crypto.randomUUID()
        writer.write({ type: 'start' })
        writer.write({ type: 'text-start', id: textId })

        if (!pinned) {
          console.warn('[picanthon/transport] no pinned target — asking user to pick')
          writer.write({
            type: 'text-delta',
            id: textId,
            delta:
              'Necesito que elijas un elemento de la página con el picker (🎯) antes de aplicar un cambio.',
          })
          writer.write({ type: 'text-end', id: textId })
          writer.write({ type: 'finish' })
          return
        }

        const toolCallId = crypto.randomUUID()
        const toolInput: PicanthonTools['edit_tailwind']['input'] = {
          request: userText,
          selector: pinned.selector,
        }
        writer.write({
          type: 'tool-input-available',
          toolCallId,
          toolName: 'edit_tailwind',
          input: toolInput,
        })

        const tTurn = performance.now()
        // Kick off the Tailwind runtime injection in parallel with the LLM
        // call — it usually finishes long before the model responds, so the
        // tweak can apply immediately without an extra serial round trip.
        const runtimeP = sendToActiveTab<TailwindRuntimeResult>({
          type: 'ENSURE_TAILWIND_RUNTIME',
        }).catch((err) => {
          console.warn('[picanthon/transport] ensure runtime failed', err)
          return { ok: false, error: String(err) } as TailwindRuntimeResult
        })

        try {
          const model = buildModel(settings.apiKey, settings.model)
          const { result } = await runTailwindEdit(model, pinned, userText, abortSignal)

          const runtime = await runtimeP
          console.info('[picanthon/transport] tailwind runtime status', runtime)

          const tweak: Tweak = {
            op: 'setAttr',
            selector: result.selector,
            name: 'class',
            value: result.newClasses,
          }
          console.info('[picanthon/transport] applying tweak', tweak)

          const tweakResults = await sendToActiveTab<TweakResult[]>({
            type: 'APPLY_TWEAKS',
            tweaks: [tweak],
          })
          const applied = tweakResults.reduce((n, r) => n + r.matched, 0)
          console.info('[picanthon/transport] tweak applied', {
            applied,
            results: tweakResults,
            totalMs: Math.round(performance.now() - tTurn),
          })

          const toolOutput: PicanthonTools['edit_tailwind']['output'] = {
            selector: result.selector,
            oldClasses: result.oldClasses,
            newClasses: result.newClasses,
            applied,
            summary: result.summary,
          }
          writer.write({
            type: 'tool-output-available',
            toolCallId,
            output: toolOutput,
          })

          const noMatchTail =
            applied === 0
              ? `\n\n(El selector \`${result.selector}\` no matcheó ningún elemento. Probá repickear el target.)`
              : ''
          const runtimeTail =
            runtime && !runtime.ok
              ? `\n\n(⚠️ No pude inyectar el runtime de Tailwind: ${runtime.error ?? 'unknown'}. Si las clases nuevas no son utilities estándar puede que no rendericen.)`
              : ''
          writer.write({
            type: 'text-delta',
            id: textId,
            delta: result.summary + noMatchTail + runtimeTail,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error('[picanthon/transport] edit failed', err)
          writer.write({
            type: 'tool-output-error',
            toolCallId,
            errorText: msg,
          })
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
            'Agregá tu API key del AI Gateway en **Settings** para que el agente edite las clases Tailwind del target picado.',
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
