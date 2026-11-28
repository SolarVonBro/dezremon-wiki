<script setup lang="ts">
// Editors' manager for overlay/base layers and marker groups of one map. Changes are saved immediately.
import { computed, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { useGallery } from '@/stores/gallery'
import { ensureImageAccess, imageUrl } from '@/data/images'
import { toast } from '@/components/common/toast'
import { openLightbox } from '@/components/viewer/lightbox'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import ImageModal from '@/components/common/ImageModal.vue'
import { inheritVisibility } from './mapUtils'
import type { Entity, MapGroup, MapLayer, MapMarker, Visibility } from '@/model/types'

type Vis = { visibility: Visibility; allowedUids: string[] }

const props = defineProps<{ entity: Entity; layers: MapLayer[]; groups: MapGroup[]; markers: MapMarker[]; tab: 'layers' | 'groups' }>()
const emit = defineEmits<{ close: [] }>()
const world = useWorld()
const gallery = useGallery()

const tab = ref(props.tab)
/** 'new' = add a layer, otherwise id of the layer whose image is replaced. */
const imageFor = ref<string | null>(null)
const busy = ref(false)
const newGroup = ref('')

const sortedLayers = computed(() => [...props.layers].sort((a, b) => a.order - b.order))
const sortedGroups = computed(() => [...props.groups].sort((a, b) => a.order - b.order))
const groupCounts = computed(() => {
  const m = new Map<string, number>()
  for (const mk of props.markers) if (mk.groupId) m.set(mk.groupId, (m.get(mk.groupId) ?? 0) + 1)
  return m
})

const visOf = (r: { visibility: Visibility; allowedUids?: string[] }): Vis => ({ visibility: r.visibility, allowedUids: r.allowedUids ?? [] })
const nextOrder = (rows: { order: number }[]) => rows.reduce((m, r) => Math.max(m, r.order), 0) + 1

const defaultVis = (): Vis => inheritVisibility(props.entity, world.isMaster)

// ---------- layers ----------
async function onFiles(files: File[]) {
  const target = imageFor.value
  if (!target || !files.length) return
  busy.value = true
  try {
    const [meta] = await gallery.upload(files.slice(0, 1), { folder: 'Карты' })
    if (meta) await useImage(target, meta.id, meta.name)
  } catch (e: any) {
    toast.error('Не удалось загрузить изображение: ' + (e?.message ?? e))
  } finally {
    busy.value = false
  }
}
function onPick(imageId: string) {
  if (imageFor.value) void useImage(imageFor.value, imageId, gallery.images.get(imageId)?.name ?? '')
}
const editingLayer = computed(() => (imageFor.value && imageFor.value !== 'new' ? props.layers.find((l) => l.id === imageFor.value) ?? null : null))
async function viewLayerImage(l: MapLayer) {
  if (!l.imageId) { imageFor.value = l.id; return }
  const src = await imageUrl(world.access, l.imageId, 'full').catch(() => null)
  if (src) openLightbox([{ src, caption: l.name || 'Слой карты' }])
}
async function clearLayerImage() {
  const layer = editingLayer.value
  if (!layer) return
  await world.saveRow('mapLayers', { id: layer.id, imageId: null })
  imageFor.value = null
}

async function useImage(target: string, imageId: string, fileName: string) {
  if (target === 'new') {
    const vis = defaultVis()
    const name = fileName.replace(/\.[^.]+$/, '') || `Слой ${props.layers.length + 1}`
    await world.saveRow('mapLayers', { mapId: props.entity.id, name, imageId, order: nextOrder(props.layers), kind: 'overlay', opacity: 1, ...vis })
    void ensureImageAccess(world.access, [imageId], vis)
  } else {
    const layer = props.layers.find((l) => l.id === target)
    await world.saveRow('mapLayers', { id: target, imageId })
    if (layer) void ensureImageAccess(world.access, [imageId], visOf(layer))
  }
}

function saveLayer(l: MapLayer, p: Partial<MapLayer>) {
  void world.saveRow('mapLayers', { id: l.id, ...p })
  if (('visibility' in p || 'allowedUids' in p) && l.imageId) {
    void ensureImageAccess(world.access, [l.imageId], { visibility: p.visibility ?? l.visibility, allowedUids: p.allowedUids ?? l.allowedUids ?? [] })
  }
}

async function removeLayer(l: MapLayer) {
  if (!window.confirm(`Удалить слой «${l.name || 'Без названия'}»? Изображение останется в галерее.`)) return
  await world.deleteRow('mapLayers', l.id)
}

/** Swap with the neighbour and renumber (orders may collide after imports). */
function move(collection: 'mapLayers' | 'mapGroups', list: { id: string; order: number }[], i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= list.length) return
  const ids = list.map((r) => r.id)
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  ids.forEach((id, idx) => {
    const row = list.find((r) => r.id === id)
    if (row && row.order !== idx + 1) void world.saveRow(collection, { id, order: idx + 1 })
  })
}

