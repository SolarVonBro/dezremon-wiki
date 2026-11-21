<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { useWorld } from '@/stores/world'
import { visibleQueries } from '@/data/access'
import { typeDef, allTypes } from '@/model/entityTypes'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import type { Bookmark } from '@/model/types'

const world = useWorld()
const rows = ref<Bookmark[]>([])
let unsubs: Unsubscribe[] = []
const parts: Map<string, Bookmark>[] = []

watch(() => [world.wid, world.role, world.status], () => {
  unsubs.forEach((u) => u())
  unsubs = []
  rows.value = []
  if (!world.wid || world.status !== 'ready') return
  visibleQueries(world.access, 'bookmarks').forEach((q, i) => {
    parts[i] = new Map()
    unsubs.push(onSnapshot(q, (s) => {
      parts[i] = new Map(s.docs.map((d) => [d.id, { ...(d.data() as Bookmark), id: d.id }]))
      const all = new Map<string, Bookmark>()
      parts.forEach((p) => p?.forEach((v, k) => all.set(k, v)))
      rows.value = [...all.values()].sort((a, b) => a.order - b.order)
    }, () => {}))
  })
}, { immediate: true })
onBeforeUnmount(() => unsubs.forEach((u) => u()))

const favorites = computed(() => (world.member?.favorites ?? []).map((id) => world.get(id)).filter(Boolean))

const adding = ref(false)
const form = ref<{ name: string; target: Bookmark['target']; entityId: string | null; typeKey: string | null; url: string; icon: string }>({ name: '', target: 'entity', entityId: null, typeKey: null, url: '', icon: 'bookmark' })
async function save() {
  const f = form.value
  const name = f.name || (f.target === 'entity' ? world.get(f.entityId)?.name : f.target === 'type' && f.typeKey ? typeDef(f.typeKey).plural : f.url) || 'Закладка'
  await world.saveRow('bookmarks', { ...f, name, order: rows.value.length, visibility: 'members', allowedUids: [] })
  adding.value = false
  form.value = { name: '', target: 'entity', entityId: null, typeKey: null, url: '', icon: 'bookmark' }
}
function to(b: Bookmark) {
  if (b.target === 'entity' && b.entityId) return { name: 'entity', params: { wid: world.wid!, eid: b.entityId } }
  if (b.target === 'type' && b.typeKey) return { name: 'list', params: { wid: world.wid!, type: b.typeKey } }
  if (b.target === 'tag' && b.entityId) return { name: 'entity', params: { wid: world.wid!, eid: b.entityId } }
  return null
}
</script>

<template>
  <nav v-if="rows.length || favorites.length || world.isMaster" class="sb-section">
    <div class="sb-section-title">Закладки <button v-if="world.isMaster" class="icon-btn" style="width: 22px; height: 22px" title="Добавить закладку" @click="adding = true"><Icon name="plus" :size="14" /></button></div>
    <template v-for="b in rows" :key="b.id">
      <RouterLink v-if="to(b)" class="sb-link" :to="to(b)!"><Icon :name="b.icon || 'bookmark'" :size="17" /> <span class="ellipsis">{{ b.name }}</span>
        <button v-if="world.isMaster" class="icon-btn bm-del" title="Удалить закладку" @click.prevent.stop="world.deleteRow('bookmarks', b.id)"><Icon name="x" :size="13" /></button>
      </RouterLink>
      <a v-else class="sb-link" :href="b.url" target="_blank" rel="noopener"><Icon :name="b.icon || 'external-link'" :size="17" /> <span class="ellipsis">{{ b.name }}</span></a>
    </template>
    <RouterLink v-for="e in favorites" :key="e!.id" class="sb-link" :to="{ name: 'entity', params: { wid: world.wid!, eid: e!.id } }">
      <Icon name="star" :size="17" style="color: var(--accent)" /> <span class="ellipsis">{{ e!.name }}</span>
    </RouterLink>
    <Modal v-if="adding" title="Новая закладка" width="460px" @close="adding = false">
      <form class="stack" @submit.prevent="save">
        <div class="row gap-sm">
          <button v-for="t in (['entity', 'type', 'url'] as const)" :key="t" type="button" class="chip" :class="{ on: form.target === t }" @click="form.target = t">{{ { entity: 'Статья', type: 'Раздел', url: 'Ссылка' }[t] }}</button>
        </div>
        <EntityPicker v-if="form.target === 'entity'" v-model="form.entityId" />
        <select v-else-if="form.target === 'type'" v-model="form.typeKey" class="input"><option v-for="t in allTypes()" :key="t.key" :value="t.key">{{ t.plural }}</option></select>
        <input v-else v-model="form.url" class="input" placeholder="https://…" />
        <label class="field"><span>Название (необязательно)</span><input v-model="form.name" class="input" /></label>
        <div><button class="btn btn-primary">Добавить</button></div>
      </form>
    </Modal>
  </nav>
</template>

<style scoped>
.bm-del { width: 20px; height: 20px; margin-left: auto; opacity: 0; }
.sb-link:hover .bm-del { opacity: 1; }
</style>
