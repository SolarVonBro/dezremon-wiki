<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useWorld } from '@/stores/world'
import type { Member, Role } from '@/model/types'
import Icon from './Icon.vue'
import Dropdown from './Dropdown.vue'

// A member of the open world, with search by name or e-mail. You first, then players, then masters.
const props = withDefaults(defineProps<{ modelValue: string | null | undefined; placeholder?: string; label?: string }>(), { placeholder: 'Выберите участника…', label: 'Участник' })
const emit = defineEmits<{ 'update:modelValue': [uid: string] }>()
const world = useWorld()
const q = ref('')
const input = ref<HTMLInputElement | null>(null)
const dd = ref<InstanceType<typeof Dropdown> | null>(null)
const ROLE: Record<Role, string> = { owner: 'владелец', master: 'мастер', player: 'игрок' }

const current = computed(() => world.members.find((m) => m.uid === props.modelValue) ?? null)
const sorted = computed(() => [...world.members].sort((a, b) =>
  Number(b.uid === world.uid) - Number(a.uid === world.uid) || Number(a.role !== 'player') - Number(b.role !== 'player') || a.displayName.localeCompare(b.displayName)))
const found = computed(() => {
  const s = q.value.trim().toLowerCase()
  return s ? sorted.value.filter((m) => m.displayName.toLowerCase().includes(s) || (m.email ?? '').toLowerCase().includes(s)) : sorted.value
})
const note = (m: Member) => (m.uid === world.uid ? `вы · ${ROLE[m.role]}` : ROLE[m.role])

async function opened() { await nextTick(); input.value?.focus() }
function pick(m: Member | undefined) {
  if (!m) return
  emit('update:modelValue', m.uid)
  q.value = ''
  dd.value?.close()
}
</script>

<template>
  <Dropdown ref="dd" keep-open>
    <template #trigger>
      <button type="button" class="picker-btn input member-picker" :aria-label="label" @click="opened">
        <template v-if="current">
          <span class="avatar round mp-ava"><img v-if="current.photoURL" :src="current.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="12" /></span>
          <span class="grow ellipsis">{{ current.displayName }}</span>
          <span class="faint small">{{ note(current) }}</span>
        </template>
        <span v-else class="grow faint ellipsis">{{ placeholder }}</span>
        <Icon name="chevron-down" :size="14" />
      </button>
    </template>
    <div class="menu picker-menu member-picker-menu">
      <input ref="input" v-model="q" class="input input-sm" placeholder="Поиск по имени или почте…" @keydown.enter.prevent="pick(found[0])" />
      <div class="menu-scroll">
        <button v-for="m in found" :key="m.uid" type="button" class="menu-item" :class="{ on: m.uid === modelValue }" @click="pick(m)">
          <span class="avatar round mp-ava"><img v-if="m.photoURL" :src="m.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="12" /></span>
          <span class="grow ellipsis">{{ m.displayName }}</span>
          <span class="faint small">{{ note(m) }}</span>
          <Icon v-if="m.uid === modelValue" name="check" :size="14" />
        </button>
        <div v-if="!found.length" class="menu-label">Никого не найдено</div>
      </div>
    </div>
  </Dropdown>
</template>

<style scoped>
.picker-btn { display: flex; align-items: center; gap: 8px; text-align: left; cursor: pointer; min-width: 0; width: 100%; }
.picker-menu { width: 340px; gap: 4px; }
.mp-ava { width: 20px; height: 20px; flex: none; }
</style>
