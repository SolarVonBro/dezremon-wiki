<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { typeDef } from '@/model/entityTypes'
import { VISIBILITY_SHORT } from '@/data/access'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import type { Entity, Relation, RelationKind, Visibility } from '@/model/types'

const RelationsGraph = defineAsyncComponent(() => import('@/components/modules/RelationsGraph.vue'))
const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()
const view = ref<'list' | 'graph'>('list')

interface Row { rel: Relation; otherId: string; label: string; outgoing: boolean }
const rows = computed<Row[]>(() => world.relationsOf(props.entity.id).map((r) => {
  const outgoing = r.sourceId === props.entity.id
  return { rel: r, otherId: outgoing ? r.targetId : r.sourceId, label: outgoing ? r.label : (r.reverseLabel || r.label), outgoing }
}).sort((a, b) => Number(b.rel.isPinned) - Number(a.rel.isPinned) || (world.get(a.otherId)?.name ?? '').localeCompare(world.get(b.otherId)?.name ?? '', 'ru')))
const byType = computed(() => {
  const m = new Map<string, Row[]>()
  for (const r of rows.value) {
    const t = world.get(r.otherId)?.type ?? 'note'
    if (!m.has(t)) m.set(t, [])
    m.get(t)!.push(r)
  }
  return [...m.entries()]
})

const KINDS: Array<{ v: RelationKind; label: string }> = [
  { v: 'generic', label: 'Обычная связь' }, { v: 'parent', label: 'Родитель → ребёнок' }, { v: 'spouse', label: 'Супруги / партнёры' }, { v: 'sibling', label: 'Братья / сёстры' },
]
const form = ref<null | { id?: string; otherId: string | null; label: string; reverseLabel: string; kind: RelationKind; attitude: number; colour: string; isPinned: boolean; vis: { visibility: Visibility; allowedUids: string[] }; outgoing: boolean }>(null)

function openNew() {
  form.value = { otherId: null, label: '', reverseLabel: '', kind: 'generic', attitude: 0, colour: '', isPinned: false, vis: { visibility: props.entity.visibility === 'public' ? 'public' : 'members', allowedUids: [] }, outgoing: true }
}
function openEdit(r: Row) {
  form.value = {
    id: r.rel.id, otherId: r.otherId, label: r.outgoing ? r.rel.label : r.rel.reverseLabel, reverseLabel: r.outgoing ? r.rel.reverseLabel : r.rel.label,
    kind: r.rel.kind, attitude: r.rel.attitude, colour: r.rel.colour, isPinned: r.rel.isPinned, vis: { visibility: r.rel.visibility, allowedUids: r.rel.allowedUids ?? [] }, outgoing: r.outgoing,
  }
}
async function save() {
  const f = form.value
  if (!f?.otherId) return
  const me = props.entity.id
  // the form is written from this entity's point of view; flip if the stored relation points at us
  const base = f.outgoing ? { sourceId: me, targetId: f.otherId, label: f.label, reverseLabel: f.reverseLabel } : { sourceId: f.otherId, targetId: me, label: f.reverseLabel, reverseLabel: f.label }
  if (f.kind === 'parent' && !f.id) { base.sourceId = me; base.targetId = f.otherId }
  await world.saveRelation({ id: f.id, ...base, kind: f.kind, attitude: Number(f.attitude), colour: f.colour, isPinned: f.isPinned, ...f.vis })
  form.value = null
}
async function remove() {
  if (form.value?.id && confirm('Удалить связь?')) { await world.deleteRelation(form.value.id); form.value = null }
}
function attitudeColor(a: number) {
  if (a > 20) return 'var(--success)'
  if (a < -20) return 'var(--danger)'
  return 'var(--text-faint)'
}
const kindNote = (r: Row) => (r.rel.kind === 'parent' ? (r.outgoing ? 'ребёнок' : 'родитель') : r.rel.kind === 'spouse' ? 'супруг(а)' : r.rel.kind === 'sibling' ? 'брат/сестра' : '')
</script>

