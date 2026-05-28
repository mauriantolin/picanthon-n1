// Typed message protocol between the extension contexts. The agent runs in the
// side panel (DirectChatTransport) and talks to the content script directly via
// chrome.tabs.sendMessage. The content script, in turn, talks to the MAIN-world
// network recorder via window.postMessage (see net-bridge.ts).

import type { Tweak } from './tweaks'

// A JSON response the page already received, captured by the MAIN-world recorder.
export interface NetworkCapture {
  id: number
  url: string
  method: string
  status: number
  contentType?: string
  json?: unknown
  ts: number
}

// A notable semantic element (heading, button, link, form input, image…).
// Kept as the secondary list the model can target by selector.
export interface ElementInfo {
  selector: string
  tag: string
  role?: string
  text?: string
}

// A container whose direct children repeat the same tag (≥3). The atomic unit
// of any feed/grid/list/timeline, regardless of how the host site names things.
export interface RepeaterInfo {
  selector: string
  containerTag: string
  childTag: string
  childCount: number
  layout: LayoutInfo
  bbox: BBox
  // outerHTML of a prototypical child, truncated + stripped of noisy long
  // attributes (style, srcset, long data-*). Gives the model the shape of one
  // item without paying for N copies.
  childSample: string
}

// A large or sticky/fixed region that frames the page — header, sidebar, footer,
// global nav. Heuristically detected. Listed so the model knows "this is the
// shell; don't override its layout casually".
export interface ShellRegion {
  selector: string
  tag: string
  role: 'header' | 'nav' | 'sidebar' | 'footer' | 'sticky' | 'fixed' | 'region'
  bbox: BBox
  layout: LayoutInfo
}

// One of the top-level content regions of the page (descendants of <main> or
// large block children of <body>). Helps the model orient: "this section is the
// content area; that other one is the sidebar".
export interface RegionInfo {
  selector: string
  tag: string
  bbox: BBox
  layout: LayoutInfo
}

export interface LayoutInfo {
  // 'grid 4x', 'flex-row', 'flex-col', 'block', 'inline', etc.
  display: string
  columns?: number
  direction?: 'row' | 'column'
  gapPx?: number
}

export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

export interface PageSnapshot {
  url: string
  title: string
  viewport: { width: number; height: number }
  outline: string
  shell: ShellRegion[]
  regions: RegionInfo[]
  repeaters: RepeaterInfo[]
  elements: ElementInfo[]
}

// Payload returned by the page picker. The selector resolves to this element
// at pick time; it may become stale later if the page repaints.
export interface PickedElement {
  selector: string
  tag: string
  outerHTML: string
  computedStyles: Record<string, string>
  boundingBox: { x: number; y: number; width: number; height: number }
  text?: string
}

// Result returned from START_PICK: the picked element, or { cancelled: true }
// if the user pressed ESC or the picker was cancelled programmatically.
export type PickResult = PickedElement | { cancelled: true }

// One element that the user's strokes intersected, with coverage in [0..1].
export interface DrawnElement {
  selector: string
  tag: string
  coverage: number
}

// Bounding box of all strokes in viewport coordinates.
export interface StrokesBBox {
  x: number
  y: number
  width: number
  height: number
}

// Payload returned by the scribble overlay when the user confirms.
// `compositePng` and `screenshotAvailable` are filled in later by the side
// panel after `chrome.tabs.captureVisibleTab` + `compositeWithStrokes`.
// Both fields are optional so the content script (which can't reach
// chrome.tabs) can still produce a valid payload synchronously.
export interface DrawnPayload {
  strokesPng: string // base64, no `data:` prefix
  bbox: StrokesBBox
  viewport: { width: number; height: number }
  coveredElements: DrawnElement[]
  compositePng?: {
    data: string // base64, no `data:` prefix
    mediaType: 'image/png' | 'image/jpeg'
    width: number
    height: number
  }
  screenshotAvailable?: boolean
}

export type DrawResult = DrawnPayload | { cancelled: true }

// side panel -> content
export interface GetSnapshotMsg {
  type: 'GET_SNAPSHOT'
}
export interface ApplyTweaksMsg {
  type: 'APPLY_TWEAKS'
  tweaks: Tweak[]
}
export interface GetNetworkCaptureMsg {
  type: 'GET_NETWORK_CAPTURE'
}
export interface ClearTweaksMsg {
  type: 'CLEAR_TWEAKS'
}
export interface StartPickMsg {
  type: 'START_PICK'
}
export interface CancelPickMsg {
  type: 'CANCEL_PICK'
}
export interface StartDrawMsg {
  type: 'START_DRAW'
}
export interface CancelDrawMsg {
  type: 'CANCEL_DRAW'
}

