# Picanthon 🌶️

Chrome extension (Manifest V3) with an AI **side panel** that reads the current
page's DOM and applies LLM-driven "tweaks" (DOM modifications) to it.

The agent runs **inside the side panel** via the AI SDK's `DirectChatTransport`
(in-process, no backend). Its tools reach the page by messaging the active tab's
content script. Two extra contexts give it grounding: a MAIN-world **network
recorder** that buffers JSON responses the page already received, and
**`chrome.storage`-backed persistence** so applied changes survive reloads.

```
┌────────────────── Side Panel (React + AI Elements) ──────────────────┐
│  useChat ─▶ ToolLoopAgent ─▶ Gateway model (Anthropic via            │
│                              `ai-gateway.vercel.sh`)                 │
│  Tools: plan_design · apply_tweaks · query_network_capture           │
│         search_shadcn_docs · replace_component · design_component(v0)│
└──────────┬───────────────────────────────────────────────────────────┘
           │ chrome.tabs.sendMessage
           ▼
┌─────────────── Content script (ISOLATED) ─ DOM access ───────────────┐
│  buildSnapshot · applyTweaks (+MutationObserver re-apply)            │
│  correlateTable · mount React or sanitized v0 HTML in Shadow DOM     │
│  restore tweaks from chrome.storage on load                          │
└──────────┬───────────────────────────────────────────────────────────┘
           │ window.postMessage (nonce-tagged)
           ▼
┌────── Network recorder (MAIN, document_start) ─ no chrome.* ─────────┐
│  monkey-patches window.fetch + XMLHttpRequest                         │
│  ring buffer of JSON responses the page already received             │
└──────────────────────────────────────────────────────────────────────┘
```

## Quick start

```bash
npm install
npm run build      # self-contained bundle in dist/ (no dev server needed)
```

Then load it in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select the `dist/` folder
4. Click the Picanthon toolbar icon to open the side panel
5. Open any web page and type a tweak, e.g. `fondo oscuro`, `resaltar titulos`

### Two modes — pick the right one

| Goal | Command | Notes |
| ---- | ------- | ----- |
| **Use / test** the extension | `npm run build` | `dist/` is self-contained. Reload the card after each build. **No server required.** |
| **Develop** with hot reload | `npm run dev` | The Vite dev server **must stay running** on `localhost:5173`. If it stops, crxjs shows a *"Cannot connect to the Vite Dev Server"* overlay and reloads the extension in a loop (closing the panel and wiping page tweaks). That's expected dev behavior — not a bug. |

> If you hit the "Cannot connect to the Vite Dev Server" loop: stop using the
> dev build. Run `npm run build` and reload `dist/` — it has no dev-server
> dependency.

Run the tests with `npm test`.

## Using a real LLM

The default **mock agent** works with no key (keyword-based tweaks) so you can
test the pipeline immediately. For the real agent:

1. Open the side panel → **Settings**
2. Paste your **Vercel AI Gateway** API key
3. Optionally change the model — it's in `provider/model` form, e.g.
   `anthropic/claude-sonnet-4.6` (list models with
   `curl -s https://ai-gateway.vercel.sh/v1/models`)
4. Save

The model is reached through the AI Gateway (`src/lib/model.ts`), which fronts
Anthropic/OpenAI/Google behind one endpoint. The key is stored in
`chrome.storage.local` and used only inside the side panel (an extension
context — the page never sees it). The model emits tweaks through the
`apply_tweaks` tool (`src/lib/agent-tools.ts`) — it never runs arbitrary code;
it only requests the structured DOM ops defined in `src/lib/tweaks.ts`.

### Custom UI with v0 (optional)

