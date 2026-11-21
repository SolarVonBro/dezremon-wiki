<script setup lang="ts">
// Settings of one video in a queue or a saved playlist: its name, the part to play and the speed.
import { computed, ref } from 'vue'
import { RATES, parseTime } from './timing'
import { formatTime, thumbUrl } from './youtube'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import type { ItemPatch } from '@/data/rooms'
import type { QueueItem } from '@/model/types'

const props = defineProps<{ item: QueueItem; duration: number }>()
const emit = defineEmits<{ save: [patch: ItemPatch]; close: [] }>()
const it = props.item
const fmt = (s: number | undefined) => (s ? formatTime(s) : '')
const form = ref({
  title: it.title,
  start: fmt(it.start),
  endMode: ((it.end ?? 0) > 0 ? 'at' : (it.end ?? 0) < 0 ? 'before' : 'full') as 'full' | 'at' | 'before',
  end: fmt(Math.abs(it.end ?? 0)),
  rate: it.rate || 1,
})

const start = computed(() => parseTime(form.value.start) ?? 0)
const endVal = computed(() => (form.value.endMode === 'full' ? 0 : parseTime(form.value.end)))
const error = computed(() => {
  if (!form.value.title.trim()) return 'Название не может быть пустым'
  if (Number.isNaN(start.value)) return 'Начало: время в виде 1:20 или 80'
  if (form.value.endMode !== 'full' && (endVal.value === null || Number.isNaN(endVal.value) || endVal.value <= 0)) return 'Конец: укажите время в виде 1:20 или 80'
  const d = props.duration
  if (d && start.value >= d) return `Начало дальше конца видео (${formatTime(d)})`
  const absEnd = form.value.endMode === 'at' ? endVal.value! : form.value.endMode === 'before' && d ? d - endVal.value! : 0
  if (absEnd && absEnd <= start.value + 1) return 'Конец должен быть позже начала'
  if (d && form.value.endMode === 'at' && endVal.value! > d + 0.5) return `В видео всего ${formatTime(d)}`
  return ''
})
const summary = computed(() => {
  const d = props.duration
  if (!d || error.value) return ''
  const e = form.value.endMode === 'full' ? d : form.value.endMode === 'at' ? endVal.value! : d - endVal.value!
  const len = (e - start.value) / form.value.rate
  return `Будет играть ${formatTime(start.value)}–${formatTime(e)}: ${formatTime(len)}${form.value.rate !== 1 ? ` с учётом скорости ×${form.value.rate}` : ''}`
})
/** the item plays the whole video at ×1 already (nothing to reset) */
const isDefault = computed(() => !(it.start ?? 0) && !(it.end ?? 0) && (it.rate ?? 1) === 1
  && !(start.value) && form.value.endMode === 'full' && form.value.rate === 1)
/** "Вернуть по умолчанию": whole video, normal speed; the name stays */
function reset() {
  emit('save', { title: form.value.title.trim() || it.title, start: 0, end: 0, rate: 1 })
}
function save() {
  if (error.value) return
  const e = form.value.endMode === 'full' ? 0 : form.value.endMode === 'at' ? endVal.value! : -endVal.value!
  emit('save', { title: form.value.title.trim(), start: start.value || 0, end: e, rate: form.value.rate })
}
</script>

<template>
  <Modal title="Настройки трека" width="520px" @close="emit('close')">
    <form class="stack" @submit.prevent="save">
      <div class="row gap">
        <img :src="thumbUrl(it.videoId)" alt="" style="width: 96px; height: 54px; object-fit: cover; border-radius: 6px; flex-shrink: 0" />
        <div class="faint small">Видео YouTube {{ it.videoId }}<br />{{ duration ? 'длительность ' + formatTime(duration) : 'длительность станет известна после первого запуска' }}</div>
      </div>
      <label class="field"><span>Название</span><input v-model="form.title" class="input" maxlength="200" /></label>
      <div class="row gap wrap" style="align-items: flex-end">
        <label class="field" style="width: 120px"><span>Начать с</span><input v-model="form.start" class="input" placeholder="0:00" inputmode="numeric" /></label>
        <label class="field"><span>Закончить</span>
          <select v-model="form.endMode" class="input" style="width: auto">
            <option value="full">в конце видео</option><option value="at">в момент…</option><option value="before">за … до конца</option>
          </select>
        </label>
        <label v-if="form.endMode !== 'full'" class="field" style="width: 120px"><span>{{ form.endMode === 'at' ? 'Время' : 'Сколько до конца' }}</span><input v-model="form.end" class="input" placeholder="0:10" inputmode="numeric" /></label>
      </div>
      <label class="field"><span>Скорость</span>
        <select v-model.number="form.rate" class="input" style="width: auto"><option v-for="r in RATES" :key="r" :value="r">×{{ r }}{{ r === 1 ? ' (обычная)' : '' }}</option></select>
      </label>
      <p v-if="error" class="small" style="margin: 0; color: var(--danger)">{{ error }}</p>
      <p v-else-if="summary" class="faint small" style="margin: 0">{{ summary }}</p>
      <p class="faint small" style="margin: 0">Время — в виде 1:20 или 80 (секунд). Интервал и скорость действуют для всех слушателей; при повторе трек повторяется внутри интервала.</p>
    </form>
    <template #footer>
      <button class="btn btn-ghost" style="margin-right: auto" :disabled="isDefault" title="Всё видео целиком, обычная скорость; название не меняется" @click="reset"><Icon name="rotate-ccw" :size="14" /> Вернуть по умолчанию</button>
      <button class="btn" @click="emit('close')">Отмена</button>
      <button class="btn btn-primary" :disabled="!!error" @click="save">Сохранить</button>
    </template>
  </Modal>
</template>
