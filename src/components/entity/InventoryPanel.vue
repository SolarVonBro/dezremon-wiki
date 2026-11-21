<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { useRows } from '@/composables/useRows'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import type { Entity, InventoryRow, Visibility } from '@/model/types'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()
const rows = useRows<InventoryRow>('inventory', 'ownerId', () => props.entity.id)
const groups = computed(() => {
  const m = new Map<string, InventoryRow[]>()
  for (const r of rows.value) { const g = r.group || 'Без группы'; if (!m.has(g)) m.set(g, []); m.get(g)!.push(r) }
  return [...m.entries()]
})
const knownGroups = computed(() => [...new Set(rows.value.map((r) => r.group).filter(Boolean))])
type Form = { id?: string; itemId: string | null; name: string; amount: number; group: string; description: string; isEquipped: boolean; vis: { visibility: Visibility; allowedUids: string[] } }
const form = ref<Form | null>(null)
function openNew() { form.value = { itemId: null, name: '', amount: 1, group: '', description: '', isEquipped: false, vis: { visibility: props.entity.visibility, allowedUids: props.entity.allowedUids ?? [] } } }
function openEdit(r: InventoryRow) { form.value = { id: r.id, itemId: r.itemId, name: r.name, amount: r.amount, group: r.group, description: r.description, isEquipped: r.isEquipped, vis: { visibility: r.visibility, allowedUids: r.allowedUids ?? [] } } }
async function save() {
  const f = form.value!
  await world.saveRow('inventory', { id: f.id, ownerId: props.entity.id, itemId: f.itemId, name: f.name.trim(), amount: Number(f.amount) || 0, group: f.group.trim(), description: f.description, isEquipped: f.isEquipped, order: f.id ? undefined : rows.value.length, ...f.vis })
  form.value = null
}
async function remove() { if (form.value?.id && confirm('Убрать из инвентаря?')) { await world.deleteRow('inventory', form.value.id); form.value = null } }
async function bump(r: InventoryRow, d: number) { await world.saveRow('inventory', { id: r.id, amount: Math.max(0, (r.amount ?? 0) + d) }) }
</script>

<template>
  <div class="card card-pad" style="max-width: 980px">
    <div class="row gap" style="margin-bottom: 10px">
      <h3 class="panel-title grow" style="margin: 0"><Icon name="archive" /> Инвентарь</h3>
      <button v-if="editing" class="btn btn-sm btn-primary" @click="openNew"><Icon name="plus" :size="14" /> Добавить</button>
    </div>
    <div v-if="!rows.length" class="empty">Инвентарь пуст.</div>
    <template v-for="[g, list] in groups" :key="g">
      <div class="section-title" style="margin-top: 12px">{{ g }}</div>
      <table class="table">
        <tbody>
          <tr v-for="r in list" :key="r.id">
            <td style="width: 46%"><EntityLink v-if="r.itemId" :id="r.itemId" avatar :fallback="r.name" /><span v-if="!r.itemId || r.name">{{ r.itemId ? (r.name ? ' — ' + r.name : '') : r.name }}</span>
              <span v-if="r.isEquipped" class="badge" style="margin-left: 6px">надето</span></td>
            <td class="nowrap">
              <button v-if="editing" class="icon-btn" style="width: 22px; height: 22px" @click="bump(r, -1)"><Icon name="minus" :size="12" /></button>
              × {{ r.amount }}
              <button v-if="editing" class="icon-btn" style="width: 22px; height: 22px" @click="bump(r, 1)"><Icon name="plus" :size="12" /></button>
            </td>
            <td class="muted small">{{ r.description }}</td>
            <td style="width: 40px"><button v-if="editing" class="icon-btn" @click="openEdit(r)"><Icon name="pencil" :size="14" /></button></td>
          </tr>
        </tbody>
      </table>
    </template>
    <Modal v-if="form" :title="form.id ? 'Предмет в инвентаре' : 'Добавить в инвентарь'" @close="form = null">
      <div class="stack">
        <div class="field"><span>Предмет из мира</span><EntityPicker v-model="form.itemId" :types="['item']" placeholder="Необязательно" /></div>
        <label class="field"><span>{{ form.itemId ? 'Пояснение' : 'Название' }}</span><input v-model="form.name" class="input" placeholder="Золотые монеты" /></label>
        <div class="row gap">
          <label class="field"><span>Количество</span><input v-model.number="form.amount" type="number" class="input" style="width: 110px" /></label>
          <label class="field grow"><span>Группа</span><input v-model="form.group" class="input" list="inv-groups" placeholder="Рюкзак, сундук…" /><datalist id="inv-groups"><option v-for="g in knownGroups" :key="g" :value="g" /></datalist></label>
        </div>
        <label class="field"><span>Описание</span><textarea v-model="form.description" class="input" rows="2" /></label>
        <label class="check"><input v-model="form.isEquipped" type="checkbox" /> Надето / в руках</label>
        <div class="field"><span>Кто видит</span><VisibilitySelect v-model="form.vis" compact /></div>
      </div>
      <template #footer>
        <button v-if="form.id" class="btn btn-danger" style="margin-right: auto" @click="remove">Удалить</button>
        <button class="btn" @click="form = null">Отмена</button>
        <button class="btn btn-primary" :disabled="!form.itemId && !form.name.trim()" @click="save">Сохранить</button>
      </template>
    </Modal>
  </div>
</template>
