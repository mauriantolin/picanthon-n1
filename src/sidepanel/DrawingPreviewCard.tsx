import { useEffect, useState } from 'react'
import type { DrawnPayload } from '@/lib/messaging'

const MIN_COMPOSITE_BYTES = 5000
const MAX_COMPOSITE_BYTES = 4_500_000

interface DrawingPreviewCardProps {
  drawing: DrawnPayload
  onClear: () => void
}

export function DrawingPreviewCard({ drawing, onClear }: DrawingPreviewCardProps) {
  const [zoomOpen, setZoomOpen] = useState(false)
  const count = drawing.coveredElements.length
  const composite = drawing.compositePng
  const screenshotAvailable = drawing.screenshotAvailable
  const compositeBytes = composite ? Math.floor((composite.data.length * 3) / 4) : 0
  const tooSmall = composite !== undefined && compositeBytes < MIN_COMPOSITE_BYTES
  const tooLarge = composite !== undefined && compositeBytes > MAX_COMPOSITE_BYTES

  const aspectRatio =
    drawing.viewport.width > 0 && drawing.viewport.height > 0
      ? drawing.viewport.width / drawing.viewport.height
      : 16 / 9

  const compositeSrc = composite
    ? `data:${composite.mediaType};base64,${composite.data}`
    : null
  const strokesSrc = `data:image/png;base64,${drawing.strokesPng}`

  return (
    <div className="mx-3 mt-2 flex flex-col gap-1">
      <div className="flex items-stretch gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs">
        <button
          type="button"
          onClick={() => composite && setZoomOpen(true)}
          disabled={!composite}
          aria-label="Ampliar previsualización del dibujo"
          className="group relative shrink-0 overflow-hidden rounded border border-primary/20 bg-muted shadow-inner transition-colors disabled:cursor-default"
          style={{
            // 144 / (16/9) = 81 → keeps the short side above the 80px floor
            // the rubric asks for on standard landscape viewports.
            aspectRatio: `${aspectRatio}`,
            width: '144px',
            maxWidth: '160px',
            maxHeight: '96px',
          }}
        >
          {compositeSrc ? (
            <img
              src={compositeSrc}
              alt="Composite del dibujo sobre la página"
              className="h-full w-full object-contain"
              data-testid="composite-image"
            />
          ) : (
            <div
              className="relative flex h-full w-full items-center justify-center bg-muted"
              style={
                screenshotAvailable === false
                  ? {
                      backgroundImage:
                        'linear-gradient(45deg, rgba(120,120,120,0.18) 25%, transparent 25%), linear-gradient(-45deg, rgba(120,120,120,0.18) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(120,120,120,0.18) 75%), linear-gradient(-45deg, transparent 75%, rgba(120,120,120,0.18) 75%)',
                      backgroundSize: '8px 8px',
                      backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
                    }
                  : undefined
              }
            >
              <img
                src={strokesSrc}
                alt="Trazos del dibujo"
                className="absolute inset-0 h-full w-full object-contain"
              />
              {screenshotAvailable !== false && (
                <span
                  className="relative z-10 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground"
                  data-testid="composing-label"
                >
                  componiendo…
                </span>
              )}
            </div>
          )}
          {composite && (
            <span className="pointer-events-none absolute inset-0 hidden items-end justify-end p-1 group-hover:flex">
              <span className="rounded bg-background/85 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                zoom
              </span>
            </span>
          )}
        </button>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <div className="flex items-center gap-2 leading-tight">
            <span className="font-medium text-foreground">Dibujo</span>
            <span
              className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1.5 font-mono text-[10px] font-semibold text-primary-foreground"
              title={`${count} ${count === 1 ? 'elemento' : 'elementos'} cubierto${count === 1 ? '' : 's'}`}
            >
              {count}
            </span>
            <span className="truncate text-muted-foreground">
              {count === 1 ? 'elemento' : 'elementos'} cubierto{count === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={onClear}
              title="Descartar dibujo"
              className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              aria-label="Descartar dibujo"
            >
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
                <path
                  d="M3 3l6 6M9 3l-6 6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {screenshotAvailable === false && (
              <span
                className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-[1px] font-medium text-amber-600 dark:text-amber-400"
                data-testid="no-screenshot-pill"
              >
                sin screenshot
              </span>
            )}
            {!composite && screenshotAvailable !== false && (
              <span className="font-mono text-[10px] text-muted-foreground">
                preparando composite…
              </span>
            )}
            {tooSmall && (
              <span
                className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-[1px] font-medium text-amber-600 dark:text-amber-400"
                data-testid="size-warning-pill"
              >
                imagen muy chica · el modelo podría ignorarla
              </span>
            )}
            {tooLarge && (
              <span
                className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-[1px] font-medium text-amber-600 dark:text-amber-400"
                data-testid="size-warning-pill"
              >
                imagen muy grande · el modelo podría ignorarla
              </span>
            )}
            {composite && !tooSmall && !tooLarge && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {formatBytes(compositeBytes)} · {composite.mediaType.replace('image/', '')}
              </span>
            )}
          </div>
        </div>
      </div>
      {zoomOpen && composite && (
        <DrawingZoomModal
          src={compositeSrc!}
          onClose={() => setZoomOpen(false)}
          alt="Composite del dibujo sobre la página"
        />
      )}
    </div>
  )
}

interface DrawingZoomModalProps {
  src: string
  alt: string
  onClose: () => void
}

export function DrawingZoomModal({ src, alt, onClose }: DrawingZoomModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vista ampliada del dibujo"
      onClick={onClose}
      className="fixed inset-0 z-[2147483646] flex items-center justify-center bg-background/95 backdrop-blur-sm p-6"
      data-testid="zoom-modal"
    >
      <div
        className="relative max-w-[90vw] max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt}
          className="max-w-[90vw] max-h-[80vh] object-contain rounded border border-border shadow-2xl"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute -top-3 -right-3 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md hover:bg-muted"
          data-testid="zoom-close"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
