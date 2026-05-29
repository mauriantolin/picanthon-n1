// Stable UIMessage type for useChat. The agent is a one-shot page editor
// (see runElementEdit in ./tailwind-edit); the transport emits a single
// `edit_element` tool step manually so the side panel renders progress while
// the lone LLM call runs.

import type { UIMessage } from 'ai'

export type EditScopeSummary =
  | { mode: 'pinned'; selector: string; tag: string }
  | { mode: 'full-body'; url: string; title: string }

export type PicanthonTools = {
  edit_element: {
    input: {
      request: string
      scope: EditScopeSummary
    }
    output: {
      tweaks: Array<{ op: string; selector: string }>
      applied: number
      summary: string
      screenshot: {
        data: string
        mediaType: 'image/jpeg'
        width: number
        height: number
      } | null
    }
  }
}

export type PicanthonUIMessage = UIMessage<unknown, Record<string, never>, PicanthonTools>
