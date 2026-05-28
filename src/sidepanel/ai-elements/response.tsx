import type { ComponentProps } from 'react'
import { Streamdown } from 'streamdown'
import { cn } from '@/lib/utils'

// Renders streaming markdown safely (handles incomplete/partial markdown).
export function Response({ className, ...props }: ComponentProps<typeof Streamdown>) {
  return (
    <Streamdown
      className={cn(
        'size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 prose-sm',
        className,
      )}
      {...props}
    />
  )
}
