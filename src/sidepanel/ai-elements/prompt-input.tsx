import type { ComponentProps, FormEvent } from 'react'
import { cn } from '@/lib/utils'

type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

export function PromptInput({
  className,
  onSubmit,
  ...props
}: Omit<ComponentProps<'form'>, 'onSubmit'> & {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        'flex flex-col gap-2 border-t border-border bg-card p-3',
        className,
      )}
      {...props}
    />
  )
}

export function PromptInputTextarea({
  className,
  onKeyDown,
  ...props
}: ComponentProps<'textarea'>) {
  return (
    <textarea
      rows={2}
      className={cn(
        'w-full resize-none rounded-lg border border-input bg-background p-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring',
        className,
      )}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          e.currentTarget.form?.requestSubmit()
        }
        onKeyDown?.(e)
      }}
      {...props}
    />
  )
}

export function PromptInputToolbar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)} {...props} />
  )
}

export function PromptInputSubmit({
  status = 'ready',
  disabled,
  onStop,
  className,
  ...props
}: ComponentProps<'button'> & { status?: ChatStatus; onStop?: () => void }) {
  const busy = status === 'submitted' || status === 'streaming'
  if (busy) {
    return (
      <button
        type="button"
        onClick={onStop}
        title="Cancelar"
        aria-label="Cancelar"
        className={cn(
          'ml-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-muted',
          className,
        )}
      >
        <span aria-hidden className="block h-3 w-3 rounded-[2px] bg-foreground" />
        Detener
      </button>
    )
  }
  return (
    <button
      type="submit"
      disabled={disabled}
      className={cn(
        'ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:cursor-default disabled:opacity-50',
        className,
      )}
      {...props}
    >
      Enviar
    </button>
  )
}
