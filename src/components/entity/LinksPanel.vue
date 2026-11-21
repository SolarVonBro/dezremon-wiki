<script setup lang="ts">
import { ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import { randomId } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import type { Entity, EntityLink } from '@/model/types'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()
const links = ref<EntityLink[]>([])
const dirty = ref(false)
watch(() => props.entity.links, (l) => { if (!dirty.value) links.value = (l ?? []).map((x) => ({ ...x })) }, { immediate: true })

function add() { links.value.push({ id: randomId(8), name: '', url: '' }); dirty.value = true }
async function save() {
  const clean = links.value.filter((l) => l.url.trim()).map((l) => ({ ...l, url: /^https?:/.test(l.url) ? l.url.trim() : 'https://' + l.url.trim(), name: l.name.trim() || l.url.trim() }))
  await world.updateEntity(props.entity.id, { links: clean })
  dirty.value = false
}
function host(u: string) { try { return new URL(u).hostname } catch { return u } }
</script>

<template>
  <div class="card card-pad" style="max-width: 820px">
    <h3 class="panel-title"><Icon name="link" /> Внешние ссылки</h3>
    <p class="muted small">Плейлист для сцены, референсы, лист персонажа в другом сервисе, исходники карты…</p>
    <div v-if="!editing" class="stack-sm">
      <a v-for="l in entity.links" :key="l.id" :href="l.url" target="_blank" rel="noopener noreferrer" class="row gap-sm">
        <Icon name="external-link" :size="15" /> {{ l.name }} <span class="faint small">{{ host(l.url) }}</span>
      </a>
      <div v-if="!entity.links.length" class="empty">Ссылок нет.</div>
    </div>
    <div v-else class="stack-sm">
      <div v-for="(l, i) in links" :key="l.id" class="row gap-sm">
        <input v-model="l.name" class="input input-sm" style="width: 35%" placeholder="Название" @input="dirty = true" />
        <input v-model="l.url" class="input input-sm grow" placeholder="https://…" @input="dirty = true" />
        <button class="icon-btn" @click="links.splice(i, 1); dirty = true"><Icon name="x" :size="14" /></button>
      </div>
      <div class="row gap">
        <button class="btn btn-sm" @click="add"><Icon name="plus" :size="14" /> Ссылка</button>
        <button class="btn btn-sm btn-primary" :disabled="!dirty" @click="save">Сохранить</button>
      </div>
    </div>
  </div>
</template>
