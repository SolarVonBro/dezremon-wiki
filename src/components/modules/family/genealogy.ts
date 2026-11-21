// Genealogy graph built from relations (kind parent / spouse / sibling) and node selection for the family tree.
// Pure module: no Vue / store imports (only types), so it can be unit-tested in isolation.
import type { Relation } from '@/model/types'

export type KinKind = 'parent' | 'spouse' | 'sibling'
/** A genealogical link seen from one person: `kind` is what the other person is to them. */
export interface KinLink { relationId: string; kind: 'parent' | 'child' | 'spouse' | 'sibling'; otherId: string }
export type AddKind = 'parent' | 'child' | 'spouse' | 'sibling'

/** id → (other id → relation id) */
type Adj = Map<string, Map<string, string>>

export interface KinGraph {
  /** child → parents */
  parents: Adj
  /** parent → children */
  children: Adj
  spouses: Adj
  siblings: Adj
}

function link(m: Adj, a: string, b: string, rid: string) {
  let inner = m.get(a)
  if (!inner) m.set(a, (inner = new Map()))
  if (!inner.has(b)) inner.set(b, rid)
}

export function buildKinGraph(relations: Array<Pick<Relation, 'id' | 'sourceId' | 'targetId' | 'kind'>>): KinGraph {
  const g: KinGraph = { parents: new Map(), children: new Map(), spouses: new Map(), siblings: new Map() }
  for (const r of relations) {
    if (!r.sourceId || !r.targetId || r.sourceId === r.targetId) continue
    if (r.kind === 'parent') {
      link(g.children, r.sourceId, r.targetId, r.id)
      link(g.parents, r.targetId, r.sourceId, r.id)
    } else if (r.kind === 'spouse') {
      link(g.spouses, r.sourceId, r.targetId, r.id)
      link(g.spouses, r.targetId, r.sourceId, r.id)
    } else if (r.kind === 'sibling') {
      link(g.siblings, r.sourceId, r.targetId, r.id)
      link(g.siblings, r.targetId, r.sourceId, r.id)
    }
  }
  return g
}

export const keysOf = (m: Adj, id: string): string[] => [...(m.get(id)?.keys() ?? [])]

/** Relation ids of all genealogical links of a person. */
export function kinRelationsOf(g: KinGraph, id: string): KinLink[] {
  const out: KinLink[] = []
  for (const [o, r] of g.parents.get(id) ?? []) out.push({ kind: 'parent', otherId: o, relationId: r })
  for (const [o, r] of g.children.get(id) ?? []) out.push({ kind: 'child', otherId: o, relationId: r })
  for (const [o, r] of g.spouses.get(id) ?? []) out.push({ kind: 'spouse', otherId: o, relationId: r })
  for (const [o, r] of g.siblings.get(id) ?? []) out.push({ kind: 'sibling', otherId: o, relationId: r })
  return out
}

/** true if `maybeDesc` is a descendant of `id` (guards against creating cycles). */
export function isDescendant(g: KinGraph, id: string, maybeDesc: string): boolean {
  const seen = new Set<string>([id])
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    for (const c of keysOf(g.children, cur)) {
      if (c === maybeDesc) return true
      if (!seen.has(c)) { seen.add(c); stack.push(c) }
    }
  }
  return false
}

/**
 * Family mode: tagged members + their parents, children, spouses, siblings, and the other parents of their children.
 * `extern` = people shown only because they are related to a member.
 */
export function familySelection(members: string[], g: KinGraph, exists: (id: string) => boolean) {
  const core = new Set(members.filter(exists))
  const ids = new Set(core)
  const add = (id: string) => { if (exists(id)) ids.add(id) }
  for (const m of core) {
    keysOf(g.parents, m).forEach(add)
    keysOf(g.spouses, m).forEach(add)
    keysOf(g.siblings, m).forEach(add)
    for (const c of keysOf(g.children, m)) {
      add(c)
      keysOf(g.parents, c).forEach(add)
    }
  }
  const extern = new Set([...ids].filter((id) => !core.has(id)))
  return { ids, core, extern }
}

/**
 * Character mode: ancestors (up to `up` generations), descendants (up to `down`), spouses and siblings of the
 * person, spouses / co-parents of descendants.
 */
export function characterSelection(centerId: string, g: KinGraph, exists: (id: string) => boolean, up = 3, down = 3) {
  const ids = new Set<string>([centerId])
  const add = (id: string) => { if (exists(id)) { ids.add(id); return true } return false }
  // ancestors
  let frontier = [centerId]
  for (let lvl = 0; lvl < up && frontier.length; lvl++) {
    const next: string[] = []
    for (const id of frontier) for (const p of keysOf(g.parents, id)) if (!ids.has(p) && add(p)) next.push(p)
    frontier = next
  }
  // spouses and siblings of the person (siblings = explicit + other children of the parents)
  keysOf(g.spouses, centerId).forEach(add)
  keysOf(g.siblings, centerId).forEach(add)
  for (const p of keysOf(g.parents, centerId)) if (ids.has(p)) keysOf(g.children, p).forEach(add)
  // descendants
  frontier = [centerId]
  const desc = new Set<string>()
  for (let lvl = 0; lvl < down && frontier.length; lvl++) {
    const next: string[] = []
    for (const id of frontier) for (const c of keysOf(g.children, id)) if (!desc.has(c) && c !== centerId && add(c)) { desc.add(c); next.push(c) }
    frontier = next
  }
  for (const d of desc) {
    keysOf(g.spouses, d).forEach(add)
    keysOf(g.parents, d).forEach(add)
  }
  return { ids }
}

// ---------- labels for new relations ----------

export type Sex = 'm' | 'f' | null

export function sexOf(raw: unknown): Sex {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return null
  if (/^(ж|f|w|♀|female|woman|жен)/.test(s)) return 'f'
  if (/^(м|m|♂|male|man|муж)/.test(s)) return 'm'
  return null
}

export const kinLabel = {
  parent: (s: Sex) => (s === 'm' ? 'отец' : s === 'f' ? 'мать' : 'родитель'),
  child: (s: Sex) => (s === 'm' ? 'сын' : s === 'f' ? 'дочь' : 'ребёнок'),
  spouse: (s: Sex) => (s === 'm' ? 'муж' : s === 'f' ? 'жена' : 'супруг(а)'),
  sibling: (s: Sex) => (s === 'm' ? 'брат' : s === 'f' ? 'сестра' : 'брат/сестра'),
}