// Full-page screenshot pipeline. The side panel orchestrates the loop
// (chrome.tabs.captureVisibleTab is only callable from there); the content
// script reports page dimensions and performs synchronized scrolls.
export interface BeginFullCaptureMsg {
  type: 'BEGIN_FULL_CAPTURE'
}
export interface ScrollToMsg {
  type: 'SCROLL_TO'
  y: number
}
export interface EndFullCaptureMsg {
  type: 'END_FULL_CAPTURE'
  restoreY: number
}

export interface FullCaptureDims {
  pageWidth: number
  pageHeight: number
  viewportWidth: number
  viewportHeight: number
  originalScrollY: number
}

export interface ScrollToResult {
  actualY: number
}

// Inject the Tailwind Play CDN once per page so the LLM can use ANY Tailwind
// class (including arbitrary variants like `[&>ul]:grid`) — the page's
// server-compiled CSS only contains the classes that were in the original
// codebase, so without the runtime any novel utility we set via setAttr
// would be a no-op.
export interface EnsureTailwindRuntimeMsg {
  type: 'ENSURE_TAILWIND_RUNTIME'
}

export interface TailwindRuntimeResult {
  ok: boolean
  alreadyPresent?: boolean
  error?: string
}

// Re-inspect a set of selectors AFTER tweaks were applied. Returns the same
// shape (layout + bbox + childCount + childSample) for each one. The model uses
// this together with the screenshot to verify the change actually worked.
export interface CaptureAffectedMsg {
  type: 'CAPTURE_AFFECTED'
  selectors: string[]
}

// A WCAG contrast failure detected inside an affected element. Used by the
// model to decide whether the AFTER state is actually legible — failing this
// check is a hard "must call apply_tweaks again" signal, not a hint.
export interface ContrastIssue {
  text: string
  fg: string
  bg: string
  ratio: number
  wcag: 'AA-fail' | 'AAA-fail'
}

// Per-selector post-tweak observation. childCount / childSample are present
// when the element is a container (any element with children). contrastIssues
// is populated when text inside the affected element fails WCAG AA.
export interface AffectedElement {
  selector: string
  found: boolean
  tag?: string
  bbox?: BBox
  layout?: LayoutInfo
  childCount?: number
  childSample?: string
  text?: string
  contrastIssues?: ContrastIssue[]
}

export type Message =
  | GetSnapshotMsg
  | ApplyTweaksMsg
  | GetNetworkCaptureMsg
  | ClearTweaksMsg
  | StartPickMsg
  | CancelPickMsg
  | StartDrawMsg
  | CancelDrawMsg
  | CaptureAffectedMsg
  | BeginFullCaptureMsg
  | ScrollToMsg
  | EndFullCaptureMsg
  | EnsureTailwindRuntimeMsg

// Sends a message to the content script of the active tab and resolves with its
// response. If the content script isn't loaded yet (tab opened pre-install,
// extension just updated, …) Chrome rejects with "Could not establish
// connection. Receiving end does not exist." — in that case we inject the
// content scripts on-demand via chrome.scripting and retry once.
export async function sendToActiveTab<R = unknown>(msg: Message): Promise<R> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('No hay una pestaña activa para modificar.')
  if (!isInjectableUrl(tab.url)) {
    throw new Error(
      `Esta pestaña no permite extensiones (${tab.url ?? 'URL desconocida'}). Abrí una página HTTP/HTTPS/file y reintentá.`,
    )
  }
  try {
    return (await chrome.tabs.sendMessage(tab.id, msg)) as R
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!/Could not establish connection|Receiving end does not exist/i.test(message)) {
      throw err
    }
    await ensureContentScript(tab.id)
    return (await chrome.tabs.sendMessage(tab.id, msg)) as R
  }
}

function isInjectableUrl(url: string | undefined): boolean {
  if (!url) return true
  return /^(https?:|file:)/i.test(url)
}

// Inject every content_script entry declared in the manifest into the target
// tab. Idempotent enough in practice — re-injecting just re-runs the script,
// which only adds another onMessage listener; that's fine because each
// listener short-circuits when its branch doesn't match.
async function ensureContentScript(tabId: number): Promise<void> {
  const manifest = chrome.runtime.getManifest()
  const scripts = manifest.content_scripts ?? []
  for (const cs of scripts) {
    if (!cs.js?.length) continue
    const world = (cs as { world?: 'MAIN' | 'ISOLATED' }).world ?? 'ISOLATED'
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: cs.js,
        world,
      })
    } catch (err) {
      console.warn('[picanthon] ensureContentScript failed for', cs.js, err)
    }
  }
}
