<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { useWorld } from '@/stores/world'
import { imageUrl } from '@/data/images'

const props = defineProps(nodeViewProps)
const world = useWorld()
const url = ref<string | null>(null)
const failed = ref(false)
const wrap = ref<HTMLElement | null>(null)

const attrs = computed(() => props.node.attrs as any)

watch(() => [attrs.value.imageId, attrs.value.src], async () => {
  failed.value = false
  if (attrs.value.imageId) {
    try { url.value = await imageUrl(world.access, attrs.value.imageId) } catch { failed.value = true }
  } else url.value = attrs.value.src
}, { immediate: true })

function startResize(e: PointerEvent, dir: 1 | -1) {
  const el = wrap.value?.closest('.wiki-img') as HTMLElement | null
  if (!el) return
  const parent = (el.parentElement?.closest('p, li, td, th, h1, h2, h3, h4, h5, h6, div[data-column], .ProseMirror') as HTMLElement) ?? el.parentElement!
  const box = parent.getBoundingClientRect()
  const startX = e.clientX
  const startW = el.getBoundingClientRect().width
  const target = e.target as HTMLElement
  target.setPointerCapture(e.pointerId)
  let pct = 0
  const move = (ev: PointerEvent) => {
    const w = Math.max(40, startW + (ev.clientX - startX) * dir * (attrs.value.align === 'center' ? 2 : 1))
    pct = Math.min(100, Math.max(5, Math.round((w / box.width) * 100)))
    el.style.width = pct + '%'
  }
  const up = () => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
    if (pct) props.updateAttributes({ width: pct + '%' })
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
}
</script>

<template>
  <NodeViewWrapper
    as="span"
    class="wiki-img"
    :class="{ 'is-selected': selected, 'is-broken': failed }"
    :data-align="attrs.align"
    :style="attrs.width ? { width: attrs.width } : undefined"
    data-drag-handle
  >
    <span ref="wrap" class="wiki-img-inner">
      <img v-if="url && !failed" :src="url" :alt="attrs.alt" :title="attrs.title" draggable="false" />
      <span v-else class="wiki-img-missing">{{ failed ? 'Изображение недоступно' : 'Загрузка…' }}</span>
      <template v-if="selected && editor.isEditable">
        <span class="rz rz-l" title="Потяните, чтобы изменить размер" @pointerdown.prevent.stop="startResize($event, -1)" />
        <span class="rz rz-r" title="Потяните, чтобы изменить размер" @pointerdown.prevent.stop="startResize($event, 1)" />
        <span class="rz-size">{{ attrs.width || 'авто' }}</span>
      </template>
    </span>
    <span v-if="attrs.caption" class="wiki-img-cap">{{ attrs.caption }}</span>
  </NodeViewWrapper>
</template>
