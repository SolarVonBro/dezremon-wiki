<script setup lang="ts">
import { ref } from 'vue'
import Modal from '@/components/common/Modal.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import { useWorld } from '@/stores/world'
import { allTypes, typeDef } from '@/model/entityTypes'
import type { Entity, Visibility } from '@/model/types'

const props = defineProps<{ entity: Entity }>()
const emit = defineEmits<{ close: [] }>()
const world = useWorld()
const vis = ref<{ visibility: Visibility; allowedUids: string[] }>({ visibility: props.entity.visibility, allowedUids: [...(props.entity.allowedUids ?? [])] })
const editors = ref<string[]>([...(props.entity.editorUids ?? [])])
const isTemplate = ref(props.entity.isTemplate)
const type = ref(props.entity.type)
const tooltip = ref(props.entity.tooltip ?? '')
const busy = ref(false)

function toggleEditor(uid: string) {
  editors.value = editors.value.includes(uid) ? editors.value.filter((u) => u !== uid) : [...editors.value, uid]
}
async function save() {
  busy.value = true
  try {
    const patch: Partial<Entity> = { ...vis.value, editorUids: editors.value, isTemplate: isTemplate.value, tooltip: tooltip.value.trim() }
    if (type.value !== props.entity.type) {
      patch.type = type.value
      if (props.entity.parentId && world.get(props.entity.parentId)?.type !== type.value) patch.parentId = null
    }
    await world.updateEntity(props.entity.id, patch)
    emit('close')
  } finally { busy.value = false }
}
</script>

<template>
  <Modal title="Доступ и настройки статьи" width="600px" @close="emit('close')">
    <div class="stack">
      <div class="field"><span>Кто может читать</span><VisibilitySelect v-model="vis" /></div>
      <div v-if="world.isMaster && world.players.length" class="field">
        <span>Игроки, которые могут редактировать</span>
        <div class="row wrap gap">
          <label v-for="p in world.players" :key="p.uid" class="check small"><input type="checkbox" :checked="editors.includes(p.uid)" @change="toggleEditor(p.uid)" /> {{ p.displayName }}</label>
        </div>
        <span class="faint small">Автор статьи и мастера могут редактировать всегда. Статьи с секретами мастера игрокам недоступны для правки.</span>
      </div>
      <label class="field"><span>Всплывающая подсказка (вместо начала текста)</span><textarea v-model="tooltip" class="input" rows="2" maxlength="500" placeholder="Короткое описание для карточки при наведении" /></label>
      <label v-if="world.isMaster" class="field"><span>Тип статьи</span>
        <select v-model="type" class="input"><option v-for="t in allTypes()" :key="t.key" :value="t.key">{{ t.label }}</option></select>
        <span v-if="type !== entity.type" class="faint small">Поля типа «{{ typeDef(entity.type).label }}» сохранятся в данных, но могут не отображаться.</span>
      </label>
      <label class="check"><input v-model="isTemplate" type="checkbox" /> Шаблон: предлагать как основу при создании новых статей этого типа</label>
    </div>
    <template #footer>
      <button class="btn" @click="emit('close')">Отмена</button>
      <button class="btn btn-primary" :disabled="busy" @click="save">Сохранить</button>
    </template>
  </Modal>
</template>
