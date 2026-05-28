import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { DrawingPreviewCard } from './DrawingPreviewCard'
import type { DrawnPayload } from '@/lib/messaging'

interface Harness {
  container: HTMLDivElement
  root: Root
  unmount: () => void
}

function mount(node: React.ReactElement): Harness {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(node)
  })
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

const baseDrawing: DrawnPayload = {
  strokesPng: 'STROKES_BASE64',
  bbox: { x: 0, y: 0, width: 50, height: 50 },
  viewport: { width: 1280, height: 720 },
  coveredElements: [{ selector: '#a', tag: 'div', coverage: 0.9 }],
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('DrawingPreviewCard', () => {
  it('renders composite image when present with a data:image/png|jpeg URL', () => {
    const drawing: DrawnPayload = {
      ...baseDrawing,
      compositePng: {
        data: 'XYZ' + 'A'.repeat(7000),
        mediaType: 'image/png',
        width: 1280,
        height: 720,
      },
      screenshotAvailable: true,
    }
    const h = mount(
      <DrawingPreviewCard drawing={drawing} onClear={() => {}} visionCapable={true} />,
    )
    const img = h.container.querySelector(
      'img[data-testid="composite-image"]',
    ) as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img!.src).toMatch(/^data:image\/(png|jpeg);base64,/)
    expect(img!.src).toContain('XYZ')
    h.unmount()
  })

  it('shows "sin screenshot" pill when screenshotAvailable is false', () => {
    const drawing: DrawnPayload = {
      ...baseDrawing,
      screenshotAvailable: false,
    }
    const h = mount(
      <DrawingPreviewCard drawing={drawing} onClear={() => {}} visionCapable={true} />,
    )
    const pill = h.container.querySelector('[data-testid="no-screenshot-pill"]')
    expect(pill).not.toBeNull()
    expect(pill!.textContent).toMatch(/sin screenshot/i)
    h.unmount()
  })

  it('shows strokes-only with "componiendo" label when compositePng is undefined', () => {
    const h = mount(
      <DrawingPreviewCard drawing={baseDrawing} onClear={() => {}} visionCapable={true} />,
    )
    const label = h.container.querySelector('[data-testid="composing-label"]')
    expect(label).not.toBeNull()
    expect(label!.textContent).toMatch(/componiendo/i)
    const img = h.container.querySelector('img[alt="Trazos del dibujo"]') as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img!.src).toContain('STROKES_BASE64')
    h.unmount()
  })

  it('opens zoom modal on thumbnail click and closes on Escape', () => {
    const drawing: DrawnPayload = {
      ...baseDrawing,
      compositePng: {
        data: 'Z'.repeat(7000),
        mediaType: 'image/png',
        width: 1280,
        height: 720,
      },
      screenshotAvailable: true,
    }
    const h = mount(
      <DrawingPreviewCard drawing={drawing} onClear={() => {}} visionCapable={true} />,
    )
    const button = h.container.querySelector(
      'button[aria-label="Ampliar previsualización del dibujo"]',
    ) as HTMLButtonElement | null
    expect(button).not.toBeNull()
    act(() => {
      button!.click()
    })
    const modal = document.querySelector('[data-testid="zoom-modal"]')
    expect(modal).not.toBeNull()
    const modalImg = modal!.querySelector('img') as HTMLImageElement | null
    expect(modalImg).not.toBeNull()
    expect(modalImg!.src).toMatch(/^data:image\/png;base64,/)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('[data-testid="zoom-modal"]')).toBeNull()
    h.unmount()
  })

  it('shows the warning pill when composite is below the 5 KB threshold', () => {
    const drawing: DrawnPayload = {
      ...baseDrawing,
      compositePng: {
        data: 'tiny',
        mediaType: 'image/png',
        width: 100,
        height: 100,
      },
      screenshotAvailable: true,
    }
    const h = mount(
      <DrawingPreviewCard drawing={drawing} onClear={() => {}} visionCapable={true} />,
    )
    const pill = h.container.querySelector('[data-testid="size-warning-pill"]')
    expect(pill).not.toBeNull()
    expect(pill!.textContent).toMatch(/muy chica/i)
    h.unmount()
  })

  it('closes the zoom modal when clicking the backdrop', () => {
    const drawing: DrawnPayload = {
      ...baseDrawing,
      compositePng: {
        data: 'Z'.repeat(7000),
        mediaType: 'image/png',
        width: 1280,
        height: 720,
      },
      screenshotAvailable: true,
    }
    const h = mount(
      <DrawingPreviewCard drawing={drawing} onClear={() => {}} visionCapable={true} />,
    )
    const trigger = h.container.querySelector(
      'button[aria-label="Ampliar previsualización del dibujo"]',
    ) as HTMLButtonElement
    act(() => trigger.click())
    const backdrop = document.querySelector('[data-testid="zoom-modal"]') as HTMLElement | null
    expect(backdrop).not.toBeNull()
    act(() => backdrop!.click())
    expect(document.querySelector('[data-testid="zoom-modal"]')).toBeNull()
    h.unmount()
  })

  it('closes the zoom modal when clicking the X button', () => {
    const drawing: DrawnPayload = {
      ...baseDrawing,
      compositePng: {
        data: 'Z'.repeat(7000),
        mediaType: 'image/png',
        width: 1280,
        height: 720,
      },
      screenshotAvailable: true,
    }
    const h = mount(
      <DrawingPreviewCard drawing={drawing} onClear={() => {}} visionCapable={true} />,
    )
    const trigger = h.container.querySelector(
      'button[aria-label="Ampliar previsualización del dibujo"]',
    ) as HTMLButtonElement
    act(() => trigger.click())
    const closeBtn = document.querySelector(
      '[data-testid="zoom-close"]',
    ) as HTMLButtonElement | null
    expect(closeBtn).not.toBeNull()
    act(() => closeBtn!.click())
    expect(document.querySelector('[data-testid="zoom-modal"]')).toBeNull()
    h.unmount()
  })

  it('thumbnail honors the viewport aspect ratio inline', () => {
    const drawing: DrawnPayload = {
      ...baseDrawing,
      compositePng: {
        data: 'Z'.repeat(7000),
        mediaType: 'image/png',
        width: 1280,
        height: 720,
      },
      screenshotAvailable: true,
    }
    const h = mount(
      <DrawingPreviewCard drawing={drawing} onClear={() => {}} visionCapable={true} />,
    )
    const btn = h.container.querySelector(
      'button[aria-label="Ampliar previsualización del dibujo"]',
    ) as HTMLButtonElement
    // jsdom normalizes `aspectRatio: '1.77'` to `'1.77 / 1'`; either spelling
    // is fine — the contract is that the inline aspect-ratio is a numeric ratio
    // tied to the viewport, not a Tailwind class.
    expect(btn.style.aspectRatio).toMatch(/^[0-9.]+(\s*\/\s*[0-9.]+)?$/)
    h.unmount()
  })

  it('calls onClear when the X button is clicked', () => {
    const onClear = vi.fn()
    const h = mount(
      <DrawingPreviewCard drawing={baseDrawing} onClear={onClear} visionCapable={true} />,
    )
    const closeBtn = h.container.querySelector(
      'button[aria-label="Descartar dibujo"]',
    ) as HTMLButtonElement | null
    expect(closeBtn).not.toBeNull()
    act(() => {
      closeBtn!.click()
    })
    expect(onClear).toHaveBeenCalledTimes(1)
    h.unmount()
  })
})