For non-shadcn / free-form component designs, add a **v0 API key** in Settings.
When the user asks for a specific look ("make this table look like a dashboard
card"), the agent calls `design_component`, which sends the element's real data
to v0 (`api.v0.dev`), gets back a self-contained HTML+CSS fragment, and mounts
it (sanitized — no scripts) in an isolated Shadow DOM. Without a v0 key, the
agent still does standard shadcn replacement via `replace_component`.

> Client-side keys are fine for a local/personal tool. To swap to a provider
> called directly (e.g. `@ai-sdk/anthropic`) change only `src/lib/model.ts`.

## What the agent can do

Examples of requests it handles, and which tools it picks:

| You say | Agent does |
| ------- | ---------- |
| *"fondo oscuro"*, *"resaltar títulos"*, *"ocultar imágenes"* | Mock keywords (no key) or `apply_tweaks` directly. |
| *"dale un look más moderno"*, *"mejorá la jerarquía del header"* | `plan_design` (commits to a palette + scales + concrete changes) then `apply_tweaks` applying that brief consistently. |
| *"convertí esta tabla en una tabla tipo shadcn"* | `search_shadcn_docs` → `replace_component` mounts the built-in `DataTable` (TanStack, sort + paginación) with the **real data** correlated from the page's network responses (DOM-scrape fallback). |
| *"esta tabla, mostrala como un dashboard oscuro con acentos neón"* | `design_component`: extracts the data, sends it to **v0** (`api.v0.dev`) with the style brief, mounts the returned HTML+CSS sanitized in a Shadow DOM. |

### Agent tools

| Tool | What it does |
| ---- | ------------ |
| `plan_design` | Refines a vague visual request into a structured `DesignBrief` (palette, type/spacing/radius, concrete changes with selectors). |
| `apply_tweaks` | Applies a list of typed DOM ops (`setStyle`, `addClass`, `setText`, `remove`, `insertHTML`, `highlight`, …) to selectors that exist on the page. |
| `query_network_capture` | Lists the JSON responses the page already received (from the MAIN-world recorder). Useful before replacing a table. |
| `search_shadcn_docs` | Returns matching ids from the local component allowlist. |
| `replace_component` | Mounts a built-in registry component (today: `data-table`) with the element's real data, inside a Shadow DOM. |
| `design_component` | Same flow as above, but the UI is generated by v0 from a free-form style brief instead of taken from the registry. |

Page context (URL, outline, **and a curated list of elements with stable
selectors**) is injected into the agent's instructions every turn, so it never
has to guess selectors.

## Persistence of changes

Applied tweaks are persisted to `chrome.storage.local`, keyed by URL
(`origin + pathname`), so they survive:

- the side panel closing,
- the extension reloading,
- the page reloading or navigating within the same path.

The content script restores and re-applies them on load, and a
`MutationObserver` re-applies them when the page itself (e.g. an SPA) replaces
nodes. The **Reset** button in the panel clears the saved tweaks for the
current URL and reloads the tab.

> Component replacements (`replace_component` / `design_component`) are **not**
> auto-restored on reload yet — re-mounting them depends on re-capturing the
> page's network responses with fragile timing. Tweaks are.

## Security model

- **Allowlist of mountable components.** The agent can only mount ids that
  exist in `src/lib/component-registry.ts`. It cannot inject arbitrary React.
- **v0 output is treated as untrusted.** Before mounting, `mount.ts` parses the
  HTML, **removes `<script>` / `<iframe>` / `<object>` / `<embed>` / `<link>`,
  every `on*` event handler, and any `javascript:` URL**. No generated code
  ever runs.
- **Isolation.** Every mount lives in a Shadow DOM host (`mode: 'open'`) with
  `:host { all: initial }` — the page's CSS doesn't leak in, and the
  component's CSS doesn't leak out.
- **Keys.** The Gateway key and v0 key live only in `chrome.storage.local`,
  read inside the side panel (an extension context). They never reach the page
  or the content script. The Anthropic-direct-browser flow that the scaffold
  used to do is gone; the gateway request goes out from the extension origin
  authorized by `host_permissions`.
- **MAIN-world recorder boundary.** The recorder runs in the page's world and
  cannot use `chrome.*`. It only buffers responses and replies to nonce-tagged
  `postMessage` requests; the ISOLATED side filters by source and nonce.

## Known limitations / roadmap

- **Component replacements aren't persisted across reloads** (tweaks are).
- **v0 mounts are static** — they render every row in the data with the
  requested style, but interactive sort/paginate on top of v0 markup is not
  wired yet (would need a generic post-mount JS layer).
- The agent context covers up to ~50 curated elements per page — very large
  pages may need a more selective collector.
- No formal **verify-after-change** step yet (Phase 4 in `docs/SPEC.md`),
  no **tweak-bar** to scrub mounted variables in real time (Phase 5),
  no **sketch canvas** (Phase 6).
- `display: 'summarized'` is enabled on Anthropic thinking so the reasoning
  streams as text; if a future model rejects that option, drop
  `providerOptions` in `src/lib/agent.ts`.

## Where to extend

| You want to…                          | Edit                         |
| ------------------------------------- | ---------------------------- |
| Add a new DOM operation               | `src/lib/tweaks.ts` (+ tool schema in `src/lib/agent-tools.ts`) |
| Tune design taste / system rules      | `src/lib/design.ts` (design-refinement prompt + brief schema) |
| Change agent behavior / tools         | `src/lib/agent.ts`, `src/lib/agent-tools.ts` |
| Change how the page is described      | `collectElements` in `src/content/page-context.ts` |
| Add a mountable replacement component | `src/lib/component-registry.ts` (meta) + `src/content/mount.ts` (factory) |
| Tune custom UI generation (v0)        | `src/lib/v0.ts` (prompt/model) |
| Tune table↔response correlation       | `src/lib/correlation.ts`     |
| Change which provider/model backs it  | `src/lib/model.ts`           |
| Change the offline mock               | `src/lib/chat-transport.ts`  |
| Change the sidebar UI                 | `src/sidepanel/` (+ `ai-elements/`) |
| Add permissions / change manifest     | `src/manifest.ts`            |

## Layout

```
src/
  manifest.ts                MV3 manifest (2 content scripts: ISOLATED + MAIN recorder)
  background/index.ts        service worker — opens the side panel (no agent loop)
  content/
    index.ts                 ISOLATED: snapshot, tweaks, replace-component handler
    page-context.ts          buildSnapshot + collectElements (stable selectors)
    persistence.ts           re-applies tweaks on re-render (MutationObserver)
    network-recorder.ts      MAIN world: patches fetch/XHR, buffers JSON responses
    mount.ts                 mounts a component in a Shadow DOM host (lazy React)
  components/replacements/
    DataTable.tsx            shadcn-style sortable/paginated table (TanStack)
  sidepanel/
    App.tsx                  chat UI (useChat + DirectChatTransport)
    ai-elements/             AI Elements-style chat components (Tailwind)
  lib/
    messaging.ts             message protocol + sendToActiveTab
    net-bridge.ts            requests captures from the MAIN recorder
    tweaks.ts                tweak schema + applier (source of truth)
    agent.ts                 ToolLoopAgent (multi-tool) + UIMessage type
    agent-tools.ts           plan_design, apply_tweaks, query_network_capture,
                             search_shadcn_docs, replace_component, design_component
    design.ts                design-refinement brief (structured output)
    v0.ts                    v0 client — generates custom HTML+CSS UI (api.v0.dev)
    correlation.ts           table ↔ captured-JSON matching (+ DOM scrape fallback)
    component-registry.ts    allowlist of mountable components (metadata)
    persisted-tweaks.ts      per-URL chrome.storage persistence for applied tweaks
    model.ts                 provider/model factory (Gateway swap point)
    chat-transport.ts        real transport + offline mock
    settings.ts              chrome.storage-backed config (Gateway key, model, v0 key)
    utils.ts                 cn() class helper
```

### Tests

Vitest + jsdom. Run with `npm test`. Covers:

- `tweaks.test.ts` — every tweak op + error handling.
- `persistence.test.ts` — apply / re-apply after SPA wipe (sync + async observer) / no `insertHTML` duplication.
- `page-context.test.ts` — `cssPath` produces selectors that resolve back to the same element.
- `correlation.test.ts` — captured-JSON match (top-level + nested), DOM-scrape fallback when no match / no captures.
- `mount.test.ts` — `mountHtml` sanitization (drops `<script>`, `on*`, `javascript:`), Shadow DOM isolation, revert.
