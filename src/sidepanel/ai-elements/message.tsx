import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type Role = 'user' | 'assistant' | 'system'

export function Message({
  from,
  className,
  ...props
}: ComponentProps<'div'> & { from: Role }) {
  return (
    <div
      className={cn(
        'group flex w-full',
        from === 'user' ? 'justify-end' : 'justify-start',
        className,
      )}
      data-role={from}
      {...props}
    />
  )
}

export function MessageContent({
  className,
  variant = 'contained',
  ...props
}: ComponentProps<'div'> & { variant?: 'contained' | 'flat' }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 text-sm',
        variant === 'contained' &&
          'max-w-[90%] overflow-hidden rounded-xl px-3 py-2 ' +
            'group-data-[role=user]:bg-primary group-data-[role=user]:text-primary-foreground ' +
            'bg-secondary text-secondary-foreground',
        variant === 'flat' && 'min-w-0 flex-1',
        className,
      )}
      {...props}
    />
  )
}
