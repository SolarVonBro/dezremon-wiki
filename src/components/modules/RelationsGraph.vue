<script setup lang="ts">
// Force-directed graph of entities and relations (d3-force, SVG). Whole world or the neighbourhood of `centerId`.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type ForceLink, type Simulation } from 'd3-force'
import { useWorld } from '@/stores/world'
import { typeDef } from '@/model/entityTypes'
import { imageUrl } from '@/data/images'
import { debounce, plural, randomId } from '@/data/util'
import type { Relation } from '@/model/types'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import { buildGraph, relationColour, type GLink, type GNode } from './graph/graphData'
import { GraphRenderer } from './graph/renderer'
import { usePanZoom, type View } from './graph/panZoom'
import { cropOf } from '@/data/crop'

const props = withDefaults(defineProps<{ centerId?: string | null; depth?: number; height?: string }>(), { centerId: null, depth: 2, height: '600px' })
const emit = defineEmits<{ select: [id: string | null] }>()
const world = useWorld()
const router = useRouter()

// ---------- UI state ----------
const localCenter = ref<string | null>(null)
const center = computed(() => localCenter.value ?? props.centerId ?? null)
const depth = ref(props.depth)
watch(() => props.depth, (d) => { depth.value = d })
watch(() => props.centerId, () => { localCenter.value = null; select(null); autoFit = true })

const hiddenTypes = reactive(new Set<string>())
const tagId = ref<string | null>(null)
const hideIsolated = ref(false)
const search = ref('')
const selected = ref<string | null>(null)
const fullscreen = ref(false)
const stats = reactive({ nodes: 0, links: 0 })
const graphIds = shallowRef(new Set<string>())
const graphNodes = shallowRef<GNode[]>([])

/** Types present among related entities (for the filter). */
const typeStats = computed(() => {
  const seen = new Set<string>()
  const m = new Map<string, number>()
  for (const r of world.visibleRelations) for (const id of [r.sourceId, r.targetId]) {
    if (seen.has(id)) continue
    seen.add(id)
    const e = world.get(id)
    if (e) m.set(e.type, (m.get(e.type) ?? 0) + 1)
  }
  return [...m.entries()].map(([type, count]) => ({ type, count, def: typeDef(type) })).sort((a, b) => b.count - a.count)
})
const tags = computed(() => world.tags)
function toggleType(t: string) { if (hiddenTypes.has(t)) hiddenTypes.delete(t); else hiddenTypes.add(t) }
function setAllTypes(on: boolean) { hiddenTypes.clear(); if (!on) typeStats.value.forEach((t) => hiddenTypes.add(t.type)) }
const filtersActive = computed(() => hiddenTypes.size > 0 || !!tagId.value || hideIsolated.value)

// ---------- DOM, pan & zoom ----------
const wrap = ref<HTMLElement | null>(null)
const svg = ref<SVGSVGElement | null>(null)
const layer = ref<SVGGElement | null>(null)
const clipId = 'rg-clip-' + randomId(8)
let renderer: GraphRenderer | null = null
let autoFit = true

