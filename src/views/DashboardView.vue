<script setup lang="ts">
// The world overview: blocks placed in a 12-column grid (src/components/dashboard). Every block keeps its column
// and moves up until the block above it (layout.ts), so rows may have empty columns and short blocks can stand
// one above the other next to a tall one. Masters switch on «Настроить обзор» to add, remove, move and resize
// blocks and change their settings; the layout lives in world.settings.dashboard.
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
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
import { ROW, clampX, compact, freeSpot, rowsFor, type Slot } from '@/components/dashboard/layout'
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

// ---------- page width → mode; block heights → positions ----------
const wrapEl = ref<HTMLElement | null>(null)
const gridEl = ref<HTMLElement | null>(null)
const gridW = ref(1200)
/** grid: blocks at their columns; two / one: blocks follow each other (two per row at most, or one). */
const mode = computed(() => (gridW.value >= 860 ? 'grid' : gridW.value >= 540 ? 'two' : 'one'))
/** Natural heights of the blocks (px), measured: the content decides how many grid rows a block takes. */
const heights = reactive(new Map<string, number>())
const measured = ref(false)
const rowsOf = (b: DashBlock) => rowsFor(b.h > 0 ? b.h : heights.get(b.id) ?? 160, gap.value)

/** While a block is dragged: its wished place, and the others' order frozen at the start (their centres). */
const drag = ref<{ id: string; key: number; keys: Map<string, number> } | null>(null)
function keyOf(b: DashBlock) {
  const d = drag.value
  if (!d) return b.y ?? 0
  return d.id === b.id ? d.key : d.keys.get(b.id) ?? b.y ?? 0
}
const slots = computed(() => compact(shown.value.map((b) => ({ id: b.id, x: b.x ?? 0, w: b.w, rows: rowsOf(b), key: keyOf(b) }))))
const slotsOf = (l: DashboardLayout) => compact(l.blocks.map((b) => ({ id: b.id, x: b.x ?? 0, w: b.w, rows: rowsOf(b), key: b.y ?? 0 })))

let gridRo: ResizeObserver | null = null
let blockRo: ResizeObserver | null = null
onMounted(() => {
  gridRo = new ResizeObserver(() => { if (wrapEl.value) gridW.value = wrapEl.value.clientWidth })
  if (wrapEl.value) { gridW.value = wrapEl.value.clientWidth; gridRo.observe(wrapEl.value) }
  blockRo = new ResizeObserver((entries) => {
    for (const en of entries) {
      const el = en.target as HTMLElement
      const id = el.dataset.blockId
      if (id && !el.classList.contains('db-floating')) heights.set(id, Math.round(en.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight))
    }
    measured.value = true
  })
  observeBlocks()
})
function observeBlocks() {
  if (!blockRo || !gridEl.value) return
  blockRo.disconnect()
  const els = gridEl.value.querySelectorAll<HTMLElement>('[data-block]')
  els.forEach((el) => blockRo!.observe(el))
  if (!els.length) measured.value = true
}
watch(() => shown.value.map((b) => b.id).join(), () => nextTick(observeBlocks), { flush: 'post' })
onBeforeUnmount(() => { gridRo?.disconnect(); blockRo?.disconnect() })

