<script setup lang="ts">
// Floating legend over the map: base image choice, overlay layers and marker groups (viewer-local toggles).
import Icon from '@/components/common/Icon.vue'
import MarkerGlyph from './MarkerGlyph.vue'
import type { LegendGroup } from './mapUtils'
import type { MapLayer, MapMarker } from '@/model/types'

defineProps<{
  groups: LegendGroup[]
  overlays: MapLayer[]
  bases: MapLayer[]
  hidden: Set<string>
  layerOn: Record<string, boolean>
  baseLayerId: string | null
  editing: boolean
}>()
const emit = defineEmits<{
  toggleGroup: [key: string]
  toggleLayer: [id: string]
  setBase: [id: string | null]
  manage: [tab: 'layers' | 'groups']
  close: []
}>()

/** Distinct looks used in a group (shape + icon + colour), at most four. */
function samples(items: MapMarker[]): MapMarker[] {
  const seen = new Set<string>()
  const out: MapMarker[] = []
  for (const m of items) {
    const k = `${m.shape}|${m.icon}|${m.colour}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(m)
    if (out.length >= 4) break
  }
  return out
}
</script>

<template>
  <div class="lg" role="dialog" aria-label="Легенда карты">
    <header class="lg-head">
      <b>Легенда</b>
      <button type="button" class="icon-btn" title="Закрыть" @click="emit('close')"><Icon name="x" :size="15" /></button>
    </header>
    <div class="lg-body">
      <template v-if="bases.length">
        <div class="section-title">Основа</div>
        <label class="check lg-row"><input type="radio" name="dw-base" :checked="!baseLayerId" @change="emit('setBase', null)" /> <span class="ellipsis">Основное изображение</span></label>
        <label v-for="b in bases" :key="b.id" class="check lg-row">
          <input type="radio" name="dw-base" :checked="baseLayerId === b.id" @change="emit('setBase', b.id)" /> <span class="ellipsis">{{ b.name || 'Без названия' }}</span>
        </label>
      </template>

      <template v-if="overlays.length">
        <div class="section-title">Слои</div>
        <label v-for="l in overlays" :key="l.id" class="check lg-row">
          <input type="checkbox" :checked="layerOn[l.id] !== false" @change="emit('toggleLayer', l.id)" /> <span class="ellipsis">{{ l.name || 'Без названия' }}</span>
        </label>
      </template>

      <div class="section-title">Группы</div>
      <label v-for="g in groups" :key="g.key" class="check lg-row">
        <input type="checkbox" :checked="!hidden.has(g.key)" @change="emit('toggleGroup', g.key)" />
        <span class="grow ellipsis">{{ g.name }}</span>
        <span class="lg-samples"><MarkerGlyph v-for="(s, i) in samples(g.items)" :key="i" :marker="s" /></span>
        <span class="lg-count">{{ g.items.length }}</span>
      </label>
      <p v-if="!groups.length" class="muted small lg-none">Меток пока нет.</p>

      <div v-if="editing" class="lg-manage">
        <button type="button" class="btn btn-sm" @click="emit('manage', 'layers')"><Icon name="layers" :size="15" /> Слои</button>
        <button type="button" class="btn btn-sm" @click="emit('manage', 'groups')"><Icon name="folder" :size="15" /> Группы</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lg { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow-lg); overflow: hidden; }
.lg-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 6px 4px 12px; border-bottom: 1px solid var(--border); }
.lg-head .icon-btn { width: 28px; height: 28px; }
.lg-body { padding: 8px 12px 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.lg-body .section-title { margin: 8px 0 2px; }
.lg-body .section-title:first-child { margin-top: 0; }
.lg-row { display: flex; gap: 8px; font-size: 13.5px; padding: 3px 0; min-width: 0; }
.lg-samples { display: inline-flex; gap: 2px; }
.lg-samples :deep(.mg) { width: 16px; height: 16px; flex-basis: 16px; }
.lg-count { font-size: 11.5px; color: var(--text-faint); min-width: 18px; text-align: right; }
.lg-none { margin: 2px 0; }
.lg-manage { display: flex; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
</style>
