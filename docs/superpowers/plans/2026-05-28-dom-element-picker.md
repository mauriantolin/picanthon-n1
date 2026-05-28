# DOM element picker — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a devtools-style element picker. The user clicks a 🎯 button in the side panel, hovers the page, clicks an element. That element gets pinned and is injected into the agent's context every turn so the user can iterate on it with deictic prompts ("hacelo más oscuro").

**Architecture:** New `src/content/picker.ts` module mounts a Shadow-DOM overlay on the page and resolves a `PickedElement` payload (selector + outerHTML + computedStyles + bbox) on click. The side panel keeps the pin in React state and threads it through `createChatTransport` → `buildAgent` → a `<focused_element>` block prepended to the agent instructions.

**Tech stack:** TypeScript, React 18, Vite + crxjs, vitest + jsdom, AI SDK `ToolLoopAgent`. Chrome MV3 content scripts (ISOLATED world).

**Spec:** `docs/superpowers/specs/2026-05-28-dom-element-picker-design.md`

**Conventions:**
- Project is not a git repository (verified). The Commit steps below are written as `git add … && git commit -m …` per the template, but the executor should skip them if `git rev-parse` fails. No `Co-Authored-By: Claude` lines under any circumstance (user convention).
- Tests run with `npm test` (vitest in `run` mode, exits when done — no watch).
- Typecheck with `npm run typecheck`.
- Existing snake-case-free conventions: camelCase for variables, PascalCase for React, no comments explaining *what* code does, only *why* when non-obvious.

---

## File structure

| File | Responsibility | Status |
| --- | --- | --- |
| `src/lib/messaging.ts` | Add `StartPickMsg`, `CancelPickMsg`, `PickedElement` interface | modify |
| `src/content/picker.ts` | Overlay + listeners + payload extraction | create |
| `src/content/picker.test.ts` | Unit tests under jsdom | create |
| `src/content/index.ts` | Wire `START_PICK` / `CANCEL_PICK` handlers | modify |
| `src/lib/agent.ts` | Accept optional `pinned`, prepend `<focused_element>` block | modify |
| `src/lib/agent.test.ts` | Assert that the block is/isn't injected | create |
| `src/lib/chat-transport.ts` | Forward `pinned` from settings to `buildAgent` | modify |
| `src/sidepanel/App.tsx` | Pin state, card, picker button, tab-change auto-clear | modify |

The cssPath helper in `src/content/page-context.ts` is reused as-is. The mount-host attribute (`data-picanthon="mount"`) already exists; we reuse the same convention for the picker overlay (`data-picanthon="picker"`).

---

## Task 1: Add messaging types for the picker

**Files:**
- Modify: `src/lib/messaging.ts`

- [ ] **Step 1: Add the `PickedElement` interface and message types**

Insert after the `ReplaceResult` interface (around line 41) and add to the `Message` union:

```ts
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
```

Inside the `// side panel -> content` section add:

```ts
export interface StartPickMsg {
  type: 'START_PICK'
}
export interface CancelPickMsg {
  type: 'CANCEL_PICK'
}
```

Extend the `Message` union:

```ts
export type Message =
  | GetSnapshotMsg
  | ApplyTweaksMsg
  | GetNetworkCaptureMsg
  | ReplaceComponentMsg
  | ClearTweaksMsg
  | GetElementDataMsg
  | MountHtmlMsg
  | StartPickMsg
  | CancelPickMsg
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no compilation errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/messaging.ts
git commit -m "feat(messaging): add picker message types"
```
Skip if not a git repo.

---

## Task 2: Picker — overlay mount + unmount lifecycle

**Files:**
- Create: `src/content/picker.ts`
- Create: `src/content/picker.test.ts`

- [ ] **Step 1: Write the failing test for overlay lifecycle**

