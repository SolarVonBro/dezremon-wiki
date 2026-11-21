<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{ title?: string; width?: string; closable?: boolean }>(), { width: '560px', closable: true })
const emit = defineEmits<{ close: [] }>()
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && props.closable) { e.stopPropagation(); emit('close') } }
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @mousedown.self="closable && emit('close')">
      <div class="modal" :style="{ maxWidth: width }" role="dialog" aria-modal="true">
        <header v-if="title || closable" class="modal-head">
          <h3>{{ title }}</h3>
          <button v-if="closable" type="button" class="icon-btn" title="Закрыть" @click="emit('close')"><Icon name="x" /></button>
        </header>
        <div class="modal-body"><slot /></div>
        <footer v-if="$slots.footer" class="modal-foot"><slot name="footer" /></footer>
      </div>
    </div>
  </Teleport>
</template>
