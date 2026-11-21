<script setup lang="ts">
import { ref } from 'vue'
import { useWorld } from '@/stores/world'
import { useRows } from '@/composables/useRows'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import { RichEditor, type RichEditorInstance } from '@/components/editor/lazy'
import RichView from '@/components/viewer/RichView.vue'
import type { Entity, QuestElement, Visibility } from '@/model/types'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()
const rows = useRows<QuestElement>('questElements', 'questId', () => props.entity.id)
type Form = { id?: string; entityId: string | null; name: string; role: string; html: string; colour: string; vis: { visibility: Visibility; allowedUids: string[] } }
const form = ref<Form | null>(null)
const ed = ref<RichEditorInstance | null>(null)
function openNew() { form.value = { entityId: null, name: '', role: '', html: '', colour: '', vis: { visibility: props.entity.visibility, allowedUids: props.entity.allowedUids ?? [] } } }
function openEdit(r: QuestElement) { form.value = { id: r.id, entityId: r.entityId, name: r.name, role: r.role, html: r.html, colour: r.colour, vis: { visibility: r.visibility, allowedUids: r.allowedUids ?? [] } } }
async function save() {
  const f = form.value!
  await world.saveRow('questElements', { id: f.id, questId: props.entity.id, entityId: f.entityId, name: f.name.trim(), role: f.role.trim(), html: ed.value?.getHTML() ?? f.html, colour: f.colour, order: f.id ? undefined : rows.value.length, ...f.vis })
  form.value = null
}
async function remove() { if (form.value?.id && confirm('Удалить элемент квеста?')) { await world.deleteRow('questElements', form.value.id); form.value = null } }
async function move(r: QuestElement, d: -1 | 1) {
  const list = rows.value
  const other = list[list.indexOf(r) + d]
  if (!other) return
  await Promise.all([world.saveRow('questElements', { id: r.id, order: other.order }), world.saveRow('questElements', { id: other.id, order: r.order })])
}
</script>

<template>
  <div class="stack" style="max-width: 980px">
    <div class="row gap">
      <h3 class="panel-title grow" style="margin: 0"><Icon name="scroll" /> Элементы квеста</h3>
      <button v-if="editing" class="btn btn-sm btn-primary" @click="openNew"><Icon name="plus" :size="14" /> Добавить</button>
    </div>
    <div v-if="!rows.length" class="card empty">Персонажи, места, предметы и этапы, связанные с квестом.</div>
    <div v-for="r in rows" :key="r.id" class="card card-pad qe" :style="{ '--qe': r.colour || 'var(--accent)' }">
      <div class="row gap">
        <EntityLink v-if="r.entityId" :id="r.entityId" avatar />
        <b v-if="r.name" class="grow">{{ r.name }}</b><span v-else class="grow" />
        <span v-if="r.role" class="badge">{{ r.role }}</span>
        <template v-if="editing">
          <button class="icon-btn" @click="move(r, -1)"><Icon name="arrow-up" :size="14" /></button>
          <button class="icon-btn" @click="move(r, 1)"><Icon name="arrow-down" :size="14" /></button>
          <button class="icon-btn" @click="openEdit(r)"><Icon name="pencil" :size="14" /></button>
        </template>
      </div>
      <RichView v-if="r.html" :html="r.html" style="font-size: 15px; margin-top: 8px" />
    </div>
    <Modal v-if="form" :title="form.id ? 'Элемент квеста' : 'Новый элемент'" width="720px" @close="form = null">
      <div class="stack">
        <div class="row gap">
          <div class="field grow"><span>Связанная статья</span><EntityPicker v-model="form.entityId" /></div>
          <label class="field grow"><span>Роль</span><input v-model="form.role" class="input" placeholder="Заказчик, цель, препятствие…" /></label>
        </div>
        <label class="field"><span>Заголовок (необязательно)</span><input v-model="form.name" class="input" /></label>
        <div class="field"><span>Описание</span><RichEditor ref="ed" :model-value="form.html" compact min-height="140px" /></div>
        <div class="row gap">
          <label class="field"><span>Цвет</span><input v-model="form.colour" type="color" class="input" style="width: 70px; height: 34px; padding: 2px" /></label>
          <div class="field grow"><span>Кто видит</span><VisibilitySelect v-model="form.vis" compact /></div>
        </div>
      </div>
      <template #footer>
        <button v-if="form.id" class="btn btn-danger" style="margin-right: auto" @click="remove">Удалить</button>
        <button class="btn" @click="form = null">Отмена</button>
        <button class="btn btn-primary" @click="save">Сохранить</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.qe { border-left: 4px solid var(--qe); }
</style>
