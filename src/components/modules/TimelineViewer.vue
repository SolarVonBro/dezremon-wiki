<script setup lang="ts">
// Kanka-style timeline: eras (collapsible sections) with dated elements on a vertical axis.
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import type { Entity, TimelineElement, TimelineEra } from '@/model/types'
import { plural } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import RichView from '@/components/viewer/RichView.vue'
import { toast } from '@/components/common/toast'
import EraModal from './timeline/EraModal.vue'
import ElementModal from './timeline/ElementModal.vue'
import { dateLabel, eraRange, groupTimeline, resolveIcon, safeColour, sortElements, sortEras, type EraGroup } from './timeline/timelineUtil'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()

const eras = ref<TimelineEra[]>([])
const elements = ref<TimelineElement[]>([])
const loaded = reactive({ eras: false, elements: false })
let stops: Array<() => void> = []

function subscribe(id: string) {
  stops.forEach((s) => s())
  eras.value = []
  elements.value = []
  loaded.eras = loaded.elements = false
  stops = [
    world.watchRows<TimelineEra>('timelineEras', 'timelineId', id, (rows) => { eras.value = rows; loaded.eras = true }),
    world.watchRows<TimelineElement>('timelineElements', 'timelineId', id, (rows) => { elements.value = rows; loaded.elements = true }),
  ]
}
watch(() => [props.entity.id, world.wid], () => { if (world.wid) subscribe(props.entity.id) }, { immediate: true })
onBeforeUnmount(() => stops.forEach((s) => s()))

// ---------- order & grouping ----------
const reverseLocal = ref<boolean | null>(null)
const reverse = computed(() => reverseLocal.value ?? !!props.entity.fields?.reverse)
watch(() => props.entity.id, () => { reverseLocal.value = null })
const groups = computed(() => groupTimeline(eras.value, elements.value, reverse.value))
const eraById = computed(() => new Map(eras.value.map((e) => [e.id, e])))
const isLoading = computed(() => !loaded.eras || !loaded.elements)
const isEmpty = computed(() => !eras.value.length && !elements.value.length)

// ---------- collapsing (local; initial state from isCollapsed) ----------
const collapsed = reactive(new Set<string>())
const seen = new Set<string>()
watch([eras, elements], () => {
  for (const r of [...eras.value, ...elements.value]) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    if (r.isCollapsed) collapsed.add(r.id)
  }
}, { immediate: true })
function toggle(id: string) { if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id) }
const allCollapsed = computed(() => eras.value.length > 0 && eras.value.every((e) => collapsed.has(e.id)))
function toggleAll() {
  if (allCollapsed.value) {
    eras.value.forEach((e) => collapsed.delete(e.id))
    collapsed.delete('__none')
  } else {
    eras.value.forEach((e) => collapsed.add(e.id))
  }
}

// ---------- helpers for the template ----------
function colourOf(el: TimelineElement) { return safeColour(el.colour) }
function iconOf(el: TimelineElement) { return resolveIcon(el.icon) }
function eraOf(el: TimelineElement) { return el.eraId ? eraById.value.get(el.eraId) ?? null : null }
function countLabel(n: number) { return `${n} ${plural(n, 'событие', 'события', 'событий')}` }
function hasBody(el: TimelineElement) { return !!el.html?.trim() }

// ---------- editing ----------
const eraModal = ref<{ era: TimelineEra | null } | null>(null)
const elModal = ref<{ element: TimelineElement | null; preset?: Partial<TimelineElement>; fromEntity?: boolean } | null>(null)

const nextEraOrder = computed(() => eras.value.reduce((m, e) => Math.max(m, (e.order ?? 0) + 1), 0))
function nextElementOrder(eraId: string | null) {
  return elements.value.filter((e) => (e.eraId ?? null) === eraId).reduce((m, e) => Math.max(m, (e.order ?? 0) + 1), 0)
}

