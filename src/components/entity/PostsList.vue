<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { useRows } from '@/composables/useRows'
import { VISIBILITY_SHORT } from '@/data/access'
import Icon from '@/components/common/Icon.vue'
import RichView from '@/components/viewer/RichView.vue'
import { defineAsyncComponent } from 'vue'
const PostEditor = defineAsyncComponent(() => import('./PostEditor.vue'))
import type { Entity, Post } from '@/model/types'

const props = defineProps<{ entity: Entity; position: 'before' | 'after'; editing: boolean }>()
const world = useWorld()
const all = useRows<Post>('posts', 'entityId', () => props.entity.id)
const posts = computed(() => all.value.filter((p) => (p.position ?? 'after') === props.position))
const editingId = ref<string | null>(null)
const collapsed = ref<Record<string, boolean>>({})

const canPost = computed(() => world.canEdit(props.entity) || (world.isMember && world.settings.playersCanPost))
const canEditPost = (p: Post) => world.isMaster || p.createdBy === world.uid

async function add() {
  const id = await world.saveRow('posts', {
    entityId: props.entity.id, title: 'Новый раздел', html: '', order: (all.value.at(-1)?.order ?? 0) + 1, position: props.position,
    isCollapsed: false, deleted: false, visibility: props.entity.visibility, allowedUids: props.entity.allowedUids ?? [],
  })
  editingId.value = id
}
async function move(p: Post, dir: -1 | 1) {
  const list = posts.value
  const i = list.indexOf(p)
  const other = list[i + dir]
  if (!other) return
  await Promise.all([world.saveRow('posts', { id: p.id, order: other.order }), world.saveRow('posts', { id: other.id, order: p.order })])
}
function isCollapsed(p: Post) { return collapsed.value[p.id] ?? p.isCollapsed }
</script>

<template>
  <template v-for="p in posts" :key="p.id">
    <PostEditor v-if="editingId === p.id && canEditPost(p)" :post="p" :entity="entity" @done="editingId = null" />
    <section v-else class="card post-card" :id="'post-' + p.id">
      <div class="post-head">
        <button class="icon-btn" :title="isCollapsed(p) ? 'Развернуть' : 'Свернуть'" @click="collapsed[p.id] = !isCollapsed(p)"><Icon :name="isCollapsed(p) ? 'chevron-right' : 'chevron-down'" :size="16" /></button>
        <h3>{{ p.title || 'Без названия' }}</h3>
        <span v-if="p.visibility !== 'members'" class="badge" :class="{ 'badge-secret': p.visibility === 'master' || p.visibility === 'custom', 'badge-public': p.visibility === 'public' }">{{ VISIBILITY_SHORT[p.visibility] }}</span>
        <template v-if="editing && canEditPost(p)">
          <button class="icon-btn" title="Выше" @click="move(p, -1)"><Icon name="arrow-up" :size="15" /></button>
          <button class="icon-btn" title="Ниже" @click="move(p, 1)"><Icon name="arrow-down" :size="15" /></button>
        </template>
        <button v-if="canEditPost(p) && (editing || p.createdBy === world.uid)" class="icon-btn" title="Редактировать раздел" @click="editingId = p.id"><Icon name="pencil" :size="15" /></button>
      </div>
      <RichView v-if="!isCollapsed(p)" :html="p.html" />
      <div v-if="!isCollapsed(p) && p.createdBy !== entity.createdBy" class="faint small">Автор: {{ world.memberName(p.createdBy) }}</div>
    </section>
  </template>
  <button v-if="editing && canPost && position === 'after'" class="btn btn-ghost" style="align-self: flex-start" @click="add"><Icon name="plus" :size="15" /> Добавить раздел (отдельный блок с собственной видимостью)</button>
  <button v-else-if="!editing && position === 'after' && world.isMember && !world.canEdit(entity) && world.settings.playersCanPost" class="btn btn-ghost btn-sm" style="align-self: flex-start" @click="add"><Icon name="plus" :size="14" /> Добавить свою заметку</button>
</template>
