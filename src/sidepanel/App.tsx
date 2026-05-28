import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useChat } from '@ai-sdk/react'
import { isToolUIPart } from 'ai'
import { getSettings, saveSettings, type Settings } from '@/lib/settings'
import {
  sendToActiveTab,
  type DrawnPayload,
  type DrawResult,
  type PickedElement,
  type PickResult,
} from '@/lib/messaging'
import { createChatTransport } from '@/lib/chat-transport'
import type { PicanthonUIMessage } from '@/lib/agent'
import { ErrorBoundary } from './ErrorBoundary'
import { DrawingPreviewCard } from './DrawingPreviewCard'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from './ai-elements/conversation'
import { Message, MessageContent } from './ai-elements/message'
import { Response } from './ai-elements/response'
import { Reasoning, ReasoningContent, ReasoningTrigger } from './ai-elements/reasoning'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from './ai-elements/tool'
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from './ai-elements/prompt-input'

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    getSettings().then(setSettings)
  }, [])

  async function resetPage() {
    try {
      await sendToActiveTab({ type: 'CLEAR_TWEAKS' })
    } catch {
      /* tab may have no content script; reload still clears the DOM */
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) chrome.tabs.reload(tab.id)
  }

  if (!settings) return null

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="font-semibold">🌶️ Picanthon</span>
        <div className="flex items-center gap-1">
          <button
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={resetPage}
            title="Borra los cambios guardados y recarga la página"
          >
            Reset
          </button>
          <button
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowSettings((v) => !v)}
          >
            {showSettings ? 'Cerrar' : 'Settings'}
          </button>
        </div>
      </header>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSave={(s) => {
            setSettings(s)
            setShowSettings(false)
          }}
        />
      )}

      {/* Remounting on key change rebuilds the transport when settings change. */}
      <ErrorBoundary key={`${settings.apiKey}:${settings.model}`}>
        <Chat settings={settings} />
      </ErrorBoundary>
    </div>
  )
}

