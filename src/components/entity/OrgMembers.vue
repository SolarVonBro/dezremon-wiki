<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { useRows } from '@/composables/useRows'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import type { Entity, OrgMembership, Visibility } from '@/model/types'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()
const isOrg = computed(() => props.entity.type === 'organisation')
const rows = useRows<OrgMembership>('orgMembers', isOrg.value ? 'organisationId' : 'characterId', () => props.entity.id)
const STATUS = { active: 'активен', inactive: 'бывший', unknown: 'неизвестно' } as const
const filter = ref<'all' | 'active' | 'inactive' | 'unknown'>('all')
const shown = computed(() => rows.value.filter((r) => filter.value === 'all' || r.status === filter.value))
// members of sub-organisations
const subOrgs = computed(() => (world.children.get(props.entity.id) ?? []).filter((e) => e.type === 'organisation'))

type Form = { id?: string; otherId: string | null; role: string; status: OrgMembership['status']; isPinned: boolean; vis: { visibility: Visibility; allowedUids: string[] } }
const form = ref<Form | null>(null)
function openNew() { form.value = { otherId: null, role: '', status: 'active', isPinned: false, vis: { visibility: props.entity.visibility, allowedUids: props.entity.allowedUids ?? [] } } }
function openEdit(r: OrgMembership) { form.value = { id: r.id, otherId: isOrg.value ? r.characterId : r.organisationId, role: r.role, status: r.status, isPinned: r.isPinned, vis: { visibility: r.visibility, allowedUids: r.allowedUids ?? [] } } }
async function save() {
  const f = form.value!
  if (!f.otherId) return
  await world.saveRow('orgMembers', {
    id: f.id, organisationId: isOrg.value ? props.entity.id : f.otherId, characterId: isOrg.value ? f.otherId : props.entity.id,
    role: f.role.trim(), status: f.status, isPinned: f.isPinned, order: f.id ? undefined : rows.value.length, ...f.vis,
  })
  form.value = null
}
async function remove() { if (form.value?.id && confirm('Убрать участника?')) { await world.deleteRow('orgMembers', form.value.id); form.value = null } }
</script>

<template>
  <div class="card card-pad" style="max-width: 980px">
    <div class="row gap wrap" style="margin-bottom: 10px">
      <h3 class="panel-title grow" style="margin: 0"><Icon name="users" /> {{ isOrg ? 'Участники' : 'Организации' }} <span class="faint small">({{ rows.length }})</span></h3>
      <button v-for="f in (['all', 'active', 'inactive', 'unknown'] as const)" :key="f" class="chip" :class="{ on: filter === f }" @click="filter = f">{{ f === 'all' ? 'все' : STATUS[f] }}</button>
      <button v-if="editing" class="btn btn-sm btn-primary" @click="openNew"><Icon name="plus" :size="14" /> Добавить</button>
    </div>
    <div v-if="!shown.length" class="empty">Никого нет.</div>
    <div v-else class="table-scroll"><table class="table">
      <thead><tr><th>{{ isOrg ? 'Персонаж' : 'Организация' }}</th><th>Роль</th><th>Статус</th><th /></tr></thead>
      <tbody>
        <tr v-for="r in shown" :key="r.id">
          <td><EntityLink :id="isOrg ? r.characterId : r.organisationId" avatar /> <Icon v-if="r.isPinned" name="pin" :size="12" class="faint" /></td>
          <td>{{ r.role }}</td>
          <td><span class="badge" :class="{ 'badge-public': r.status === 'active', 'badge-dead': r.status === 'inactive' }">{{ STATUS[r.status] }}</span></td>
          <td style="width: 40px"><button v-if="editing" class="icon-btn" @click="openEdit(r)"><Icon name="pencil" :size="14" /></button></td>
        </tr>
      </tbody>
    </table></div>
    <div v-if="isOrg && subOrgs.length" style="margin-top: 16px">
      <div class="section-title">Подразделения</div>
      <div class="row wrap gap"><EntityLink v-for="o in subOrgs" :key="o.id" :id="o.id" avatar /></div>
    </div>
    <Modal v-if="form" :title="form.id ? 'Участник' : 'Новый участник'" @close="form = null">
      <div class="stack">
        <div class="field"><span>{{ isOrg ? 'Персонаж' : 'Организация' }}</span><EntityPicker v-model="form.otherId" :types="isOrg ? ['character'] : ['organisation']" /></div>
        <label class="field"><span>Роль / должность</span><input v-model="form.role" class="input" placeholder="Магистр, казначей…" /></label>
        <label class="field"><span>Статус</span><select v-model="form.status" class="input"><option value="active">Активный участник</option><option value="inactive">Бывший участник</option><option value="unknown">Неизвестно</option></select></label>
        <label class="check"><input v-model="form.isPinned" type="checkbox" /> Закрепить</label>
        <div class="field"><span>Кто видит</span><VisibilitySelect v-model="form.vis" compact /></div>
      </div>
      <template #footer>
        <button v-if="form.id" class="btn btn-danger" style="margin-right: auto" @click="remove">Удалить</button>
        <button class="btn" @click="form = null">Отмена</button>
        <button class="btn btn-primary" :disabled="!form.otherId" @click="save">Сохранить</button>
      </template>
    </Modal>
  </div>
</template>
