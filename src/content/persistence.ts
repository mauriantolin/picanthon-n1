// Keeps applied tweaks alive. Many sites (SPAs) re-render and wipe our DOM
// changes; this re-applies the accumulated tweaks whenever the page mutates.
// Pure DOM (document + MutationObserver) — no chrome APIs, so it's unit-testable.

import { applyTweaks, type Tweak, type TweakResult } from '@/lib/tweaks'

// insertHTML is the only non-idempotent op (re-running would duplicate nodes),
// so it is excluded from re-application.
function reapplyable(tweaks: Tweak[]): Tweak[] {
  return tweaks.filter((t) => t.op !== 'insertHTML')
}

export class TweakPersistence {
  private tweaks: Tweak[] = []
  private observer: MutationObserver | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  // Apply a new batch, remember it, and start watching for the page wiping it.
  apply(tweaks: Tweak[]): TweakResult[] {
    this.tweaks.push(...tweaks)
    const results = applyTweaks(tweaks)
    this.start()
    return results
  }

  // Re-apply the idempotent subset of everything applied so far.
  reapply(): void {
    applyTweaks(reapplyable(this.tweaks))
  }

  // The full cumulative set, for persistence.
  getAll(): Tweak[] {
    return [...this.tweaks]
  }

  clear(): void {
    this.tweaks = []
    this.stop()
  }

  start(): void {
    if (this.observer || typeof MutationObserver === 'undefined') return
    this.observer = new MutationObserver(() => this.schedule())
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    })
  }

  stop(): void {
    this.observer?.disconnect()
    this.observer = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      // Detach while we mutate so our own changes don't re-trigger the observer.
      this.observer?.disconnect()
      this.reapply()
      this.observer?.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      })
    }, 150)
  }
}