function Chat({ settings }: { settings: Settings }) {
  const [input, setInput] = useState('')
  const [pinned, setPinned] = useState<PickedElement | null>(null)
  const [picking, setPicking] = useState(false)
  const [drawing, setDrawing] = useState<DrawnPayload | null>(null)
  const [drawingActive, setDrawingActive] = useState(false)

  // Refs let the (memoized) transport always read the latest pinned/drawing at
  // send time. Without them useChat would capture the first transport instance
  // (built when pinned was null) and never see later picks.
  const pinnedRef = useRef<PickedElement | null>(null)
  const drawingRef = useRef<DrawnPayload | null>(null)
  useEffect(() => {
    pinnedRef.current = pinned
  }, [pinned])
  useEffect(() => {
    drawingRef.current = drawing
  }, [drawing])

  const transport = useMemo(
    () =>
      createChatTransport(settings, {
        getPinned: () => pinnedRef.current,
        getDrawing: () => drawingRef.current,
      }),
    [settings],
  )
  const { messages, sendMessage, status, error } = useChat<PicanthonUIMessage>({
    transport,
    onError: (err) => console.error('Picanthon chat error:', err),
  })

  // Clear the pin and drawing when the active tab navigates — the selector
  // would no longer resolve and the screenshot would be of a different page.
  useEffect(() => {
    function onTabUpdated(
      _tabId: number,
      change: chrome.tabs.TabChangeInfo,
      _tab: chrome.tabs.Tab,
    ) {
      if (change.status === 'loading' || change.url) {
        setPinned(null)
        setDrawing(null)
      }
    }
    chrome.tabs?.onUpdated.addListener(onTabUpdated)
    return () => chrome.tabs?.onUpdated.removeListener(onTabUpdated)
  }, [])

  async function togglePicker() {
    if (picking) {
      try {
        await sendToActiveTab({ type: 'CANCEL_PICK' })
      } catch {
        /* tab may have no content script */
      }
      setPicking(false)
      return
    }
    setPicking(true)
    setDrawingActive(false)
    try {
      const result = await sendToActiveTab<PickResult>({ type: 'START_PICK' })
      if ('cancelled' in result) {
        console.info('[picanthon/picker] cancelled')
      } else {
        console.info('[picanthon/picker] picked', {
          selector: result.selector,
          tag: result.tag,
          outerHtmlBytes: result.outerHTML.length,
          bbox: result.boundingBox,
        })
        setPinned(result)
      }
    } catch (err) {
      console.warn('Picanthon picker error:', err)
    } finally {
      setPicking(false)
    }
  }

  async function toggleScribble() {
    if (drawingActive) {
      try {
        await sendToActiveTab({ type: 'CANCEL_DRAW' })
      } catch {
        /* tab may have no content script */
      }
      setDrawingActive(false)
      return
    }
    setDrawingActive(true)
    setPicking(false)
    try {
      const result = await sendToActiveTab<DrawResult>({ type: 'START_DRAW' })
      if (!('cancelled' in result)) setDrawing(result)
    } catch (err) {
      console.warn('Picanthon scribble error:', err)
    } finally {
      setDrawingActive(false)
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (status === 'streaming' || status === 'submitted') return
    const text = input.trim()
    // With a drawing the text is optional — the gesture is the input.
    if (!text && !drawing) return
    sendMessage({ text: text || '(sin texto, interpretá el dibujo)' })
    setInput('')
    // One-shot: the drawing belongs to this single turn.
    setDrawing(null)
  }

  return (
    <>
      <Conversation>
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              title="Pedime que modifique esta página"
              description='Probá: "fondo oscuro", "resaltar títulos", "ocultar imágenes".'
            />
          )}

          {messages.map((message) => (
            <Message key={message.id} from={message.role}>
              <MessageContent variant={message.role === 'user' ? 'contained' : 'flat'}>
                {message.parts.map((part, i) => {
                  const key = `${message.id}-${i}`

                  if (part.type === 'text') {
                    return <Response key={key}>{part.text}</Response>
                  }

                  if (part.type === 'reasoning') {
                    const streaming = 'state' in part && part.state === 'streaming'
                    return (
                      <Reasoning key={key} isStreaming={streaming}>
                        <ReasoningTrigger />
                        <ReasoningContent>{part.text}</ReasoningContent>
                      </Reasoning>
                    )
                  }

                  if (isToolUIPart(part)) {
                    const name = part.type.replace(/^tool-/, '')
                    const hasInput =
                      part.state === 'input-available' ||
                      part.state === 'output-available' ||
                      part.state === 'output-error'
                    return (
                      <Tool key={key}>
                        <ToolHeader type={name} state={part.state} />
                        <ToolContent>
                          {hasInput && <ToolInput input={part.input} />}
                          {part.state === 'output-available' && (
                            <ToolOutput output={part.output} />
                          )}
                          {part.state === 'output-error' && (
                            <ToolOutput errorText={part.errorText} />
                          )}
                        </ToolContent>
                      </Tool>
                    )
                  }

                  return null
                })}
              </MessageContent>
            </Message>
          ))}

          {error && (
            <Message from="assistant">
              <MessageContent variant="flat">
                <p className="rounded-lg bg-destructive/20 px-3 py-2 text-sm text-destructive">
                  {error.message}
                </p>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
      </Conversation>

      {pinned && <PinnedElementCard pin={pinned} onClear={() => setPinned(null)} />}
      {drawing && (
        <DrawingPreviewCard
          drawing={drawing}
          onClear={() => setDrawing(null)}
          visionCapable={isVisionCapable(settings.model)}
        />
      )}

      <PromptInput onSubmit={onSubmit}>
        <PromptInputTextarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={drawing ? 'Describí el dibujo (opcional)…' : 'Describí un cambio…'}
        />
        <PromptInputToolbar>
          <span className="text-[11px] text-muted-foreground">
            {settings.apiKey ? settings.model : 'modo mock (sin API key)'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <ScribbleButton active={drawingActive} onClick={toggleScribble} />
            <PickerButton active={picking} onClick={togglePicker} />
            <PromptInputSubmit
              status={status}
              disabled={!input.trim() && !drawing}
            />
          </div>
        </PromptInputToolbar>
      </PromptInput>
    </>
  )
}

function ScribbleButton({
  active,
  onClick,
}: {
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? 'Cancelar dibujo' : 'Dibujar sobre la página'}
      aria-pressed={active}
      className={
        'inline-flex h-8 w-8 items-center justify-center rounded-lg border text-foreground transition-colors ' +
        (active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-input bg-background hover:bg-muted')
      }
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    </button>
  )
}

// Vision-capable model heuristic. Whitelist the families we know can read
// images via the Vercel AI Gateway. Anything else is flagged so the user
// realizes the drawing will silently be dropped.
function isVisionCapable(modelId: string): boolean {
  const m = modelId.toLowerCase()
  return (
    m.includes('claude') ||
    m.includes('gpt-4') ||
    m.includes('gpt-5') ||
    m.includes('gemini') ||
    m.includes('grok-4-vision') ||
    m.includes('llama-3.2-vision') ||
    m.includes('llama-4')
  )
}

function PickerButton({
  active,
  onClick,
}: {
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? 'Cancelar selección' : 'Seleccionar elemento de la página'}
      aria-pressed={active}
      className={
        'inline-flex h-8 w-8 items-center justify-center rounded-lg border text-foreground transition-colors ' +
        (active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-input bg-background hover:bg-muted')
      }
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="3" x2="12" y2="6" />
        <line x1="12" y1="18" x2="12" y2="21" />
        <line x1="3" y1="12" x2="6" y2="12" />
        <line x1="18" y1="12" x2="21" y2="12" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </svg>
    </button>
  )
}

function PinnedElementCard({
  pin,
  onClear,
}: {
  pin: PickedElement
  onClear: () => void
}) {
  const w = Math.round(pin.boundingBox.width)
  const h = Math.round(pin.boundingBox.height)
  return (
    <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs">
      <span aria-hidden>🎯</span>
      <code className="truncate font-mono text-foreground">{pin.selector}</code>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground whitespace-nowrap">
        {w}×{h}
      </span>
      <button
        type="button"
        onClick={onClear}
        title="Limpiar selección"
        className="ml-auto rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
        aria-label="Limpiar selección"
      >
        ×
      </button>
    </div>
  )
}

function SettingsPanel({
  settings,
  onSave,
}: {
  settings: Settings
  onSave: (s: Settings) => void
}) {
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [model, setModel] = useState(settings.model)

  async function persist() {
    const next: Settings = { apiKey, model }
    await saveSettings(next)
    onSave(next)
  }

  return (
    <section className="flex flex-col gap-2 border-b border-border bg-card p-4">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Vercel AI Gateway API key
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="vck_…"
          className="rounded-md border border-input bg-background p-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Model (vision-capable)
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="anthropic/claude-sonnet-4.6"
          className="rounded-md border border-input bg-background p-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <button
        onClick={persist}
        className="mt-1 self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Guardar
      </button>
      <p className="text-[11px] text-muted-foreground">
        ¿Sin key? Modo mock para probar la UI. Un único modelo: hace 1 sola llamada por edición.
      </p>
    </section>
  )
}
