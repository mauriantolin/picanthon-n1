import { createContext, useContext, useState, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied'

const Ctx = createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null)
const useTool = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('Tool.* must be used inside <Tool>')
  return c
}

export function Tool({
  defaultOpen = true,
  className,
  children,
  ...props
}: ComponentProps<'div'> & { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Ctx.Provider value={{ open, setOpen }}>
      <div
        className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}
        {...props}
      >
        {children}
      </div>
    </Ctx.Provider>
  )
}

const STATE_LABEL: Record<ToolState, string> = {
  'input-streaming': 'preparando',
  'input-available': 'ejecutando',
  'approval-requested': 'aprobación',
  'approval-responded': 'aprobado',
  'output-available': 'listo',
  'output-error': 'error',
  'output-denied': 'denegado',
}

export function ToolHeader({
  type,
  state,
  className,
}: {
  type: string
  state: ToolState
  className?: string
}) {
  const { open, setOpen } = useTool()
  const live = state === 'input-streaming' || state === 'input-available'
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      className={cn(
        // min-h-9 + py-2 keeps the header at a consistent ~36px tall even when
        // text is somehow missing or the bubble was previously expanded — that
        // was the "tool collapses to a thin line" bug.
        'flex min-h-9 w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-muted',
        className,
      )}
    >
      <span className={cn('inline-block transition-transform', open && 'rotate-90')}>▸</span>
      <span className="font-mono font-medium text-foreground">{type}</span>
      <span
        className={cn(
          'ml-auto rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide',
          live && 'animate-pulse',
          state === 'output-error'
            ? 'bg-destructive/20 text-destructive'
            : state === 'output-available'
              ? 'bg-primary/20 text-primary'
              : 'bg-secondary text-muted-foreground',
        )}
      >
        {STATE_LABEL[state] ?? state}
      </span>
    </button>
  )
}

export function ToolContent({ children }: { children: React.ReactNode }) {
  const { open } = useTool()
  if (!open) return null
  return <div className="border-t border-border">{children}</div>
}

export function ToolInput({ input }: { input: unknown }) {
  return (
    <div className="px-3 py-2.5">
      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Input</p>
      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-background p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
        {JSON.stringify(input, null, 2)}
      </pre>
    </div>
  )
}

export function ToolOutput({
  output,
  errorText,
}: {
  output?: unknown
  errorText?: string
}) {
  if (errorText) {
    return (
      <div className="px-3 py-2.5 text-xs leading-relaxed text-destructive">{errorText}</div>
    )
  }
  if (output === undefined) return null
  return (
    <div className="px-3 py-2.5">
      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Output</p>
      <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded bg-background p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
        {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
      </pre>
    </div>
  )
}
