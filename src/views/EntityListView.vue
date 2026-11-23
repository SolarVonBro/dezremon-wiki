<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import { typeDef, type FieldDef } from '@/model/entityTypes'
import { relativeTime } from '@/data/util'
import { VISIBILITY_SHORT } from '@/data/access'
import { useListFilters, applyFilters, NONE, type Tri } from '@/composables/useListFilters'
import Icon from '@/components/common/Icon.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import TreeNode from '@/components/entity/TreeNode.vue'
import EntityCard from '@/components/entity/EntityCard.vue'
import MultiSelect, { type MultiOption } from '@/components/common/MultiSelect.vue'
import { createRequest } from '@/components/layout/createRequest'
import Dropdown from '@/components/common/Dropdown.vue'
import Modal from '@/components/common/Modal.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import { toast } from '@/components/common/toast'
import { charTypeOfKind } from '@/data/charType'
import { isCampaignTag } from '@/data/campaignTags'
import { worldCampaigns } from '@/data/worldCampaigns'
import type { CampaignStatus, Entity, Visibility } from '@/model/types'

const route = useRoute()
const router = useRouter()
const world = useWorld()
const type = computed(() => route.params.type as string)
const def = computed(() => typeDef(type.value))

function readPref<T>(k: string, d: T): T { try { return (JSON.parse(localStorage.getItem('dw.list.' + k) ?? 'null') as T) ?? d } catch { return d } }
function writePref(k: string, v: unknown) { try { localStorage.setItem('dw.list.' + k, JSON.stringify(v)) } catch { /* ignore */ } }
type View = 'cards' | 'table' | 'tree' | 'campaigns'
// the view is remembered per section; characters open «По играм» until another view is chosen for them
const viewPrefs = ref<Record<string, View>>(readPref('views', {}))
const view = computed<View>({
  get: () => viewPrefs.value[type.value] ?? (type.value === 'character' ? 'campaigns' : readPref<View>('view', 'cards')),
  set: (v) => { viewPrefs.value = { ...viewPrefs.value, [type.value]: v }; writePref('views', viewPrefs.value) },
})
/** «По кампейнам» exists for characters only; the tree only for types with a parent. */
const shownView = computed(() => (view.value === 'campaigns' && type.value !== 'character') || (view.value === 'tree' && !def.value.parentLabel) ? 'cards' : view.value)
const panelOpen = ref<boolean>(readPref('panel', false))
watch(panelOpen, (v) => writePref('panel', v))

// ---------- filters (remembered per world and type) ----------
const { f, active, clear } = useListFilters(computed(() => world.wid), type)
// links like ?tag=… or ?q=… (bookmarks, tag pages) override the remembered filters once
watch(() => [route.query.tag, route.query.q], ([tag, q]) => {
  if (typeof tag === 'string' && tag) { clear(); f.tags = [tag] }
  if (typeof q === 'string' && q) f.q = q
  if (tag || q) void router.replace({ query: {} })
}, { immediate: true })

const all = computed(() => world.byType.get(type.value) ?? [])
const filterFields = computed<FieldDef[]>(() => def.value.fields.filter((fd) => ['bool', 'entity', 'entities', 'text', 'number', 'textarea'].includes(fd.kind)))