/** Settles a layout after a change: every block gets the place it actually takes; the list follows reading order. */
function settle(l: DashboardLayout) {
  const s = slotsOf(l)
  for (const b of l.blocks) { const p = s.get(b.id); if (p) { b.x = p.x; b.y = p.top } }
  l.blocks.sort((a, b) => (a.y! - b.y!) || (a.x! - b.x!))
}

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
function change(fn: (l: DashboardLayout) => void) {
  if (!draft.value) return
  remember()
  const next = clean(draft.value)
  fn(next)
  settle(next)
  draft.value = next
  scheduleSave()
}
function startEdit() {
  const d = clean(saved.value)
  settle(d)
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
  // the highest free place for its width (fills holes next to shorter blocks)
  change((l) => { const spot = freeSpot(slotsOf(l), b.w); l.blocks.push({ ...b, x: spot.x, y: spot.top }) })
  if (kindOf(type).needsSetup) settingsFor.value = b.id
  await nextTick()
  document.querySelector(`[data-block-id="${b.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
function saveBlock(b: DashBlock) {
  change((l) => { const i = l.blocks.findIndex((x) => x.id === b.id); if (i >= 0) l.blocks[i] = { ...b, x: clampX(b.x, b.w) } })
  settingsFor.value = null
}
function removeBlock(id: string) {
  change((l) => { l.blocks = l.blocks.filter((b) => b.id !== id) })
  settingsFor.value = null
}
function duplicate(id: string) {
  change((l) => {
    const src = find(l, id)
    if (src) l.blocks.push({ ...clean(src), id: newBlock(src.type).id, y: (src.y ?? 0) + 0.5 })
  })
}
/** Arrow moves: a column left/right, or above/below the neighbouring block that shares a column. */
function nudge(id: string, dir: 'left' | 'right' | 'up' | 'down') {
  change((l) => {
    const b = find(l, id)
    if (!b) return
    if (dir === 'left' || dir === 'right') { b.x = clampX((b.x ?? 0) + (dir === 'left' ? -1 : 1), b.w); return }
    const s = slotsOf(l)
    const me = s.get(id)!
    const near = l.blocks.map((o) => ({ o, p: s.get(o.id)! })).filter(({ o, p }) => o.id !== id && p.x < me.x + me.w && me.x < p.x + p.w)
    const pick = dir === 'up'
      ? near.filter(({ p }) => p.top < me.top).sort((a, z) => z.p.top - a.p.top)[0]
      : near.filter(({ p }) => p.top > me.top).sort((a, z) => a.p.top - z.p.top)[0]
    if (pick) b.y = pick.p.top + (dir === 'up' ? -0.5 : 0.5)
  })
}
function setHeight(id: string, h: number) { change((l) => { const b = find(l, id); if (b) b.h = h }) }

// ---------- mouse / touch ----------
let resizing = false
const { onPointerDown, floating } = useGridEdit(() => gridEl.value, {
  mode: () => (mode.value === 'grid' ? 'grid' : 'list'),
  gap: () => gap.value,
  dragStart: (id) => {
    remember()
    const keys = new Map<string, number>()
    for (const [k, s] of slots.value) keys.set(k, s.top + s.rows / 2)
    drag.value = { id, key: keys.get(id) ?? 0, keys }
  },
  dragTo: (id, x, top) => {
    const b = draft.value && find(draft.value, id)
    if (!b || !drag.value) return
    b.x = clampX(x, b.w)
    drag.value = { ...drag.value, key: top + rowsOf(b) / 2 }
  },
  dragEnd: (_id, commit) => {
    const d = drag.value
    if (!draft.value || !d) { drag.value = null; return }
    if (!commit) { drag.value = null; undo(); return }
    // the places the page showed while dragging become the saved ones
    const s = slots.value
    const l = clean(draft.value)
    for (const b of l.blocks) { const p = s.get(b.id); if (p) { b.x = p.x; b.y = p.top } }
    drag.value = null
    settle(l)
    draft.value = l
    scheduleSave()
  },
  move: (id, targetId, after) => change((l) => {
    const b = find(l, id), t = find(l, targetId)
    if (!b || !t) return
    // narrow page: the block goes before/after the target in reading order and takes its column
    b.x = clampX(t.x, b.w)
    b.y = (t.y ?? 0) + (after ? 0.5 : -0.5)
  }),
  resize: (id, w, h) => {
    if (!draft.value) return
    if (!resizing) remember()
    resizing = true
    const b = find(draft.value, id)
    if (!b) return
    if (w !== null) b.w = Math.min(w, 12 - (b.x ?? 0))
    if (h !== null) b.h = h
  },
  resizeEnd: () => {
    if (!resizing || !draft.value) return
    resizing = false
    const l = clean(draft.value)
    settle(l)
    draft.value = l
    scheduleSave()
  },
})
const placeholder = computed(() => (floating.value && mode.value === 'grid' ? slots.value.get(floating.value.id) ?? null : null))
const slotStyle = (s: Slot) => ({ '--gc': `${s.x + 1} / span ${s.w}`, '--gr': `${s.top + 1} / span ${s.rows}` })
function blockStyle(b: DashBlock) {
  const s = slots.value.get(b.id)
  const st: Record<string, string | number | undefined> = { '--w': b.w, '--wm': midW(b.w), height: b.h > 0 ? b.h + 'px' : undefined, ...(s ? slotStyle(s) : {}) }
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
        <span class="faint small hide-sm">Тащите блок за <Icon name="grip-vertical" :size="13" /> в любую колонку, размер — за края. Изменения сохраняются сразу и видны всем.</span>
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
      <div ref="gridEl" class="db-grid" :class="['mode-' + mode, { editing, measured }]" :style="{ '--g': gap + 'px', '--row': ROW + 'px' }" @pointerdown="editing && onPointerDown($event)">
        <div v-if="placeholder" class="db-placeholder" :style="slotStyle(placeholder)" />
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
            <span class="db-size-tip">{{ b.w }}/12 · {{ b.h ? b.h + ' px' : 'авто' }}</span>
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
/* wide page: blocks at their columns and rows; each takes its natural height, the rest of its rows is the gap */
.db-grid.mode-grid { grid-auto-rows: var(--row); row-gap: 0; align-items: start; }
.mode-grid > .db-block { grid-column: var(--gc); grid-row: var(--gr); }
.mode-grid:not(.measured) { visibility: hidden; }
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
.fixed .db-body { overflow: auto; scrollbar-width: thin; }
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
.db-placeholder { grid-column: var(--gc); grid-row: var(--gr); align-self: stretch; margin-bottom: var(--g); border: 2px dashed var(--accent); border-radius: 14px; background: var(--accent-soft); }
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
