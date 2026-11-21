import MiniSearch from 'minisearch'
import type { Entity } from '@/model/types'

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е')

/** Fast name/alias search used by pickers, @-mentions and the quick search box. */
export function quickSearch(list: Entity[], q: string, limit = 12, types?: string[]): Entity[] {
  const query = norm(q.trim())
  const pool = types?.length ? list.filter((e) => types.includes(e.type)) : list
  if (!query) return [...pool].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  const scored: Array<[number, Entity]> = []
  for (const e of pool) {
    const name = norm(e.name)
    let s = 0
    if (name === query) s = 100
    else if (name.startsWith(query)) s = 80
    else if (name.split(/[\s\-—,.(«]+/).some((w) => w.startsWith(query))) s = 60
    else if (name.includes(query)) s = 40
    for (const al of e.aliases ?? []) {
      const a = norm(al)
      if (a === query) s = Math.max(s, 90)
      else if (a.startsWith(query)) s = Math.max(s, 70)
      else if (a.includes(query)) s = Math.max(s, 35)
    }
    if (!s && e.kind && norm(e.kind).includes(query)) s = 10
    if (s) scored.push([s - name.length / 1000, e])
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1])
}

export interface FullTextDoc { id: string; name: string; aliases: string; kind: string; text: string; attrs: string; tags: string; type: string }

export function buildFullText(docs: FullTextDoc[]) {
  const ms = new MiniSearch<FullTextDoc>({
    fields: ['name', 'aliases', 'kind', 'text', 'attrs', 'tags'],
    storeFields: ['id', 'type'],
    processTerm: (t) => norm(t),
    searchOptions: { boost: { name: 4, aliases: 3, kind: 1.5, tags: 1.5 }, prefix: true, fuzzy: 0.2 },
  })
  ms.addAll(docs)
  return ms
}

/** A short highlighted fragment of `text` around the first query term. */
export function snippet(text: string, q: string, radius = 90): string {
  const t = text ?? ''
  const terms = norm(q).split(/\s+/).filter(Boolean)
  const lower = norm(t)
  let at = -1
  for (const term of terms) { at = lower.indexOf(term); if (at >= 0) break }
  if (at < 0) return t.slice(0, radius * 2)
  const start = Math.max(0, at - radius)
  return (start > 0 ? '…' : '') + t.slice(start, at + radius * 1.5) + (at + radius * 1.5 < t.length ? '…' : '')
}
