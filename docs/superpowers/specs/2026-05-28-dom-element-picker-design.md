# DOM element picker — design

Status: approved (2026-05-28)
Scope: single iteration, single sub-project.

## Goal

Add a devtools-style element picker to the Picanthon side panel: the user clicks
a 🎯 button, the cursor turns into a crosshair on the page, hovering highlights
the element under the cursor, and clicking pins that element. The pinned
element is then injected into the agent's context every turn so the user can
say "hacelo más oscuro" and the agent knows what "this" refers to.

## Non-goals

- Persisting the pin across reloads or side-panel close (it's "focus" state, like
  devtools).
- Multiple simultaneous pins.
- Strict scope enforcement (rejecting tweaks outside the pinned subtree).
- Re-validating the selector every turn — if the SPA repainted and the selector
  no longer resolves, `apply_tweaks` will surface the error.
- Highlighting the pinned element permanently on the page (only during picking).

## Architecture

```
side panel ──START_PICK──▶ content script (ISOLATED)
                              │
                              ▼
                          picker.ts: overlay (Shadow DOM host)
                              + mousemove / click / keydown listeners
                              │
side panel ◀──PickedElement── │  (resolves the START_PICK promise)
   │
   ▼
 React state: pinnedElement
   │
   ├──▶ Card above the prompt textarea (selector chip + ×)
   └──▶ chat-transport: includes pin in the agent context per turn
            │
            ▼
        agent.ts: prepends <focused_element> block to instructions
```

### New module: `src/content/picker.ts`

Pure DOM module (testable under jsdom). Exports:

```ts
export interface PickedElement {
  selector: string
  tag: string
  outerHTML: string
  computedStyles: Record<string, string>
  boundingBox: { x: number; y: number; width: number; height: number }
  text?: string
}

// Starts pick mode. Resolves with the picked element, or null if cancelled.
// Only one pick session can be active at a time (re-calling cancels the prior).
export function startPick(): Promise<PickedElement | null>

// Explicit cancel (called from CANCEL_PICK handler).
export function cancelPick(): void
```

Implementation notes:

- Mounts a single `<div>` host on `document.body` with a Shadow DOM (`mode: 'open'`)
  containing two elements:
  - An outline rectangle positioned via `transform: translate(x,y)` and explicit
    `width`/`height` matching the hovered element's bounding box. Style:
    `outline: 2px solid rgba(239,68,68,.9); background: rgba(239,68,68,.1);
    pointer-events: none; position: fixed`.
  - A label (`position: fixed`, top-left of the rectangle) showing
    `<tag>{role/id}` + truncated selector + `WxH`.
- Sets `document.body.style.cursor = 'crosshair'` while active; restores on exit.
- Listeners attached with `capture: true` on `document`:
  - `mousemove` → `document.elementFromPoint(x, y)`, skipping the overlay host
    via `el.closest('[data-picanthon-picker]')` check.
  - `click` → captures the current target, calls `preventDefault()` +
    `stopImmediatePropagation()`, resolves the promise.
  - `keydown` → if `key === 'Escape'`, cancels.
  - `mousedown` + `mouseup` also intercepted (preventDefault + stopImmediatePropagation)
    so sites that listen on mousedown in capture don't see the click.

### Payload extraction

When the user clicks:

```ts
function extract(el: Element): PickedElement {
  const rect = el.getBoundingClientRect()
  const styles = getComputedStyle(el)
  const computedStyles: Record<string, string> = {}
  for (const prop of styles) {
    const v = styles.getPropertyValue(prop)
    if (v !== '') computedStyles[prop] = v   // drop empties (~half of the 400+ props)
  }
  let outerHTML = el.outerHTML
  if (outerHTML.length > 50_000) {
    outerHTML = outerHTML.slice(0, 50_000) + '… [truncated]'
  }
  const stylesJson = JSON.stringify(computedStyles, null, 2)
  // If still huge, drop the lowest-signal props (custom --vars first, then anything
  // matching default values would be ideal — for v1, just hard-truncate the JSON).
  return {
    selector: cssPath(el),               // reuse src/content/page-context.ts
    tag: el.tagName.toLowerCase(),
    outerHTML,
    computedStyles,
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    text: truncate(el.textContent ?? '', 200) || undefined,
  }
}
```

### Messaging additions (`src/lib/messaging.ts`)

```ts
export interface StartPickMsg { type: 'START_PICK' }
export interface CancelPickMsg { type: 'CANCEL_PICK' }
// Response to START_PICK is PickedElement | { cancelled: true }
```

Added to the `Message` union. `sendToActiveTab<PickedElement | { cancelled: true }>`.

### Content script handler (`src/content/index.ts`)

```ts
case 'START_PICK':
  startPick().then((picked) => sendResponse(picked ?? { cancelled: true }))
  return true
case 'CANCEL_PICK':
  cancelPick()
  sendResponse({ ok: true })
  return true
```

### Side panel state + UI (`src/sidepanel/App.tsx`)

- New React state in `Chat`: `const [pinned, setPinned] = useState<PickedElement | null>(null)`.
- Pass `pinned` to `createChatTransport({ ..., pinned })` via `useMemo` deps — the
  transport rebuilds when the pin changes, so the next agent call sees it.
- New component `PinnedElementCard` rendered above `PromptInput`:
  - Visible only when `pinned !== null`.
  - Layout: `🎯 <tag>.<short-selector>  ·  WxH        ×`
  - `×` calls `setPinned(null)`.
- New button in `PromptInputToolbar` (next to Submit):
  - Icon: crosshair (lucide-style inline SVG, no new dep).
  - Active state when a pick is in progress.
  - On click: `sendToActiveTab({ type: 'START_PICK' })`, set local `picking = true`,
    on resolve set `pinned` (or leave unchanged if cancelled). If clicked again
    while picking, sends `CANCEL_PICK`.