<template>
  <div class="stack">
    <div class="row gap wrap">
      <div class="row gap-sm">
        <button class="chip" :class="{ on: view === 'list' }" @click="view = 'list'"><Icon name="layout-list" :size="14" /> Список</button>
        <button class="chip" :class="{ on: view === 'graph' }" @click="view = 'graph'"><Icon name="network" :size="14" /> Граф</button>
      </div>
      <span class="grow" />
      <button v-if="editing" class="btn btn-primary btn-sm" @click="openNew"><Icon name="plus" :size="14" /> Новая связь</button>
    </div>

    <RelationsGraph v-if="view === 'graph'" :center-id="entity.id" :depth="2" height="560px" />
    <template v-else>
      <div v-if="!rows.length" class="card empty">Связей пока нет.<br /><span class="small">Связи описывают отношения: «наставник — ученик», «враг», «торговый партнёр». Родство (родители, супруги) строит родословную.</span></div>
      <div v-for="[t, list] in byType" :key="t" class="card card-pad">
        <div class="section-title" :style="{ color: typeDef(t).color }"><Icon :name="typeDef(t).icon" :size="13" /> {{ typeDef(t).plural }}</div>
        <div v-for="r in list" :key="r.rel.id" class="rel-row">
          <span class="attitude" :style="{ background: r.rel.colour || attitudeColor(r.rel.attitude) }" :title="'Отношение: ' + r.rel.attitude" />
          <EntityLink :id="r.otherId" avatar />
          <span class="muted grow">{{ r.label || kindNote(r) }}</span>
          <span v-if="r.rel.kind !== 'generic'" class="badge">{{ kindNote(r) }}</span>
          <Icon v-if="r.rel.isPinned" name="pin" :size="13" class="faint" />
          <span v-if="r.rel.visibility !== 'members'" class="badge" :class="{ 'badge-secret': r.rel.visibility === 'master' }">{{ VISIBILITY_SHORT[r.rel.visibility] }}</span>
          <button v-if="editing" class="icon-btn" title="Изменить" @click="openEdit(r)"><Icon name="pencil" :size="14" /></button>
        </div>
      </div>
    </template>

    <Modal v-if="form" :title="form.id ? 'Связь' : 'Новая связь'" width="560px" @close="form = null">
      <div class="stack">
        <div class="field"><span>С кем / с чем</span><EntityPicker v-model="form.otherId" :exclude="[entity.id]" /></div>
        <label class="field"><span>Тип связи</span><select v-model="form.kind" class="input"><option v-for="k in KINDS" :key="k.v" :value="k.v">{{ k.label }}</option></select></label>
        <p v-if="form.kind === 'parent'" class="faint small" style="margin: 0">«{{ entity.name }}» — родитель выбранного персонажа.</p>
        <div class="row gap">
          <label class="field grow"><span>Кем {{ world.get(form.otherId)?.name || 'он' }} приходится «{{ entity.name }}»</span><input v-model="form.label" class="input" placeholder="наставник, враг, союзник…" /></label>
          <label class="field grow"><span>Обратная связь</span><input v-model="form.reverseLabel" class="input" placeholder="ученик…" /></label>
        </div>
        <label class="field"><span>Отношение: {{ form.attitude }}</span><input v-model.number="form.attitude" type="range" min="-100" max="100" step="5" /></label>
        <div class="row gap">
          <label class="field"><span>Цвет линии</span><input v-model="form.colour" type="color" class="input" style="width: 70px; height: 34px; padding: 2px" /></label>
          <label class="check" style="margin-top: 18px"><input v-model="form.isPinned" type="checkbox" /> Закрепить</label>
        </div>
        <div class="field"><span>Кто видит связь</span><VisibilitySelect v-model="form.vis" compact /></div>
      </div>
      <template #footer>
        <button v-if="form.id" class="btn btn-danger" style="margin-right: auto" @click="remove">Удалить</button>
        <button class="btn" @click="form = null">Отмена</button>
        <button class="btn btn-primary" :disabled="!form.otherId" @click="save">Сохранить</button>
      </template>
    </Modal>
  </div>
</template>
