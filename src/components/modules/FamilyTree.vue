<script setup lang="ts">
// Family tree for `family` pages (all members + people related to them) and `character` pages
// (ancestors and descendants up to 3 generations). Genealogy = relations of kind parent / spouse / sibling.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import type { Entity } from '@/model/types'
import { plural } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import { toast } from '@/components/common/toast'
import FamilyCard from './family/FamilyCard.vue'
import AddRelativeModal from './family/AddRelativeModal.vue'
import { buildKinGraph, characterSelection, familySelection, kinRelationsOf, type AddKind, type KinLink } from './family/genealogy'
import { DEFAULT_LAYOUT, layoutFamily, type LayoutResult } from './family/layout'
import { usePanZoom } from './graph/panZoom'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()
const router = useRouter()

const isFamily = computed(() => props.entity.type === 'family')
const L = DEFAULT_LAYOUT

// ---------- data ----------
const kinRelations = computed(() => world.visibleRelations.filter((r) => r.kind === 'parent' || r.kind === 'spouse' || r.kind === 'sibling'))
const graph = computed(() => buildKinGraph(kinRelations.value))
const exists = (id: string) => !!world.get(id)

const members = computed(() => {
  if (!isFamily.value) return [] as Entity[]
  const fid = props.entity.id
  return world.list.filter((e) => Array.isArray(e.fields?.familyIds) && e.fields.familyIds.includes(fid))
})

const selection = computed(() => {
  if (isFamily.value) {
    const s = familySelection(members.value.map((m) => m.id), graph.value, exists)
    return { ids: s.ids, core: s.core, extern: s.extern }
  }
  const s = characterSelection(props.entity.id, graph.value, exists, 3, 3)
  return { ids: s.ids, core: new Set<string>(), extern: new Set<string>() }
})

const layout = computed<LayoutResult>(() => {
  const sel = selection.value.ids
  const g = graph.value
  const ents = [...sel].map((id) => world.get(id)).filter((e): e is Entity => !!e)
  // priority: family members before relatives, then by name
  ents.sort((a, b) => Number(selection.value.extern.has(a.id)) - Number(selection.value.extern.has(b.id)) || a.name.localeCompare(b.name, 'ru'))
  const ids = ents.map((e) => e.id)
  const inSel = (id: string) => sel.has(id)
  const parentEdges: Array<[string, string]> = []
  const spousePairs: Array<[string, string]> = []
  const siblingPairs: Array<[string, string]> = []
  for (const id of ids) {
    for (const c of g.children.get(id)?.keys() ?? []) if (inSel(c)) parentEdges.push([id, c])
    for (const s of g.spouses.get(id)?.keys() ?? []) if (inSel(s) && id < s) spousePairs.push([id, s])
    for (const s of g.siblings.get(id)?.keys() ?? []) if (inSel(s) && id < s) siblingPairs.push([id, s])
  }
  return layoutFamily({ ids, parentEdges, spousePairs, siblingPairs }, L)
})

const nodes = computed(() => [...layout.value.nodes.values()].map((p) => ({ ...p, e: world.get(p.id)! })).filter((n) => n.e))
const relativesCount = computed(() => nodes.value.length)
const svgBox = computed(() => {
  const b = layout.value.bounds
  const pad = 40
  return { x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 }
})

// ---------- hover highlight ----------
const hovered = ref<string | null>(null)
const related = computed(() => {
  const id = hovered.value
  if (!id) return null
  const set = new Set<string>([id])
  for (const c of layout.value.connectors) if (c.ids.includes(id)) {
    if (c.kind === 'child') {
      // connector ids = parents + children; highlight the hovered person's own parents/children only
      const g = graph.value
      for (const o of c.ids) if (g.parents.get(id)?.has(o) || g.children.get(id)?.has(o)) set.add(o)
    } else c.ids.forEach((o) => set.add(o))
  }
  return set
})
function connectorHl(ids: string[]) { return !!hovered.value && ids.includes(hovered.value) }