- Clear pin on tab navigation: register a `chrome.tabs.onUpdated` listener (in a
  `useEffect`) and `setPinned(null)` when the active tab's URL changes or status
  goes to `loading`.

### Agent context injection (`src/lib/agent.ts` + `src/lib/chat-transport.ts`)

- `chat-transport.ts`: accept `pinned: PickedElement | null` in the settings/options
  passed to `createChatTransport`. Forward into the agent call.
- `agent.ts`: if `pinned` is set, prepend the following block to `instructions`:

```
<focused_element>
The user has focused the following element on the page. Treat any deictic
reference ("this", "esto", "este botón") as referring to it. Prefer this
exact selector when generating apply_tweaks ops.

selector: {selector}
tag: {tag}
boundingBox: {width}x{height} at ({x},{y})
text: {text}

outerHTML:
{outerHTML}

computedStyles:
{JSON.stringify(computedStyles, null, 2)}
</focused_element>
```

Hard cap after serialization: if the rendered block exceeds 80_000 chars, trim
the `computedStyles` JSON to the first 60_000 chars (outerHTML is the more
load-bearing signal — preserve it).

## User flow

1. User opens the side panel on a page with several components.
2. Clicks the 🎯 button. The cursor on the page turns to crosshair; hovering shows
   a red outline + label.
3. Clicks a `<table>`. The card appears above the prompt: `🎯 table  ·  640×280  ×`.
4. Types "convertilo en una shadcn data-table oscura". The agent receives the
   `<focused_element>` block and immediately knows the selector + structure +
   styling. It calls `replace_component` (or `design_component`) with that exact
   selector.
5. After the change, the user can keep iterating — the pin stays. To switch
   focus, they pick again. To clear, they click `×`.
6. If the user navigates the tab elsewhere, the pin is auto-cleared.

## Edge cases

- **Click on `<a target="_blank">`**: neutralized by `preventDefault` on
  `mousedown` + `click` with `capture: true`.
- **Picking inside an extension-mounted Shadow DOM**: detected via
  `el.closest('[data-picanthon-mount]')` (the existing replace-component host
  carries this attribute today; if not, add it). We allow it — the agent can act
  on its own replacement.
- **Picking the overlay itself**: prevented because `mousemove` skips elements
  whose ancestor chain includes the picker host (`[data-picanthon-picker]`).
- **Picking nothing useful (`<html>` / `<body>`)**: allowed; the agent decides.
- **Scrolling during pick**: allowed — we don't block wheel events. The overlay
  is `position: fixed` and follows the cursor naturally.
- **Tab without content script** (e.g. `chrome://`): `sendToActiveTab` throws;
  the picker button surfaces a tiny inline error toast.

## Testing

New file: `src/content/picker.test.ts` (vitest + jsdom):

- Overlay mounts on `startPick()` and is removed on resolve / cancel / ESC.
- `mousemove` over a tracked element updates the overlay rect.
- `elementFromPoint` skips the overlay host (the overlay never picks itself).
- `ESC` resolves with `null`.
- Click resolves with a `PickedElement` whose `selector` resolves back to the
  same element via `document.querySelector`.
- `outerHTML` longer than 50_000 chars is truncated and ends with `… [truncated]`.
- `computedStyles` excludes empty-string values.
- Calling `startPick()` while already picking cancels the prior session.

Extension to `src/lib/agent.test.ts` (or new test alongside): when `pinned` is
present, the rendered instructions contain `<focused_element>` with the given
selector. When absent, no such block appears.

No changes needed in `mount.test.ts`, `tweaks.test.ts`, `persistence.test.ts`,
`page-context.test.ts`, or `correlation.test.ts`.

## Files touched

| File | Change |
| --- | --- |
| `src/content/picker.ts` | **new** — overlay + listeners + payload extraction |
| `src/content/picker.test.ts` | **new** — tests above |
| `src/lib/messaging.ts` | add `StartPickMsg`, `CancelPickMsg`, `PickedElement` |
| `src/content/index.ts` | handlers for `START_PICK` / `CANCEL_PICK` |
| `src/sidepanel/App.tsx` | pin state, card, toolbar button, tab-change listener |
| `src/sidepanel/ai-elements/prompt-input.tsx` | (maybe) extend `PromptInputToolbar` slot |
| `src/lib/chat-transport.ts` | accept and forward `pinned` |
| `src/lib/agent.ts` | prepend `<focused_element>` block when `pinned` set |
| `src/lib/agent.test.ts` | assertion on the injected block |

## Risks and YAGNI cuts

- **Largest unknown**: some sites use very aggressive event capture
  (`mousedown` listeners at `window` level with `capture: true`). The plan adds
  capture-phase listeners on `document` for `mousedown` / `mouseup` / `click`
  with `preventDefault` + `stopImmediatePropagation`. If a real site still
  triggers (e.g. closes a menu we want to inspect), we'd later add
  `pointerdown` interception too — but not in v1.
- **No persistence of the pin**: matches devtools semantics; revisit only if
  users complain.
- **No scope enforcement**: explicitly rejected — the agent is smart enough to
  use the selector, and constraining `apply_tweaks` to a subtree adds a special
  case to a tool that today operates by selector only.

## Done criteria

- `npm test` passes (existing + new tests).
- `npm run build` produces a working `dist/` loaded in Chrome.
- Manual smoke: open any page, click 🎯, hover, click a button, see card,
  type "hacelo rojo", verify the agent's `apply_tweaks` targets that exact
  selector.