Create `src/content/picker.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { startPick, cancelPick } from './picker'

afterEach(() => {
  // belt-and-braces: ensure no leftover overlay between tests
  cancelPick()
  document.body.innerHTML = ''
  document.body.style.cursor = ''
  vi.useRealTimers()
})

function pickerHost(): HTMLElement | null {
  return document.querySelector('[data-picanthon="picker"]')
}

describe('picker overlay lifecycle', () => {
  it('mounts a Shadow DOM host while picking and removes it on cancel', () => {
    expect(pickerHost()).toBeNull()
    const promise = startPick()
    expect(pickerHost()).not.toBeNull()
    expect(pickerHost()!.shadowRoot).not.toBeNull()
    cancelPick()
    return promise.then((result) => {
      expect(result).toEqual({ cancelled: true })
      expect(pickerHost()).toBeNull()
    })
  })

  it('sets and restores the body cursor', () => {
    document.body.style.cursor = 'auto'
    const promise = startPick()
    expect(document.body.style.cursor).toBe('crosshair')
    cancelPick()
    return promise.then(() => {
      expect(document.body.style.cursor).toBe('auto')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/content/picker.test.ts`
Expected: FAIL — "Cannot find module './picker'".

- [ ] **Step 3: Create the minimal picker module**

Create `src/content/picker.ts`:

```ts
// Devtools-style element picker. Mounts a Shadow-DOM overlay on the page, lets
// the user hover and click an element, and resolves with the selected element's
// stable selector + outerHTML + computedStyles. No chrome.* here — this is a
// pure DOM module so it stays unit-testable under jsdom.

import type { PickedElement, PickResult } from '@/lib/messaging'
import { cssPath } from './page-context'

const PICKER_ATTR = 'data-picanthon'
const PICKER_VALUE = 'picker'

interface ActiveSession {
  host: HTMLElement
  resolve: (result: PickResult) => void
  previousCursor: string
  detach: () => void
}

let active: ActiveSession | null = null

export function startPick(): Promise<PickResult> {
  // If a session is already active, cancel it before starting a new one. The
  // previous promise resolves with { cancelled: true }.
  if (active) cancelPick()

  return new Promise<PickResult>((resolve) => {
    const host = document.createElement('div')
    host.setAttribute(PICKER_ATTR, PICKER_VALUE)
    host.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:2147483647;'
    host.attachShadow({ mode: 'open' })
    document.body.appendChild(host)

    const previousCursor = document.body.style.cursor
    document.body.style.cursor = 'crosshair'

    const detach = () => {
      host.remove()
      document.body.style.cursor = previousCursor
      active = null
    }

    active = { host, resolve, previousCursor, detach }
  })
}

export function cancelPick(): void {
  if (!active) return
  const { resolve, detach } = active
  detach()
  resolve({ cancelled: true })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/content/picker.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/content/picker.ts src/content/picker.test.ts
git commit -m "feat(picker): overlay mount and cancel"
```
Skip if not a git repo.

---

## Task 3: Picker — ESC cancels the session

**Files:**
- Modify: `src/content/picker.ts`
- Modify: `src/content/picker.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/content/picker.test.ts`:

```ts
describe('picker ESC cancellation', () => {
  it('resolves with { cancelled: true } when Escape is pressed', async () => {
    const promise = startPick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await expect(promise).resolves.toEqual({ cancelled: true })
    expect(pickerHost()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/content/picker.test.ts`
Expected: FAIL on the ESC test (timeout or never resolves).

- [ ] **Step 3: Wire ESC handling in `startPick`**

Replace the body of the `new Promise(...)` in `src/content/picker.ts` with:

```ts
return new Promise<PickResult>((resolve) => {
  const host = document.createElement('div')
  host.setAttribute(PICKER_ATTR, PICKER_VALUE)
  host.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483647;'
  host.attachShadow({ mode: 'open' })
  document.body.appendChild(host)

  const previousCursor = document.body.style.cursor
  document.body.style.cursor = 'crosshair'

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopImmediatePropagation()
      cancelPick()
    }
  }
  document.addEventListener('keydown', onKeyDown, true)

  const detach = () => {
    document.removeEventListener('keydown', onKeyDown, true)
    host.remove()
    document.body.style.cursor = previousCursor
    active = null
  }

  active = { host, resolve, previousCursor, detach }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/content/picker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/content/picker.ts src/content/picker.test.ts
git commit -m "feat(picker): ESC cancels picking"
```
Skip if not a git repo.

---

## Task 4: Picker — click resolves with a PickedElement

**Files:**
- Modify: `src/content/picker.ts`
- Modify: `src/content/picker.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/content/picker.test.ts`:

