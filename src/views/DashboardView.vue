<script setup lang="ts">
// The world overview: blocks in a 12-column grid (src/components/dashboard). Masters switch on «Настроить обзор»
// to add, remove, move and resize blocks and change their settings; the layout lives in world.settings.dashboard.
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
import { defaultLayout, kindOf, midW, newBlock, normalizeLayout, titleOf } from '@/components/dashboard/blocks'
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
function change(fn: (l: DashboardLayout) => void, opts: { record?: boolean; save?: boolean } = {}) {
  if (!draft.value) return
  if (opts.record !== false) history.value = [...history.value.slice(-39), clean(draft.value)]
  const next = clean(draft.value)
  fn(next)
  draft.value = next
  if (opts.save !== false) scheduleSave()
}
function startEdit() {
  draft.value = clean(saved.value)
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
const idx = (id: string) => draft.value?.blocks.findIndex((b) => b.id === id) ?? -1

// ---------- blocks ----------
const adding = ref(false)
const settingsFor = ref<string | null>(null)
const settingsBlock = computed(() => draft.value?.blocks.find((b) => b.id === settingsFor.value) ?? null)
async function addBlock(type: DashBlockType) {
  adding.value = false
  const b = newBlock(type)
  change((l) => { l.blocks.push(b) })
  if (kindOf(type).needsSetup) settingsFor.value = b.id
  await nextTick()
  document.querySelector(`[data-block-id="${b.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
function saveBlock(b: DashBlock) {
  const i = idx(b.id)
  if (i >= 0) change((l) => { l.blocks[i] = b })
  settingsFor.value = null
}
function removeBlock(id: string) {
  const i = idx(id)
  if (i >= 0) change((l) => { l.blocks.splice(i, 1) })
  settingsFor.value = null
}
function duplicate(id: string) {
  const i = idx(id)
  if (i < 0) return
  change((l) => { l.blocks.splice(i + 1, 0, { ...clean(l.blocks[i]), id: newBlock(l.blocks[i].type).id }) })
}
function nudge(id: string, d: number) {
  const i = idx(id), j = i + d
  if (i < 0 || j < 0 || j >= (draft.value?.blocks.length ?? 0)) return
  change((l) => { const [b] = l.blocks.splice(i, 1); l.blocks.splice(j, 0, b) })
}
function setHeight(id: string, h: number) { const i = idx(id); if (i >= 0) change((l) => { l.blocks[i].h = h }) }

// ---------- mouse / touch ----------
const gridEl = ref<HTMLElement | null>(null)
let resizing = false
const { onPointerDown } = useGridEdit(() => gridEl.value, {
  move: (from, to) => change((l) => { const [b] = l.blocks.splice(from, 1); l.blocks.splice(to, 0, b) }),
  resize: (i, w, h) => {
    change((l) => { if (w !== null) l.blocks[i].w = w; if (h !== null) l.blocks[i].h = h }, { record: !resizing, save: false })
    resizing = true
  },
  resizeEnd: () => { if (resizing) scheduleSave(); resizing = false },
})

function onKey(e: KeyboardEvent) {
  if (!editing.value || settingsFor.value || adding.value) return
  const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')
  if (!typing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); if (saveTimer) void flush() })
onBeforeRouteLeave(async () => { if (saveTimer) await flush() })

const GAPS = { sm: '10px', md: '18px', lg: '28px' } as const
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
        <span class="faint small hide-sm">Тащите блок за <Icon name="grip-vertical" :size="13" />, размер — за края. Изменения сохраняются сразу и видны всем.</span>
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
    </div>

    <div class="db-wrap">
      <div ref="gridEl" class="db-grid" :class="{ editing }" :style="{ gap: GAPS[layout.gap ?? 'md'] }" @pointerdown="editing && onPointerDown($event)">
        <div v-for="b in shown" :key="b.id" class="db-block" data-block :data-block-id="b.id"
          :class="['db-' + (b.type === 'hero' ? 'hero' : b.style ?? 'card'), { fixed: b.h > 0 }]"
          :style="{ '--w': b.w, '--wm': midW(b.w), height: b.h > 0 ? b.h + 'px' : undefined }">
          <div v-if="editing" class="db-edit-bar">
            <button class="db-grip" data-block-grip title="Перетащите, чтобы переставить блок"><Icon name="grip-vertical" :size="16" /></button>
            <Icon :name="kindOf(b.type).icon" :size="14" class="faint" />
            <span class="ellipsis grow db-eb-title">{{ titleOf(b) }}</span>
            <span v-if="b.show && b.show !== 'all'" class="badge db-eb-badge" :title="'Блок видят только ' + SHOW_LABEL[b.show]"><Icon :name="b.show === 'masters' ? 'crown' : 'users'" :size="11" /><span class="db-eb-badge-text"> {{ SHOW_LABEL[b.show] }}</span></span>
            <span v-else-if="!data.hasContent(b)" class="badge db-eb-badge" title="Сейчас блоку нечего показать — зрители его не увидят"><Icon name="eye-off" :size="11" /><span class="db-eb-badge-text"> пуст</span></span>
            <button class="icon-btn" title="Настройки блока" @click="settingsFor = b.id"><Icon name="settings" :size="15" /></button>
            <Dropdown placement="bottom-end">
              <template #trigger><button class="icon-btn" title="Ещё"><Icon name="more-horizontal" :size="15" /></button></template>
              <div class="menu">
                <button class="menu-item" @click="nudge(b.id, -1)"><Icon name="arrow-left" :size="15" /> Левее / выше</button>
                <button class="menu-item" @click="nudge(b.id, 1)"><Icon name="arrow-right" :size="15" /> Правее / ниже</button>
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
        <button v-if="editing" class="db-add-tile" @click="adding = true"><Icon name="plus" :size="22" /><span>Добавить блок</span></button>
      </div>
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
.db-wrap { container: dbgrid / inline-size; }
.db-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); align-items: stretch; }
.db-block { grid-column: span var(--w); position: relative; display: flex; flex-direction: column; min-width: 0; border-radius: 14px; }
.editing .db-block { container: dbblock / inline-size; }
.db-card { background: var(--surface); border: 1px solid var(--border); padding: 16px 18px; }
.db-accent { background: color-mix(in srgb, var(--accent) 10%, var(--surface)); border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); padding: 16px 18px; }
.db-plain { padding: 0; }
.db-hero { padding: 0; overflow: hidden; border: 1px solid var(--border); }
.db-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.db-body > * { flex: 1; }
.fixed .db-body { overflow: auto; scrollbar-width: thin; }
.db-hero.fixed .db-body { overflow: hidden; }
/* mid-size page column: two blocks per row at most; narrow: one */
@container dbgrid (max-width: 860px) { .db-block { grid-column: span var(--wm); } }
@container dbgrid (max-width: 540px) { .db-block { grid-column: span 12; } }

/* ---------- edit mode ---------- */
.db-toolbar { position: sticky; top: calc(var(--topbar-h) + 8px); z-index: 25; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; margin-bottom: 16px; box-shadow: var(--shadow); }
.db-tb-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.db-tb-title > .icon { color: var(--accent); }
.db-tb-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.db-tb-group { display: inline-flex; align-items: center; gap: 4px; }
.editing .db-block { outline: 1px dashed var(--border-strong); outline-offset: 4px; }
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
.db-size-tip { position: absolute; right: 14px; bottom: -22px; z-index: 5; padding: 1px 7px; border-radius: 6px; background: var(--accent); color: var(--accent-fg); font-size: 11.5px; font-weight: 600; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity .12s; }
.db-block:has(.db-rs:hover) .db-size-tip, .db-resizing .db-size-tip { opacity: 1; }
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
@container dbgrid (max-width: 860px) { .db-rs-x, .db-rs-xy { display: none; } }
.db-resizing { outline: 2px solid var(--accent) !important; }
.db-dragging { z-index: 50; opacity: .92; box-shadow: var(--shadow-lg); cursor: grabbing; transition: none; }
.db-moving { user-select: none; }
.db-block.db-drop-left::before, .db-block.db-drop-right::before, .db-block.db-drop-above::before, .db-block.db-drop-below::before {
  content: ''; position: absolute; background: var(--accent); border-radius: 3px; z-index: 4; box-shadow: 0 0 0 3px var(--accent-soft);
}
.db-drop-left::before { left: -9px; top: 0; bottom: 0; width: 4px; }
.db-drop-right::before { right: -9px; top: 0; bottom: 0; width: 4px; }
.db-drop-above::before { top: -9px; left: 0; right: 0; height: 4px; }
.db-drop-below::before { bottom: -9px; left: 0; right: 0; height: 4px; }
.db-add-tile { grid-column: span 4; min-height: 120px; border: 2px dashed var(--border-strong); border-radius: 14px; background: none; color: var(--text-muted); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font: inherit; }
.db-add-tile:hover { border-color: var(--accent); color: var(--accent); }
@container dbgrid (max-width: 860px) { .db-add-tile { grid-column: span 6; } }
@container dbgrid (max-width: 540px) { .db-add-tile { grid-column: span 12; } }
@media (max-width: 860px) {
  .db-toolbar { top: calc(var(--topbar-h) + 4px); }
  .db-card, .db-accent { padding: 14px; }
}
</style>
