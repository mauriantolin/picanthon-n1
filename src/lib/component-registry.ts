// Allowlist of mountable "shadcn-style" components. The agent can only ask to
// mount an id from this list — it never injects code. This metadata is shared
// (no React) so the side panel's search_shadcn_docs tool can use it; the actual
// React factories live in src/content/mount.ts (content-script side).

export interface ComponentMeta {
  id: string
  name: string
  description: string
  keywords: string[]
  // The kind of native element this component is meant to replace.
  appliesTo: 'table' | 'list' | 'generic'
}

export const COMPONENT_REGISTRY: ComponentMeta[] = [
  {
    id: 'data-table',
    name: 'Data Table (shadcn-style)',
    description:
      'A sortable, filterable, paginated table built with TanStack Table and ' +
      'styled like shadcn/ui. Replaces a native <table>, reusing its real data.',
    keywords: ['table', 'tabla', 'grid', 'datatable', 'data table', 'tabular', 'shadcn'],
    appliesTo: 'table',
  },
]

export function getComponent(id: string): ComponentMeta | undefined {
  return COMPONENT_REGISTRY.find((c) => c.id === id)
}

export function searchComponents(query: string): ComponentMeta[] {
  const q = query.toLowerCase().trim()
  if (!q) return COMPONENT_REGISTRY
  const scored = COMPONENT_REGISTRY.map((c) => {
    const hay = [c.id, c.name, c.description, ...c.keywords].join(' ').toLowerCase()
    const score = q
      .split(/\s+/)
      .reduce((n, term) => n + (hay.includes(term) ? 1 : 0), 0)
    return { c, score }
  })
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)
  return (hits.length ? hits : scored).map((s) => s.c)
}