// ---------- groups ----------
async function addGroup() {
  const name = newGroup.value.trim()
  if (!name) return
  newGroup.value = ''
  await world.saveRow('mapGroups', { mapId: props.entity.id, name, order: nextOrder(props.groups), isShown: true, ...defaultVis() })
}

function saveGroup(g: MapGroup, p: Partial<MapGroup>) {
  void world.saveRow('mapGroups', { id: g.id, ...p })
}

async function removeGroup(g: MapGroup) {
  const n = groupCounts.value.get(g.id) ?? 0
  const msg = n ? `Удалить группу «${g.name}»? Её метки (${n}) останутся на карте без группы.` : `Удалить группу «${g.name}»?`
  if (!window.confirm(msg)) return
  await Promise.all(props.markers.filter((m) => m.groupId === g.id).map((m) => world.saveRow('mapMarkers', { id: m.id, groupId: null })))
  await world.deleteRow('mapGroups', g.id)
}
</script>

<template>
  <Modal title="Слои и группы карты" width="760px" @close="emit('close')">
    <div class="tabs">
      <button type="button" class="tab" :class="{ on: tab === 'layers' }" @click="tab = 'layers'"><Icon name="layers" :size="16" /> Слои <span class="count">{{ layers.length }}</span></button>
      <button type="button" class="tab" :class="{ on: tab === 'groups' }" @click="tab = 'groups'"><Icon name="folder" :size="16" /> Группы <span class="count">{{ groups.length }}</span></button>
    </div>

    <template v-if="tab === 'layers'">
      <p class="muted small mm-intro">
        Слои — изображения поверх основной карты (например, границы, дороги или та же местность в другую эпоху). Слой-«основа»
        можно выбрать в легенде вместо основного изображения. Изображения растягиваются на всю карту, поэтому их пропорции должны совпадать с картой.
      </p>
      <div class="mm-list">
        <div v-for="(l, i) in sortedLayers" :key="l.id" class="mm-row">
          <div class="mm-thumb-wrap">
            <button type="button" class="mm-thumb" :class="{ zoomable: !!l.imageId }" :title="l.imageId ? 'Открыть крупно' : 'Выбрать изображение'" @click="viewLayerImage(l)">
              <Thumb :id="l.imageId"><Icon name="image" :size="20" /></Thumb>
            </button>
            <button type="button" class="mm-thumb-edit" :title="l.imageId ? 'Заменить или убрать изображение' : 'Выбрать изображение'" @click="imageFor = l.id"><Icon name="pencil" :size="11" /></button>
          </div>
          <div class="mm-main">
            <div class="row gap-sm">
              <input class="input input-sm grow" :value="l.name" placeholder="Название слоя" @change="saveLayer(l, { name: ($event.target as HTMLInputElement).value.trim() })" />
              <select class="input input-sm mm-kind" :value="l.kind" @change="saveLayer(l, { kind: ($event.target as HTMLSelectElement).value as MapLayer['kind'] })">
                <option value="overlay">Наложение</option>
                <option value="base">Основа</option>
              </select>
            </div>
            <div class="row gap-sm wrap">
              <label class="mm-opacity small muted">
                Непрозрачность
                <input type="range" min="0.05" max="1" step="0.05" :value="l.opacity" @change="saveLayer(l, { opacity: Number(($event.target as HTMLInputElement).value) })" />
                {{ Math.round(l.opacity * 100) }}%
              </label>
              <VisibilitySelect :model-value="visOf(l)" compact @update:model-value="(v) => saveLayer(l, v)" />
            </div>
          </div>
          <div class="mm-actions">
            <button type="button" class="icon-btn" title="Выше" :disabled="i === 0" @click="move('mapLayers', sortedLayers, i, -1)"><Icon name="arrow-up" :size="15" /></button>
            <button type="button" class="icon-btn" title="Ниже" :disabled="i === sortedLayers.length - 1" @click="move('mapLayers', sortedLayers, i, 1)"><Icon name="arrow-down" :size="15" /></button>
            <button type="button" class="icon-btn danger" title="Удалить слой" @click="removeLayer(l)"><Icon name="trash2" :size="15" /></button>
          </div>
        </div>
        <p v-if="!layers.length" class="muted small">Слоёв пока нет.</p>
      </div>
      <button type="button" class="btn btn-sm" :disabled="busy" @click="imageFor = 'new'">
        <Icon :name="busy ? 'refresh-cw' : 'plus'" :size="15" :class="{ spin: busy }" /> {{ busy ? 'Загрузка…' : 'Добавить слой' }}
      </button>
    </template>

    <template v-else>
      <p class="muted small mm-intro">Группы объединяют метки: их можно скрывать и показывать на карте и в списке. «Показывать сразу» — видна ли группа при открытии карты.</p>
      <div class="mm-list">
        <div v-for="(g, i) in sortedGroups" :key="g.id" class="mm-row">
          <div class="mm-main">
            <div class="row gap-sm">
              <input class="input input-sm grow" :value="g.name" placeholder="Название группы" @change="saveGroup(g, { name: ($event.target as HTMLInputElement).value.trim() })" />
              <span class="badge" title="Меток в группе">{{ groupCounts.get(g.id) ?? 0 }}</span>
            </div>
            <div class="row gap wrap">
              <label class="check small"><input type="checkbox" :checked="g.isShown" @change="saveGroup(g, { isShown: ($event.target as HTMLInputElement).checked })" /> Показывать сразу</label>
              <VisibilitySelect :model-value="visOf(g)" compact @update:model-value="(v) => saveGroup(g, v)" />
            </div>
          </div>
          <div class="mm-actions">
            <button type="button" class="icon-btn" title="Выше" :disabled="i === 0" @click="move('mapGroups', sortedGroups, i, -1)"><Icon name="arrow-up" :size="15" /></button>
            <button type="button" class="icon-btn" title="Ниже" :disabled="i === sortedGroups.length - 1" @click="move('mapGroups', sortedGroups, i, 1)"><Icon name="arrow-down" :size="15" /></button>
            <button type="button" class="icon-btn danger" title="Удалить группу" @click="removeGroup(g)"><Icon name="trash2" :size="15" /></button>
          </div>
        </div>
        <p v-if="!groups.length" class="muted small">Групп пока нет.</p>
      </div>
      <form class="row gap-sm" @submit.prevent="addGroup">
        <input v-model="newGroup" class="input input-sm grow" placeholder="Новая группа: города, подземелья, лагеря…" />
        <button class="btn btn-sm" :disabled="!newGroup.trim()"><Icon name="plus" :size="15" /> Добавить</button>
      </form>
    </template>

    <ImageModal
      v-if="imageFor"
      :title="imageFor === 'new' ? 'Изображение слоя' : 'Изображение слоя'"
      :image-id="editingLayer?.imageId ?? null"
      :has-image="!!editingLayer?.imageId"
      :allow-crop="false"
      :allow-url="false"
      :allow-delete="!!editingLayer?.imageId"
      remove-label="Убрать изображение"
      @close="imageFor = null"
      @files="onFiles"
      @pick="onPick"
      @remove="clearLayerImage"
    />
  </Modal>
