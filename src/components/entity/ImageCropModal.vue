<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import { useWorld } from '@/stores/world'
import { imageUrl } from '@/data/images'
import { DEFAULT_CROP, cropOf, cropStyle, type CropField, type ImageCrop } from '@/data/crop'
import type { Entity } from '@/model/types'

const props = defineProps<{ entity: Entity; field: CropField }>()
const emit = defineEmits<{ close: [] }>()
const world = useWorld()
const imageId = computed(() => (props.field === 'headerCrop' ? props.entity.headerImageId : props.entity.imageId))
const url = ref<string | null>(null)
const crop = ref<ImageCrop>({ ...(cropOf(props.entity, props.field) ?? DEFAULT_CROP) })
const imgEl = ref<HTMLImageElement | null>(null)
const busy = ref(false)

onMounted(async () => {
  if (imageId.value) url.value = await imageUrl(world.access, imageId.value, 'full').catch(() => null)
})

const style = computed(() => cropStyle(crop.value))
const PREVIEWS = computed(() => props.field === 'headerCrop'
  ? [{ label: 'Обложка статьи', w: 340, h: 104, round: false }, { label: 'Высокая обложка', w: 340, h: 170, round: false }]
  : [{ label: 'Аватар', w: 132, h: 132, round: false }, { label: 'Карточка в списке', w: 176, h: 132, round: false }, { label: 'Значок', w: 56, h: 56, round: true }, { label: 'Портрет', w: 100, h: 132, round: false }])

// The focal point is set by clicking or dragging on the full image.
function setFrom(e: PointerEvent) {
  const r = imgEl.value?.getBoundingClientRect()
  if (!r) return
  crop.value = { ...crop.value, x: Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)) * 10) / 10, y: Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) * 10) / 10 }
}
function down(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  setFrom(e)
}
function move(e: PointerEvent) { if (e.buttons & 1) setFrom(e) }
function wheel(e: WheelEvent) {
  e.preventDefault()
  crop.value = { ...crop.value, zoom: Math.round(Math.min(4, Math.max(1, crop.value.zoom * Math.exp(-e.deltaY * 0.0015))) * 100) / 100 }
}
function key(e: KeyboardEvent) {
  const step = e.shiftKey ? 5 : 1
  const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
  if (!d[e.key]) return
  e.preventDefault()
  crop.value = { ...crop.value, x: Math.min(100, Math.max(0, crop.value.x + d[e.key][0])), y: Math.min(100, Math.max(0, crop.value.y + d[e.key][1])) }
}

async function save(reset = false) {
  busy.value = true
  try {
    const value = reset || (crop.value.x === 50 && crop.value.y === 50 && crop.value.zoom === 1) ? null : { ...crop.value }
    await world.updateEntity(props.entity.id, { fields: { ...props.entity.fields, [props.field]: value } })
    emit('close')
  } finally { busy.value = false }
}
</script>

<template>
  <Modal :title="field === 'headerCrop' ? 'Кадр обложки' : 'Кадр изображения'" width="980px" @close="emit('close')">
    <div class="crop-wrap">
      <div class="crop-stage" tabindex="0" @keydown="key">
        <span v-if="url" class="crop-img" @pointerdown.prevent="down" @pointermove="move" @wheel="wheel">
          <img ref="imgEl" :src="url" alt="" draggable="false" />
          <span class="crop-dot" :style="{ left: crop.x + '%', top: crop.y + '%' }" />
        </span>
        <div v-else class="empty"><Icon name="refresh-cw" class="spin" /></div>
      </div>
      <aside class="crop-side">
        <p class="muted small" style="margin: 0">Щёлкните или потяните по картинке, чтобы выбрать главное место кадра — оно останется видимым во всех рамках. Стрелки двигают точку, колесо мыши меняет масштаб.</p>
        <label class="field"><span>Масштаб: {{ crop.zoom.toFixed(2) }}×</span>
          <input v-model.number="crop.zoom" type="range" min="1" max="4" step="0.01" />
        </label>
        <div class="crop-previews">
          <div v-for="p in PREVIEWS" :key="p.label" class="crop-prev">
            <div class="crop-frame" :class="{ round: p.round }" :style="{ width: p.w + 'px', height: p.h + 'px' }">
              <img v-if="url" :src="url" alt="" :style="style" draggable="false" />
            </div>
            <span class="faint small">{{ p.label }}</span>
          </div>
        </div>
      </aside>
    </div>
    <template #footer>
      <button class="btn btn-ghost" style="margin-right: auto" :disabled="busy" @click="save(true)"><Icon name="rotate-ccw" :size="14" /> Сбросить (по центру)</button>
      <button class="btn" @click="emit('close')">Отмена</button>
      <button class="btn btn-primary" :disabled="busy || !url" @click="save()">Сохранить кадр</button>
    </template>
  </Modal>
</template>

<style scoped>
.crop-wrap { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 18px; align-items: start; }
.crop-stage { display: flex; align-items: center; justify-content: center; background: var(--surface-3); border-radius: 10px; padding: 10px; min-height: 260px; outline: none; }
.crop-stage:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
.crop-img { position: relative; display: inline-block; cursor: crosshair; touch-action: none; line-height: 0; }
.crop-img img { max-width: 100%; max-height: 62vh; display: block; border-radius: 4px; user-select: none; }
.crop-dot { position: absolute; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 0 2px rgb(0 0 0 / 55%), 0 2px 8px rgb(0 0 0 / 40%); pointer-events: none; }
.crop-dot::after { content: ''; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px; border-radius: 50%; background: var(--accent); }
.crop-side { display: flex; flex-direction: column; gap: 14px; }
.crop-previews { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.crop-prev { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.crop-frame { overflow: hidden; border-radius: 10px; background: var(--surface-3); border: 1px solid var(--border); }
.crop-frame.round { border-radius: 50%; }
.crop-frame img { display: block; }
@media (max-width: 860px) { .crop-wrap { grid-template-columns: 1fr; } }
</style>