// ---------- pan & zoom ----------
const viewport = ref<HTMLElement | null>(null)
const pz = usePanZoom(viewport, { minK: 0.15, maxK: 2.5 })
const fullscreen = ref(false)
const zoomPct = computed(() => Math.round(pz.view.k * 100))

function fitView() {
  const b = layout.value.bounds
  if (!layout.value.nodes.size) return
  const need = pz.fit(b, 30, 1, 0.5)
  if (need < 0.5) {
    // tree too big to fit legibly: show the focus person (character) or the top of the tree (family)
    const focus = !isFamily.value ? layout.value.nodes.get(props.entity.id) : null
    if (focus) pz.centerOn(focus.x, focus.y + L.nodeH / 2, 0.75)
    else {
      const r = viewport.value?.getBoundingClientRect()
      pz.setView({ k: 0.6, x: (r?.width ?? 0) / 2 - ((b.minX + b.maxX) / 2) * 0.6, y: 30 - b.minY * 0.6 })
    }
  }
}
function centerFocus() {
  const focus = layout.value.nodes.get(props.entity.id)
  if (focus) pz.centerOn(focus.x, focus.y + L.nodeH / 2, Math.max(pz.view.k, 0.8))
  else fitView()
}

let fitted = ''
async function maybeFit() {
  await nextTick()
  if (!viewport.value || !layout.value.nodes.size) return
  const key = props.entity.id + (fullscreen.value ? ':fs' : '')
  if (fitted === key) return
  fitted = key
  fitView()
}
watch(() => [props.entity.id, layout.value.nodes.size > 0], () => { void maybeFit() })
watch(fullscreen, () => { void maybeFit() })
onMounted(() => { void maybeFit() })

function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && fullscreen.value) fullscreen.value = false }
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

// ---------- navigation ----------
function open(id: string) {
  if (pz.wasDragged()) return
  if (id === props.entity.id) return
  void router.push({ name: 'entity', params: { wid: world.wid!, eid: id } })
}

// ---------- editing ----------
const addModal = ref<{ person: Entity | null; kind: AddKind | 'member' } | null>(null)
function linksOf(id: string): KinLink[] {
  return kinRelationsOf(graph.value, id).filter((l) => exists(l.otherId))
}
function onAdd(person: Entity, kind: AddKind) { addModal.value = { person, kind } }
const KIND_TEXT: Record<KinLink['kind'], string> = { parent: 'родитель', child: 'ребёнок', spouse: 'супруг(а)', sibling: 'брат/сестра' }
async function onUnlink(person: Entity, link: KinLink) {
  const other = world.get(link.otherId)?.name ?? 'скрыто'
  if (!confirm(`Убрать связь: «${other}» — ${KIND_TEXT[link.kind]} для «${person.name}»?`)) return
  try {
    await world.deleteRelation(link.relationId)
    toast.success('Связь удалена')
  } catch { /* toast shown by the store */ }
}
async function onLeave(person: Entity) {
  if (!confirm(`Убрать «${person.name}» из семьи «${props.entity.name}»? Родственные связи сохранятся.`)) return
  const ids = (person.fields?.familyIds ?? []).filter((x: string) => x !== props.entity.id)
  try { await world.updateEntity(person.id, { fields: { ...person.fields, familyIds: ids } }) } catch { /* toast shown */ }
}
function canLeave(e: Entity) { return isFamily.value && selection.value.core.has(e.id) && world.canEdit(e) }

const cycleTitle = computed(() => 'Связи «родитель» образуют цикл и не показаны: ' + layout.value.droppedEdges
  .map(([p, c]) => `${world.get(p)?.name ?? '?'} → ${world.get(c)?.name ?? '?'}`).join('; '))
const characterFamilies = computed(() => (!isFamily.value ? ((props.entity.fields?.familyIds ?? []) as string[]).filter(exists) : []))
const isAlone = computed(() => !isFamily.value && nodes.value.length <= 1)
</script>

