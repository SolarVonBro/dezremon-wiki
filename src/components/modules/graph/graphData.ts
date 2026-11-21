// Builds force-graph nodes/links from entities and relations (filters, neighbourhood, multi-edge curves, styling).
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import type { Entity, Relation, RelationKind } from '@/model/types'

export interface GNode extends SimulationNodeDatum {
  id: string
  name: string
  type: string
  color: string
  imageId: string | null
  initial: string
  r: number
  degree: number
  /** Hops from the centre (neighbourhood mode). */
  depth: number
  isCenter: boolean
}

export interface GLink extends SimulationLinkDatum<GNode> {
  id: string
  sourceId: string
  targetId: string
  label: string
  kind: RelationKind
  color: string
  directed: boolean
  dash: string
  width: number
  /** Perpendicular offset for parallel edges, relative to the canonical (sorted ids) direction. 0 = straight. */
  curve: number
}

export interface GraphFilter {
  /** Allowed entity types; null = all. */
  types: Set<string> | null
  tagId: string | null
  hideIsolated: boolean
}

export interface BuildOptions {
  centerId?: string | null
  depth?: number
  filter: GraphFilter
  get: (id: string) => Entity | undefined
  typeColor: (type: string) => string
}

export function relationColour(r: Pick<Relation, 'colour' | 'attitude'>): string {
  const c = safeColour(r.colour)
  if (c) return c
  const a = Math.max(-1, Math.min(1, (Number(r.attitude) || 0) / 100))
  if (Math.abs(a) < 0.05) return 'var(--rg-edge)'
  const pct = Math.round(25 + Math.abs(a) * 75)
  return `color-mix(in srgb, var(${a > 0 ? '--success' : '--danger'}) ${pct}%, var(--rg-edge))`
}

export function safeColour(c: string | null | undefined): string {
  let s = (c || '').trim()
  if (!s) return ''
  if (/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(s)) s = '#' + s
  if (/^#[0-9a-f]{3,8}$/i.test(s) || /^(rgb|hsl)a?\([\d\s.,%+-]+\)$/i.test(s) || /^[a-z]{3,20}$/i.test(s)) return s
  return ''
}

export function isDirected(r: Pick<Relation, 'kind' | 'label' | 'reverseLabel'>): boolean {
  if (r.kind === 'parent') return true
  if (r.kind === 'spouse' || r.kind === 'sibling') return false
  const rev = (r.reverseLabel || '').trim()
  return !!rev && rev.toLowerCase() !== (r.label || '').trim().toLowerCase()
}

const DASH: Record<RelationKind, string> = { generic: '', parent: '', spouse: '7 4', sibling: '2 4' }
const KIND_LABEL: Record<RelationKind, string> = { generic: '', parent: 'родитель', spouse: 'супруги', sibling: 'брат/сестра' }

export function buildGraph(relations: Relation[], opt: BuildOptions): { nodes: GNode[]; links: GLink[] } {
  const { filter, get } = opt
  const center = opt.centerId ? get(opt.centerId) : undefined
  const passes = (e: Entity | undefined): e is Entity => {
    if (!e) return false
    if (center && e.id === center.id) return true
    if (filter.types && !filter.types.has(e.type)) return false
    if (filter.tagId && !(e.tagIds ?? []).includes(filter.tagId)) return false
    return true
  }
  const rels = relations.filter((r) => r.sourceId !== r.targetId && passes(get(r.sourceId)) && passes(get(r.targetId)))

  let nodeIds: Set<string>
  const depthOf = new Map<string, number>()
  if (center) {
    const adj = new Map<string, string[]>()
    for (const r of rels) {
      ;(adj.get(r.sourceId) ?? adj.set(r.sourceId, []).get(r.sourceId)!).push(r.targetId)
      ;(adj.get(r.targetId) ?? adj.set(r.targetId, []).get(r.targetId)!).push(r.sourceId)
    }
    const maxDepth = Math.max(1, opt.depth ?? 2)
    depthOf.set(center.id, 0)
    let frontier = [center.id]
    for (let d = 1; d <= maxDepth && frontier.length; d++) {
      const next: string[] = []
      for (const id of frontier) for (const o of adj.get(id) ?? []) if (!depthOf.has(o)) { depthOf.set(o, d); next.push(o) }
      frontier = next
    }
    nodeIds = new Set(depthOf.keys())
  } else {
    nodeIds = new Set<string>()
    // every entity that has a relation (even if its partners are filtered out: "isolated" in this view)
    for (const r of relations) {
      if (r.sourceId === r.targetId) continue
      for (const id of [r.sourceId, r.targetId]) if (passes(get(id))) nodeIds.add(id)
    }
  }

  const linksRaw = rels.filter((r) => nodeIds.has(r.sourceId) && nodeIds.has(r.targetId))
  const degree = new Map<string, number>()
  for (const r of linksRaw) {
    degree.set(r.sourceId, (degree.get(r.sourceId) ?? 0) + 1)
    degree.set(r.targetId, (degree.get(r.targetId) ?? 0) + 1)
  }
  if (filter.hideIsolated) for (const id of [...nodeIds]) if (!degree.get(id) && id !== center?.id) nodeIds.delete(id)

  const nodes: GNode[] = []
  for (const id of nodeIds) {
    const e = get(id)
    if (!e) continue
    const deg = degree.get(id) ?? 0
    const isCenter = id === center?.id
    nodes.push({
      id, name: e.name, type: e.type, color: opt.typeColor(e.type), imageId: e.imageId ?? null,
      initial: (e.name.trim()[0] ?? '?').toUpperCase(),
      r: isCenter ? 26 : Math.round(11 + Math.min(11, Math.sqrt(deg) * 2.6)),
      degree: deg, depth: depthOf.get(id) ?? 0, isCenter,
    })
  }

  // parallel edges between the same pair get symmetric curve offsets
  const pairCount = new Map<string, number>()
  const pairKey = (r: Relation) => (r.sourceId < r.targetId ? `${r.sourceId}|${r.targetId}` : `${r.targetId}|${r.sourceId}`)
  for (const r of linksRaw) pairCount.set(pairKey(r), (pairCount.get(pairKey(r)) ?? 0) + 1)
  const pairSeen = new Map<string, number>()
  const links: GLink[] = linksRaw.map((r) => {
    const key = pairKey(r)
    const n = pairCount.get(key)!
    const i = pairSeen.get(key) ?? 0
    pairSeen.set(key, i + 1)
    return {
      id: r.id, source: r.sourceId, target: r.targetId, sourceId: r.sourceId, targetId: r.targetId,
      label: (r.label || '').trim() || KIND_LABEL[r.kind] || '',
      kind: r.kind, color: relationColour(r), directed: isDirected(r), dash: DASH[r.kind] ?? '',
      width: r.isPinned ? 2.6 : 1.5, curve: n > 1 ? i - (n - 1) / 2 : 0,
    }
  })
  return { nodes, links }
}