```ts
describe('picker click extraction', () => {
  it('resolves with a PickedElement whose selector resolves back to the same node', async () => {
    document.body.innerHTML = `
      <main>
        <section id="hero">
          <h1>Hello</h1>
          <button class="cta">Buy</button>
        </section>
      </main>
    `
    const btn = document.querySelector('button.cta') as HTMLElement
    const promise = startPick()

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    const result = await promise

    expect('cancelled' in result).toBe(false)
    if ('cancelled' in result) return
    expect(result.tag).toBe('button')
    expect(result.text).toBe('Buy')
    expect(document.querySelector(result.selector)).toBe(btn)
    expect(result.outerHTML).toContain('Buy')
    expect(result.boundingBox).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })
  })

  it('prevents the page from receiving the click', async () => {
    document.body.innerHTML = `<a id="link" href="#after">Go</a>`
    const link = document.getElementById('link') as HTMLAnchorElement
    let pageSawClick = false
    link.addEventListener('click', () => {
      pageSawClick = true
    })
    const promise = startPick()
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    await promise
    expect(pageSawClick).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/content/picker.test.ts`
Expected: FAIL (the click tests time out — no click handler yet).

- [ ] **Step 3: Add the click handler + payload extraction**

In `src/content/picker.ts`, add helpers and hook the click listener. Final file:

```ts
import type { PickedElement, PickResult } from '@/lib/messaging'
import { cssPath } from './page-context'

const PICKER_ATTR = 'data-picanthon'
const PICKER_VALUE = 'picker'
const MAX_OUTER_HTML = 50_000

interface ActiveSession {
  host: HTMLElement
  resolve: (result: PickResult) => void
  previousCursor: string
  detach: () => void
}

let active: ActiveSession | null = null

export function startPick(): Promise<PickResult> {
  if (active) cancelPick()

  return new Promise<PickResult>((resolve) => {
    const host = document.createElement('div')
    host.setAttribute(PICKER_ATTR, PICKER_VALUE)
    host.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:2147483647;'
    host.attachShadow({ mode: 'open' })
    document.body.appendChild(host)

    const previousCursor = document.body.style.cursor
    document.body.style.cursor = 'crosshair'

    const finish = (result: PickResult) => {
      detach()
      resolve(result)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        finish({ cancelled: true })
      }
    }
    // Capture-phase swallow: stops the page from acting on the pick click.
    const swallow = (e: Event) => {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (!target || target.closest(`[${PICKER_ATTR}="${PICKER_VALUE}"]`)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      finish(extract(target))
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', swallow, true)
    document.addEventListener('mouseup', swallow, true)
    document.addEventListener('click', onClick, true)

    const detach = () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', swallow, true)
      document.removeEventListener('mouseup', swallow, true)
      document.removeEventListener('click', onClick, true)
      host.remove()
      document.body.style.cursor = previousCursor
      active = null
    }

    active = { host, resolve, previousCursor, detach }
  })
}

export function cancelPick(): void {
  if (!active) return
  const { resolve, detach } = active
  detach()
  resolve({ cancelled: true })
}

function extract(el: Element): PickedElement {
  const rect = el.getBoundingClientRect()
  const computedStyles = collectComputedStyles(el)
  let outerHTML = el.outerHTML
  if (outerHTML.length > MAX_OUTER_HTML) {
    outerHTML = outerHTML.slice(0, MAX_OUTER_HTML) + '… [truncated]'
  }
  const text = truncate(el.textContent ?? '', 200)
  return {
    selector: cssPath(el),
    tag: el.tagName.toLowerCase(),
    outerHTML,
    computedStyles,
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    text: text || undefined,
  }
}

function collectComputedStyles(el: Element): Record<string, string> {
  const styles = getComputedStyle(el)
  const out: Record<string, string> = {}
  for (let i = 0; i < styles.length; i++) {
    const prop = styles.item(i)
    const value = styles.getPropertyValue(prop)
    if (value !== '') out[prop] = value
  }
  return out
}

function truncate(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > n ? t.slice(0, n) + '…' : t
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/content/picker.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/content/picker.ts src/content/picker.test.ts
git commit -m "feat(picker): click resolves with PickedElement"
```
Skip if not a git repo.

---

## Task 5: Picker — outerHTML truncation cap

