<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { quickSearch } from '@/data/search'
import { typeDef } from '@/model/entityTypes'
import Icon from './Icon.vue'
import Dropdown from './Dropdown.vue'

const props = withDefaults(defineProps<{ modelValue: string | null | undefined; types?: string[]; placeholder?: string; exclude?: string[]; allowCreate?: boolean }>(), { placeholder: 'Выберите статью…', allowCreate: true })
const emit = defineEmits<{ 'update:modelValue': [id: string | null] }>()
const world = useWorld()
const q = ref('')
const input = ref<HTMLInputElement | null>(null)
const dd = ref<InstanceType<typeof Dropdown> | null>(null)

const current = computed(() => world.get(props.modelValue ?? null))
const found = computed(() => quickSearch(world.list, q.value, 12, props.types).filter((e) => !props.exclude?.includes(e.id)))
const createType = computed(() => (props.types?.length === 1 ? props.types[0] : null))

async function opened() { await nextTick(); input.value?.focus() }
function pick(id: string | null) { emit('update:modelValue', id); q.value = ''; dd.value?.close() }
async function create() {
  if (!createType.value || !q.value.trim()) return
  const id = await world.createEntity(createType.value, q.value.trim())
  pick(id)
}
</script>

<template>
  <Dropdown ref="dd" keep-open>
    <template #trigger>
      <button type="button" class="picker-btn input" @click="opened">
        <template v-if="current">
          <Icon :name="typeDef(current.type).icon" :size="15" :style="{ color: typeDef(current.type).color }" />
          <span class="grow ellipsis">{{ current.name }}</span>
        </template>
        <span v-else class="grow faint ellipsis">{{ modelValue ? 'Недоступная статья' : placeholder }}</span>
        <Icon name="chevron-down" :size="14" />
      </button>
    </template>
    <div class="menu picker-menu">
      <input ref="input" v-model="q" class="input input-sm" placeholder="Поиск…" @keydown.enter.prevent="found[0] ? pick(found[0].id) : create()" />
      <div class="menu-scroll">
        <button v-if="modelValue" type="button" class="menu-item faint" @click="pick(null)"><Icon name="x" :size="15" /> Очистить</button>
        <button v-for="e in found" :key="e.id" type="button" class="menu-item" @click="pick(e.id)">
          <Icon :name="typeDef(e.type).icon" :size="15" :style="{ color: typeDef(e.type).color }" />
          <span class="grow ellipsis">{{ e.name }}</span>
          <span class="faint small">{{ e.kind || typeDef(e.type).label }}</span>
        </button>
        <button v-if="allowCreate && createType && q.trim() && world.canCreate(createType)" type="button" class="menu-item" @click="create">
          <Icon name="plus" :size="15" /> Создать {{ typeDef(createType).acc }} «{{ q.trim() }}»
        </button>
        <div v-if="!found.length && !q" class="menu-label">Нет статей</div>
      </div>
    </div>
  </Dropdown>
</template>

<style scoped>
.picker-btn { display: flex; align-items: center; gap: 6px; text-align: left; cursor: pointer; min-width: 0; }
.picker-menu { width: 340px; gap: 4px; }
</style>
