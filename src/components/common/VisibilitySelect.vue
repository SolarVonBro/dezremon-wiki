<script setup lang="ts">
import { computed } from 'vue'
import { useWorld } from '@/stores/world'
import { VISIBILITY_LABELS } from '@/data/access'
import type { Visibility } from '@/model/types'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{ modelValue: { visibility: Visibility; allowedUids: string[] }; compact?: boolean }>(), { compact: false })
const emit = defineEmits<{ 'update:modelValue': [v: { visibility: Visibility; allowedUids: string[] }] }>()
const world = useWorld()

const options = computed<Visibility[]>(() => (world.isMaster ? ['public', 'members', 'custom', 'master'] : ['members', 'custom', 'master']))
const ICON: Record<Visibility, string> = { public: 'globe', members: 'users', custom: 'user-plus', master: 'lock' }
function setVis(v: Visibility) { emit('update:modelValue', { visibility: v, allowedUids: v === 'custom' ? props.modelValue.allowedUids ?? [] : [] }) }
function toggleUid(uid: string) {
  const set = new Set(props.modelValue.allowedUids ?? [])
  if (set.has(uid)) set.delete(uid); else set.add(uid)
  emit('update:modelValue', { visibility: 'custom', allowedUids: [...set] })
}
</script>

<template>
  <div class="vis">
    <div class="vis-opts" :class="{ compact }">
      <button v-for="o in options" :key="o" type="button" class="vis-opt" :class="{ on: modelValue.visibility === o }" :title="VISIBILITY_LABELS[o]" @click="setVis(o)">
        <Icon :name="ICON[o]" :size="15" />
        <span v-if="!compact">{{ VISIBILITY_LABELS[o] }}</span>
      </button>
    </div>
    <div v-if="modelValue.visibility === 'custom'" class="vis-players">
      <span v-if="!world.players.length" class="muted small">В мире пока нет игроков — пригласите их в настройках мира.</span>
      <label v-for="p in world.players" :key="p.uid" class="check small">
        <input type="checkbox" :checked="modelValue.allowedUids?.includes(p.uid)" @change="toggleUid(p.uid)" /> {{ p.displayName }}
      </label>
    </div>
    <p v-if="modelValue.visibility === 'public' && !world.world?.isPublic" class="muted small">Мир сейчас закрыт: «всем» означает всем участникам. Открыть мир для гостей можно в настройках.</p>
  </div>
</template>

<style scoped>
.vis-opts { display: flex; flex-direction: column; gap: 4px; }
.vis-opts.compact { flex-direction: row; }
.vis-opt { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); cursor: pointer; text-align: left; font-size: 13.5px; color: var(--text-muted); }
.vis-opt:hover { border-color: var(--accent); }
.vis-opt.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.vis-players { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 8px 4px 0; }
</style>
