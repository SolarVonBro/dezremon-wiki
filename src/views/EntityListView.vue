<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import { typeDef } from '@/model/entityTypes'
import { relativeTime } from '@/data/util'
import { quickSearch } from '@/data/search'
import { VISIBILITY_SHORT } from '@/data/access'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import TreeNode from '@/components/entity/TreeNode.vue'
import { cropOf } from '@/data/crop'
import { createRequest } from '@/components/layout/createRequest'
import Dropdown from '@/components/common/Dropdown.vue'
import Modal from '@/components/common/Modal.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import { toast } from '@/components/common/toast'
import type { Entity, Visibility } from '@/model/types'

const route = useRoute()
const router = useRouter()
const world = useWorld()
const type = computed(() => route.params.type as string)
const def = computed(() => typeDef(type.value))

function readPref<T>(k: string, d: T): T { try { return (JSON.parse(localStorage.getItem('dw.list.' + k) ?? 'null') as T) ?? d } catch { return d } }
const view = ref<'cards' | 'table' | 'tree'>(readPref('view', 'cards'))
watch(view, (v) => { try { localStorage.setItem('dw.list.view', JSON.stringify(v)) } catch { /* ignore */ } })
const q = ref((route.query.q as string) ?? '')
const tag = ref<string | null>((route.query.tag as string) ?? null)
const kind = ref<string>('')
const sort = ref<'name' | 'updated' | 'created'>('name')
const onlyTemplates = ref(false)
watch(type, () => { q.value = ''; kind.value = ''; tag.value = null })

const all = computed(() => world.byType.get(type.value) ?? [])
const kinds = computed(() => [...new Set(all.value.map((e) => e.kind).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')))
const tagsInUse = computed(() => {
  const ids = new Set(all.value.flatMap((e) => e.tagIds))
  return world.tags.filter((t) => ids.has(t.id))
})
const items = computed(() => {
  let list = q.value.trim() ? quickSearch(all.value, q.value, 1000) : [...all.value]
  if (kind.value) list = list.filter((e) => e.kind === kind.value)
  if (tag.value) list = list.filter((e) => e.tagIds.includes(tag.value!))
  if (onlyTemplates.value) list = list.filter((e) => e.isTemplate)
  if (!q.value.trim()) {
    if (sort.value === 'updated') list.sort((a, b) => b.updatedAt - a.updatedAt)
    else if (sort.value === 'created') list.sort((a, b) => b.createdAt - a.createdAt)
  }
  return list
})
const roots = computed(() => items.value.filter((e) => !e.parentId || !all.value.some((p) => p.id === e.parentId)))
const filtered = computed(() => !!(q.value.trim() || kind.value || tag.value || onlyTemplates.value))
function open(e: Entity) { void router.push({ name: 'entity', params: { wid: world.wid!, eid: e.id } }) }

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
    <div class="list-toolbar">
      <input v-model="q" class="input" style="max-width: 280px" placeholder="Фильтр по названию…" />
      <select v-if="kinds.length" v-model="kind" class="input" style="max-width: 200px"><option value="">Все подтипы</option><option v-for="k in kinds" :key="k" :value="k">{{ k }}</option></select>
      <select v-if="tagsInUse.length" v-model="tag" class="input" style="max-width: 200px"><option :value="null">Все теги</option><option v-for="t in tagsInUse" :key="t.id" :value="t.id">{{ t.name }}</option></select>
      <select v-model="sort" class="input" style="max-width: 190px"><option value="name">По названию</option><option value="updated">Недавно изменённые</option><option value="created">Недавно созданные</option></select>
      <label class="check small"><input v-model="onlyTemplates" type="checkbox" /> шаблоны</label>
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
        <button class="icon-btn" :class="{ on: view === 'cards' }" title="Карточки" @click="view = 'cards'"><Icon name="layout-grid" /></button>
        <button class="icon-btn" :class="{ on: view === 'table' }" title="Таблица" @click="view = 'table'"><Icon name="layout-list" /></button>
        <button v-if="def.parentLabel" class="icon-btn" :class="{ on: view === 'tree' }" title="Дерево" @click="view = 'tree'"><Icon name="git-branch" /></button>
      </div>
    </div>

    <div v-if="!items.length" class="card empty">
      <Icon :name="def.icon" :size="36" />
      <p>{{ filtered ? 'Ничего не найдено.' : `${def.plural} ещё не созданы.` }}</p>
    </div>

    <div v-else-if="view === 'cards'" class="card-grid">
      <RouterLink v-for="e in items" :key="e.id" class="ecard" :to="{ name: 'entity', params: { wid: world.wid!, eid: e.id } }">
        <div class="ecard-img"><Thumb :id="e.imageId" :crop="cropOf(e)"><Icon :name="def.icon" :size="38" :style="{ color: def.color, opacity: 0.6 }" /></Thumb></div>
        <div class="ecard-body">
          <div class="ecard-name">{{ e.name }}</div>
          <div class="ecard-sub">
            {{ e.kind || def.label }}
            <span v-if="e.visibility !== 'members'" class="badge" :class="{ 'badge-secret': e.visibility === 'master' || e.visibility === 'custom', 'badge-public': e.visibility === 'public' }" style="margin-left: 4px">{{ VISIBILITY_SHORT[e.visibility] }}</span>
            <span v-if="e.fields?.isDead" class="badge badge-dead" style="margin-left: 4px">†</span>
          </div>
          <div v-if="e.tooltip || e.excerpt" class="ecard-text">{{ e.tooltip || e.excerpt }}</div>
        </div>
      </RouterLink>
    </div>

    <div v-else-if="view === 'table'" class="card" style="overflow-x: auto">
      <table class="table">
        <thead><tr><th>Название</th><th>Подтип</th><th v-if="def.parentLabel">{{ def.parentLabel }}</th><th>Теги</th><th>Видимость</th><th>Изменено</th></tr></thead>
        <tbody>
          <tr v-for="e in items" :key="e.id" style="cursor: pointer" @click="open(e)">
            <td><EntityLink :id="e.id" avatar /></td>
            <td class="muted">{{ e.kind }}</td>
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
