<script setup lang="ts">
import { computed, ref } from 'vue'
import EntityLink from '@/components/common/EntityLink.vue'
import Icon from '@/components/common/Icon.vue'
import type { Entity } from '@/model/types'

defineOptions({ name: 'TreeNode' })
const props = withDefaults(defineProps<{ entity: Entity; pool: Entity[]; depth?: number }>(), { depth: 0 })
const kids = computed(() => props.pool.filter((e) => e.parentId === props.entity.id))
const open = ref(props.depth < 1)
</script>

<template>
  <li>
    <div class="tree-row">
      <button v-if="kids.length" class="tree-toggle" @click="open = !open"><Icon :name="open ? 'chevron-down' : 'chevron-right'" :size="15" /></button>
      <span v-else class="tree-toggle" />
      <EntityLink :id="entity.id" avatar />
      <span v-if="entity.kind" class="faint small">{{ entity.kind }}</span>
      <span v-if="kids.length" class="faint small">· {{ kids.length }}</span>
    </div>
    <ul v-if="open && kids.length && depth < 12" class="tree">
      <TreeNode v-for="k in kids" :key="k.id" :entity="k" :pool="pool" :depth="depth + 1" />
    </ul>
  </li>
</template>
