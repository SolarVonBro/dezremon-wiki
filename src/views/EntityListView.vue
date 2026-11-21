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
import { createRequest } from '@/components/layout/createRequest'
import type { Entity } from '@/model/types'

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
        <div class="ecard-img"><Thumb :id="e.imageId"><Icon :name="def.icon" :size="38" :style="{ color: def.color, opacity: 0.6 }" /></Thumb></div>
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
  </div>
</template>
