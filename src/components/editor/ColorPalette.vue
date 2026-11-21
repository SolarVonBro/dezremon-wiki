<script setup lang="ts">
const props = defineProps<{ value?: string | null; resetLabel?: string }>()
const emit = defineEmits<{ pick: [color: string | null] }>()

const COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#d9d9d9', '#efefef', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#9900ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#d9d2e9',
  '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#8e7cc3',
  '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#674ea7',
  '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#20124d',
  '#c9a227', '#8b5a2b', '#5c4033', '#2f4f4f', '#7b2d26', '#3b5b33', '#283c63', '#4b2a59',
]
function custom(e: Event) { emit('pick', (e.target as HTMLInputElement).value) }
</script>

<template>
  <div class="palette" @mousedown.prevent>
    <div class="palette-grid">
      <button
        v-for="c in COLORS" :key="c" type="button" class="swatch" :class="{ on: props.value?.toLowerCase() === c }"
        :style="{ background: c }" :title="c" @click="emit('pick', c)"
      />
    </div>
    <div class="palette-foot">
      <button type="button" class="btn btn-ghost btn-sm" @click="emit('pick', null)">{{ resetLabel ?? 'Сбросить' }}</button>
      <label class="btn btn-ghost btn-sm palette-custom">Свой цвет<input type="color" :value="value || '#c9a227'" @change="custom" /></label>
    </div>
  </div>
</template>
