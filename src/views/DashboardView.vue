<script setup lang="ts">
// The world overview: blocks in a table-like grid of 12 columns and rows (src/components/dashboard/layout.ts).
// Blocks of one row start and end on one level; columns may stay empty; a block may span several rows, next to
// blocks placed one above the other. Masters switch on «Настроить обзор» to add, remove, move and resize blocks and
// change their settings; the layout lives in world.settings.dashboard.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useWorld } from '@/stores/world'
import { clean, errorText } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import { toast } from '@/components/common/toast'
import DashBlockView from '@/components/dashboard/DashBlockView.vue'
import DashBlockSettings from '@/components/dashboard/DashBlockSettings.vue'
import DashAddModal from '@/components/dashboard/DashAddModal.vue'
import { GAP_PX, defaultLayout, kindOf, midW, newBlock, normalizeLayout, titleOf } from '@/components/dashboard/blocks'
import { clampX, freePlace, insertAt, maxWidth, neighbour, placeAt, rowsWithout, tidy, visibleCells, type Cell, type Geometry } from '@/components/dashboard/layout'
import { useDashData } from '@/components/dashboard/useDashData'
import { useGridEdit } from '@/components/dashboard/useGridEdit'
import type { DashBlock, DashBlockType, DashboardLayout } from '@/model/types'

const world = useWorld()
const saved = computed(() => normalizeLayout(world.settings.dashboard, world.settings.dashboardPins))
const editing = ref(false)
const draft = ref<DashboardLayout | null>(null)
const layout = computed(() => (editing.value && draft.value ? draft.value : saved.value))
const blocks = computed(() => layout.value.blocks)
const data = useDashData(blocks)
/** Outside edit mode a block shows only if this viewer may see it and it has something to show. */
const shown = computed(() => (editing.value ? blocks.value : blocks.value.filter((b) => data.allowed(b) && data.hasContent(b))))
const gap = computed(() => GAP_PX[layout.value.gap ?? 'md'])
/** Where every shown block stands (rows left empty by hidden blocks close up). */
const cells = computed(() => visibleCells(shown.value))

// ---------- page width → mode ----------
const wrapEl = ref<HTMLElement | null>(null)
const gridEl = ref<HTMLElement | null>(null)
const gridW = ref(1200)
/** grid: blocks at their columns and rows; two / one: blocks follow each other (two per row at most, or one). */
const mode = computed(() => (gridW.value >= 860 ? 'grid' : gridW.value >= 540 ? 'two' : 'one'))
let gridRo: ResizeObserver | null = null
onMounted(() => {
  gridRo = new ResizeObserver(() => { if (wrapEl.value) gridW.value = wrapEl.value.clientWidth })
  if (wrapEl.value) { gridW.value = wrapEl.value.clientWidth; gridRo.observe(wrapEl.value) }
})
onBeforeUnmount(() => gridRo?.disconnect())

// ---------- editing: changes go to a draft and are saved shortly after (one write per gesture) ----------
const history = ref<DashboardLayout[]>([])
let saveTimer: ReturnType<typeof setTimeout> | null = null
async function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  if (!draft.value) return
  try { await world.updateSettings({ dashboard: clean(draft.value) }) } catch (e) { toast.error('Не удалось сохранить обзор: ' + errorText(e)) }
}
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flush(), 700)
}
const remember = () => { if (draft.value) history.value = [...history.value.slice(-39), clean(draft.value)] }
/** A change of the layout: `fn` edits a copy, which is then made valid (no overlaps, no empty rows). */
function change(fn: (l: DashboardLayout) => string | void) {
  if (!draft.value) return
  remember()
  const next = clean(draft.value)
  const keep = fn(next)
  tidy(next.blocks, keep || undefined)
  draft.value = next
  scheduleSave()
}
function startEdit() {
  const d = clean(saved.value)
  tidy(d.blocks)
  draft.value = d
  history.value = []
  editing.value = true
}
async function finishEdit() {
  await flush()
  editing.value = false
  draft.value = null
  settingsFor.value = null
}
function undo() {
  const prev = history.value[history.value.length - 1]
  if (!prev) return
  history.value = history.value.slice(0, -1)
  draft.value = prev
  scheduleSave()
}
function resetLayout() {
  if (!confirm('Вернуть стандартный вид обзора? Ваши блоки и их настройки будут заменены (можно отменить кнопкой «Отменить», пока не закрыли настройку).')) return
  change((l) => { Object.assign(l, defaultLayout(world.settings.dashboardPins)) })
}
const find = (l: DashboardLayout, id: string) => l.blocks.find((b) => b.id === id)

