import { useEffect, useRef, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

// Scrollable chat viewport that sticks to the bottom as new content streams in,
// unless the user has scrolled up to read history.
//
// Two pieces have to cooperate to stay glued to the bottom:
//   • Programmatic scroll is flagged so the onScroll listener doesn't read it
//     as a user gesture and disable stickiness.
//   • A ResizeObserver re-triggers the scroll whenever the inner content height
//     changes — this catches collapses (e.g. Reasoning auto-collapsing when it
//     finishes streaming) that would otherwise leave a phantom gap because the
//     parent's effect already ran before the child shrank.
export function Conversation({ className, children, ...props }: ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const programmatic = useRef(false)

  const stickToBottom = () => {
    const el = ref.current
    if (!el || !stick.current) return
    programmatic.current = true
    el.scrollTop = el.scrollHeight
    requestAnimationFrame(() => {
      programmatic.current = false
    })
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      if (programmatic.current) return
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }
    el.addEventListener('scroll', onScroll, { passive: true })

    // Re-stick only when the content SHRINKS. A shrink that happens after our
    // render pass (e.g. Reasoning auto-collapsing when it finishes streaming)
    // leaves an empty gap because we already scrolled relative to the taller
    // height — re-sticking closes it. Growth is handled by the per-render
    // effect below; force-sticking on growth would yank the viewport to the
    // bottom when the user manually expands a tool, cutting off its top.
    let lastHeight = el.firstElementChild?.scrollHeight ?? 0
    const ro = new ResizeObserver(() => {
      const height = el.firstElementChild?.scrollHeight ?? 0
      if (height < lastHeight) stickToBottom()
      lastHeight = height
    })
    if (el.firstElementChild) ro.observe(el.firstElementChild)

    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])

  useEffect(stickToBottom)

  return (
    <div
      ref={ref}
      className={cn('flex-1 overflow-y-auto', className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function ConversationContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-4 p-4', className)} {...props} />
}

export function ConversationEmptyState({
  title,
  description,
  className,
  ...props
}: ComponentProps<'div'> & { title?: string; description?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-16 text-center',
        className,
      )}
      {...props}
    >
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
    </div>
  )
}
