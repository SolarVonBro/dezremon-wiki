<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import Icon from '@/components/common/Icon.vue'
import type { Entity } from '@/model/types'

// Private notes for masters only. Stored in the master-only secrets doc, never sent to players.
const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()
const notes = computed(() => world.secretsState[props.entity.id]?.gmNotes ?? '')
const draft = ref(notes.value)
const saving = ref(false)
watch(notes, (n) => { if (document.activeElement?.id !== 'gm-notes') draft.value = n })

async function save() {
  if (draft.value === notes.value) return
  saving.value = true
  try { await world.saveSecretsMeta(props.entity.id, { gmNotes: draft.value }) } finally { saving.value = false }
}
</script>

<template>
  <div v-if="world.isMaster && (editing || notes)" class="card card-pad gm-notes">
    <div class="section-title row"><Icon name="lock" :size="12" /> <span class="grow">Заметки мастера</span><Icon v-if="saving" name="refresh-cw" :size="12" class="spin" /></div>
    <textarea v-if="editing" id="gm-notes" v-model="draft" class="input" rows="4" placeholder="Видят только мастера: планы, тайны, скрытые имена…" @blur="save" />
    <div v-else class="gm-text">{{ notes }}</div>
  </div>
</template>

<style scoped>
.gm-notes { border-color: color-mix(in srgb, var(--secret) 45%, var(--border)); background: color-mix(in srgb, var(--secret) 5%, var(--surface)); }
.gm-notes .section-title { color: var(--secret); gap: 6px; }
.gm-text { white-space: pre-wrap; font-size: 14px; }
</style>