function countBy<T extends string>(values: T[]): Map<T, number> {
  const m = new Map<T, number>()
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1)
  return m
}
const kindOptions = computed<MultiOption[]>(() => {
  const c = countBy(all.value.map((e) => e.kind || NONE))
  return [...c.entries()].sort((a, b) => (a[0] === NONE ? 1 : b[0] === NONE ? -1 : a[0].localeCompare(b[0], 'ru')))
    .map(([k, n]) => ({ value: k, label: k === NONE ? '— не указан —' : k, count: n }))
})
const tagsInUse = computed(() => {
  const ids = new Set(all.value.flatMap((e) => e.tagIds))
  return world.tags.filter((t) => ids.has(t.id))
})
const tagOptions = computed<MultiOption[]>(() => {
  const c = countBy(all.value.flatMap((e) => e.tagIds))
  return tagsInUse.value.map((t) => ({ value: t.id, label: t.name, color: t.fields?.colour || 'var(--accent)', count: c.get(t.id) ?? 0 }))
})
const authorOptions = computed<MultiOption[]>(() => {
  const c = countBy(all.value.map((e) => e.createdBy))
  return [...c.entries()].map(([uid, n]) => ({ value: uid, label: world.memberName(uid), count: n })).sort((a, b) => b.count! - a.count!)
})
const VIS_LABEL: Record<Visibility, string> = { public: 'Всем (публично)', members: 'Участникам', custom: 'Выбранным игрокам', master: 'Только мастерам' }
const visOptions = computed<MultiOption[]>(() => {
  const c = countBy(all.value.map((e) => e.visibility))
  return (['public', 'members', 'custom', 'master'] as Visibility[]).filter((v) => c.has(v)).map((v) => ({ value: v, label: VIS_LABEL[v], count: c.get(v) }))
})
/** Options of an entity-reference field: the entities actually referenced by this list, plus "not set". */
function refOptions(fd: FieldDef): MultiOption[] {
  const ids: string[] = []
  let none = 0
  for (const e of all.value) {
    const v = e.fields?.[fd.key]
    const arr: string[] = Array.isArray(v) ? v : v ? [v] : []
    if (!arr.length) none++
    ids.push(...arr)
  }
  const c = countBy(ids)
  const opts = [...c.entries()].map(([id, n]) => {
    const t = world.get(id)
    return t ? { value: id, label: t.name, icon: typeDef(t.type).icon, color: typeDef(t.type).color, count: n } : null
  }).filter(Boolean) as MultiOption[]
  opts.sort((a, b) => a.label.localeCompare(b.label, 'ru'))
  if (none) opts.push({ value: NONE, label: '— не указано —', count: none })
  return opts
}
const fieldOptions = computed(() => Object.fromEntries(filterFields.value.filter((fd) => fd.kind === 'entity' || fd.kind === 'entities').map((fd) => [fd.key, refOptions(fd)])))

function ancestorsOf(e: Entity): string[] {
  const out: string[] = []
  let p = e.parentId ? world.get(e.parentId) : undefined
  while (p && !out.includes(p.id) && out.length < 20) { out.push(p.id); p = p.parentId ? world.get(p.parentId) : undefined }
  return out
}
const now = ref(Date.now())
const items = computed(() => applyFilters(f, { all: all.value, fieldDefs: filterFields.value, ancestorsOf, tagExists: (id) => !!world.get(id), now: now.value }))
const roots = computed(() => items.value.filter((e) => !e.parentId || !items.value.some((p) => p.id === e.parentId)))
function open(e: Entity) { void router.push({ name: 'entity', params: { wid: world.wid!, eid: e.id } }) }

