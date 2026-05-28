// Pure helper that takes a raw DrawnPayload and returns one enriched with the
// composite + screenshotAvailable flag, computed exactly once. Lives outside
// App.tsx so the "1 composite per drawing" invariant can be unit-tested without
// React Testing Library — the sidepanel just calls this and updates state with
// whatever it returns.

import type { DrawnPayload } from './messaging'
import { captureActiveTab, compositeWithStrokes } from './screenshot'

export async function enrichWithComposite(drawing: DrawnPayload): Promise<DrawnPayload> {
  try {
    const screenshot = await captureActiveTab()
    const composite = await compositeWithStrokes(
      screenshot?.data ?? null,
      drawing.strokesPng,
    )
    return {
      ...drawing,
      compositePng: {
        data: composite.data,
        mediaType: composite.mediaType,
        width: composite.width,
        height: composite.height,
      },
      screenshotAvailable: !!screenshot,
    }
  } catch (err) {
    console.warn('[picanthon/scribble] composite precompute failed:', err)
    return { ...drawing, screenshotAvailable: false }
  }
}