function addEra() { eraModal.value = { era: null } }
function editEra(era: TimelineEra) { eraModal.value = { era } }
function addElement(eraId: string | null = null) {
  // New elements go to the last era (chronologically) by default.
  const fallback = eraId ?? sortEras(eras.value).at(-1)?.id ?? null
  elModal.value = { element: null, preset: { eraId: fallback } }
}
function addFromEntity() { elModal.value = { element: null, fromEntity: true, preset: { eraId: sortEras(eras.value).at(-1)?.id ?? null } } }
function editElement(el: TimelineElement) { elModal.value = { element: el } }

async function deleteEra(era: TimelineEra) {
  const inside = elements.value.filter((e) => e.eraId === era.id)
  const msg = inside.length
    ? `Удалить эпоху «${era.name}»? ${countLabel(inside.length)} останутся в хронологии без эпохи.`
    : `Удалить эпоху «${era.name}»?`
  if (!confirm(msg)) return
  try {
    let order = nextElementOrder(null)
    await Promise.all(inside.map((e) => world.saveRow('timelineElements', { id: e.id, eraId: null, order: order++ })))
    await world.deleteRow('timelineEras', era.id)
    toast.success('Эпоха удалена')
  } catch { /* toast shown by the store */ }
}

async function deleteElement(el: TimelineElement) {
  if (!confirm(`Удалить событие «${el.name}»?`)) return
  try { await world.deleteRow('timelineElements', el.id) } catch { /* toast shown */ }
}

/** Writes `order = index` for rows whose order differs. */
async function renumber(collection: 'timelineEras' | 'timelineElements', rows: Array<{ id: string; order: number }>) {
  const writes = rows.map((r, i) => (r.order === i ? null : world.saveRow(collection, { id: r.id, order: i }))).filter(Boolean)
  await Promise.all(writes)
}

/** dir: -1 = visually up, +1 = visually down. */
async function moveEra(era: TimelineEra, dir: -1 | 1) {
  const chrono = sortEras(eras.value)
  const i = chrono.findIndex((e) => e.id === era.id)
  const j = i + (reverse.value ? -dir : dir)
  if (i < 0 || j < 0 || j >= chrono.length) return
  ;[chrono[i], chrono[j]] = [chrono[j], chrono[i]]
  try { await renumber('timelineEras', chrono) } catch { /* toast shown */ }
}

async function moveElement(group: EraGroup, el: TimelineElement, dir: -1 | 1) {
  const chrono = sortElements(group.elements, group.era?.startYear ?? null)
  const i = chrono.findIndex((e) => e.id === el.id)
  const j = i + (reverse.value ? -dir : dir)
  if (i < 0 || j < 0 || j >= chrono.length) return
  const a = chrono[i].year
  const b = chrono[j].year
  if (a != null && b != null && a !== b) {
    toast.info('Порядок событий с разными годами определяется годом — измените год, чтобы переставить.')
    return
  }
  ;[chrono[i], chrono[j]] = [chrono[j], chrono[i]]
  try { await renumber('timelineElements', chrono) } catch { /* toast shown */ }
}

function canMove(group: EraGroup, idx: number, dir: -1 | 1) {
  const other = group.elements[idx + dir]
  if (!other) return false
  const a = group.elements[idx].year
  const b = other.year
  return !(a != null && b != null && a !== b)
}
function eraIndex(era: TimelineEra) { return groups.value.findIndex((g) => g.era?.id === era.id) }
const eraGroupCount = computed(() => groups.value.filter((g) => g.era).length)
</script>