<template>
  <div class="ft" :class="{ fullscreen }">
    <div class="ft-toolbar">
      <div class="ft-info">
        <template v-if="isFamily">
          <span class="muted small">{{ members.length }} {{ plural(members.length, 'член семьи', 'члена семьи', 'членов семьи') }}<template v-if="relativesCount > members.length"> · ещё {{ relativesCount - members.length }} {{ plural(relativesCount - members.length, 'родственник', 'родственника', 'родственников') }}</template></span>
        </template>
        <template v-else>
          <span v-if="characterFamilies.length" class="ft-fams small">
            <span class="muted">{{ characterFamilies.length > 1 ? 'Семьи:' : 'Семья:' }}</span>
            <EntityLink v-for="f in characterFamilies" :key="f" :id="f" />
          </span>
          <span v-else class="muted small">Предки и потомки до трёх поколений</span>
        </template>
      </div>
      <span class="grow" />
      <span v-if="layout.droppedEdges.length" class="ft-warn small" :title="cycleTitle">
        <Icon name="triangle-alert" :size="14" /> Цикл в родословной
      </span>
      <button v-if="editing && isFamily" type="button" class="btn btn-sm" @click="addModal = { person: null, kind: 'member' }"><Icon name="user-plus" :size="15" /> Член семьи</button>
      <div class="ft-zoom">
        <button type="button" class="icon-btn" title="Уменьшить" @click="pz.zoomBy(1 / 1.25)"><Icon name="zoom-out" :size="16" /></button>
        <span class="ft-pct small muted">{{ zoomPct }}%</span>
        <button type="button" class="icon-btn" title="Увеличить" @click="pz.zoomBy(1.25)"><Icon name="zoom-in" :size="16" /></button>
        <button type="button" class="icon-btn" title="Вписать в окно" @click="fitView"><Icon name="maximize2" :size="16" /></button>
        <button v-if="!isFamily" type="button" class="icon-btn" title="К персонажу" @click="centerFocus"><Icon name="locate" :size="16" /></button>
        <button type="button" class="icon-btn" :title="fullscreen ? 'Выйти из полноэкранного режима' : 'Во весь экран'" @click="fullscreen = !fullscreen">
          <Icon :name="fullscreen ? 'minimize2' : 'maximize2'" :size="16" />
        </button>
      </div>
    </div>

    <div v-if="isFamily && !nodes.length" class="empty ft-empty">
      <Icon name="users" :size="32" />
      <div>В семье пока нет персонажей.</div>
      <div class="muted small">Укажите эту семью в поле «Семьи» у персонажей<template v-if="editing"> или добавьте их кнопкой «Член семьи»</template>.</div>
    </div>

    <div v-else ref="viewport" class="ft-viewport">
      <div class="ft-world" :style="{ transform: `translate(${pz.view.x}px, ${pz.view.y}px) scale(${pz.view.k})` }">
        <svg class="ft-lines" :style="{ left: svgBox.x + 'px', top: svgBox.y + 'px', width: svgBox.w + 'px', height: svgBox.h + 'px' }"
          :viewBox="`${svgBox.x} ${svgBox.y} ${svgBox.w} ${svgBox.h}`" aria-hidden="true">
          <g v-for="(c, i) in layout.connectors" :key="i" class="ft-conn" :class="[c.kind, { solid: c.adjacent, hl: connectorHl(c.ids), dim: hovered && !connectorHl(c.ids) }]">
            <path :d="c.d" />
            <g v-if="c.mark" class="ft-ring" :transform="`translate(${c.mark.x} ${c.mark.y})`">
              <circle r="5.5" />
            </g>
          </g>
        </svg>
        <FamilyCard v-for="n in nodes" :key="n.id" :entity="n.e"
          :style="{ left: n.x - L.nodeW / 2 + 'px', top: n.y + 'px', width: L.nodeW + 'px', height: L.nodeH + 'px' }"
          :focus="!isFamily && n.id === entity.id" :extern="selection.extern.has(n.id)" :editing="editing"
          :dim="!!related && !related.has(n.id)" :hl="!!related && related.has(n.id) && n.id !== hovered"
          :links="editing ? linksOf(n.id) : undefined" :can-leave-family="editing && canLeave(n.e)"
          @mouseenter="hovered = n.id" @mouseleave="hovered === n.id && (hovered = null)"
          @open="open(n.id)" @add="(k: AddKind) => onAdd(n.e, k)" @unlink="(l: KinLink) => onUnlink(n.e, l)" @leave="onLeave(n.e)" />
      </div>
      <div v-if="isAlone" class="ft-hint small">
        Родственные связи не указаны.<template v-if="editing"> Добавьте родителей, детей или супругов через меню <Icon name="more-horizontal" :size="14" /> на карточке.</template>
      </div>
      <div v-if="isFamily && selection.extern.size" class="ft-legend small">
        <span><i class="lg-card" /> член семьи</span>
        <span><i class="lg-card ext" /> родственник</span>
        <span><i class="lg-line" /> брак</span>
      </div>
    </div>

    <AddRelativeModal v-if="addModal" :person="addModal.person" :kind="addModal.kind" :graph="graph" :family="isFamily ? entity : null" @close="addModal = null" />
  </div>
