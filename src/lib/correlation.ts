// Correlate a native table on the page with the JSON the page already received,
// so a replacement component can be fed clean, complete data — not a scrape of
// truncated rendered text. Falls back to scraping the DOM table when no captured
// response matches. Never re-issues requests.

import type { NetworkCapture } from './messaging'

export interface TableData {
  columns: string[]
  rows: Record<string, unknown>[]
  source: 'network' | 'dom'
}

export interface ScrapedTable {
  columns: string[]
  rows: Record<string, string>[]
}

// Parse a <table> (or table-like element) into columns + row objects.
export function scrapeTable(el: Element): ScrapedTable {
  const headerCells = Array.from(el.querySelectorAll('thead th, thead td'))
  let columns = headerCells.map((c) => text(c)).filter(Boolean)

  const bodyRows = Array.from(el.querySelectorAll('tbody tr'))
  const rowEls = bodyRows.length ? bodyRows : Array.from(el.querySelectorAll('tr'))

  // No <thead>: use the first row as the header.
  let dataRowEls = rowEls
  if (!columns.length && rowEls.length) {
    const first = rowEls[0]
    columns = Array.from(first.querySelectorAll('th, td')).map((c) => text(c))
    dataRowEls = rowEls.slice(1)
  }
  if (!columns.length) {
    const maxCells = Math.max(0, ...rowEls.map((r) => r.querySelectorAll('td, th').length))
    columns = Array.from({ length: maxCells }, (_, i) => `col${i + 1}`)
  }

  const rows = dataRowEls.map((tr) => {
    const cells = Array.from(tr.querySelectorAll('td, th'))
    const row: Record<string, string> = {}
    columns.forEach((col, i) => {
      row[col] = text(cells[i])
    })
    return row
  })

  return { columns, rows }
}

// Pick the captured JSON array that best matches the scraped table; else scrape.
export function correlateTable(el: Element, captures: NetworkCapture[]): TableData {
  const scraped = scrapeTable(el)
  const candidates = captures.flatMap((c) => extractArrays(c.json))

  let best: { arr: Record<string, unknown>[]; score: number } | null = null
  for (const arr of candidates) {
    const score = scoreArray(arr, scraped)
    if (!best || score > best.score) best = { arr, score }
  }

  if (best && best.score >= 2) {
    const columns = Object.keys(best.arr[0] ?? {})
    return { columns, rows: best.arr, source: 'network' }
  }

  return { columns: scraped.columns, rows: scraped.rows, source: 'dom' }
}

// Collect arrays-of-objects from a JSON value (top level + one level of nesting).
export function extractArrays(json: unknown): Record<string, unknown>[][] {
  const out: Record<string, unknown>[][] = []
  const isRowArray = (v: unknown): v is Record<string, unknown>[] =>
    Array.isArray(v) && v.length > 0 && v.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))

  if (isRowArray(json)) out.push(json)
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    for (const v of Object.values(json as Record<string, unknown>)) {
      if (isRowArray(v)) out.push(v)
    }
  }
  return out
}

function scoreArray(arr: Record<string, unknown>[], scraped: ScrapedTable): number {
  let score = 0

  // Strong signal: same number of rows.
  if (arr.length === scraped.rows.length && arr.length > 0) score += 2
  else if (Math.abs(arr.length - scraped.rows.length) <= 1) score += 1

  // Keys overlap with headers.
  const keys = new Set(Object.keys(arr[0] ?? {}).map(norm))
  const headers = scraped.columns.map(norm)
  const keyHits = headers.filter((h) => keys.has(h)).length
  if (keyHits) score += Math.min(2, keyHits)

  // Cell texts appear among the JSON values.
  const values = new Set<string>()
  for (const row of arr.slice(0, 20)) {
    for (const v of Object.values(row)) {
      if (v != null && typeof v !== 'object') values.add(norm(String(v)))
    }
  }
  let textHits = 0
  let textTotal = 0
  for (const row of scraped.rows.slice(0, 20)) {
    for (const cell of Object.values(row)) {
      if (!cell) continue
      textTotal++
      if (values.has(norm(cell))) textHits++
    }
  }
  if (textTotal && textHits / textTotal > 0.4) score += 2
  else if (textHits > 0) score += 1

  return score
}

function text(el: Element | undefined): string {
  return (el?.textContent ?? '').trim().replace(/\s+/g, ' ')
}

function norm(s: string): string {
  return s.trim().toLowerCase()
}
