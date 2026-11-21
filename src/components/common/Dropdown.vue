<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'

const props = withDefaults(defineProps<{ placement?: 'bottom-start' | 'bottom-end' | 'bottom' | 'top-start' | 'right-start'; keepOpen?: boolean; disabled?: boolean }>(), { placement: 'bottom-start' })
const open = ref(false)
const trigger = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)

async function place() {
  if (!trigger.value || !panel.value) return
  const { x, y } = await computePosition(trigger.value, panel.value, { placement: props.placement, strategy: 'fixed', middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })] })
  Object.assign(panel.value.style, { left: `${x}px`, top: `${y}px` })
}
function onDoc(e: MouseEvent) {
  const t = e.target as Node
  if (trigger.value?.contains(t) || panel.value?.contains(t)) return
  close()
}
async function toggle() {
  if (props.disabled) return
  if (open.value) return close()
  open.value = true
  await nextTick()
  await place()
  document.addEventListener('mousedown', onDoc, true)
  window.addEventListener('resize', place)
}
function close() {
  open.value = false
  document.removeEventListener('mousedown', onDoc, true)
  window.removeEventListener('resize', place)
}
function onPanelClick() { if (!props.keepOpen) close() }
onBeforeUnmount(close)
defineExpose({ close, open: toggle })
</script>

<template>
  <span ref="trigger" class="dd-trigger" @click="toggle" @mousedown.prevent>
    <slot name="trigger" :open="open" />
  </span>
  <Teleport to="body">
    <div v-if="open" ref="panel" class="dd-panel" @click="onPanelClick" @keydown.esc="close">
      <slot :close="close" />
    </div>
  </Teleport>
</template>
