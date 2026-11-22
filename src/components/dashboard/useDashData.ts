// What each overview block shows, computed from the world store (so the page can also hide blocks that have
// nothing to show for this viewer — a player without a character, an empty list…).
import { computed, onBeforeUnmount, reactive, watch, type Ref } from 'vue'
import { useWorld } from '@/stores/world'
import { allTypes } from '@/model/entityTypes'
import { watchWorldCampaigns } from '@/data/campaigns'
import { safeUrl } from './links'
import type { Campaign, DashBlock, Entity } from '@/model/types'

/** Not "articles" for the random pick and the "waiting for text" list. */
const SERVICE_TYPES = ['tag', 'calendar', 'attribute_template']

export function useDashData(blocks: Ref<DashBlock[]>) {
  const world = useWorld()

  const typeOk = (types?: string[]) => (e: Entity) => !types?.length || types.includes(e.type)

  function stats(b: DashBlock) {
    return allTypes()
      .filter((t) => world.enabledTypes(t.key) && (!b.types?.length || b.types.includes(t.key)) && (world.byType.get(t.key)?.length ?? 0) > 0)
      .map((t) => ({ t, n: world.byType.get(t.key)!.length }))
  }
  const pins = (b: DashBlock) => (b.ids ?? []).map((id) => world.get(id)).filter((e): e is Entity => !!e)
  const recent = (b: DashBlock) => world.recent.filter(typeOk(b.types)).slice(0, b.limit || 10)
  function list(b: DashBlock) {
    const rows = world.list.filter((e) => typeOk(b.types)(e) && (!b.tagId || e.tagIds?.includes(b.tagId)) && !e.isTemplate)
    if (b.sort === 'name') rows.sort((a, z) => a.name.localeCompare(z.name, 'ru'))
    else if (b.sort === 'created') rows.sort((a, z) => z.createdAt - a.createdAt)
    else rows.sort((a, z) => z.updatedAt - a.updatedAt)
    return rows.slice(0, b.limit || 8)
  }
  const waiting = (b: DashBlock) => world.list
    .filter((e) => !world.backlinks.get(e.id)?.length && !SERVICE_TYPES.includes(e.type) && !e.excerpt)
    .slice(0, b.limit || 8)
  const character = computed(() => world.get(world.viewMember?.characterId ?? null) ?? null)
  const entity = (b: DashBlock) => world.get(b.entityId ?? null) ?? null
  const calendarExists = (b: DashBlock) => (b.calendarId ? !!world.get(b.calendarId) : (world.byType.get('calendar')?.length ?? 0) > 0)
  const links = (b: DashBlock) => (b.links ?? []).filter((l) => (l.entityId ? !!world.get(l.entityId) : !!safeUrl(l.url)))

  // ---------- random article: picked once per block, re-picked on demand or when it stops matching ----------
  const picks = reactive(new Map<string, string>())
  function pool(b: DashBlock) { return world.list.filter((e) => !SERVICE_TYPES.includes(e.type) && typeOk(b.types)(e)) }
  function reroll(b: DashBlock) {
    const l = pool(b)
    if (!l.length) { picks.delete(b.id); return }
    const cur = picks.get(b.id)
    const options = l.length > 1 ? l.filter((e) => e.id !== cur) : l
    picks.set(b.id, options[Math.floor(Math.random() * options.length)].id)
  }
  watch(() => [blocks.value.filter((b) => b.type === 'random').map((b) => b.id + ':' + (b.types ?? []).join(',')).join('|'), world.list.length], () => {
    for (const b of blocks.value) {
      if (b.type !== 'random') continue
      const e = world.get(picks.get(b.id) ?? null)
      if (!e || !pool(b).some((x) => x.id === e.id)) reroll(b)
    }
  }, { immediate: true })
  const random = (b: DashBlock) => world.get(picks.get(b.id) ?? null) ?? null

  // ---------- campaigns of this world the viewer takes part in (only watched while such a block exists) ----------
  const campaigns = reactive({ rows: [] as Campaign[] })
  let stop: (() => void) | null = null
  watch(() => [blocks.value.some((b) => b.type === 'campaigns'), world.wid, world.uid] as const, ([need, w, u]) => {
    stop?.(); stop = null; campaigns.rows = []
    if (need && w && u) stop = watchWorldCampaigns(w, u, (r) => { campaigns.rows = r })
  }, { immediate: true })
  onBeforeUnmount(() => stop?.())

  /** Whether the block has anything to show to the current viewer (empty blocks are hidden outside edit mode). */
  function hasContent(b: DashBlock): boolean {
    switch (b.type) {
      case 'hero': case 'stats': return true
      case 'text': { const h = b.html ?? ''; return /<img|<hr|<table/i.test(h) || /\S/.test(h.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')) }
      case 'pins': return pins(b).length > 0
      case 'entity': return !!entity(b)
      case 'map': return !!entity(b)
      case 'list': return list(b).length > 0
      case 'recent': return recent(b).length > 0
      case 'calendar': return calendarExists(b)
      case 'image': return !!b.imageId
      case 'links': return links(b).length > 0
      case 'character': return !!character.value
      case 'campaigns': return campaigns.rows.length > 0 || (world.isMaster && !world.adminView)
      case 'random': return !!random(b)
      case 'waiting': return world.isMaster && waiting(b).length > 0
    }
    return false
  }
  /** Whether the block's "who sees it" setting lets the current viewer (or the previewed one) see it. */
  function allowed(b: DashBlock): boolean {
    if (b.show === 'masters') return world.isMaster
    if (b.show === 'members') return world.isMember && !world.preview?.guest
    return true
  }

  return { stats, pins, recent, list, waiting, character, entity, calendarExists, links, random, reroll, campaigns, hasContent, allowed }
}
export type DashData = ReturnType<typeof useDashData>