// ---------- characters by campaign: a group per campaign (its tag, or its players' current characters), inside it
// PCs, then NPCs, then the rest; in every run the characters with both a picture and a text come first ----------
const richness = (e: Entity) => (e.imageId ? 1 : 0) + (e.excerpt?.trim() ? 1 : 0)
const byRichness = (a: Entity, b: Entity) => richness(b) - richness(a) || a.name.localeCompare(b.name, 'ru')
const KIND_RUNS = [{ key: 'pc', label: 'Игровые персонажи' }, { key: 'npc', label: 'NPC' }, { key: '', label: 'Без типа' }] as const
function runs(list: Entity[]) {
  return KIND_RUNS.map((r) => ({ ...r, items: list.filter((e) => (charTypeOfKind(e.kind) ?? '') === r.key).sort(byRichness) })).filter((r) => r.items.length)
}
// order of the groups: running games, characters outside games, paused, being prepared, finished. A game a player
// cannot open (only its tag is visible) has no known status: it goes right after the running ones.
const GROUP_RANK: Record<string, number> = { active: 0, unknown: 1, none: 2, paused: 3, planning: 4, finished: 5 }
const STATUS_NOTE: Partial<Record<CampaignStatus, string>> = { paused: 'на паузе', planning: 'готовится', finished: 'завершена' }
const campaignGroups = computed(() => {
  if (shownView.value !== 'campaigns') return []
  type G = { key: string; title: string; colour: string | null; tagId: string | null; cid: string | null; status: CampaignStatus | null; ids: Set<string> }
  const groups: G[] = []
  for (const t of world.campaignTags) {
    const c = worldCampaigns.value.find((x) => x.tagId === t.id || x.id === t.fields?.campaignId) ?? null
    groups.push({ key: t.id, title: t.name, colour: t.fields?.colour ?? null, tagId: t.id, cid: c?.id ?? null, status: c?.status ?? null, ids: new Set(Object.values(c?.characters ?? {}).flat()) })
  }
  for (const c of worldCampaigns.value) {
    if (groups.some((g) => g.cid === c.id)) continue
    groups.push({ key: c.id, title: '⚔ ' + c.name, colour: null, tagId: null, cid: c.id, status: c.status, ids: new Set(Object.values(c.characters ?? {}).flat()) })
  }
  const placed = new Set<string>()
  const out = groups.map((g) => {
    const list = items.value.filter((e) => (g.tagId && e.tagIds.includes(g.tagId)) || g.ids.has(e.id))
    list.forEach((e) => placed.add(e.id))
    return { ...g, rank: GROUP_RANK[g.cid ? g.status ?? 'active' : 'unknown'], note: g.status ? STATUS_NOTE[g.status] ?? '' : '', count: list.length, runs: runs(list) }
  }).filter((g) => g.count)
  const rest = items.value.filter((e) => !placed.has(e.id))
  if (rest.length) out.push({ key: '_none', title: 'Вне игр', colour: null, tagId: null, cid: null, status: null, ids: new Set(), rank: GROUP_RANK.none, note: '', count: rest.length, runs: runs(rest) })
  return out.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title, 'ru'))
})

// ---------- the campaign whose tag goes on new articles (all sections; kept per world on this device) ----------
const showCampaignBar = computed(() => world.campaignTags.length > 0 && !!world.member && !world.preview)
// the tags page: how many articles carry each tag
const tagUse = computed(() => {
  const m = new Map<string, number>()
  if (type.value === 'tag') for (const e of world.list) for (const t of e.tagIds) m.set(t, (m.get(t) ?? 0) + 1)
  return m
})

function setSort(s: 'name' | 'updated' | 'created') {
  if (f.sort === s) f.dir = f.dir === 'asc' ? 'desc' : 'asc'
  else { f.sort = s; f.dir = s === 'name' ? 'asc' : 'desc' }
}
const SORT_LABEL = { name: 'По названию', updated: 'По изменению', created: 'По созданию' }