**Files:**
- Modify: `src/content/picker.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/content/picker.test.ts`:

```ts
describe('picker payload caps', () => {
  it('truncates outerHTML when it exceeds the 50KB cap', async () => {
    const big = 'x'.repeat(60_000)
    document.body.innerHTML = `<div id="big">${big}</div>`
    const promise = startPick()
    document.getElementById('big')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    const result = await promise
    if ('cancelled' in result) throw new Error('expected pick')
    expect(result.outerHTML.endsWith('… [truncated]')).toBe(true)
    expect(result.outerHTML.length).toBeLessThanOrEqual(50_000 + '… [truncated]'.length)
  })
})
```

- [ ] **Step 2: Run test to verify it passes (no impl change needed — Task 4 already capped)**

Run: `npx vitest run src/content/picker.test.ts`
Expected: PASS (6 tests).

The cap was implemented in Task 4 (`MAX_OUTER_HTML = 50_000`). This task only adds the regression test.

- [ ] **Step 3: Commit**

```bash
git add src/content/picker.test.ts
git commit -m "test(picker): regression test for outerHTML cap"
```
Skip if not a git repo.

---

## Task 6: Picker — computedStyles excludes empty values

**Files:**
- Modify: `src/content/picker.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/content/picker.test.ts`:

```ts
describe('picker computedStyles filter', () => {
  it('omits properties whose computed value is the empty string', async () => {
    document.body.innerHTML = `<div id="d" style="color: rgb(255, 0, 0);">x</div>`
    const promise = startPick()
    document.getElementById('d')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    const result = await promise
    if ('cancelled' in result) throw new Error('expected pick')
    for (const v of Object.values(result.computedStyles)) {
      expect(v).not.toBe('')
    }
    // jsdom returns this for inline styles
    expect(result.computedStyles.color).toBe('rgb(255, 0, 0)')
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/content/picker.test.ts`
Expected: PASS (7 tests). Filter was implemented in Task 4 (`if (value !== '')`).

- [ ] **Step 3: Commit**

```bash
git add src/content/picker.test.ts
git commit -m "test(picker): regression test for empty-style filter"
```
Skip if not a git repo.

---

## Task 7: Picker — starting twice cancels the prior session

**Files:**
- Modify: `src/content/picker.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/content/picker.test.ts`:

```ts
describe('picker concurrent sessions', () => {
  it('cancels a prior session when startPick is called again', async () => {
    document.body.innerHTML = `<button id="a">A</button><button id="b">B</button>`
    const first = startPick()
    const second = startPick()
    await expect(first).resolves.toEqual({ cancelled: true })

    document.getElementById('b')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    const result = await second
    if ('cancelled' in result) throw new Error('expected pick')
    expect(result.text).toBe('B')
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/content/picker.test.ts`
Expected: PASS (8 tests). Behavior already implemented in Task 4 (`if (active) cancelPick()` at the top of `startPick`).

- [ ] **Step 3: Commit**

```bash
git add src/content/picker.test.ts
git commit -m "test(picker): regression test for concurrent startPick"
```
Skip if not a git repo.

---

## Task 8: Wire picker into the content script

**Files:**
- Modify: `src/content/index.ts`

- [ ] **Step 1: Add the handler imports and switch cases**

In `src/content/index.ts`, add the import near the top with the other content imports:

```ts
import { cancelPick, startPick } from './picker'
```

Inside the `switch (msg.type)` block, add new cases (place them before the `default:`):

```ts
case 'START_PICK':
  startPick().then(sendResponse)
  return true // async response

case 'CANCEL_PICK':
  cancelPick()
  sendResponse({ ok: true })
  return true
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run all tests to make sure nothing regressed**

Run: `npm test`
Expected: PASS (existing + new picker tests).

- [ ] **Step 4: Commit**

```bash
git add src/content/index.ts
git commit -m "feat(content): wire START_PICK and CANCEL_PICK handlers"
```
Skip if not a git repo.

---

## Task 9: Agent — inject `<focused_element>` block when pinned

**Files:**
- Modify: `src/lib/agent.ts`
- Create: `src/lib/agent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderInstructions } from './agent'
import type { PageSnapshot, PickedElement } from './messaging'

