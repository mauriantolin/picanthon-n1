// The "tweak" protocol: the unit of DOM modification an agent can request.
// Both the agent (which produces tweaks) and the content script (which applies
// them) depend on this file, so it is the single source of truth for the schema.

export type Tweak =
  | { op: 'setStyle'; selector: string; styles: Record<string, string> }
  | { op: 'setText'; selector: string; text: string }
  | { op: 'setAttr'; selector: string; name: string; value: string }
  | { op: 'addClass'; selector: string; className: string }
  | { op: 'removeClass'; selector: string; className: string }
  | { op: 'remove'; selector: string }
  | { op: 'insertHTML'; selector: string; position: InsertPosition; html: string }
  | { op: 'highlight'; selector: string; color?: string }

export interface TweakResult {
  tweak: Tweak
  matched: number
  error?: string
}

// Runs in the content script (has access to `document`). Returns one result per
// tweak so the sidebar can report what actually happened on the page.
export function applyTweaks(tweaks: Tweak[]): TweakResult[] {
  return tweaks.map((tweak) => {
    try {
      const els = Array.from(document.querySelectorAll(tweak.selector))
      for (const el of els) applyOne(el as HTMLElement, tweak)
      return { tweak, matched: els.length }
    } catch (err) {
      return { tweak, matched: 0, error: String(err) }
    }
  })
}

function applyOne(el: HTMLElement, tweak: Tweak): void {
  switch (tweak.op) {
    case 'setStyle':
      for (const [prop, value] of Object.entries(tweak.styles)) {
        el.style.setProperty(prop, value)
      }
      break
    case 'setText':
      el.textContent = tweak.text
      break
    case 'setAttr':
      el.setAttribute(tweak.name, tweak.value)
      break
    case 'addClass':
      el.classList.add(tweak.className)
      break
    case 'removeClass':
      el.classList.remove(tweak.className)
      break
    case 'remove':
      el.remove()
      break
    case 'insertHTML':
      el.insertAdjacentHTML(tweak.position, tweak.html)
      break
    case 'highlight':
      el.style.setProperty('outline', `3px solid ${tweak.color ?? '#ff3e7f'}`)
      el.style.setProperty('outline-offset', '2px')
      break
  }
}