// ---------- active filter chips ----------
const TRI: Record<Tri, string> = { any: 'любые', yes: 'есть', no: 'нет' }
const UPDATED = [{ v: 0, l: 'за всё время' }, { v: 1, l: 'за сутки' }, { v: 7, l: 'за неделю' }, { v: 30, l: 'за месяц' }, { v: 365, l: 'за год' }]
const labelOf = (opts: MultiOption[], vals: string[]) => vals.map((v) => opts.find((o) => o.value === v)?.label ?? '…').join(', ')
const chips = computed(() => {
  const out: Array<{ label: string; clear: () => void }> = []
  if (f.q.trim()) out.push({ label: `«${f.q.trim()}»`, clear: () => (f.q = '') })
  if (f.kinds.length) out.push({ label: `Подтип: ${labelOf(kindOptions.value, f.kinds)}`, clear: () => (f.kinds = []) })
  if (f.tags.length) out.push({ label: `Теги (${f.tagMode === 'all' ? 'все' : 'любой'}): ${labelOf(tagOptions.value, f.tags)}`, clear: () => (f.tags = []) })
  for (const fd of filterFields.value) {
    const v = f.fields[fd.key]
    if (!v || (Array.isArray(v) && !v.length) || v === 'any') continue
    const text = Array.isArray(v) ? labelOf(fieldOptions.value[fd.key] ?? [], v) : fd.kind === 'bool' ? (v === 'yes' ? 'да' : 'нет') : `содержит «${v}»`
    out.push({ label: `${fd.label}: ${text}`, clear: () => { const n = { ...f.fields }; delete n[fd.key]; f.fields = n } })
  }
  if (f.level !== 'any') out.push({ label: f.level === 'root' ? 'Только верхний уровень' : 'Только вложенные', clear: () => (f.level = 'any') })
  if (f.within) out.push({ label: `Внутри: ${world.get(f.within)?.name ?? '…'}`, clear: () => (f.within = null) })
  if (f.image !== 'any') out.push({ label: `Изображение: ${TRI[f.image]}`, clear: () => (f.image = 'any') })
  if (f.text !== 'any') out.push({ label: `Текст: ${TRI[f.text]}`, clear: () => (f.text = 'any') })
  if (f.updated) out.push({ label: `Изменено ${UPDATED.find((u) => u.v === f.updated)?.l}`, clear: () => (f.updated = 0) })
  if (f.authors.length) out.push({ label: `Автор: ${labelOf(authorOptions.value, f.authors)}`, clear: () => (f.authors = []) })
  if (f.visibility.length) out.push({ label: `Видимость: ${labelOf(visOptions.value, f.visibility)}`, clear: () => (f.visibility = []) })
  if (f.secrets !== 'any') out.push({ label: `Секреты мастера: ${TRI[f.secrets]}`, clear: () => (f.secrets = 'any') })
  if (f.templates !== 'any') out.push({ label: f.templates === 'yes' ? 'Только шаблоны' : 'Без шаблонов', clear: () => (f.templates = 'any') })
  return out
})
function setField(key: string, v: string[] | string) { f.fields = { ...f.fields, [key]: v } }

// ---------- bulk actions (masters): apply to every article currently shown ----------
const bulk = ref<null | 'visibility' | 'addTag' | 'removeTag'>(null)
const bulkVis = ref<{ visibility: Visibility; allowedUids: string[] }>({ visibility: 'members', allowedUids: [] })
const bulkTag = ref<string | null>(null)
const bulkBusy = ref<{ done: number; total: number } | null>(null)
const BULK_LABEL = { visibility: 'Изменить видимость', addTag: 'Добавить тег', removeTag: 'Убрать тег', trash: 'Переместить в корзину' }
async function runBulk(kind: 'visibility' | 'addTag' | 'removeTag' | 'trash') {
  const list = items.value
  if (!list.length) return
  if (!confirm(`${BULK_LABEL[kind]}: ${list.length} показанных статей?`)) return
  const tag = bulkTag.value
  const patchFor = (e: Entity): Partial<Entity> | null => {
    if (kind === 'visibility') return e.visibility === bulkVis.value.visibility && JSON.stringify(e.allowedUids) === JSON.stringify(bulkVis.value.allowedUids) ? null : { ...bulkVis.value }
    if (kind === 'addTag') return tag && !e.tagIds.includes(tag) ? { tagIds: [...e.tagIds, tag] } : null
    if (kind === 'removeTag') return tag && e.tagIds.includes(tag) ? { tagIds: e.tagIds.filter((t) => t !== tag) } : null
    return { deleted: true, deletedAt: Date.now() }
  }
  bulkBusy.value = { done: 0, total: list.length }
  try {
    await world.bulkUpdateEntities(list.map((e) => e.id), patchFor, (done, total) => { bulkBusy.value = { done, total } })
    toast.success('Готово')
    bulk.value = null
    bulkTag.value = null
  } finally { bulkBusy.value = null }
}
</script>

