<script setup lang="ts">
// Content of the Leaflet popup (teleported into the popup element by MapViewer, so router/pinia work here).
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import { typeDef } from '@/model/entityTypes'
import { toast } from '@/components/common/toast'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import RichView from '@/components/viewer/RichView.vue'
import { hasContent, markerTitle } from './mapUtils'
import type { MapMarker } from '@/model/types'

const props = defineProps<{ marker: MapMarker; mapId: string; editing: boolean }>()
const emit = defineEmits<{ edit: [id: string] }>()
const world = useWorld()
const router = useRouter()

const linked = computed(() => world.get(props.marker.entityId))
const td = computed(() => (linked.value ? typeDef(linked.value.type) : null))
const to = computed(() => (linked.value ? { name: 'entity', params: { wid: world.wid!, eid: linked.value.id } } : null))
const title = computed(() => markerTitle(props.marker, linked.value))
const text = computed(() => (linked.value ? linked.value.tooltip || linked.value.excerpt : ''))
const showHtml = computed(() => hasContent(props.marker.html))

async function copyLink() {
  try {
    const href = router.resolve({ name: 'entity', params: { wid: world.wid!, eid: props.mapId }, query: { marker: props.marker.id } }).href
    await navigator.clipboard.writeText(new URL(href, location.href).href)
    toast.success('Ссылка на метку скопирована')
  } catch {
    toast.error('Не удалось скопировать ссылку')
  }
}
</script>

<template>
  <div class="mp">
    <div v-if="linked && td && to" class="mp-head">
      <RouterLink :to="to" class="mp-img" :style="{ color: td.color }">
        <Thumb :id="linked.imageId"><Icon :name="td.icon" :size="22" /></Thumb>
      </RouterLink>
      <div class="mp-titles">
        <div class="mp-type" :style="{ color: td.color }">{{ td.label }}<template v-if="linked.kind"> · {{ linked.kind }}</template></div>
        <RouterLink :to="to" class="mp-name">{{ title }}</RouterLink>
        <div v-if="title !== linked.name" class="mp-sub">{{ linked.name }}</div>
      </div>
    </div>
    <div v-else class="mp-name mp-name-solo">{{ title }}</div>

    <p v-if="text" class="mp-text">{{ text }}</p>
    <RichView v-if="showHtml" :html="marker.html" class="mp-html" />

    <div class="mp-foot">
      <RouterLink v-if="to" :to="to" class="mp-open">Открыть статью <Icon name="arrow-right" :size="14" /></RouterLink>
      <span class="grow" />
      <button type="button" class="icon-btn" title="Скопировать ссылку на метку" @click="copyLink"><Icon name="link" :size="16" /></button>
      <button v-if="editing" type="button" class="icon-btn" title="Изменить метку" @click="emit('edit', marker.id)"><Icon name="pencil" :size="16" /></button>
    </div>
  </div>
</template>

<style scoped>
.mp { display: flex; flex-direction: column; gap: 8px; font-family: var(--font-ui); color: var(--text); }
.mp-head { display: flex; gap: 10px; align-items: center; }
.mp-img { width: 52px; height: 52px; flex: 0 0 52px; border-radius: 8px; overflow: hidden; background: var(--surface-3); display: flex; align-items: center; justify-content: center; }
.mp-img :deep(img) { width: 100%; height: 100%; object-fit: cover; display: block; }
.mp-img :deep(.thumb-empty) { width: 100%; height: 100%; background: transparent; color: inherit; }
.mp-titles { min-width: 0; display: flex; flex-direction: column; }
.mp-type { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
.mp-name { font-family: var(--font-head); font-size: 19px; font-weight: 700; line-height: 1.2; color: var(--text) !important; overflow-wrap: anywhere; }
a.mp-name:hover { color: var(--accent) !important; text-decoration: none; }
.mp-name-solo { padding-right: 16px; }
.mp-sub { font-size: 12.5px; color: var(--text-muted); }
.mp-text { margin: 0 !important; font-size: 13.5px; color: var(--text-muted); line-height: 1.45; }
.mp-html { font-size: 14px; line-height: 1.5; }
.mp-html :deep(p) { margin: 0 0 .5em; }
.mp-html :deep(h1), .mp-html :deep(h2), .mp-html :deep(h3) { font-size: 1.15em; margin: .4em 0 .3em; border: 0; }
.mp-foot { display: flex; align-items: center; gap: 2px; border-top: 1px solid var(--border); padding-top: 6px; margin-top: 2px; }
.mp-open { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; font-size: 13.5px; color: var(--accent) !important; }
.mp-foot .icon-btn { width: 28px; height: 28px; }
</style>