const ctx: PageSnapshot = {
  url: 'https://example.com/',
  title: 'Example',
  outline: 'h1: Hello',
  elements: [],
}

const pin: PickedElement = {
  selector: 'button.cta',
  tag: 'button',
  outerHTML: '<button class="cta">Buy</button>',
  computedStyles: { color: 'rgb(255,0,0)' },
  boundingBox: { x: 0, y: 0, width: 100, height: 30 },
  text: 'Buy',
}

describe('renderInstructions', () => {
  it('does not include a focused_element block when pinned is null', () => {
    const out = renderInstructions(ctx, null)
    expect(out).not.toContain('<focused_element>')
  })

  it('prepends a focused_element block when pinned is present', () => {
    const out = renderInstructions(ctx, pin)
    expect(out.indexOf('<focused_element>')).toBeLessThan(out.indexOf('PAGE CONTEXT'))
    expect(out).toContain('selector: button.cta')
    expect(out).toContain('<button class="cta">Buy</button>')
    expect(out).toContain('"color": "rgb(255,0,0)"')
  })

  it('truncates a huge computedStyles JSON to keep the block bounded', () => {
    const big: Record<string, string> = {}
    for (let i = 0; i < 5000; i++) big[`prop-${i}`] = 'x'.repeat(50)
    const out = renderInstructions(ctx, { ...pin, computedStyles: big })
    expect(out.length).toBeLessThan(150_000) // safety bound
    expect(out).toContain('… [truncated]')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/agent.test.ts`
Expected: FAIL — `renderInstructions` is not exported.

- [ ] **Step 3: Refactor `agent.ts` to export `renderInstructions` and accept `pinned`**

Replace the body of `src/lib/agent.ts` with:

```ts
// The Picanthon agent: a ToolLoopAgent that modifies the live page. It handles
// two kinds of request:
//   • styling/visual  -> plan_design (concrete brief) then apply_tweaks
//   • component swap   -> search_shadcn_docs then replace_component (reuses data)
// It runs in the side panel and is consumed by useChat via the transport.

import { ToolLoopAgent, stepCountIs, type InferAgentUIMessage, type LanguageModel } from 'ai'
import { buildTools } from './agent-tools'
import { formatContext } from './design'
import type { PageSnapshot, PickedElement } from './messaging'

const MAX_STYLES_JSON = 60_000

export function renderInstructions(
  context: PageSnapshot,
  pinned: PickedElement | null,
): string {
  const focus = pinned ? renderFocusedBlock(pinned) : ''
  return `${focus}You are Picanthon, an agent that modifies the user's current web page live, without touching its source.

Decide the request type and follow the matching workflow:

1) VISUAL / STYLING ("make it look like X", "dark mode", "improve hierarchy"):
   - Call plan_design first to commit to a concrete, consistent design (palette, scales, specific changes).
   - Then call apply_tweaks with tweaks that realize the brief. Reuse the brief's palette/values consistently.

2) COMPONENT REPLACEMENT, standard shadcn look ("turn this table into a shadcn table"):
   - Call search_shadcn_docs to find a matching component id.
   - Optionally call query_network_capture to see what data backs the element.
   - Call replace_component with the target selector and the component id. It reuses the page's real data.

3) COMPONENT REPLACEMENT, custom look ("make this table look like X", any non-shadcn / specific visual style):
   - Call design_component with the target selector and a free-form style brief.
   - A self-contained HTML+CSS fragment is generated through the same Gateway model and mounted (sanitized, in a Shadow DOM) with the page's real data. Use this when the user wants a particular aesthetic rather than the default shadcn style.

Rules:
- Use ONLY selectors that appear in the PAGE CONTEXT below. Never invent selectors.
- Keep changes minimal and targeted.
- After acting, briefly tell the user what changed (in their language). Report counts / data source when relevant.

PAGE CONTEXT:
${formatContext(context)}`
}

function renderFocusedBlock(pin: PickedElement): string {
  let stylesJson = JSON.stringify(pin.computedStyles, null, 2)
  if (stylesJson.length > MAX_STYLES_JSON) {
    stylesJson = stylesJson.slice(0, MAX_STYLES_JSON) + '\n… [truncated]'
  }
  const { x, y, width, height } = pin.boundingBox
  return `<focused_element>
The user has focused the following element on the page. Treat any deictic
reference ("this", "esto", "este botón") as referring to it. Prefer this
exact selector when generating apply_tweaks ops.

selector: ${pin.selector}
tag: ${pin.tag}
boundingBox: ${Math.round(width)}x${Math.round(height)} at (${Math.round(x)},${Math.round(y)})
text: ${pin.text ?? ''}

outerHTML:
${pin.outerHTML}

computedStyles:
${stylesJson}
</focused_element>

`
}

export function buildAgent(
  model: LanguageModel,
  context: PageSnapshot,
  pinned: PickedElement | null = null,
) {
  return new ToolLoopAgent({
    model,
    instructions: renderInstructions(context, pinned),
    tools: buildTools(model, context),
    stopWhen: stepCountIs(12),
    providerOptions: {
      // `display: 'summarized'` is required for the model to stream reasoning
      // text — without it, thinking blocks come back empty.
      anthropic: { thinking: { type: 'adaptive', display: 'summarized' } },
    },
  })
}

// Stable UIMessage type for useChat. Tool names/shapes are fixed, so the type is
// stable regardless of the per-message model/context.
export type PicanthonAgent = ReturnType<typeof buildAgent>
export type PicanthonUIMessage = InferAgentUIMessage<PicanthonAgent>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/agent.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run all tests to confirm no regression**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent.ts src/lib/agent.test.ts
git commit -m "feat(agent): inject focused_element block when pinned"
```
Skip if not a git repo.

---

## Task 10: Thread `pinned` through `chat-transport`

**Files:**
- Modify: `src/lib/chat-transport.ts`

- [ ] **Step 1: Accept `pinned` in `createChatTransport`**

Update the signature and pass through to `buildAgent`. Replace lines 19–48 of `src/lib/chat-transport.ts` with:

```ts
export function createChatTransport(
  settings: Settings,
  pinned: PickedElement | null = null,
): ChatTransport<PicanthonUIMessage> {
  if (!settings.apiKey) return new MockChatTransport()
  return new PicanthonChatTransport(settings, pinned)
}

class PicanthonChatTransport implements ChatTransport<PicanthonUIMessage> {
  constructor(
    private readonly settings: Settings,
    private readonly pinned: PickedElement | null,
  ) {}

  async sendMessages({
    messages,
    abortSignal,
  }: Parameters<ChatTransport<PicanthonUIMessage>['sendMessages']>[0]) {
    const model = buildModel(this.settings.apiKey, this.settings.model)
    const context = await sendToActiveTab<PageSnapshot>({ type: 'GET_SNAPSHOT' })
    const agent = buildAgent(model, context, this.pinned)

    const validated = await validateUIMessages<PicanthonUIMessage>({
      messages,
      tools: agent.tools,
    })
    const prompt = await convertToModelMessages(validated, { tools: agent.tools })

    const result = await agent.stream({ prompt, abortSignal })
    return result.toUIMessageStream({ sendReasoning: true })
  }

  async reconnectToStream() {
    return null
  }
}
```

Update the imports at the top of the file to include `PickedElement`:

```ts
import { sendToActiveTab, type PageSnapshot, type PickedElement } from './messaging'
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chat-transport.ts
git commit -m "feat(chat-transport): forward pinned element to agent"
```
Skip if not a git repo.

---

## Task 11: Side panel — pin state + picker button in the toolbar

**Files:**
- Modify: `src/sidepanel/App.tsx`

- [ ] **Step 1: Add `pinned` state, picker handler, and thread it into the transport**

In `src/sidepanel/App.tsx`, update the imports:

```ts
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useChat } from '@ai-sdk/react'
import { isToolUIPart } from 'ai'
import { getSettings, saveSettings, type Settings } from '@/lib/settings'
import { sendToActiveTab, type PickedElement, type PickResult } from '@/lib/messaging'
import { createChatTransport } from '@/lib/chat-transport'
import type { PicanthonUIMessage } from '@/lib/agent'
```

Replace the `Chat` component (currently lines 84-186) with:

```tsx
function Chat({ settings }: { settings: Settings }) {
  const [input, setInput] = useState('')
  const [pinned, setPinned] = useState<PickedElement | null>(null)
  const [picking, setPicking] = useState(false)

  const transport = useMemo(
    () => createChatTransport(settings, pinned),
    [settings, pinned],
  )
  const { messages, sendMessage, status, error } = useChat<PicanthonUIMessage>({
    transport,
    onError: (err) => console.error('Picanthon chat error:', err),
  })

  // Clear the pin when the active tab navigates — the selector would no longer
  // resolve and we don't want stale focus.
  useEffect(() => {
    function onTabUpdated(
      _tabId: number,
      change: chrome.tabs.TabChangeInfo,
      _tab: chrome.tabs.Tab,
    ) {
      if (change.status === 'loading' || change.url) setPinned(null)
    }
    chrome.tabs?.onUpdated.addListener(onTabUpdated)
    return () => chrome.tabs?.onUpdated.removeListener(onTabUpdated)
  }, [])

  async function togglePicker() {
    if (picking) {
      try {
        await sendToActiveTab({ type: 'CANCEL_PICK' })
      } catch {
        /* tab may have no content script */
      }
      setPicking(false)
      return
    }
    setPicking(true)
    try {
      const result = await sendToActiveTab<PickResult>({ type: 'START_PICK' })
      if (!('cancelled' in result)) setPinned(result)
    } catch (err) {
      console.warn('Picanthon picker error:', err)
    } finally {
      setPicking(false)
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const text = input.trim()
    if (!text || status === 'streaming' || status === 'submitted') return
    sendMessage({ text })
    setInput('')
  }

  return (
    <>
      <Conversation>
        <ConversationContent>
          {messages.length === 0 && (
            <ConversationEmptyState
              title="Pedime que modifique esta página"
              description='Probá: "fondo oscuro", "resaltar títulos", "ocultar imágenes".'
            />
          )}

          {messages.map((message) => (
            <Message key={message.id} from={message.role}>
              <MessageContent variant={message.role === 'user' ? 'contained' : 'flat'}>
                {message.parts.map((part, i) => {
                  const key = `${message.id}-${i}`

                  if (part.type === 'text') {
                    return <Response key={key}>{part.text}</Response>
                  }

                  if (part.type === 'reasoning') {
                    const streaming = 'state' in part && part.state === 'streaming'
                    return (
                      <Reasoning key={key} isStreaming={streaming}>
                        <ReasoningTrigger />
                        <ReasoningContent>{part.text}</ReasoningContent>
                      </Reasoning>
                    )
                  }

                  if (isToolUIPart(part)) {
                    const name = part.type.replace(/^tool-/, '')
                    const hasInput =
                      part.state === 'input-available' ||
                      part.state === 'output-available' ||
                      part.state === 'output-error'
                    return (
                      <Tool key={key}>
                        <ToolHeader type={name} state={part.state} />
                        <ToolContent>
                          {hasInput && <ToolInput input={part.input} />}
                          {part.state === 'output-available' && (
                            <ToolOutput output={part.output} />
                          )}
                          {part.state === 'output-error' && (
                            <ToolOutput errorText={part.errorText} />
                          )}
                        </ToolContent>
                      </Tool>
                    )
                  }

                  return null
                })}
              </MessageContent>
            </Message>
          ))}

          {error && (
            <Message from="assistant">
              <MessageContent variant="flat">
                <p className="rounded-lg bg-destructive/20 px-3 py-2 text-sm text-destructive">
                  {error.message}
                </p>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
      </Conversation>

      {pinned && <PinnedElementCard pin={pinned} onClear={() => setPinned(null)} />}

      <PromptInput onSubmit={onSubmit}>
        <PromptInputTextarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describí un cambio…"
        />
        <PromptInputToolbar>
          <span className="text-[11px] text-muted-foreground">
            {settings.apiKey ? settings.model : 'modo mock (sin API key)'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <PickerButton active={picking} onClick={togglePicker} />
            <PromptInputSubmit status={status} disabled={!input.trim()} />
          </div>
        </PromptInputToolbar>
      </PromptInput>
    </>
  )
}

function PickerButton({
  active,
  onClick,
}: {
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? 'Cancelar selección' : 'Seleccionar elemento de la página'}
      aria-pressed={active}
      className={
        'inline-flex h-8 w-8 items-center justify-center rounded-lg border text-foreground transition-colors ' +
        (active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-input bg-background hover:bg-muted')
      }
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="3" x2="12" y2="6" />
        <line x1="12" y1="18" x2="12" y2="21" />
        <line x1="3" y1="12" x2="6" y2="12" />
        <line x1="18" y1="12" x2="21" y2="12" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </svg>
    </button>
  )
}

function PinnedElementCard({
  pin,
  onClear,
}: {
  pin: PickedElement
  onClear: () => void
}) {
  const w = Math.round(pin.boundingBox.width)
  const h = Math.round(pin.boundingBox.height)
  return (
    <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs">
      <span aria-hidden>🎯</span>
      <code className="truncate font-mono text-foreground">{pin.selector}</code>
      <span className="text-muted-foreground">·</span>
      <span className="text-muted-foreground whitespace-nowrap">
        {w}×{h}
      </span>
      <button
        type="button"
        onClick={onClear}
        title="Limpiar selección"
        className="ml-auto rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
        aria-label="Limpiar selección"
      >
        ×
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: SUCCESS. `dist/` contains the extension.

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/App.tsx
git commit -m "feat(sidepanel): picker button, pinned card, and tab auto-clear"
```
Skip if not a git repo.

---

## Task 12: Manual smoke test

**Files:** none — manual verification.

- [ ] **Step 1: Load the built extension**

In Chrome: `chrome://extensions` → toggle Developer mode on → Load unpacked → select `dist/`.
If a previous version is loaded, click Reload first.

- [ ] **Step 2: Open the side panel on a real page**

Navigate to any page with multiple components (e.g. https://news.ycombinator.com).
Click the Picanthon toolbar icon to open the side panel.

- [ ] **Step 3: Use the picker**

- Click the 🎯 button in the prompt toolbar. The button should highlight (`active` style).
- Move the cursor over the page. The cursor should be `crosshair`. **(Note: this version does not yet draw a hover outline on the page; that's an explicit follow-up in the spec.)**
- Click any visible element (e.g. a story title). The button should de-activate and a card should appear above the textarea with the selector + dimensions + an `×`.

- [ ] **Step 4: Verify the pin reaches the agent**

(Requires an AI Gateway key in Settings.)
- Type "hacelo rojo" or similar deictic prompt.
- Verify the agent's `apply_tweaks` tool input targets the exact pinned selector.
- The change should be visible on the page.

- [ ] **Step 5: Verify clear paths**

- Click the `×` on the card → the card disappears, next prompt no longer references the pin.
- Pick again → reload the page → the card should disappear automatically (auto-clear on `tabs.onUpdated`).
- Pick → press ESC → the card stays unset (cancel path).
- Pick → click the 🎯 again before clicking the page → second click cancels.

- [ ] **Step 6: Document any issues**

If any step fails, file a follow-up note in the spec rather than fixing inline; the plan is done when the behaviors above all work.

---

## Self-review summary

- **Spec coverage:** all spec sections are mapped to tasks. Architecture → Tasks 1, 2, 4, 8, 9, 10; UX → Tasks 4 (click), 8 (wiring), 11 (button/card/auto-clear), 12 (smoke); Payload → Tasks 4, 5, 6, 9; Testing → Tasks 2, 3, 4, 5, 6, 7, 9; Edge cases → Tasks 4 (preventDefault), 11 (auto-clear on navigation), 4 (concurrent sessions).
- **Spec deferral:** the spec describes a hover outline + label that tracks the cursor. The minimum-viable plan ships with the crosshair cursor and capture-phase click-swallowing only — the outline is documented as an explicit gap in Task 12 step 3. Adding the live overlay is straightforward as a follow-up (mousemove → reposition shadow-DOM rectangle) but is not on the critical path for the agent-context feature, which is the actual goal. If you want it in v1, insert a task between Tasks 7 and 8 that adds the mousemove handler and a positioned rectangle inside the Shadow DOM host. The Task 4 click test would still pass.
- **Placeholders:** none. Every code step has full code.
- **Type consistency:** `PickedElement`, `PickResult`, `StartPickMsg`, `CancelPickMsg` defined once in `messaging.ts`, used across `picker.ts`, `agent.ts`, `chat-transport.ts`, `App.tsx`. `renderInstructions(context, pinned)` signature consistent between Tasks 9 and 10.