<template>
  <Teleport defer to="#crumbs">
    <RouterLink :to="{ name: 'dashboard', params: { wid: world.wid! } }">{{ world.world?.name }}</RouterLink>
    <Icon name="chevron-right" :size="13" /><span style="color: var(--text)">{{ def.plural }}</span>
  </Teleport>
  <div class="content">
    <div class="page-head">
      <Icon :name="def.icon" :size="30" :style="{ color: def.color }" />
      <h1 class="grow">{{ def.plural }} <span class="faint" style="font-size: 20px">{{ all.length }}</span></h1>
      <button v-if="world.canCreate(type)" class="btn btn-primary" @click="createRequest = { type }"><Icon name="plus" :size="16" /> Создать {{ def.acc }}</button>
    </div>

    <div v-if="showCampaignBar" class="camp-bar" :class="{ on: !!world.autoCampaignTagId }">
      <Icon name="swords" :size="16" />
      <span class="small">Игра для новых статей</span>
      <select v-model="world.campaignTagPref.tagId" class="input input-sm camp-bar-select" aria-label="Игра для новых статей">
        <option :value="null">— не выбран —</option>
        <option v-for="t in world.campaignTags" :key="t.id" :value="t.id">{{ t.name }}</option>
      </select>
      <label class="check small" :title="world.campaignTagPref.tagId ? '' : 'Сначала выберите игру'">
        <input v-model="world.campaignTagPref.auto" type="checkbox" :disabled="!world.campaignTagPref.tagId" /> Добавлять его тег ко всем новым статьям (кроме тегов)
      </label>
    </div>

    <div class="list-toolbar">
      <div class="search-box">
        <Icon name="search" :size="15" class="faint" />
        <input v-model="f.q" class="input" placeholder="Поиск по названию и другим именам…" />
        <button v-if="f.q" class="icon-btn" title="Очистить поиск" @click="f.q = ''"><Icon name="x" :size="14" /></button>
      </div>
      <button class="btn" :class="{ 'btn-primary': panelOpen }" @click="panelOpen = !panelOpen">
        <Icon name="filter" :size="15" /> Фильтры<span v-if="active - (f.q.trim() ? 1 : 0) > 0" class="filter-count">{{ active - (f.q.trim() ? 1 : 0) }}</span>
      </button>
      <Dropdown>
        <template #trigger><button class="btn" title="Сортировка"><Icon :name="f.dir === 'asc' ? 'arrow-up' : 'arrow-down'" :size="15" /> {{ SORT_LABEL[f.sort] }}</button></template>
        <div class="menu">
          <button v-for="(l, s) in SORT_LABEL" :key="s" class="menu-item" :class="{ on: f.sort === s }" @click="setSort(s)">
            {{ l }}<span class="grow" /><Icon v-if="f.sort === s" :name="f.dir === 'asc' ? 'arrow-up' : 'arrow-down'" :size="14" />
          </button>
          <div class="menu-label">Повторный выбор меняет направление</div>
        </div>
      </Dropdown>
      <button v-if="active" class="btn btn-ghost" title="Сбросить все фильтры и поиск" @click="clear"><Icon name="x" :size="15" /> Очистить фильтры</button>
      <span class="grow" />
      <Dropdown v-if="world.isMaster && items.length" placement="bottom-end">
        <template #trigger><button class="btn btn-sm" :disabled="!!bulkBusy"><Icon name="list-checks" :size="14" /> {{ bulkBusy ? `${bulkBusy.done} / ${bulkBusy.total}` : `Действия (${items.length})` }}</button></template>
        <div class="menu">
          <div class="menu-label">Со всеми показанными статьями</div>
          <button class="menu-item" @click="bulk = 'visibility'"><Icon name="shield" :size="15" /> Изменить видимость…</button>
          <button class="menu-item" @click="bulk = 'addTag'"><Icon name="tag" :size="15" /> Добавить тег…</button>
          <button v-if="tagsInUse.length" class="menu-item" @click="bulk = 'removeTag'"><Icon name="x" :size="15" /> Убрать тег…</button>
          <div class="menu-sep" />
          <button class="menu-item danger" @click="runBulk('trash')"><Icon name="trash2" :size="15" /> В корзину</button>
        </div>
      </Dropdown>
      <div class="row gap-sm">
        <button class="icon-btn" :class="{ on: shownView === 'cards' }" title="Карточки" @click="view = 'cards'"><Icon name="layout-grid" /></button>
        <button class="icon-btn" :class="{ on: shownView === 'table' }" title="Таблица" @click="view = 'table'"><Icon name="layout-list" /></button>
        <button v-if="def.parentLabel" class="icon-btn" :class="{ on: view === 'tree' }" title="Дерево" @click="view = 'tree'"><Icon name="git-branch" /></button>
        <button v-if="type === 'character'" class="icon-btn" :class="{ on: shownView === 'campaigns' }" title="По играм: внутри PC, затем NPC" @click="view = 'campaigns'"><Icon name="swords" /></button>
      </div>
    </div>

    <section v-if="panelOpen" class="card card-pad filter-panel">
      <div v-if="kindOptions.length > 1 || kindOptions[0]?.value !== NONE" class="field"><span>Подтип</span><MultiSelect v-model="f.kinds" :options="kindOptions" placeholder="Любой" /></div>
      <div v-if="tagOptions.length" class="field">
        <span class="row">Теги<span class="grow" />
          <span class="seg"><button :class="{ on: f.tagMode === 'any' }" title="Есть хотя бы один из выбранных" @click="f.tagMode = 'any'">любой</button><button :class="{ on: f.tagMode === 'all' }" title="Есть все выбранные" @click="f.tagMode = 'all'">все</button></span>
        </span>
        <MultiSelect v-model="f.tags" :options="tagOptions" placeholder="Любые" />
      </div>
      <template v-for="fd in filterFields" :key="fd.key">
        <div v-if="fd.kind === 'entity' || fd.kind === 'entities'" v-show="(fieldOptions[fd.key] ?? []).length" class="field"><span>{{ fd.label }}</span>
          <MultiSelect :model-value="(f.fields[fd.key] as string[]) ?? []" :options="fieldOptions[fd.key] ?? []" @update:model-value="(v) => setField(fd.key, v)" />
        </div>
        <label v-else-if="fd.kind === 'bool'" class="field"><span>{{ fd.label }}</span>
          <select class="input" :value="f.fields[fd.key] ?? 'any'" @change="setField(fd.key, ($event.target as HTMLSelectElement).value)">
            <option value="any">Неважно</option><option value="yes">Да</option><option value="no">Нет</option>
          </select>
        </label>
        <label v-else class="field"><span>{{ fd.label }}</span>
          <input class="input" :value="(f.fields[fd.key] as string) ?? ''" placeholder="Содержит…" @input="setField(fd.key, ($event.target as HTMLInputElement).value)" />
        </label>
      </template>
      <template v-if="def.parentLabel">
        <label class="field"><span>Уровень</span>
          <select v-model="f.level" class="input"><option value="any">Все</option><option value="root">Только верхний уровень</option><option value="child">Только вложенные</option></select>
        </label>
        <div class="field"><span>Внутри ({{ def.parentLabel.toLowerCase() }})</span><EntityPicker v-model="f.within" :types="[type]" :allow-create="false" placeholder="Где угодно" /></div>
      </template>
      <label class="field"><span>Изображение</span>
        <select v-model="f.image" class="input"><option value="any">Неважно</option><option value="yes">Есть</option><option value="no">Нет</option></select>
      </label>
      <label class="field"><span>Текст статьи</span>
        <select v-model="f.text" class="input"><option value="any">Неважно</option><option value="yes">Написан</option><option value="no">Пустой</option></select>
      </label>
      <label class="field"><span>Изменено</span>
        <select v-model.number="f.updated" class="input"><option v-for="u in UPDATED" :key="u.v" :value="u.v">{{ u.l[0].toUpperCase() + u.l.slice(1) }}</option></select>
      </label>
      <div v-if="authorOptions.length > 1" class="field"><span>Автор</span><MultiSelect v-model="f.authors" :options="authorOptions" placeholder="Любой" /></div>
      <template v-if="world.isMaster">
        <div v-if="visOptions.length > 1" class="field"><span>Видимость</span><MultiSelect v-model="f.visibility" :options="visOptions" placeholder="Любая" /></div>
        <label class="field"><span>Секреты мастера</span>
          <select v-model="f.secrets" class="input"><option value="any">Неважно</option><option value="yes">Есть</option><option value="no">Нет</option></select>
        </label>
      </template>
      <label class="field"><span>Шаблоны</span>
        <select v-model="f.templates" class="input"><option value="any">Показывать</option><option value="yes">Только шаблоны</option><option value="no">Скрыть шаблоны</option></select>
      </label>
    </section>

    <div v-if="chips.length || active" class="filter-chips">
      <span class="muted small">Показано {{ items.length }} из {{ all.length }}</span>
      <button v-for="c in chips" :key="c.label" class="chip filter-chip" :title="'Убрать фильтр: ' + c.label" @click="c.clear()">{{ c.label }} <Icon name="x" :size="12" /></button>
      <button class="btn btn-ghost btn-sm" @click="clear"><Icon name="x" :size="13" /> Очистить фильтры</button>
    </div>

    <div v-if="!items.length" class="card empty">
      <Icon :name="def.icon" :size="36" />
      <p>{{ active ? 'По этим фильтрам ничего не найдено.' : `${def.plural} ещё не созданы.` }}</p>
      <button v-if="active" class="btn" @click="clear"><Icon name="x" :size="14" /> Очистить фильтры</button>
    </div>

    <div v-else-if="shownView === 'cards'" class="card-grid">
      <EntityCard v-for="e in items" :key="e.id" :entity="e" :uses="tagUse.get(e.id)" />
    </div>

    <div v-else-if="shownView === 'campaigns'" class="stack camp-groups">
      <section v-for="g in campaignGroups" :key="g.key" class="camp-group">
        <h2 class="camp-group-head">
          <RouterLink v-if="g.cid" :to="{ name: 'wcampaign', params: { wid: world.wid!, cid: g.cid } }" class="camp-group-title" :style="{ '--tag-color': g.colour || 'var(--accent)' }">{{ g.title }}</RouterLink>
          <span v-else class="camp-group-title" :style="{ '--tag-color': g.colour || 'var(--border)' }">{{ g.title }}</span>
          <span v-if="g.note" class="badge camp-group-note">{{ g.note }}</span>
          <span class="faint" style="font-size: 15px">{{ g.count }}</span>
        </h2>
        <template v-for="r in g.runs" :key="r.key">
          <div class="section-title camp-run">{{ r.label }} · {{ r.items.length }}</div>
          <div class="card-grid"><EntityCard v-for="e in r.items" :key="e.id" :entity="e" /></div>
        </template>
      </section>
    </div>

    <div v-else-if="shownView === 'table'" class="card" style="overflow-x: auto">
      <table class="table">
        <thead>
          <tr>
            <th class="sortable" @click="setSort('name')">Название <Icon v-if="f.sort === 'name'" :name="f.dir === 'asc' ? 'arrow-up' : 'arrow-down'" :size="12" /></th>
            <th v-if="type === 'tag'">Цвет</th><th v-if="type === 'tag'">Статей</th><th v-else>Подтип</th><th v-if="def.parentLabel">{{ def.parentLabel }}</th><th>Теги</th><th>Видимость</th>
            <th class="sortable" @click="setSort('updated')">Изменено <Icon v-if="f.sort === 'updated'" :name="f.dir === 'asc' ? 'arrow-up' : 'arrow-down'" :size="12" /></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in items" :key="e.id" style="cursor: pointer" @click="open(e)">
            <td><EntityLink :id="e.id" avatar /><span v-if="isCampaignTag(e)" class="badge" style="margin-left: 6px" title="Тег игры"><Icon name="swords" :size="11" /> игра</span></td>
            <template v-if="type === 'tag'">
              <td><span class="tag-chip" :style="{ '--tag-color': e.fields?.colour }" :title="e.fields?.colour || 'цвет по умолчанию'">{{ e.fields?.colour || 'по умолчанию' }}</span></td>
              <td class="muted">{{ tagUse.get(e.id) ?? 0 }}</td>
            </template>
            <td v-else class="muted">{{ e.kind }}</td>
            <td v-if="def.parentLabel"><EntityLink v-if="e.parentId" :id="e.parentId" @click.stop /></td>
            <td><span v-for="t in e.tagIds.slice(0, 3)" :key="t" class="tag-chip" style="margin-right: 4px" :style="{ '--tag-color': world.get(t)?.fields?.colour }">{{ world.get(t)?.name }}</span></td>
            <td class="small">{{ VISIBILITY_SHORT[e.visibility] }}</td>
            <td class="faint small nowrap">{{ relativeTime(e.updatedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="card card-pad">
      <ul class="tree"><TreeNode v-for="e in roots" :key="e.id" :entity="e" :pool="items" /></ul>
    </div>

    <Modal v-if="bulk" :title="bulk === 'visibility' ? `Видимость ${items.length} статей` : bulk === 'addTag' ? 'Добавить тег' : 'Убрать тег'" width="520px" @close="bulk = null">
      <div class="stack">
        <p class="muted small" style="margin: 0">Действие применится ко всем статьям, которые сейчас показаны в списке с учётом фильтров ({{ items.length }}).</p>
        <VisibilitySelect v-if="bulk === 'visibility'" v-model="bulkVis" />
        <EntityPicker v-else-if="bulk === 'addTag'" v-model="bulkTag" :types="['tag']" placeholder="Выберите или создайте тег…" />
        <select v-else v-model="bulkTag" class="input"><option :value="null">Выберите тег…</option><option v-for="t in tagsInUse" :key="t.id" :value="t.id">{{ t.name }}</option></select>
        <p v-if="bulk === 'visibility'" class="faint small" style="margin: 0">Разделы (посты) статей сохраняют свою видимость. Картинки в открытых статьях станут видны их читателям.</p>
      </div>
      <template #footer>
        <button class="btn" @click="bulk = null">Отмена</button>
        <button class="btn btn-primary" :disabled="!!bulkBusy || (bulk !== 'visibility' && !bulkTag)" @click="runBulk(bulk!)">{{ bulkBusy ? `${bulkBusy.done} / ${bulkBusy.total}` : 'Применить' }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.search-box { position: relative; display: flex; align-items: center; flex: 1 1 260px; max-width: 360px; }
.search-box > .icon { position: absolute; left: 10px; pointer-events: none; }
.search-box .input { padding-left: 32px; padding-right: 30px; }
.search-box .icon-btn { position: absolute; right: 2px; width: 28px; height: 28px; }
.filter-count { margin-left: 4px; font-size: 11px; font-weight: 700; background: var(--accent-fg); color: var(--accent); border-radius: 8px; padding: 0 6px; }
.btn:not(.btn-primary) .filter-count { background: var(--accent); color: var(--accent-fg); }
.filter-panel { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px 14px; margin-bottom: 14px; }
.filter-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 14px; }
.filter-chip { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.seg button { border: 0; background: none; padding: 0 7px; font-size: 11.5px; cursor: pointer; color: var(--text-muted); }
.seg button.on { background: var(--accent); color: var(--accent-fg); }
.camp-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin: -6px 0 14px; padding: 8px 12px; border: 1px dashed var(--border); border-radius: 10px; color: var(--text-muted); }
.camp-bar.on { border-style: solid; border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); background: var(--accent-soft); color: var(--text); }
.camp-bar > .icon { color: var(--accent); }
.camp-bar-select { width: auto; min-width: 180px; max-width: 100%; }
.camp-groups { gap: 0; }
.camp-group + .camp-group { border-top: 1px solid var(--border); margin-top: 20px; padding-top: 20px; }
.camp-group-note { font-size: 11.5px; align-self: center; }
.camp-group-head { display: flex; align-items: baseline; gap: 10px; margin: 0 0 8px; font-size: 22px; }
.camp-group-title { color: var(--text); text-decoration: none; padding-left: 10px; border-left: 4px solid var(--tag-color); }
a.camp-group-title:hover { color: var(--accent); }
.camp-run { margin: 10px 0 8px; }
</style>
