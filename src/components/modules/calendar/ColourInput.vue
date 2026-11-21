<script setup lang="ts">
// Small colour chooser: preset swatches + native picker. Empty value = theme default.
import { computed } from 'vue'
import Icon from '@/components/common/Icon.vue'
import { REMINDER_COLOURS } from './shared'

const props = withDefaults(defineProps<{ modelValue: string | null | undefined; presets?: string[]; allowEmpty?: boolean }>(), { presets: () => REMINDER_COLOURS, allowEmpty: true })
const emit = defineEmits<{ 'update:modelValue': [c: string] }>()
const hex = computed(() => (/^#[0-9a-f]{6}$/i.test(props.modelValue ?? '') ? props.modelValue! : '#c9a227'))
const isPreset = computed(() => props.presets.some((c) => c.toLowerCase() === (props.modelValue ?? '').toLowerCase()))
</script>

<template>
  <div class="colour-input">
    <button v-if="allowEmpty" type="button" class="sw sw-none" :class="{ on: !modelValue }" title="По умолчанию" @click="emit('update:modelValue', '')">
      <Icon name="x" :size="12" />
    </button>
    <button
      v-for="c in presets" :key="c" type="button" class="sw" :class="{ on: (modelValue ?? '').toLowerCase() === c.toLowerCase() }"
      :style="{ background: c }" :title="c" @click="emit('update:modelValue', c)"
    />
    <label class="sw sw-custom" :class="{ on: !!modelValue && !isPreset }" :style="modelValue && !isPreset ? { background: modelValue } : {}" title="Свой цвет">
      <Icon v-if="!modelValue || isPreset" name="palette" :size="12" />
      <input type="color" :value="hex" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
    </label>
  </div>
</template>

<style scoped>
.colour-input { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.sw {
  width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 18%, transparent); display: inline-flex; align-items: center; justify-content: center;
}
.sw.on { border-color: var(--text); }
.sw-none, .sw-custom { background: var(--surface-2); color: var(--text-muted); position: relative; overflow: hidden; }
.sw-custom input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; border: 0; padding: 0; }
</style>
