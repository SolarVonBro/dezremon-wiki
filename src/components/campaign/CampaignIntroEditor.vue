<script setup lang="ts">
import { computed } from 'vue'
import { INTRO_KEYS } from '@/data/campaigns'
import Icon from '@/components/common/Icon.vue'

// The game's intro («вводная»): name / value lines — genre, mood, system, level… Empty lines are dropped on save
// (cleanIntro); usual names are one click away, any other can be typed.
const props = defineProps<{ modelValue: Array<{ name: string; value: string }> }>()
const emit = defineEmits<{ 'update:modelValue': [v: Array<{ name: string; value: string }>] }>()
const rows = computed(() => props.modelValue)
const missing = computed(() => INTRO_KEYS.filter((k) => !rows.value.some((r) => r.name.trim().toLowerCase() === k.toLowerCase())))
function set(i: number, key: 'name' | 'value', v: string) { emit('update:modelValue', rows.value.map((r, j) => (j === i ? { ...r, [key]: v } : r))) }
function add(name = '') { emit('update:modelValue', [...rows.value, { name, value: '' }]) }
function remove(i: number) { emit('update:modelValue', rows.value.filter((_, j) => j !== i)) }
const PLACEHOLDER: Record<string, string> = {
  'Жанр': 'тёмное фэнтези, детектив…', 'Настроение': 'мрачное, с юмором…', 'Система': 'D&D 5e, Pathfinder 2e…', 'Уровень персонажей': 'с 1-го',
  'Игроков': '3–5', 'Ограничения и табу': 'без жестокости к детям…', 'Возраст': '18+',
}
</script>

<template>
  <div class="intro-ed">
    <div v-for="(r, i) in rows" :key="i" class="intro-row">
      <input class="input input-sm intro-name" :value="r.name" placeholder="Пункт" maxlength="60" aria-label="Пункт вводной" @input="set(i, 'name', ($event.target as HTMLInputElement).value)" />
      <input class="input input-sm grow" :value="r.value" :placeholder="PLACEHOLDER[r.name.trim()] ?? 'Значение'" maxlength="500" :aria-label="r.name || 'Значение'" @input="set(i, 'value', ($event.target as HTMLInputElement).value)" />
      <button type="button" class="icon-btn" title="Убрать пункт" @click="remove(i)"><Icon name="x" :size="14" /></button>
    </div>
    <div class="row gap-sm wrap">
      <button v-for="k in missing" :key="k" type="button" class="chip intro-add" @click="add(k)"><Icon name="plus" :size="12" /> {{ k }}</button>
      <button type="button" class="chip intro-add" @click="add()"><Icon name="plus" :size="12" /> свой пункт</button>
    </div>
  </div>
</template>

<style scoped>
.intro-ed { display: flex; flex-direction: column; gap: 6px; }
.intro-row { display: flex; align-items: center; gap: 6px; }
.intro-name { width: 34%; min-width: 110px; flex: none; }
.intro-add { cursor: pointer; font-size: 12px; }
@media (max-width: 520px) { .intro-name { width: 40%; min-width: 0; } }
</style>