<template>
  <div class="tl-module">
    <div v-if="editing || !isEmpty" class="tl-toolbar">
      <template v-if="editing">
        <button type="button" class="btn btn-sm" @click="addEra"><Icon name="layers" :size="15" /> Эпоха</button>
        <button type="button" class="btn btn-sm btn-primary" @click="addElement()"><Icon name="plus" :size="15" /> Событие</button>
        <button type="button" class="btn btn-sm btn-ghost" title="Создать событие на основе существующей статьи" @click="addFromEntity"><Icon name="link" :size="15" /> Из статьи…</button>
      </template>
      <span class="grow" />
      <span v-if="elements.length" class="muted small">{{ countLabel(elements.length) }}</span>
      <button type="button" class="icon-btn" :title="reverse ? 'Сейчас: новые сверху' : 'Сейчас: старые сверху'" @click="reverseLocal = !reverse">
        <Icon :name="reverse ? 'arrow-up' : 'arrow-down'" :size="16" />
      </button>
      <button v-if="eras.length" type="button" class="icon-btn" :title="allCollapsed ? 'Развернуть все эпохи' : 'Свернуть все эпохи'" @click="toggleAll">
        <Icon :name="allCollapsed ? 'maximize2' : 'minimize2'" :size="16" />
      </button>
    </div>

    <div v-if="isLoading && isEmpty" class="empty"><Icon name="history" :size="28" class="pulse" /><div>Загрузка хронологии…</div></div>
    <div v-else-if="isEmpty" class="empty">
      <Icon name="history" :size="32" />
      <div>В хронологии пока нет событий.</div>
      <div v-if="editing" class="muted small">Добавьте эпоху или первое событие кнопками выше.</div>
    </div>

    <div v-else class="tl">
      <section v-for="g in groups" :key="g.key" class="tl-era" :class="{ 'no-era': !g.era, collapsed: collapsed.has(g.key) }">
        <header class="tl-era-head" @click="toggle(g.key)">
          <div class="tl-era-range">{{ g.era ? eraRange(g.era) : '' }}</div>
          <div class="tl-axis"><span class="tl-era-mark"><Icon :name="collapsed.has(g.key) ? 'chevron-right' : 'chevron-down'" :size="16" /></span></div>
          <div class="tl-era-main">
            <div class="tl-era-title grow">
              <h3>{{ g.era ? g.era.name : 'Вне эпох' }}</h3>
              <span v-if="g.era?.abbreviation" class="badge">{{ g.era.abbreviation }}</span>
              <span v-if="g.era && eraRange(g.era)" class="tl-era-years">{{ eraRange(g.era) }}</span>
              <span class="tl-era-count faint small">{{ countLabel(g.elements.length) }}</span>
            </div>
            <div v-if="editing && g.era" class="tl-tools" @click.stop>
              <button type="button" class="icon-btn" title="Добавить событие в эпоху" @click="addElement(g.era.id)"><Icon name="plus" :size="15" /></button>
              <button type="button" class="icon-btn" title="Выше" :disabled="eraIndex(g.era) <= 0" @click="moveEra(g.era, -1)"><Icon name="arrow-up" :size="15" /></button>
              <button type="button" class="icon-btn" title="Ниже" :disabled="eraIndex(g.era) >= eraGroupCount - 1" @click="moveEra(g.era, 1)"><Icon name="arrow-down" :size="15" /></button>
              <button type="button" class="icon-btn" title="Изменить эпоху" @click="editEra(g.era)"><Icon name="pencil" :size="15" /></button>
              <button type="button" class="icon-btn danger" title="Удалить эпоху" @click="deleteEra(g.era)"><Icon name="trash2" :size="15" /></button>
            </div>
          </div>
        </header>

        <div v-if="!collapsed.has(g.key)" class="tl-era-body">
          <RichView v-if="g.era?.html" :html="g.era.html" class="tl-era-desc" />
          <div v-if="!g.elements.length" class="tl-era-empty faint small">
            В этой эпохе пока нет событий.
            <button v-if="editing && g.era" type="button" class="btn btn-sm btn-ghost" @click="addElement(g.era.id)"><Icon name="plus" :size="14" /> Добавить</button>
          </div>
          <ol v-else class="tl-list">
            <li v-for="(el, idx) in g.elements" :key="el.id" class="tl-item" :class="{ 'has-colour': !!colourOf(el), folded: collapsed.has(el.id) }"
              :style="colourOf(el) ? { '--c': colourOf(el) } : undefined">
              <div class="tl-date" :title="dateLabel(el, eraOf(el))">{{ dateLabel(el, eraOf(el)) }}</div>
              <div class="tl-axis">
                <span class="tl-dot">
                  <Icon v-if="iconOf(el)" :name="iconOf(el)" :size="15" />
                </span>
              </div>
              <article class="tl-card">
                <header class="tl-card-head" :class="{ clickable: hasBody(el) }" @click="hasBody(el) && toggle(el.id)">
                  <div class="tl-card-title grow">
                    <span class="tl-date-inline">{{ dateLabel(el, eraOf(el)) }}</span>
                    <h4>{{ el.name }}</h4>
                    <span v-if="el.entityId" class="tl-link" @click.stop><EntityLink :id="el.entityId" avatar /></span>
                  </div>
                  <div v-if="editing" class="tl-tools" @click.stop>
                    <button type="button" class="icon-btn" title="Выше" :disabled="!canMove(g, idx, -1)" @click="moveElement(g, el, -1)"><Icon name="arrow-up" :size="15" /></button>
                    <button type="button" class="icon-btn" title="Ниже" :disabled="!canMove(g, idx, 1)" @click="moveElement(g, el, 1)"><Icon name="arrow-down" :size="15" /></button>
                    <button type="button" class="icon-btn" title="Изменить" @click="editElement(el)"><Icon name="pencil" :size="15" /></button>
                    <button type="button" class="icon-btn danger" title="Удалить" @click="deleteElement(el)"><Icon name="trash2" :size="15" /></button>
                  </div>
                  <Icon v-if="hasBody(el)" class="tl-chev" :name="collapsed.has(el.id) ? 'chevron-right' : 'chevron-down'" :size="16" />
                </header>
                <RichView v-if="hasBody(el) && !collapsed.has(el.id)" :html="el.html" class="tl-card-body" />
              </article>
            </li>
          </ol>
        </div>
      </section>
    </div>

    <EraModal v-if="eraModal" :timeline="entity" :era="eraModal.era" :next-order="nextEraOrder" @close="eraModal = null" />
    <ElementModal v-if="elModal" :timeline="entity" :eras="eras" :element="elModal.element" :preset="elModal.preset" :from-entity="elModal.fromEntity"
      :next-order="nextElementOrder" @close="elModal = null" />
  </div>
