<script setup lang="ts">
// Side panel editing one marker. The draft lives in MapViewer (v-model:draft) so the map previews
// every change live; saving/deleting goes straight to the store.
import { computed, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { toast } from '@/components/common/toast'
import Icon from '@/components/common/Icon.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import { RichEditor, type RichEditorInstance } from '@/components/editor/lazy'
import IconPicker from './IconPicker.vue'
import {
  AREA_OPACITY, DEFAULT_COLOUR, DEFAULT_FONT, SHAPES, SWATCHES, centroid, defaultPolygon, hasContent, isArea, markerTitle, round2,
  safeColour, toHex6, type MarkerData, type MarkerShape,
} from './mapUtils'
import type { MapGroup, Visibility } from '@/model/types'

const props = defineProps<{ draft: MarkerData; groups: MapGroup[]; defaultRadius: number }>()
const emit = defineEmits<{ 'update:draft': [d: MarkerData]; close: []; saved: [id: string]; deleted: [id: string]; dirty: [] }>()
const world = useWorld()
const rich = ref<RichEditorInstance | null>(null)
const saving = ref(false)

const isNew = computed(() => !props.draft.id)
const linked = computed(() => world.get(props.draft.entityId))
const area = computed(() => isArea(props.draft.shape))

function patch(p: Partial<MarkerData>) {
  emit('update:draft', { ...props.draft, ...p })
}
/** Writable computed bound to one draft field (for v-model). */
function field<K extends keyof MarkerData>(k: K) {
  return computed<MarkerData[K]>({ get: () => props.draft[k], set: (v) => patch({ [k]: v } as Partial<MarkerData>) })
}
const name = field('name')
const entityId = field('entityId')
const icon = field('icon')
const size = field('size')
const radius = field('radius')
const opacity = field('opacity')
const vis = computed<{ visibility: Visibility; allowedUids: string[] }>({
  get: () => ({ visibility: props.draft.visibility, allowedUids: props.draft.allowedUids ?? [] }),
  set: (v) => patch({ visibility: v.visibility, allowedUids: v.allowedUids }),
})

function setShape(s: MarkerShape) {
  const d = props.draft
  if (s === d.shape) return
  const p: Partial<MarkerData> = { shape: s }
  if (s === 'polygon' && d.points.length < 3) p.points = defaultPolygon({ lat: d.lat, lng: d.lng }, d.radius > 1 ? d.radius : props.defaultRadius)
  if (d.shape === 'polygon' && d.points.length >= 3) {
    const c = centroid(d.points)
    p.lat = round2(c.lat); p.lng = round2(c.lng)
  }
  if (s === 'circle' && !(d.radius > 1)) p.radius = props.defaultRadius
  // keep the default opacity of the shape family unless the user changed it
  if (isArea(s) !== isArea(d.shape) && d.opacity === (isArea(d.shape) ? AREA_OPACITY : 1)) p.opacity = isArea(s) ? AREA_OPACITY : 1
  patch(p)
}

const sameColour = (a: string, b: string) => safeColour(a, '').toLowerCase() === b.toLowerCase()

function onGroup(e: Event) {
  const sel = e.target as HTMLSelectElement
  if (sel.value === '__new') {
    sel.value = props.draft.groupId ?? ''
    void createGroup()
  } else patch({ groupId: sel.value || null })
}
async function createGroup() {
  const n = window.prompt('Название новой группы:')?.trim()
  if (!n) return
  const order = props.groups.reduce((m, g) => Math.max(m, g.order), 0) + 1
  const id = await world.saveRow('mapGroups', { mapId: props.draft.mapId, name: n, order, isShown: true })
  patch({ groupId: id })
}

async function save() {
  const d = props.draft
  if (d.shape === 'label' && !d.name.trim() && !linked.value) { toast.error('Введите текст подписи'); return }
  if (d.shape === 'polygon' && d.points.length < 3) { toast.error('У области должно быть не меньше трёх вершин'); return }
  saving.value = true
  try {
    const raw = rich.value?.getHTML() ?? d.html
    const data: MarkerData = {
      ...d,
      name: d.name.trim(),
      html: hasContent(raw) ? raw : '',
      lat: round2(d.lat), lng: round2(d.lng),
      radius: round2(Math.max(1, d.radius)),
      size: Math.round(d.size),
      points: d.shape === 'polygon' ? d.points.map((p) => ({ lat: round2(p.lat), lng: round2(p.lng) })) : [],
    }
    const id = await world.saveRow('mapMarkers', data)
    emit('saved', id)
  } catch {
    // the store already shows a toast
  } finally {
    saving.value = false
  }
}

async function remove() {
  const id = props.draft.id
  if (!id || !window.confirm(`Удалить метку «${markerTitle(props.draft, linked.value)}»?`)) return
  try {
    await world.deleteRow('mapMarkers', id)
    emit('deleted', id)
  } catch { /* toast shown by the store */ }
}
</script>

<template>
  <div class="me">
    <header class="me-head">
      <b>{{ isNew ? 'Новая метка' : 'Метка' }}</b>
      <button type="button" class="icon-btn" title="Закрыть без сохранения" @click="emit('close')"><Icon name="x" :size="16" /></button>
    </header>

    <div class="me-body">
      <div class="me-shapes" role="radiogroup" aria-label="Форма">
        <button v-for="s in SHAPES" :key="s.value" type="button" class="me-shape" :class="{ on: draft.shape === s.value }" :aria-checked="draft.shape === s.value" role="radio" @click="setShape(s.value)">
          <Icon :name="s.icon" :size="15" /> <span>{{ s.label }}</span>
        </button>
      </div>

      <label class="field">
        <span>{{ draft.shape === 'label' ? 'Текст подписи' : 'Название' }}</span>
        <input v-model="name" class="input input-sm" :placeholder="linked?.name || (draft.shape === 'label' ? 'Текст на карте' : 'Без названия')" />
      </label>

      <div class="field">
        <span>Статья</span>
        <EntityPicker v-model="entityId" placeholder="Не привязана" />
      </div>

      <label class="field">
        <span>Группа</span>
        <select class="input input-sm" :value="draft.groupId ?? ''" @change="onGroup">
          <option value="">Без группы</option>
          <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name || 'Без названия' }}</option>
          <option value="__new">+ Новая группа…</option>
        </select>
      </label>

      <div v-if="draft.shape === 'marker'" class="field">
        <span>Значок</span>
        <IconPicker v-model="icon" :allow-entity="!!draft.entityId" />
      </div>

      <div class="field">
        <span>{{ draft.shape === 'label' ? 'Фон' : area ? 'Цвет области' : 'Цвет маркера' }}</span>
        <div class="me-colours">
          <button v-if="draft.shape === 'label'" type="button" class="me-sw me-sw-none" :class="{ on: draft.colour === 'transparent' }" title="Без фона" @click="patch({ colour: 'transparent' })" />
          <button v-for="c in SWATCHES" :key="c" type="button" class="me-sw" :class="{ on: sameColour(draft.colour, c) }" :style="{ background: c }" :title="c" @click="patch({ colour: c })" />
          <input type="color" class="me-picker" title="Свой цвет" :value="toHex6(draft.colour, DEFAULT_COLOUR)" @input="patch({ colour: ($event.target as HTMLInputElement).value })" />
        </div>
      </div>

      <div v-if="!area" class="field">
        <span>{{ draft.shape === 'label' ? 'Цвет текста' : 'Цвет значка' }}</span>
        <div class="me-colours">
          <button v-for="c in SWATCHES" :key="c" type="button" class="me-sw" :class="{ on: sameColour(draft.fontColour, c) }" :style="{ background: c }" :title="c" @click="patch({ fontColour: c })" />
          <input type="color" class="me-picker" title="Свой цвет" :value="toHex6(draft.fontColour, DEFAULT_FONT)" @input="patch({ fontColour: ($event.target as HTMLInputElement).value })" />
        </div>
      </div>

      <label v-if="!area" class="field">
        <span>{{ draft.shape === 'label' ? 'Размер текста' : 'Размер' }} · {{ draft.size }}</span>
        <input v-model.number="size" type="range" min="16" max="96" step="2" />
      </label>

      <div v-if="draft.shape === 'circle'" class="field">
        <span>Радиус (в пикселях карты)</span>
        <div class="row gap-sm">
          <input v-model.number="radius" type="range" class="grow" min="1" :max="Math.max(defaultRadius * 10, draft.radius)" step="1" />
          <input v-model.number="radius" type="number" class="input input-sm me-num" min="1" />
        </div>
      </div>

      <label class="field">
        <span>{{ area ? 'Заливка' : 'Непрозрачность' }} · {{ Math.round(draft.opacity * 100) }}%</span>
        <input v-model.number="opacity" type="range" min="0" max="1" step="0.05" />
      </label>

      <p class="me-hint">
        <template v-if="draft.shape === 'polygon'">Вершины перетаскиваются на карте; щелчок по точке на ребре добавляет вершину, правый щелчок по вершине — удаляет. Квадратная ручка двигает всю область.</template>
        <template v-else-if="draft.shape === 'circle'">Центр и радиус можно менять ручками на карте.</template>
        <template v-else>Метку можно перетащить на карте. Координаты: {{ Math.round(draft.lng) }} × {{ Math.round(draft.lat) }}.</template>
      </p>

      <div class="field">
        <span>Описание</span>
        <RichEditor ref="rich" :model-value="draft.html" compact min-height="110px" placeholder="Описание метки… (для меток со статьёй — дополнение к ней)"
          :upload-visibility="vis" folder="Карты" @dirty="emit('dirty')" @save-now="save" />
      </div>

      <div class="field">
        <span>Кто видит</span>
        <VisibilitySelect v-model="vis" compact />
      </div>
    </div>

    <footer class="me-foot">
      <button v-if="!isNew" type="button" class="btn btn-sm btn-danger" title="Удалить метку" @click="remove"><Icon name="trash2" :size="15" /></button>
      <span class="grow" />
      <button type="button" class="btn btn-sm btn-ghost" @click="emit('close')">Отмена</button>
      <button type="button" class="btn btn-sm btn-primary" :disabled="saving" @click="save"><Icon name="check" :size="15" /> Сохранить</button>
    </footer>
  </div>
</template>

<style scoped>
.me { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
.me-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 8px 6px 12px; border-bottom: 1px solid var(--border); }
.me-head b { font-family: var(--font-head); font-size: 18px; }
.me-body { flex: 1 1 auto; overflow-y: auto; padding: 10px 12px 14px; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.me-shapes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; }
.me-shape { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text-muted); cursor: pointer; font-size: 13px; }
.me-shape:hover { border-color: var(--accent); color: var(--text); }
.me-shape.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.me-colours { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.me-sw { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--border-strong); cursor: pointer; padding: 0; }
.me-sw.on { outline: 2px solid var(--accent); outline-offset: 1px; }
.me-sw-none { background: repeating-conic-gradient(var(--surface-3) 0 25%, var(--surface) 0 50%) 50% / 8px 8px; }
.me-picker { width: 30px; height: 24px; padding: 0; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--surface); cursor: pointer; }
.me-num { width: 84px; flex: 0 0 84px; }
.me-hint { margin: -4px 0 0; font-size: 12px; color: var(--text-faint); line-height: 1.4; }
input[type='range'] { accent-color: var(--accent); width: 100%; }
.me-foot { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--border); background: var(--surface); }
</style>