</template>

<style scoped>
.ft { display: flex; flex-direction: column; gap: 8px; }
.ft.fullscreen { position: fixed; inset: 0; z-index: 200; background: var(--bg); padding: 10px 14px 14px; }
.ft-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 34px; }
.ft-info { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ft-fams { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; }
.ft-warn { display: inline-flex; align-items: center; gap: 4px; color: var(--warning); cursor: help; }
.ft-zoom { display: inline-flex; align-items: center; gap: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
.ft-zoom .icon-btn { width: 30px; height: 30px; }
.ft-pct { min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; }

.ft-viewport {
  position: relative; height: 560px; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius);
  background-color: var(--surface-2);
  background-image: radial-gradient(circle, color-mix(in srgb, var(--text-faint) 28%, transparent) 1px, transparent 1.2px);
  background-size: 22px 22px; cursor: grab; touch-action: none; user-select: none;
}
.ft-viewport:active { cursor: grabbing; }
.ft.fullscreen .ft-viewport { flex: 1; height: auto; }
.ft-world { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; will-change: transform; }
.ft-lines { position: absolute; overflow: visible; pointer-events: none; }

.ft-conn path { fill: none; stroke: var(--border-strong); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; transition: stroke .12s, opacity .12s; }
.ft-conn.child path { stroke: color-mix(in srgb, var(--text-faint) 80%, var(--border-strong)); }
.ft-conn.spouse path { stroke: var(--accent); stroke-width: 2.5; }
.ft-conn.spouse:not(.solid) path { stroke-dasharray: 6 5; stroke-width: 2; }
.ft-conn.sibling path { stroke-dasharray: 2 5; stroke-width: 2; }
.ft-conn.hl path { stroke: var(--accent); stroke-width: 3; }
.ft-conn.dim { opacity: .35; }
.ft-ring circle { fill: var(--surface); stroke: var(--accent); stroke-width: 2; }
.ft-conn.hl .ft-ring circle { fill: var(--accent); }

.ft-hint {
  position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); max-width: calc(100% - 28px);
  padding: 8px 14px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); color: var(--text-muted);
  box-shadow: var(--shadow); text-align: center; pointer-events: none;
}
.ft-legend {
  position: absolute; left: 10px; bottom: 10px; display: flex; gap: 12px; padding: 5px 10px; border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 90%, transparent); border: 1px solid var(--border); color: var(--text-muted); pointer-events: none;
}
.ft-legend span { display: inline-flex; align-items: center; gap: 5px; }
.lg-card { display: inline-block; width: 16px; height: 11px; border-radius: 3px; border: 1px solid var(--border-strong); background: var(--surface); }
.lg-card.ext { border-style: dashed; background: var(--surface-2); }
.lg-line { display: inline-block; width: 18px; height: 0; border-top: 2.5px solid var(--accent); }
.ft-empty { border: 1px dashed var(--border-strong); border-radius: var(--radius); }

@media (max-width: 720px) {
  .ft-viewport { height: 460px; }
  .ft-legend { display: none; }
}
</style>