</template>

<style scoped>
.tl-module { --tl-date-w: 128px; --tl-axis-w: 40px; display: flex; flex-direction: column; gap: 12px; }
.tl-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.icon-btn:disabled { opacity: .35; cursor: default; background: none; }
.icon-btn.danger:hover { color: var(--danger); }

.tl { display: flex; flex-direction: column; gap: 4px; }

/* ----- era ----- */
.tl { position: relative; }
.tl::before {
  content: ''; position: absolute; top: 18px; bottom: 10px; left: calc(var(--tl-date-w) + var(--tl-axis-w) / 2 - 1px); width: 2px;
  background: linear-gradient(var(--border-strong), var(--border-strong) 92%, transparent);
}
.tl-era { position: relative; }
.tl-era-head {
  display: grid; grid-template-columns: var(--tl-date-w) var(--tl-axis-w) minmax(0, 1fr); align-items: center;
  padding: 6px 0; cursor: pointer; user-select: none;
}
.tl-era-range {
  padding-right: 8px; text-align: right; font-family: var(--font-head); font-size: 15px; font-weight: 700; color: var(--accent);
  line-height: 1.15; overflow-wrap: anywhere;
}
.tl-era-main {
  display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px 10px 8px 14px; border-radius: var(--radius);
  background: linear-gradient(90deg, var(--accent-soft), transparent 80%);
  border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
}
.tl-era.no-era .tl-era-main { background: var(--surface-2); border-color: var(--border); }
.tl-era-head:hover .tl-era-main { border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
.tl-era-mark {
  position: relative; z-index: 1; width: 32px; height: 32px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%; background: var(--accent); color: var(--accent-fg); box-shadow: 0 0 0 4px var(--bg);
}
.tl-era.no-era .tl-era-mark { background: var(--surface-3); color: var(--text-muted); }
.tl-era-title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; min-width: 0; }
.tl-era-title h3 { margin: 0; font-size: 22px; color: var(--text); }
.tl-era-years { display: none; font-family: var(--font-head); font-size: 16px; font-weight: 600; color: var(--accent); }
.tl-era-count { margin-left: auto; }
.tl-era-body { padding: 0 0 12px; }
.tl-era-desc { font-size: 15px; margin: 6px 4px 4px calc(var(--tl-date-w) + var(--tl-axis-w) + 4px); color: var(--text-muted); }
.tl-era-empty { display: flex; align-items: center; gap: 8px; padding: 8px 0 4px calc(var(--tl-date-w) + var(--tl-axis-w) + 4px); }
.tl-tools { display: flex; align-items: center; gap: 0; opacity: .55; transition: opacity .12s; }
.tl-era-head:hover .tl-tools, .tl-card:hover .tl-tools, .tl-tools:focus-within { opacity: 1; }
.tl-tools .icon-btn { width: 28px; height: 28px; }