// ---------- blocks ----------
const adding = ref(false)
const settingsFor = ref<string | null>(null)
const settingsBlock = computed(() => draft.value?.blocks.find((b) => b.id === settingsFor.value) ?? null)
async function addBlock(type: DashBlockType) {
  adding.value = false
  const b = newBlock(type)
  // the first free place in the existing rows (empty columns), else a new row at the bottom
  change((l) => { const p = freePlace(l.blocks, b.w); l.blocks.push({ ...b, x: p.x, y: p.y, rs: 1 }); return b.id })
  if (kindOf(type).needsSetup) settingsFor.value = b.id
  await nextTick()
  document.querySelector(`[data-block-id="${b.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
function saveBlock(b: DashBlock) {
  // a wider block pushes the neighbours it now covers down
  change((l) => { const i = l.blocks.findIndex((x) => x.id === b.id); if (i >= 0) l.blocks[i] = { ...b, x: clampX(b.x, b.w) }; return b.id })
  settingsFor.value = null
}
function removeBlock(id: string) {
  change((l) => { l.blocks = l.blocks.filter((b) => b.id !== id) })
  settingsFor.value = null
}
function duplicate(id: string) {
  change((l) => {
    const src = find(l, id)
    if (!src) return
    const copy = { ...clean(src), id: newBlock(src.type).id }
    l.blocks.push(copy)
    const at = rowsWithout(l.blocks, copy.id, src.id)
    insertAt(l.blocks, copy.id, at ? at.end + 1 : 0, src.x ?? 0)
    return copy.id
  })
}
/** Arrow moves: a column left/right (neighbours in the way move down), or above/below the neighbouring block. */
function nudge(id: string, dir: 'left' | 'right' | 'up' | 'down') {
  change((l) => {
    const b = find(l, id)
    if (!b) return
    if (dir === 'left' || dir === 'right') { b.x = clampX((b.x ?? 0) + (dir === 'left' ? -1 : 1), b.w); return id }
    const n = neighbour(l.blocks, id, dir)
    if (!n) return
    const at = rowsWithout(l.blocks, id, n.id)
    if (at) insertAt(l.blocks, id, dir === 'up' ? at.row : at.end + 1, b.x ?? 0)
    return id
  })
}
function setHeight(id: string, h: number) { change((l) => { const b = find(l, id); if (b) b.h = h }) }

// ---------- mouse / touch ----------
/** The rows as drawn: px from the top of the grid (the browser has already sized them to their blocks). */
function geometry(): Geometry {
  const g = gridEl.value
  if (!g) return { tops: [], bottoms: [] }
  const cs = getComputedStyle(g)
  const gapPx = parseFloat(cs.rowGap) || 0
  const sizes = cs.gridTemplateRows.split(' ').map(parseFloat).filter((n) => Number.isFinite(n))
  const tops: number[] = [], bottoms: number[] = []
  let y = 0
  for (const s of sizes) { tops.push(y); bottoms.push(y + s); y += s + gapPx }
  return { tops, bottoms }
}
let dragBase: DashBlock[] | null = null
let dragGeo: Geometry = { tops: [], bottoms: [] }
let resizing = false
const { onPointerDown, floating } = useGridEdit(() => gridEl.value, {
  mode: () => (mode.value === 'grid' ? 'grid' : 'list'),
  gap: () => gap.value,
  dragStart: () => {
    if (!draft.value) return
    remember()
    dragBase = clean(draft.value.blocks)
    dragGeo = geometry()
  },
  dragTo: (id, x, top) => {
    if (!draft.value || !dragBase) return
    // keep the list order while dragging: re-ordering the elements would make the dragged one lose the pointer
    const placed = new Map(placeAt(dragBase, id, x, top, dragGeo).map((b) => [b.id, b]))
    draft.value.blocks = dragBase.map((b) => placed.get(b.id) ?? b)
  },
  dragEnd: (_id, commit) => {
    const base = dragBase
    dragBase = null
    if (!draft.value || !base) return
    if (!commit) { undo(); return }
    tidy(draft.value.blocks)
    draft.value = clean(draft.value)
    scheduleSave()
  },
  // narrow page: before / after the target in reading order, in its column
  move: (id, targetId, after) => change((l) => {
    const t = find(l, targetId)
    const at = rowsWithout(l.blocks, id, targetId)
    if (!t || !at) return
    insertAt(l.blocks, id, after ? at.end + 1 : at.row, t.x ?? 0)
    return id
  }),
  resize: (id, w, h) => {
    if (!draft.value) return
    if (!resizing) remember()
    resizing = true
    const b = find(draft.value, id)
    if (!b) return
    // grows to the right up to the next block of its rows
    if (w !== null) b.w = Math.max(2, Math.min(w, maxWidth(draft.value.blocks, id)))
    if (h !== null) b.h = h
  },
  resizeEnd: () => {
    if (!resizing || !draft.value) return
    resizing = false
    tidy(draft.value.blocks)
    draft.value = clean(draft.value)
    scheduleSave()
  },
})
const cellStyle = (c: Cell) => ({ '--gc': `${c.x + 1} / span ${c.w}`, '--gr': `${c.row + 1} / span ${c.span}` })
const placeholder = computed(() => {
  const f = floating.value
  const c = f && mode.value === 'grid' ? cells.value.get(f.id) : null
  return c && f ? { ...cellStyle(c), minHeight: f.height + 'px' } : null
})
function blockStyle(b: DashBlock) {
  const c = cells.value.get(b.id)
  const st: Record<string, string | number | undefined> = { '--w': b.w, '--wm': midW(b.w), '--h': b.h > 0 ? b.h + 'px' : undefined, ...(c ? cellStyle(c) : {}) }
  const f = floating.value
  if (f && f.id === b.id) Object.assign(st, { left: f.left + 'px', top: f.top + 'px', width: f.width + 'px', height: f.height + 'px' })
  return st
}

function onKey(e: KeyboardEvent) {
  if (!editing.value || settingsFor.value || adding.value) return
  const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')
  if (!typing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); if (saveTimer) void flush() })
onBeforeRouteLeave(async () => { if (saveTimer) await flush() })

const SHOW_LABEL = { members: 'участникам', masters: 'мастерам' } as const
</script>

<template>
  <Teleport defer to="#crumbs"><span style="color: var(--text)">Обзор</span></Teleport>
  <Teleport defer to="#topbar-actions">
    <button v-if="world.isMaster && !editing" class="btn btn-sm btn-ghost" aria-label="Настроить обзор" title="Добавить, убрать, переставить блоки обзора и поменять их размер" @click="startEdit"><Icon name="layout-dashboard" :size="15" /><span class="hide-sm"> Настроить обзор</span></button>
  </Teleport>
  <div class="content" :class="{ 'content-wide': layout.wide }">
    <div v-if="editing" class="db-toolbar card">
      <div class="db-tb-title"><Icon name="layout-dashboard" :size="17" /> <b>Настройка обзора</b>
        <span class="faint small hide-sm">Тащите блок за <Icon name="grip-vertical" :size="13" />: на пустые колонки ряда — в этот ряд, на верх или низ другого блока — над ним или под ним. Размер — за края. Изменения видны всем сразу.</span>
      </div>
      <div class="db-tb-actions">
        <button class="btn btn-sm btn-primary" @click="adding = true"><Icon name="plus" :size="15" /> Блок</button>
        <div class="db-tb-group" title="Расстояние между блоками">
          <span class="faint small">Отступы</span>
          <button v-for="g in (['sm', 'md', 'lg'] as const)" :key="g" class="chip" :class="{ on: (layout.gap ?? 'md') === g }" @click="change((l) => { l.gap = g })">{{ { sm: 'S', md: 'M', lg: 'L' }[g] }}</button>
        </div>
        <button class="chip" :class="{ on: layout.wide }" title="Растянуть обзор на всё окно" @click="change((l) => { l.wide = !l.wide })"><Icon name="maximize2" :size="13" /> Во всю ширину</button>
        <span class="grow" />
        <button class="btn btn-sm btn-ghost" :disabled="!history.length" title="Отменить (Ctrl+Z)" @click="undo"><Icon name="undo2" :size="15" /><span class="hide-sm"> Отменить</span></button>
        <button class="btn btn-sm btn-ghost" title="Вернуть стандартный набор блоков" @click="resetLayout"><Icon name="rotate-ccw" :size="15" /><span class="hide-sm"> Стандартный вид</span></button>
        <button class="btn btn-sm" @click="finishEdit"><Icon name="check" :size="15" /> Готово</button>
      </div>
      <p v-if="mode !== 'grid'" class="faint small" style="margin: 0">На узком экране блоки идут друг за другом; расставить их по колонкам можно на широком.</p>
    </div>

    <div ref="wrapEl" class="db-wrap">
      <div ref="gridEl" class="db-grid" :class="['mode-' + mode, { editing }]" :style="{ '--g': gap + 'px' }" @pointerdown="editing && onPointerDown($event)">
        <div v-if="placeholder" class="db-placeholder" :style="placeholder" />
        <div v-for="b in shown" :key="b.id" class="db-block" data-block :data-block-id="b.id"
          :class="['db-' + (b.type === 'hero' ? 'hero' : b.style ?? 'card'), { fixed: b.h > 0, 'is-empty': editing && !data.hasContent(b), 'db-floating': floating?.id === b.id }]"
          :style="blockStyle(b)">
          <div v-if="editing" class="db-edit-bar">
            <button class="db-grip" data-block-grip title="Перетащите, чтобы переставить блок"><Icon name="grip-vertical" :size="16" /></button>
            <Icon :name="kindOf(b.type).icon" :size="14" class="faint" />
            <span class="ellipsis grow db-eb-title">{{ titleOf(b) }}</span>
            <span v-if="b.show && b.show !== 'all'" class="badge db-eb-badge" :title="'Блок видят только ' + SHOW_LABEL[b.show]"><Icon :name="b.show === 'masters' ? 'crown' : 'users'" :size="11" /><span class="db-eb-badge-text"> {{ SHOW_LABEL[b.show] }}</span></span>
            <span v-else-if="!data.hasContent(b)" class="badge db-eb-badge" title="Сейчас блоку нечего показать — на странице его не будет, а блоки под ним поднимутся"><Icon name="eye-off" :size="11" /><span class="db-eb-badge-text"> пуст</span></span>
            <button class="icon-btn" title="Настройки блока" @click="settingsFor = b.id"><Icon name="settings" :size="15" /></button>
            <Dropdown placement="bottom-end">
              <template #trigger><button class="icon-btn" title="Ещё"><Icon name="more-horizontal" :size="15" /></button></template>
              <div class="menu">
                <template v-if="mode === 'grid'">
                  <button class="menu-item" :disabled="(b.x ?? 0) === 0" @click="nudge(b.id, 'left')"><Icon name="arrow-left" :size="15" /> Левее</button>
                  <button class="menu-item" :disabled="(b.x ?? 0) + b.w >= 12" @click="nudge(b.id, 'right')"><Icon name="arrow-right" :size="15" /> Правее</button>
                </template>
                <button class="menu-item" @click="nudge(b.id, 'up')"><Icon name="arrow-up" :size="15" /> Выше</button>
                <button class="menu-item" @click="nudge(b.id, 'down')"><Icon name="arrow-down" :size="15" /> Ниже</button>
                <button class="menu-item" @click="duplicate(b.id)"><Icon name="copy" :size="15" /> Копия блока</button>
                <button v-if="b.h" class="menu-item" @click="setHeight(b.id, 0)"><Icon name="move-vertical" :size="15" /> Высота по содержимому</button>
                <button class="menu-item danger" @click="removeBlock(b.id)"><Icon name="trash2" :size="15" /> Убрать блок</button>
              </div>
            </Dropdown>
            <button class="icon-btn" title="Убрать блок" @click="removeBlock(b.id)"><Icon name="x" :size="15" /></button>
          </div>
          <div class="db-body"><DashBlockView :block="b" :data="data" :editing="editing" @setup="settingsFor = b.id" /></div>
          <template v-if="editing">
            <span class="db-rs db-rs-x" data-block-resize="x" title="Ширина" />
            <span class="db-rs db-rs-y" data-block-resize="y" title="Высота (двойной щелчок — по содержимому)" @dblclick="setHeight(b.id, 0)" />
            <span class="db-rs db-rs-xy" data-block-resize="xy" title="Размер" />
            <span class="db-size-tip">{{ b.w }}/12 · {{ b.h ? 'от ' + b.h + ' px' : 'по содержимому' }}</span>
          </template>
        </div>
      </div>
      <button v-if="editing" class="db-add-bar" @click="adding = true"><Icon name="plus" :size="18" /> Добавить блок</button>
      <div v-if="!shown.length && !editing" class="card empty">
        <Icon name="layout-dashboard" :size="30" />
        <p>{{ world.isMaster ? 'На обзоре нет блоков.' : 'Здесь пока пусто.' }}</p>
        <button v-if="world.isMaster" class="btn btn-primary" @click="startEdit"><Icon name="layout-dashboard" :size="15" /> Настроить обзор</button>
      </div>
    </div>

    <DashAddModal v-if="adding" :present="blocks.map((b) => b.type)" @close="adding = false" @add="addBlock" />
    <DashBlockSettings v-if="settingsBlock" :key="settingsBlock.id" :block="settingsBlock" @close="settingsFor = null" @save="saveBlock" @remove="removeBlock(settingsBlock.id)" />
  </div>
</template>

<style scoped>
.content-wide { max-width: none; }
.db-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: var(--g); }
/* wide page: blocks at their columns and rows; a row is as tall as its tallest block, the others stretch to it */
.db-grid.mode-grid { grid-auto-rows: auto; row-gap: var(--g); align-items: stretch; }
.mode-grid > .db-block, .mode-grid > .db-placeholder { grid-column: var(--gc); grid-row: var(--gr); }
/* narrow page: one after another, two per row at most (or one) */
.db-grid.mode-two, .db-grid.mode-one { row-gap: var(--g); align-items: stretch; }
.mode-two > .db-block { grid-column: span var(--wm); }
.mode-one > .db-block { grid-column: span 12; }

.db-block { position: relative; display: flex; flex-direction: column; min-width: 0; border-radius: 14px; }
.editing .db-block { container: dbblock / inline-size; }
.db-card { background: var(--surface); border: 1px solid var(--border); padding: 16px 18px; }
.db-accent { background: color-mix(in srgb, var(--accent) 10%, var(--surface)); border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); padding: 16px 18px; }
.db-plain { padding: 0; }
.db-hero { padding: 0; overflow: hidden; border: 1px solid var(--border); }
.db-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.db-body > * { flex: 1; }
/* a set height: the block asks its row for that much (the content does not count — `contain: size`) and scrolls
   inside; a taller row still stretches it */
.db-block.fixed { min-height: var(--h); }
.fixed .db-body { contain: size; overflow: auto; scrollbar-width: thin; }
.fixed .db-body > * { flex: 1 0 auto; }
.db-hero.fixed .db-body { overflow: hidden; }

/* ---------- edit mode ---------- */
.db-toolbar { position: sticky; top: calc(var(--topbar-h) + 8px); z-index: 25; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; margin-bottom: 16px; box-shadow: var(--shadow); }
.db-tb-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.db-tb-title > .icon { color: var(--accent); }
.db-tb-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.db-tb-group { display: inline-flex; align-items: center; gap: 4px; }
.editing .db-block { outline: 1px dashed var(--border-strong); outline-offset: 4px; }
.editing .db-block.is-empty { opacity: .72; }
.editing .db-plain, .editing .db-hero { min-height: 90px; }
.editing .db-body { pointer-events: none; user-select: none; }
.editing .db-body :deep(.dbv-setup) { pointer-events: auto; }
.db-edit-bar { display: flex; align-items: center; gap: 4px; padding: 3px 4px 3px 2px; margin-bottom: 10px; border-radius: 8px; background: var(--surface-2); border: 1px solid var(--border); font-size: 13px; min-width: 0; }
.db-card .db-edit-bar, .db-accent .db-edit-bar { margin: -8px -10px 10px; }
.db-hero .db-edit-bar { margin: 0; border-radius: 0; border-width: 0 0 1px; }
.db-edit-bar .icon-btn { width: 26px; height: 26px; flex-shrink: 0; }
.db-eb-title { font-weight: 600; min-width: 40px; }
.db-eb-badge { flex-shrink: 0; }
@container dbblock (max-width: 420px) { .db-eb-badge-text { display: none; } }
.db-grip { border: 0; background: none; color: var(--text-muted); cursor: grab; padding: 4px 2px; display: inline-flex; touch-action: none; border-radius: 6px; flex-shrink: 0; }
.db-grip:hover { background: var(--surface-3); color: var(--text); }
.db-rs { position: absolute; z-index: 3; touch-action: none; }
.db-rs::after { content: ''; position: absolute; background: var(--accent); border-radius: 3px; opacity: .35; transition: opacity .12s; }
.db-rs:hover::after, .db-resizing .db-rs::after { opacity: 1; }
.db-rs-x { top: 25%; bottom: 25%; right: -11px; width: 14px; cursor: ew-resize; }
.db-rs-x::after { top: 0; bottom: 0; left: 5px; width: 4px; }
.db-rs-y { left: 30%; right: 30%; bottom: -11px; height: 14px; cursor: ns-resize; }
.db-rs-y::after { left: 0; right: 0; top: 5px; height: 4px; }
.db-rs-xy { right: -11px; bottom: -11px; width: 20px; height: 20px; cursor: nwse-resize; }
.db-rs-xy::after { right: 5px; bottom: 5px; width: 10px; height: 10px; border-radius: 3px; opacity: .6; }
.mode-two .db-rs-x, .mode-two .db-rs-xy, .mode-one .db-rs-x, .mode-one .db-rs-xy { display: none; }
.db-size-tip { position: absolute; right: 14px; bottom: -22px; z-index: 5; padding: 1px 7px; border-radius: 6px; background: var(--accent); color: var(--accent-fg); font-size: 11.5px; font-weight: 600; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity .12s; }
.db-block:has(.db-rs:hover) .db-size-tip, .db-resizing .db-size-tip { opacity: 1; }
.db-resizing { outline: 2px solid var(--accent) !important; }

/* wide page: the dragged block floats under the pointer, a frame shows where it will stand */
.db-grid .db-floating { position: fixed; z-index: 60; margin: 0; opacity: .94; box-shadow: var(--shadow-lg); cursor: grabbing; }
.db-placeholder { border: 2px dashed var(--accent); border-radius: 14px; background: var(--accent-soft); }
/* narrow page: the block follows the pointer, a line marks where it lands */
.db-dragging { z-index: 50; opacity: .92; box-shadow: var(--shadow-lg); cursor: grabbing; transition: none; }
.db-moving { user-select: none; }
.db-block.db-drop-left::before, .db-block.db-drop-right::before, .db-block.db-drop-above::before, .db-block.db-drop-below::before {
  content: ''; position: absolute; background: var(--accent); border-radius: 3px; z-index: 4; box-shadow: 0 0 0 3px var(--accent-soft);
}
.db-drop-left::before { left: -9px; top: 0; bottom: 0; width: 4px; }
.db-drop-right::before { right: -9px; top: 0; bottom: 0; width: 4px; }
.db-drop-above::before { top: -9px; left: 0; right: 0; height: 4px; }
.db-drop-below::before { bottom: -9px; left: 0; right: 0; height: 4px; }
.db-add-bar { width: 100%; margin-top: 18px; min-height: 64px; border: 2px dashed var(--border-strong); border-radius: 14px; background: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; font: inherit; }
.db-add-bar:hover { border-color: var(--accent); color: var(--accent); }
@media (max-width: 860px) {
  .db-toolbar { top: calc(var(--topbar-h) + 4px); }
  .db-card, .db-accent { padding: 14px; }
}
</style>
