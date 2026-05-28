import { beforeEach, describe, expect, it } from 'vitest'
import { correlateTable, scrapeTable } from './correlation'
import type { NetworkCapture } from './messaging'

function capture(json: unknown): NetworkCapture {
  return { id: 1, url: 'https://api.test/data', method: 'GET', status: 200, json, ts: Date.now() }
}

beforeEach(() => {
  document.body.innerHTML = `
    <table id="t">
      <thead><tr><th>Name</th><th>Age</th></tr></thead>
      <tbody>
        <tr><td>Ana</td><td>30</td></tr>
        <tr><td>Beto</td><td>25</td></tr>
        <tr><td>Cata</td><td>41</td></tr>
      </tbody>
    </table>
  `
})

describe('scrapeTable', () => {
  it('extracts columns and rows keyed by header', () => {
    const t = scrapeTable(document.querySelector('#t')!)
    expect(t.columns).toEqual(['Name', 'Age'])
    expect(t.rows).toHaveLength(3)
    expect(t.rows[0]).toEqual({ Name: 'Ana', Age: '30' })
  })
})

describe('correlateTable', () => {
  it('matches the captured JSON array and uses it as the data source', () => {
    const caps = [
      capture([
        { name: 'Ana', age: 30, email: 'ana@x.com' },
        { name: 'Beto', age: 25, email: 'beto@x.com' },
        { name: 'Cata', age: 41, email: 'cata@x.com' },
      ]),
    ]
    const data = correlateTable(document.querySelector('#t')!, caps)
    expect(data.source).toBe('network')
    expect(data.rows).toHaveLength(3)
    // Network data is richer than the rendered table (has email).
    expect(data.columns).toContain('email')
    expect(data.rows[0].name).toBe('Ana')
  })

  it('finds the array nested in an object response', () => {
    const caps = [
      capture({ ok: true, data: [{ name: 'Ana', age: 30 }, { name: 'Beto', age: 25 }, { name: 'Cata', age: 41 }] }),
    ]
    const data = correlateTable(document.querySelector('#t')!, caps)
    expect(data.source).toBe('network')
    expect(data.rows).toHaveLength(3)
  })

  it('falls back to DOM scraping when no capture matches', () => {
    const caps = [capture([{ unrelated: 'x' }, { unrelated: 'y' }])]
    const data = correlateTable(document.querySelector('#t')!, caps)
    expect(data.source).toBe('dom')
    expect(data.columns).toEqual(['Name', 'Age'])
    expect(data.rows).toHaveLength(3)
  })

  it('falls back to DOM scraping when there are no captures', () => {
    const data = correlateTable(document.querySelector('#t')!, [])
    expect(data.source).toBe('dom')
    expect(data.rows).toHaveLength(3)
  })
})
