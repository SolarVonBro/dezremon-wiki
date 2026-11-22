<script setup lang="ts">
// The catalogue of overview blocks.
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import { BLOCK_KINDS } from './blocks'
import type { DashBlockType } from '@/model/types'

defineProps<{ present: DashBlockType[] }>()
const emit = defineEmits<{ close: []; add: [type: DashBlockType] }>()
</script>

<template>
  <Modal title="Добавить блок" width="760px" @close="emit('close')">
    <div class="dba-grid">
      <button v-for="k in BLOCK_KINDS" :key="k.type" class="dba-item" @click="emit('add', k.type)">
        <span class="dba-icon"><Icon :name="k.icon" :size="20" /></span>
        <span class="grow">
          <b>{{ k.label }}</b>
          <span v-if="present.includes(k.type)" class="badge dba-have">уже есть</span>
          <span class="muted small dba-desc">{{ k.description }}</span>
        </span>
      </button>
    </div>
    <p class="faint small" style="margin: 12px 0 0">Блоков одного вида может быть сколько угодно — например, несколько списков по разным разделам или несколько текстов.</p>
  </Modal>
</template>

<style scoped>
.dba-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.dba-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; text-align: left; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--text); cursor: pointer; font: inherit; transition: border-color .12s, background .12s; }
.dba-item:hover { border-color: var(--accent); background: var(--surface-2); }
.dba-icon { width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--accent-soft); color: var(--accent); }
.dba-item .grow { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dba-have { align-self: flex-start; font-size: 10.5px; }
.dba-desc { line-height: 1.3; }
</style>
