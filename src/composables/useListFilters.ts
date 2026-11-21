import { computed, reactive, watch, type Ref } from 'vue'
import { quickSearch } from '@/data/search'
import type { FieldDef } from '@/model/entityTypes'
import type { Entity } from '@/model/types'

export type Tri = 'any' | 'yes' | 'no'
export const NONE = '__none__'

export interface ListFilters {
  q: string
  kinds: string[]
  tags: string[]
  tagMode: 'any' | 'all'
  visibility: string[]
  image: Tri
  text: Tri
  secrets: Tri
  templates: Tri
  level: 'any' | 'root' | 'child'
  within: string | null
  /** Changed during the last N days (0 = any time). */
  updated: number
  authors: string[]
  /** Type-specific field filters: ids for entity fields, text for text fields, Tri for checkboxes. */
  fields: Record<string, string[] | string>
  sort: 'name' | 'updated' | 'created'
  dir: 'asc' | 'desc'
}

export const defaultFilters = (): ListFilters => ({
  q: '', kinds: [], tags: [], tagMode: 'any', visibility: [], image: 'any', text: 'any', secrets: 'any', templates: 'any',
  level: 'any', within: null, updated: 0, authors: [], fields: {}, sort: 'name', dir: 'asc',
})

function read(key: string): Partial<ListFilters> {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<ListFilters> } catch { return {} }
}

/** Filters of an entity list, remembered per world and type in this browser. */
export function useListFilters(wid: Ref<string | null>, type: Ref<string>) {
  const f = reactive<ListFilters>(defaultFilters())
  let key = ''
  let loading = false
  watch([wid, type], ([w, t]) => {
    key = `dw.filters.v1.${w}.${t}`
    loading = true
    Object.assign(f, defaultFilters(), read(key))
    loading = false
  }, { immediate: true })
  watch(f, () => {
    if (loading || !key) return
    try { localStorage.setItem(key, JSON.stringify(f)) } catch { /* private mode */ }
  }, { deep: true })

  /** Number of active filters (sorting does not count). */
  const active = computed(() => {
    let n = 0
    if (f.q.trim()) n++
    for (const k of ['kinds', 'tags', 'visibility', 'authors'] as const) if (f[k].length) n++
    for (const k of ['image', 'text', 'secrets', 'templates'] as const) if (f[k] !== 'any') n++
    if (f.level !== 'any') n++
    if (f.within) n++
    if (f.updated) n++
    for (const v of Object.values(f.fields)) if (Array.isArray(v) ? v.length : v && v !== 'any') n++
    return n
  })
  function clear() {
    const { sort, dir } = f
    Object.assign(f, defaultFilters(), { sort, dir })
  }
  return { f, active, clear }
}

export interface FilterContext {
  all: Entity[]
  fieldDefs: FieldDef[]
  ancestorsOf: (e: Entity) => string[]
  tagExists: (id: string) => boolean
  now: number
}

/** Applies the filters; search results stay in relevance order unless another sort is chosen. */
export function applyFilters(f: ListFilters, ctx: FilterContext): Entity[] {
  const q = f.q.trim()
  let list = q ? quickSearch(ctx.all, q, 5000) : [...ctx.all]
  const tri = (t: Tri, v: boolean) => t === 'any' || (t === 'yes') === v
  const kinds = new Set(f.kinds)
  const tags = f.tags.filter(ctx.tagExists)
  const vis = new Set(f.visibility)
  const authors = new Set(f.authors)
  const minTime = f.updated ? ctx.now - f.updated * 86400000 : 0
  list = list.filter((e) => {
    if (kinds.size && !kinds.has(e.kind || NONE)) return false
    if (tags.length) {
      const has = (t: string) => e.tagIds.includes(t)
      if (f.tagMode === 'all' ? !tags.every(has) : !tags.some(has)) return false
    }
    if (vis.size && !vis.has(e.visibility)) return false
    if (!tri(f.image, !!e.imageId)) return false
    if (!tri(f.text, !!e.excerpt)) return false
    if (!tri(f.secrets, !!e.hasSecrets)) return false
    if (!tri(f.templates, !!e.isTemplate)) return false
    if (f.level === 'root' && e.parentId && ctx.all.some((p) => p.id === e.parentId)) return false
    if (f.level === 'child' && !e.parentId) return false
    if (f.within && !ctx.ancestorsOf(e).includes(f.within)) return false
    if (minTime && e.updatedAt < minTime) return false
    if (authors.size && !authors.has(e.createdBy)) return false
    for (const def of ctx.fieldDefs) {
      const want = f.fields[def.key]
      if (!want || (Array.isArray(want) && !want.length) || want === 'any') continue
      const v = e.fields?.[def.key]
      if (def.kind === 'bool') { if (!tri(want as Tri, !!v)) return false; continue }
      if (def.kind === 'entity' || def.kind === 'entities') {
        const ids: string[] = Array.isArray(v) ? v : v ? [v] : []
        const sel = want as string[]
        const ok = sel.some((s) => (s === NONE ? !ids.length : ids.includes(s)))
        if (!ok) return false
        continue
      }
      if (typeof want === 'string' && !String(v ?? '').toLowerCase().includes(want.toLowerCase())) return false
    }
    return true
  })
  if (!q || f.sort !== 'name') {
    const dir = f.dir === 'asc' ? 1 : -1
    if (f.sort === 'updated') list.sort((a, b) => (a.updatedAt - b.updatedAt) * dir)
    else if (f.sort === 'created') list.sort((a, b) => (a.createdAt - b.createdAt) * dir)
    else list.sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base', numeric: true }) * dir)
  }
  return list
}