function applyView(v: View) {
  layer.value?.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`)
  updateLabelClasses()
}
const pz = usePanZoom(wrap, {
  minK: 0.05, maxK: 4,
  canPan: (e) => !(e.target as Element | null)?.closest?.('.rg-node'),
  onChange: applyView,
})
const zoomPct = computed(() => Math.round(pz.view.k * 100))

function updateLabelClasses() {
  const s = svg.value
  if (!s) return
  s.classList.toggle('show-labels', pz.view.k >= 0.7 || stats.nodes <= 80)
  s.classList.toggle('show-edge-labels', pz.view.k >= 1.25 || stats.links <= 30)
}

function bounds() {
  const ns = graphNodes.value
  if (!ns.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of ns) {
    minX = Math.min(minX, (n.x ?? 0) - n.r); maxX = Math.max(maxX, (n.x ?? 0) + n.r)
    minY = Math.min(minY, (n.y ?? 0) - n.r); maxY = Math.max(maxY, (n.y ?? 0) + n.r + 16)
  }
  return { minX, minY, maxX, maxY }
}
function fitView() {
  const b = bounds()
  if (b) pz.fit(b, 40, 1.4, 0.05)
}
function focusNode(id: string, zoom = true) {
  const n = graphNodes.value.find((x) => x.id === id)
  if (n) pz.centerOn(n.x ?? 0, n.y ?? 0, zoom ? Math.max(pz.view.k, 1) : pz.view.k)
}

// ---------- simulation ----------
let sim: Simulation<GNode, GLink> | null = null
const positions = new Map<string, { x: number; y: number; fx: number | null; fy: number | null }>()
let lastKey = ''

function savePositions() {
  for (const n of graphNodes.value) positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, fx: n.fx ?? null, fy: n.fy ?? null })
}

function ensureSim() {
  if (sim) return sim
  sim = forceSimulation<GNode, GLink>([])
    .force('link', forceLink<GNode, GLink>([]).id((d) => d.id).distance((l) => 60 + (l.source as GNode).r + (l.target as GNode).r))
    .force('charge', forceManyBody<GNode>().strength((n) => -110 - n.r * 6).theta(0.9).distanceMax(700))
    .force('collide', forceCollide<GNode>((n) => n.r + 7).iterations(1))
    .force('x', forceX<GNode>(0).strength(0.035))
    .force('y', forceY<GNode>(0).strength(0.035))
    .velocityDecay(0.42)
    .on('tick', () => renderer?.tick())
    .on('end', () => {
      savePositions()
      if (autoFit) fitView()
    })
  sim.stop()
  return sim
}

function rebuild() {
  if (!renderer) return
  savePositions()
  const types = hiddenTypes.size ? new Set(typeStats.value.map((t) => t.type).filter((t) => !hiddenTypes.has(t))) : null
  const { nodes, links } = buildGraph(world.visibleRelations as Relation[], {
    centerId: center.value, depth: depth.value,
    filter: { types, tagId: tagId.value, hideIsolated: hideIsolated.value },
    get: (id) => world.get(id),
    typeColor: (t) => typeDef(t).color,
  })

  // positions: keep known ones, put new nodes next to a known neighbour or on rings around the centre
  const neighbour = new Map<string, string[]>()
  for (const l of links) {
    ;(neighbour.get(l.sourceId) ?? neighbour.set(l.sourceId, []).get(l.sourceId)!).push(l.targetId)
    ;(neighbour.get(l.targetId) ?? neighbour.set(l.targetId, []).get(l.targetId)!).push(l.sourceId)
  }
  let fresh = 0
  for (const n of nodes) {
    const p = positions.get(n.id)
    if (p) { n.x = p.x; n.y = p.y; n.fx = p.fx; n.fy = p.fy; continue }
    fresh++
    const near = (neighbour.get(n.id) ?? []).map((id) => positions.get(id)).find(Boolean)
    if (near) { n.x = near.x + (Math.random() - 0.5) * 60; n.y = near.y + (Math.random() - 0.5) * 60 }
    else if (center.value) {
      if (n.isCenter) { n.x = 0; n.y = 0 } else {
        const a = Math.random() * Math.PI * 2
        const rad = n.depth * 150 + Math.random() * 40
        n.x = Math.cos(a) * rad; n.y = Math.sin(a) * rad
      }
    }
  }

  const key = nodes.map((n) => n.id).sort().join(',') + '|' + links.map((l) => l.id).sort().join(',')
  const changed = key !== lastKey
  const first = !lastKey
  lastKey = key

  graphNodes.value = nodes
  graphIds.value = new Set(nodes.map((n) => n.id))
  stats.nodes = nodes.length
  stats.links = links.length

  const s = ensureSim()
  s.nodes(nodes)
  ;(s.force('link') as ForceLink<GNode, GLink>).links(links)
  s.alphaDecay(nodes.length > 600 ? 0.045 : nodes.length > 250 ? 0.03 : 0.0228)
  renderer.setData(nodes, links)
  for (const n of nodes) if (n.fx != null) renderer.setPinned(n.id, true)

  if (selected.value && !graphIds.value.has(selected.value)) select(null)
  renderer.setSelected(selected.value)
  renderer.highlight(hovered ?? selected.value)
  applyMatches()
  updateLabelClasses()

  if (changed) {
    if (first || fresh > nodes.length / 2) {
      // warm-up without rendering so the first frame is already readable
      s.alpha(1)
      const warm = nodes.length < 150 ? 120 : nodes.length < 500 ? 60 : 25
      s.tick(warm)
      renderer.tick()
      if (autoFit) fitView()
      s.alpha(0.6).restart()
    } else {
      s.alpha(Math.min(0.5, 0.15 + fresh / Math.max(1, nodes.length))).restart()
    }
  } else {
    renderer.tick()
  }
  queueImages()
}
const rebuildSoon = debounce(rebuild, 120)

watch(() => [world.visibleRelations, center.value, depth.value, tagId.value, hideIsolated.value, hiddenTypes.size], () => rebuildSoon())
watch(center, () => { autoFit = true; lastKey = '' })

// ---------- thumbnails (limited: all for small graphs, otherwise only around the selection) ----------
const loadedImg = new Map<string, string>() // nodeId → imageId requested
let imgQueue: GNode[] = []
let imgActive = 0
function queueImages() {
  const ns = graphNodes.value
  let want: GNode[]
  if (ns.length <= 250) want = ns
  else {
    const ids = new Set<string>()
    if (center.value) ids.add(center.value)
    if (selected.value && renderer) renderer.neighbours(selected.value).forEach((i) => ids.add(i))
    want = ns.filter((n) => ids.has(n.id))
  }
  imgQueue = want.filter((n) => n.imageId && loadedImg.get(n.id) !== n.imageId)
  pumpImages()
}
function pumpImages() {
  while (imgActive < 6 && imgQueue.length) {
    const n = imgQueue.shift()!
    const imageId = n.imageId!
    loadedImg.set(n.id, imageId)
    imgActive++
    imageUrl(world.access, imageId, 'thumb')
      .then((url) => renderer?.setImage(n.id, url))
      .catch(() => { /* keep the coloured circle */ })
      .finally(() => { imgActive--; pumpImages() })
  }
}

// ---------- search ----------
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim()
const matches = computed(() => {
  const q = norm(search.value)
  if (!q) return null
  const set = new Set<string>()
  for (const n of graphNodes.value) if (norm(n.name).includes(q)) set.add(n.id)
  return set
})
function applyMatches() { renderer?.setMatches(matches.value) }
watch(matches, applyMatches)
function searchEnter() {
  const first = graphNodes.value.find((n) => matches.value?.has(n.id))
  if (first) { select(first.id); focusNode(first.id) }
}

// ---------- interaction ----------
let hovered: string | null = null
function select(id: string | null) {
  selected.value = id
  renderer?.setSelected(id)
  renderer?.highlight(hovered ?? id)
  emit('select', id)
  if (id && graphNodes.value.length > 250) queueImages()
}
function nodeIdOf(t: EventTarget | null): string | null {
  const g = (t as Element | null)?.closest?.('.rg-node')
  return g?.getAttribute('data-id') ?? null
}
function onOver(e: MouseEvent) {
  const id = nodeIdOf(e.target)
  if (id === hovered) return
  hovered = id
  renderer?.highlight(id ?? selected.value)
}
function onOut(e: MouseEvent) {
  if (!hovered) return
  const to = nodeIdOf(e.relatedTarget)
  if (to === hovered) return
  hovered = to
  renderer?.highlight(to ?? selected.value)
}

let drag: { id: string; node: GNode; x: number; y: number; moved: boolean; pointerId: number } | null = null
function onNodeDown(e: PointerEvent) {
  const id = nodeIdOf(e.target)
  if (!id || (e.button !== 0 && e.pointerType === 'mouse')) return
  const node = graphNodes.value.find((n) => n.id === id)
  if (!node) return
  autoFit = false
  drag = { id, node, x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
  window.addEventListener('pointercancel', onDragEnd)
}
function onDragMove(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId) return
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return
  if (!drag.moved) {
    drag.moved = true
    sim?.alphaTarget(0.25).restart()
  }
  const p = pz.toWorld(e.clientX, e.clientY)
  drag.node.fx = p.x
  drag.node.fy = p.y
}
function onDragEnd(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId) return
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragEnd)
  const d = drag
  drag = null
  if (d.moved) {
    sim?.alphaTarget(0)
    renderer?.setPinned(d.id, true)
    pinnedTick.value++
  } else if (e.altKey) {
    unpin(d.id)
  } else {
    select(selected.value === d.id ? null : d.id)
  }
}
function onDblClick(e: MouseEvent) {
  const id = nodeIdOf(e.target)
  if (id) openEntity(id)
}
function onBgClick(e: MouseEvent) {
  if (nodeIdOf(e.target) || pz.wasDragged()) return
  if (selected.value) select(null)
}
function openEntity(id: string) {
  void router.push({ name: 'entity', params: { wid: world.wid!, eid: id } })
}

const pinnedTick = ref(0)
const selectedPinned = computed(() => {
  void pinnedTick.value
  const n = graphNodes.value.find((x) => x.id === selected.value)
  return !!n && n.fx != null
})
function unpin(id: string) {
  const n = graphNodes.value.find((x) => x.id === id)
  if (!n) return
  n.fx = null
  n.fy = null
  positions.delete(id)
  renderer?.setPinned(id, false)
  pinnedTick.value++
  sim?.alpha(0.3).restart()
}
function relayout() {
  for (const n of graphNodes.value) {
    n.fx = null; n.fy = null
    renderer?.setPinned(n.id, false)
  }
  positions.clear()
  pinnedTick.value++
  autoFit = true
  sim?.alpha(1).restart()
}

// ---------- side card ----------
const selEntity = computed(() => world.get(selected.value))
const KIND_NOTE = (r: Relation, outgoing: boolean) => (r.kind === 'parent' ? (outgoing ? 'ребёнок' : 'родитель') : r.kind === 'spouse' ? 'супруг(а)' : r.kind === 'sibling' ? 'брат/сестра' : '')
const selRelations = computed(() => {
  const id = selected.value
  if (!id) return []
  return world.relationsOf(id).map((r) => {
    const outgoing = r.sourceId === id
    const otherId = outgoing ? r.targetId : r.sourceId
    return { r, otherId, label: (outgoing ? r.label : r.reverseLabel || r.label) || KIND_NOTE(r, outgoing), colour: relationColour(r), name: world.get(otherId)?.name ?? '' }
  }).sort((a, b) => Number(b.r.isPinned) - Number(a.r.isPinned) || a.name.localeCompare(b.name, 'ru'))
})
function goTo(id: string) {
  if (graphIds.value.has(id)) { select(id); focusNode(id, false) }
}
function showAround(id: string) {
  localCenter.value = id === props.centerId ? null : id
  select(id)
}

// ---------- lifecycle ----------
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && fullscreen.value) fullscreen.value = false }
function stopAutoFit() { autoFit = false }
onMounted(() => {
  if (layer.value && svg.value) renderer = new GraphRenderer(layer.value, svg.value, clipId)
  const r = wrap.value?.getBoundingClientRect()
  pz.setView({ x: (r?.width ?? 0) / 2, y: (r?.height ?? 0) / 2, k: 1 })
  wrap.value?.addEventListener('wheel', stopAutoFit, { passive: true })
  document.addEventListener('keydown', onKey)
  rebuild()
})
watch(fullscreen, async () => { await nextTick(); fitView() })
onBeforeUnmount(() => {
  rebuildSoon.cancel()
  sim?.stop()
  sim = null
  renderer?.destroy()
  renderer = null
  imgQueue = []
  wrap.value?.removeEventListener('wheel', stopAutoFit)
  document.removeEventListener('keydown', onKey)
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
  window.removeEventListener('pointercancel', onDragEnd)
})
</script>

<template>
  <div class="rg" :class="{ fullscreen }" :style="{ '--rg-h': height }">
    <div class="rg-toolbar">
      <div class="rg-search">
        <Icon name="search" :size="15" class="faint" />
        <input v-model="search" class="input input-sm" placeholder="Найти на графе…" @keydown.enter.prevent="searchEnter" @keydown.esc="search = ''" />
        <span v-if="matches" class="faint small nowrap">{{ matches.size }}</span>
      </div>

      <Dropdown keep-open>
        <template #trigger>
          <button type="button" class="btn btn-sm" :class="{ 'btn-on': hiddenTypes.size }"><Icon name="filter" :size="14" /> Типы<template v-if="hiddenTypes.size"> ({{ typeStats.length - hiddenTypes.size }}/{{ typeStats.length }})</template></button>
        </template>
        <div class="menu rg-types">
          <div class="row gap-sm rg-types-head">
            <button type="button" class="btn btn-sm btn-ghost" @click="setAllTypes(true)">Все</button>
            <button type="button" class="btn btn-sm btn-ghost" @click="setAllTypes(false)">Ничего</button>
          </div>
          <div class="menu-scroll">
            <label v-for="t in typeStats" :key="t.type" class="menu-item check">
              <input type="checkbox" :checked="!hiddenTypes.has(t.type)" @change="toggleType(t.type)" />
              <Icon :name="t.def.icon" :size="15" :style="{ color: t.def.color }" />
              <span class="grow">{{ t.def.plural }}</span>
              <span class="faint small">{{ t.count }}</span>
            </label>
            <div v-if="!typeStats.length" class="menu-label">Нет связанных статей</div>
          </div>
        </div>
      </Dropdown>

      <select v-if="tags.length" v-model="tagId" class="input input-sm rg-tag" title="Только статьи с тегом">
        <option :value="null">Все теги</option>
        <option v-for="t in tags" :key="t.id" :value="t.id">{{ t.name }}</option>
      </select>

      <label class="check small" title="Скрывать статьи, у которых не осталось связей после фильтров">
        <input v-model="hideIsolated" type="checkbox" /> Без одиночных
      </label>

      <label v-if="center" class="row gap-sm small rg-depth" title="Глубина окружения">
        <span class="muted">Глубина</span>
        <select v-model.number="depth" class="input input-sm">
          <option v-for="d in [1, 2, 3, 4]" :key="d" :value="d">{{ d }}</option>
        </select>
      </label>

      <span class="grow" />
      <span class="muted small nowrap">{{ stats.nodes }} {{ plural(stats.nodes, 'статья', 'статьи', 'статей') }} · {{ stats.links }} {{ plural(stats.links, 'связь', 'связи', 'связей') }}</span>
      <div class="rg-zoom">
        <button type="button" class="icon-btn" title="Уменьшить" @click="pz.zoomBy(1 / 1.3)"><Icon name="zoom-out" :size="16" /></button>
        <span class="rg-pct small muted">{{ zoomPct }}%</span>
        <button type="button" class="icon-btn" title="Увеличить" @click="pz.zoomBy(1.3)"><Icon name="zoom-in" :size="16" /></button>
        <button type="button" class="icon-btn" title="Вписать в окно" @click="fitView"><Icon name="maximize2" :size="16" /></button>
        <button type="button" class="icon-btn" title="Перестроить раскладку (открепить все узлы)" @click="relayout"><Icon name="refresh-cw" :size="15" /></button>
        <button type="button" class="icon-btn" :title="fullscreen ? 'Выйти из полноэкранного режима' : 'Во весь экран'" @click="fullscreen = !fullscreen">
          <Icon :name="fullscreen ? 'minimize2' : 'maximize2'" :size="16" />
        </button>
      </div>
    </div>

    <div v-if="localCenter" class="rg-crumb small">
      <Icon name="locate" :size="14" />
      Окружение: <EntityLink :id="localCenter" />
      <button type="button" class="btn btn-sm btn-ghost" @click="localCenter = null">
        <Icon name="x" :size="14" /> {{ props.centerId ? 'Вернуться' : 'Весь мир' }}
      </button>
    </div>

    <div ref="wrap" class="rg-view">
      <svg ref="svg" class="rg-svg" @mouseover="onOver" @mouseout="onOut" @pointerdown="onNodeDown" @dblclick="onDblClick" @click="onBgClick">
        <defs>
          <clipPath :id="clipId" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5" /></clipPath>
        </defs>
        <g ref="layer" class="rg-layer" />
      </svg>

      <div v-if="!stats.nodes" class="rg-empty">
        <Icon name="network" :size="30" />
        <div v-if="filtersActive">Под фильтры ничего не попало.</div>
        <div v-else-if="center">У этой статьи пока нет связей.</div>
        <div v-else>В мире пока нет связей между статьями.</div>
      </div>

      <div class="rg-legend small">
        <span><i class="lg pos" /> дружба</span>
        <span><i class="lg neg" /> вражда</span>
        <span><i class="lg dash" /> супруги</span>
        <span><i class="lg dot" /> братья / сёстры</span>
        <span>→ направленная</span>
      </div>

      <aside v-if="selEntity" class="rg-side" @pointerdown.stop @wheel.stop>
        <header class="rg-side-head">
          <span class="avatar rg-side-avatar"><Thumb :id="selEntity.imageId" :crop="cropOf(selEntity)"><Icon :name="typeDef(selEntity.type).icon" :size="20" /></Thumb></span>
          <div class="grow" style="min-width: 0">
            <EntityLink :id="selEntity.id" :icon="false" class="rg-side-name" />
            <div class="small" :style="{ color: typeDef(selEntity.type).color }">{{ typeDef(selEntity.type).label }}<template v-if="selEntity.kind"> · <span class="muted">{{ selEntity.kind }}</span></template></div>
          </div>
          <button type="button" class="icon-btn" title="Закрыть" @click="select(null)"><Icon name="x" :size="16" /></button>
        </header>
        <div class="rg-side-actions">
          <button type="button" class="btn btn-sm" @click="openEntity(selEntity.id)"><Icon name="external-link" :size="14" /> Открыть</button>
          <button v-if="selEntity.id !== center" type="button" class="btn btn-sm btn-ghost" title="Показать только окружение этой статьи" @click="showAround(selEntity.id)"><Icon name="locate" :size="14" /> Окружение</button>
          <button v-if="selectedPinned" type="button" class="btn btn-sm btn-ghost" @click="unpin(selEntity.id)"><Icon name="pin" :size="14" /> Открепить</button>
        </div>
        <div class="section-title rg-side-title">Связи · {{ selRelations.length }}</div>
        <div class="rg-side-list">
          <div v-for="row in selRelations" :key="row.r.id" class="rg-rel">
            <span class="rg-rel-dot" :style="{ background: row.colour }" />
            <div class="rg-rel-main">
              <span v-if="row.label" class="rg-rel-label">{{ row.label }}</span>
              <EntityLink :id="row.otherId" />
            </div>
            <button v-if="graphIds.has(row.otherId)" type="button" class="icon-btn" title="Показать на графе" @click="goTo(row.otherId)"><Icon name="crosshair" :size="14" /></button>
          </div>
          <div v-if="!selRelations.length" class="muted small">Связей нет.</div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.rg {
  --rg-edge: color-mix(in srgb, var(--text-muted) 55%, transparent);
  --rg-label-halo: var(--surface-2);
  display: flex; flex-direction: column; gap: 8px; min-height: 0;
}
.rg.fullscreen { position: fixed; inset: 0; z-index: 200; background: var(--bg); padding: 10px 14px 14px; }
.rg-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.rg-search { display: flex; align-items: center; gap: 6px; padding-left: 8px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); }
.rg-search .input { border: 0; box-shadow: none; background: transparent; width: 180px; padding-left: 0; }
.rg-search span { padding-right: 8px; }
.rg-tag { width: auto; max-width: 180px; }
.rg-depth select { width: auto; }
.btn-on { border-color: var(--accent); color: var(--accent); }
.rg-types { width: 280px; }
.rg-types-head { padding: 2px 4px 4px; }
.rg-types .menu-item { gap: 8px; }
.rg-zoom { display: inline-flex; align-items: center; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
.rg-zoom .icon-btn { width: 30px; height: 30px; }
.rg-pct { min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; }
.rg-crumb { display: flex; align-items: center; gap: 6px; color: var(--text-muted); }

.rg-view {
  position: relative; height: var(--rg-h); min-height: 320px; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius);
  background-color: var(--surface-2);
  background-image: radial-gradient(circle, color-mix(in srgb, var(--text-faint) 26%, transparent) 1px, transparent 1.2px);
  background-size: 24px 24px; cursor: grab; touch-action: none; user-select: none;
}
.rg-view:active { cursor: grabbing; }
.rg.fullscreen .rg-view { flex: 1; height: auto; }
.rg-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; font-family: var(--font-ui); }

/* links */
.rg-svg :deep(.rg-link) { fill: none; stroke-linecap: round; stroke-linejoin: round; opacity: .8; transition: opacity .12s; }
.rg-svg :deep(.rg-link-label) {
  display: none; font-size: 10.5px; fill: var(--text-muted); pointer-events: none;
  paint-order: stroke; stroke: var(--rg-label-halo); stroke-width: 3px; stroke-linejoin: round;
}
.rg-svg.show-edge-labels :deep(.rg-link-label), .rg-svg :deep(.rg-link-label.hl) { display: block; }
.rg-svg :deep(.rg-link-label.hl) { fill: var(--text); font-weight: 600; }

/* nodes */
.rg-svg :deep(.rg-node) { cursor: pointer; transition: opacity .12s; }
.rg-svg :deep(.rg-node-bg) { stroke: var(--surface); stroke-width: 1.5px; }
.rg-svg :deep(.rg-node-initial) { fill: var(--surface); font-weight: 700; pointer-events: none; }
.rg-svg :deep(.rg-node.has-img .rg-node-initial) { display: none; }
.rg-svg :deep(.rg-node-img) { pointer-events: none; }
.rg-svg :deep(.rg-node-ring) { fill: none; stroke-width: 2.5px; }
.rg-svg :deep(.rg-node.center .rg-node-ring) { stroke: var(--accent) !important; stroke-width: 4px; }
.rg-svg :deep(.rg-node.pinned .rg-node-ring) { stroke-dasharray: 3 2.5; }
.rg-svg :deep(.rg-node.selected .rg-node-ring) { stroke: var(--text) !important; stroke-width: 3.5px; }
.rg-svg :deep(.rg-node-label) {
  display: none; font-size: 11.5px; font-weight: 500; fill: var(--text); pointer-events: none;
  paint-order: stroke; stroke: var(--rg-label-halo); stroke-width: 3.5px; stroke-linejoin: round;
}
.rg-svg.show-labels :deep(.rg-node-label),
.rg-svg :deep(.rg-node.hl .rg-node-label),
.rg-svg :deep(.rg-node.selected .rg-node-label),
.rg-svg :deep(.rg-node.match .rg-node-label),
.rg-svg :deep(.rg-node.center .rg-node-label) { display: block; }
.rg-svg :deep(.rg-node.center .rg-node-label), .rg-svg :deep(.rg-node.selected .rg-node-label) { font-weight: 700; font-size: 12.5px; }

/* highlight & search */
.rg-svg.has-hl :deep(.rg-node:not(.hl)) { opacity: .22; }
.rg-svg.has-hl :deep(.rg-link:not(.hl)) { opacity: .08; }
.rg-svg.has-hl :deep(.rg-link.hl) { opacity: 1; }
.rg-svg.searching:not(.has-hl) :deep(.rg-node:not(.match)) { opacity: .25; }
.rg-svg.searching:not(.has-hl) :deep(.rg-link) { opacity: .15; }
.rg-svg :deep(.rg-node.match .rg-node-ring) { stroke: var(--accent) !important; stroke-width: 4px; }

.rg-empty {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  color: var(--text-muted); pointer-events: none;
}
.rg-empty .icon { color: var(--text-faint); }
.rg-legend {
  position: absolute; left: 10px; bottom: 10px; display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 5px 10px; border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 88%, transparent); border: 1px solid var(--border); color: var(--text-muted); pointer-events: none;
  max-width: calc(100% - 20px);
}
.rg-legend span { display: inline-flex; align-items: center; gap: 5px; }
.lg { display: inline-block; width: 18px; height: 0; border-top: 2px solid var(--rg-edge); }
.lg.pos { border-color: var(--success); }
.lg.neg { border-color: var(--danger); }
.lg.dash { border-top-style: dashed; }
.lg.dot { border-top-style: dotted; border-top-width: 3px; }

/* side card */
.rg-side {
  position: absolute; top: 10px; right: 10px; bottom: 10px; width: 300px; max-width: calc(100% - 20px); display: flex; flex-direction: column; gap: 10px;
  padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-lg);
  cursor: default; user-select: text; overflow: hidden;
}
.rg-side-head { display: flex; align-items: center; gap: 10px; }
.rg-side-avatar { width: 44px; height: 44px; border-radius: 10px; }
.rg-side-avatar :deep(.thumb-empty) { width: 100%; height: 100%; }
.rg-side-name { font-family: var(--font-head); font-size: 19px; font-weight: 700; }
.rg-side-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.rg-side-title { margin: 4px 0 0; }
.rg-side-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; margin: 0 -4px; padding: 0 4px; }
.rg-rel { display: flex; align-items: center; gap: 8px; padding: 4px 2px; border-radius: 6px; font-size: 13.5px; }
.rg-rel:hover { background: var(--surface-2); }
.rg-rel-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.rg-rel-main { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.rg-rel-label { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rg-rel .icon-btn { width: 26px; height: 26px; flex-shrink: 0; }

@media (max-width: 720px) {
  .rg-search .input { width: 130px; }
  .rg-legend { display: none; }
  .rg-side { top: auto; height: 55%; left: 10px; width: auto; }
}
</style>
