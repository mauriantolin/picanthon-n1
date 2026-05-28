import { describe, it, expect } from 'vitest'
import { extractClassAttr } from './tailwind-edit'

describe('extractClassAttr', () => {
  it('returns the class value with double quotes', () => {
    expect(extractClassAttr('<div class="p-4 text-red-500"><span>x</span></div>')).toBe('p-4 text-red-500')
  })

  it('returns the class value with single quotes', () => {
    expect(extractClassAttr("<button class='btn primary'>x</button>")).toBe('btn primary')
  })

  it('returns empty when no class attribute', () => {
    expect(extractClassAttr('<div id="x">y</div>')).toBe('')
  })

  it('returns empty for empty input', () => {
    expect(extractClassAttr('')).toBe('')
  })

  it('handles other attributes before class', () => {
    expect(extractClassAttr('<a href="/x" class="link" data-id="1">x</a>')).toBe('link')
  })

  it('matches only the root element class', () => {
    expect(
      extractClassAttr('<div class="outer"><span class="inner">x</span></div>'),
    ).toBe('outer')
  })
})
