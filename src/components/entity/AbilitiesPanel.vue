<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { useRows } from '@/composables/useRows'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import type { Entity, EntityAbility, Visibility } from '@/model/types'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()
const rows = useRows<EntityAbility>('entityAbilities', 'entityId', () => props.entity.id)
// For an ability page: who has it
const holders = useRows<EntityAbility>('entityAbilities', 'abilityId', () => (props.entity.type === 'ability' ? props.entity.id : null), null)
const grouped = computed(() => {
  const m = new Map<string, EntityAbility[]>()
  for (const r of rows.value) {
    const parent = world.get(world.get(r.abilityId)?.parentId)?.name ?? 'Способности'
    if (!m.has(parent)) m.set(parent, [])
    m.get(parent)!.push(r)
  }
  return [...m.entries()]
})
type Form = { id?: string; abilityId: string | null; charges: number; usedCharges: number; note: string; vis: { visibility: Visibility; allowedUids: string[] } }
const form = ref<Form | null>(null)
function openNew() { form.value = { abilityId: null, charges: 0, usedCharges: 0, note: '', vis: { visibility: props.entity.visibility, allowedUids: props.entity.allowedUids ?? [] } } }
function openEdit(r: EntityAbility) { form.value = { id: r.id, abilityId: r.abilityId, charges: r.charges, usedCharges: r.usedCharges, note: r.note, vis: { visibility: r.visibility, allowedUids: r.allowedUids ?? [] } } }
async function save() {
  const f = form.value!
  if (!f.abilityId) return
  await world.saveRow('entityAbilities', { id: f.id, entityId: props.entity.id, abilityId: f.abilityId, charges: Number(f.charges) || 0, usedCharges: Number(f.usedCharges) || 0, note: f.note, order: f.id ? undefined : rows.value.length, ...f.vis })
  form.value = null
}
async function remove() { if (form.value?.id && confirm('Убрать способность?')) { await world.deleteRow('entityAbilities', form.value.id); form.value = null } }
async function use(r: EntityAbility, d: number) { await world.saveRow('entityAbilities', { id: r.id, usedCharges: Math.min(r.charges, Math.max(0, (r.usedCharges ?? 0) + d)) }) }
</script>

<template>
  <div class="stack" style="max-width: 980px">
    <div class="card card-pad">
      <div class="row gap" style="margin-bottom: 10px">
        <h3 class="panel-title grow" style="margin: 0"><Icon name="sparkles" /> Способности</h3>
        <button v-if="editing" class="btn btn-sm btn-primary" @click="openNew"><Icon name="plus" :size="14" /> Добавить</button>
      </div>
      <div v-if="!rows.length" class="empty">Способностей нет. Сначала создайте статьи типа «Способность», затем привяжите их здесь.</div>
      <template v-for="[g, list] in grouped" :key="g">
        <div class="section-title" style="margin-top: 10px">{{ g }}</div>
        <div v-for="r in list" :key="r.id" class="rel-row">
          <EntityLink :id="r.abilityId" avatar />
          <span class="muted grow small">{{ r.note || world.get(r.abilityId)?.excerpt?.slice(0, 120) }}</span>
          <span v-if="r.charges" class="charges" title="Заряды: нажмите, чтобы потратить/вернуть">
            <button v-for="i in r.charges" :key="i" class="charge" :class="{ used: i <= (r.usedCharges ?? 0) }" :disabled="!world.isMember" @click="use(r, i <= (r.usedCharges ?? 0) ? -1 : 1)" />
          </span>
          <button v-if="editing" class="icon-btn" @click="openEdit(r)"><Icon name="pencil" :size="14" /></button>
        </div>
      </template>
    </div>
    <div v-if="entity.type === 'ability' && holders.length" class="card card-pad">
      <div class="section-title">Кто владеет ({{ holders.length }})</div>
      <div class="row wrap gap"><EntityLink v-for="h in holders" :key="h.id" :id="h.entityId" avatar /></div>
    </div>
    <Modal v-if="form" :title="form.id ? 'Способность' : 'Добавить способность'" @close="form = null">
      <div class="stack">
        <div class="field"><span>Способность</span><EntityPicker v-model="form.abilityId" :types="['ability']" /></div>
        <div class="row gap">
          <label class="field"><span>Зарядов</span><input v-model.number="form.charges" type="number" min="0" class="input" style="width: 110px" /></label>
          <label class="field"><span>Потрачено</span><input v-model.number="form.usedCharges" type="number" min="0" class="input" style="width: 110px" /></label>
        </div>
        <label class="field"><span>Заметка</span><textarea v-model="form.note" class="input" rows="2" /></label>
        <div class="field"><span>Кто видит</span><VisibilitySelect v-model="form.vis" compact /></div>
      </div>
      <template #footer>
        <button v-if="form.id" class="btn btn-danger" style="margin-right: auto" @click="remove">Удалить</button>
        <button class="btn" @click="form = null">Отмена</button>
        <button class="btn btn-primary" :disabled="!form.abilityId" @click="save">Сохранить</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.charges { display: inline-flex; gap: 3px; flex-wrap: wrap; max-width: 160px; }
.charge { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--accent); background: var(--accent); cursor: pointer; padding: 0; }
.charge.used { background: transparent; }
</style>
