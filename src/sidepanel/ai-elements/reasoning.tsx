import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from 'react'
import { Streamdown } from 'streamdown'
import { cn } from '@/lib/utils'

interface ReasoningCtx {
  open: boolean
  setOpenManual: (v: boolean) => void
  isStreaming: boolean
}
const Ctx = createContext<ReasoningCtx | null>(null)
const useReasoning = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('Reasoning.* must be used inside <Reasoning>')
  return c
}

// Collapsible "thinking" disclosure. Auto-opens while the model streams its
// reasoning, auto-collapses when streaming ends so a turn with several
// reasoning blocks doesn't push the rest of the conversation off-screen.
// If the user clicks the header at any point, we honor that intent and stop
// auto-toggling — they're in control after the first manual interaction.
export function Reasoning({
  isStreaming = false,
  className,
  children,
  ...props
}: ComponentProps<'div'> & { isStreaming?: boolean }) {
  const [open, setOpen] = useState(isStreaming)
  const userTouched = useRef(false)

  useEffect(() => {
    if (userTouched.current) return
    setOpen(isStreaming)
  }, [isStreaming])

  const setOpenManual = (v: boolean) => {
    userTouched.current = true
    setOpen(v)
  }

  return (
    <Ctx.Provider value={{ open, setOpenManual, isStreaming }}>
      <div className={cn('rounded-lg border border-border bg-card', className)} {...props}>
        {children}
      </div>
    </Ctx.Provider>
  )
}

export function ReasoningTrigger({ className, ...props }: ComponentProps<'button'>) {
  const { open, setOpenManual, isStreaming } = useReasoning()
  return (
    <button
      type="button"
      onClick={() => setOpenManual(!open)}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
      {...props}
    >
      <span className={cn('inline-block transition-transform', open && 'rotate-90')}>▸</span>
      <span className={cn(isStreaming && 'animate-pulse')}>
        {isStreaming ? 'Razonando…' : 'Razonamiento'}
      </span>
    </button>
  )
}

export function ReasoningContent({
  className,
  children,
}: {
  className?: string
  children: string
}) {
  const { open } = useReasoning()
  if (!open) return null
  return (
    <div
      className={cn(
        'border-t border-border px-3 py-3 text-sm leading-relaxed text-muted-foreground',
        className,
      )}
    >
      <Streamdown className="prose-sm break-words">{children}</Streamdown>
    </div>
  )
}