/* ----- elements on the axis ----- */
.tl-list { list-style: none; margin: 0; padding: 2px 0 0; position: relative; }
.tl-item {
  --c: var(--accent);
  position: relative; display: grid; grid-template-columns: var(--tl-date-w) var(--tl-axis-w) minmax(0, 1fr); align-items: start;
  padding: 6px 0;
}
.tl-date {
  padding: 9px 8px 0 0; text-align: right; font-family: var(--font-head); font-weight: 700; font-size: 16px; line-height: 1.2;
  color: var(--text-muted); overflow-wrap: anywhere;
}
.tl-item.has-colour .tl-date { color: color-mix(in srgb, var(--c) 70%, var(--text)); }
.tl-axis { position: relative; display: flex; justify-content: center; padding-top: 4px; }
.tl-dot {
  position: relative; z-index: 1; width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--c) 18%, var(--surface)); border: 2px solid var(--c); color: var(--c);
  box-shadow: 0 0 0 4px var(--bg);
}
.tl-item:not(.has-colour) .tl-dot { border-color: var(--border-strong); color: var(--accent); background: var(--surface); }
.tl-dot:empty::after { content: ''; width: 10px; height: 10px; border-radius: 50%; background: var(--c); }

.tl-card {
  position: relative; min-width: 0; background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--border-strong);
  border-radius: var(--radius); box-shadow: var(--shadow); transition: border-color .12s;
}
.tl-item.has-colour .tl-card { border-left-color: var(--c); }
.tl-card::before {
  content: ''; position: absolute; left: -11px; top: 14px; width: 8px; height: 2px; background: var(--border-strong);
}
.tl-item.has-colour .tl-card::before { background: var(--c); }
.tl-card:hover { border-color: var(--border-strong); }
.tl-item.has-colour .tl-card:hover { border-left-color: var(--c); }
.tl-card-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px 8px 14px; min-height: 42px; }
.tl-card-head.clickable { cursor: pointer; }
.tl-card-title { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; min-width: 0; }
.tl-card-title h4 { margin: 0; font-family: var(--font-head); font-size: 19px; font-weight: 700; color: var(--text); line-height: 1.25; }
.tl-date-inline { display: none; font-size: 12.5px; font-weight: 600; color: var(--text-muted); width: 100%; }
.tl-link { display: inline-flex; min-width: 0; max-width: 100%; font-size: 14px; }
.tl-chev { color: var(--text-faint); }
.tl-card-body { padding: 0 14px 10px; font-size: 15.5px; }
.tl-card-body > :deep(:last-child) { margin-bottom: 0; }

@media (max-width: 720px) {
  .tl-module { --tl-date-w: 0px; --tl-axis-w: 34px; }
  .tl-date, .tl-era-range { display: none; }
  .tl-date-inline, .tl-era-years { display: block; }
  .tl-era-years { display: inline; }
  .tl-item.has-colour .tl-date-inline { color: color-mix(in srgb, var(--c) 70%, var(--text)); }
  .tl-dot { width: 26px; height: 26px; }
  .tl-era-desc, .tl-era-empty { margin-left: 0; padding-left: 0; }
  .tl-era-title h3 { font-size: 19px; }
  .tl-tools { opacity: 1; }
}
</style>
