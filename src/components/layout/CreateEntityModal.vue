<script setup lang="ts">
import { computed, ref } from 'vue'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import { useWorld } from '@/stores/world'
import { allTypes, typeDef } from '@/model/entityTypes'
import { randomId } from '@/data/util'
import type { Visibility } from '@/model/types'

const props = defineProps<{ initialType?: string | null; parentId?: string | null }>()
const emit = defineEmits<{ close: []; created: [id: string] }>()
const world = useWorld()

const types = computed(() => allTypes().filter((t) => world.enabledTypes(t.key) && world.canCreate(t.key)))
const type = ref<string | null>(props.initialType ?? null)
const name = ref('')
const parent = ref<string | null>(props.parentId ?? null)
const templateId = ref<string | null>(null)
const vis = ref<{ visibility: Visibility; allowedUids: string[] }>({ visibility: world.isMaster ? world.settings.defaultVisibility : 'members', allowedUids: [] })
const busy = ref(false)
const templates = computed(() => (type.value ? (world.byType.get(type.value) ?? []).filter((e) => e.isTemplate) : []))
const def = computed(() => (type.value ? typeDef(type.value) : null))

async function create() {
  if (!type.value || !name.value.trim() || busy.value) return
  busy.value = true
  try {
    let extra: Record<string, any> = { parentId: parent.value, ...vis.value }
    let html = ''
    const tpl = templateId.value ? world.get(templateId.value) : null
    if (tpl) {
      extra = { ...extra, kind: tpl.kind, fields: JSON.parse(JSON.stringify(tpl.fields ?? {})), attributes: tpl.attributes.map((a) => ({ ...a, id: randomId(8) })), tagIds: [...tpl.tagIds] }
      html = await world.loadText(tpl.id)
    }
    const id = await world.createEntity(type.value, name.value, extra, html)
    emit('created', id)
  } finally { busy.value = false }
}
</script>

<template>
  <Modal :title="def ? `Новая статья: ${def.label.toLowerCase()}` : 'Что создаём?'" width="640px" @close="emit('close')">
    <div v-if="!type" class="type-grid">
      <button v-for="t in types" :key="t.key" type="button" class="type-tile" :style="{ '--c': t.color }" @click="type = t.key">
        <Icon :name="t.icon" :size="22" /><span>{{ t.label }}</span>
      </button>
      <p v-if="!types.length" class="muted">Вам пока нельзя создавать статьи в этом мире.</p>
    </div>
    <form v-else class="stack" @submit.prevent="create">
      <label class="field"><span>Название</span><input v-model="name" class="input" :placeholder="def?.label" autofocus maxlength="200" /></label>
      <label v-if="def?.parentLabel" class="field"><span>{{ def.parentLabel }}</span><EntityPicker v-model="parent" :types="[type]" placeholder="Не выбрано" /></label>
      <label v-if="templates.length" class="field"><span>Шаблон</span>
        <select v-model="templateId" class="input"><option :value="null">Без шаблона</option><option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option></select>
      </label>
      <div class="field"><span>Кто видит</span><VisibilitySelect v-model="vis" /></div>
      <div class="row gap wrap">
        <button class="btn btn-primary" :disabled="!name.trim() || busy"><Icon name="plus" :size="16" /> Создать и редактировать</button>
        <button v-if="!initialType" type="button" class="btn btn-ghost" @click="type = null">Другой тип</button>
      </div>
    </form>
  </Modal>
</template>

<style scoped>
.type-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.type-tile { display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); cursor: pointer; font-weight: 500; text-align: left; }
.type-tile .icon { color: var(--c); }
.type-tile:hover { border-color: var(--c); background: color-mix(in srgb, var(--c) 10%, var(--surface)); }
</style>