</template>

<style scoped>
.mm-intro { margin: -4px 0 12px; }
.mm-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.mm-row { display: flex; gap: 10px; align-items: flex-start; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
.mm-thumb-wrap { position: relative; flex: 0 0 64px; }
.mm-thumb { width: 64px; height: 64px; padding: 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; cursor: pointer; background: var(--surface-3); display: flex; align-items: center; justify-content: center; color: var(--text-faint); }
.mm-thumb.zoomable { cursor: zoom-in; }
.mm-thumb:hover { border-color: var(--accent); }
.mm-thumb-edit { position: absolute; right: -5px; bottom: -5px; width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--surface-2); background: var(--accent); color: var(--accent-fg); display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
.mm-thumb-edit:hover { background: var(--accent-2); }
.mm-thumb :deep(img) { width: 100%; height: 100%; object-fit: cover; display: block; }
.mm-thumb :deep(.thumb-empty) { width: 100%; height: 100%; }
.mm-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.mm-kind { width: 140px; flex: 0 0 140px; }
.mm-opacity { display: inline-flex; align-items: center; gap: 6px; }
.mm-opacity input { width: 110px; accent-color: var(--accent); }
.mm-actions { display: flex; flex-direction: column; gap: 2px; }
.mm-actions .icon-btn { width: 28px; height: 28px; }
.mm-actions .icon-btn:disabled { opacity: .35; cursor: default; }
</style>
