<script setup lang="ts">
// Adds a parent / child / spouse / sibling to a person (existing or new character), or a member to a family.
import { computed, ref } from 'vue'
import { useWorld } from '@/stores/world'
import type { Entity } from '@/model/types'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import { toast } from '@/components/common/toast'
import { isDescendant, keysOf, kinLabel, sexOf, type AddKind, type KinGraph } from './genealogy'

const props = defineProps<{
  /** Person the relative is added to; null with kind 'member' = add to the family only. */
  person: Entity | null
  kind: AddKind | 'member'
  graph: KinGraph
  /** Family whose page we are on (family mode). */
  family: Entity | null
}>()
const emit = defineEmits<{ close: []; added: [id: string] }>()
const world = useWorld()

const canCreate = computed(() => world.canCreate('character'))
const mode = ref<'existing' | 'new'>('existing')
const pickedId = ref<string | null>(null)
const newName = ref('')
const addToFamily = ref(props.kind === 'member')
const newInFamily = ref(true)
const busy = ref(false)

const TITLES: Record<AddKind | 'member', string> = {
  parent: 'Добавить родителя', child: 'Добавить ребёнка', spouse: 'Добавить супруга(у)', sibling: 'Добавить брата / сестру', member: 'Добавить члена семьи',
}
const title = computed(() => TITLES[props.kind] + (props.person ? ` — ${props.person.name}` : ''))

const pid = computed(() => props.person?.id ?? '')
const spouses = computed(() => (pid.value ? keysOf(props.graph.spouses, pid.value).map((id) => world.get(id)).filter((e): e is Entity => !!e) : []))
const parents = computed(() => (pid.value ? keysOf(props.graph.parents, pid.value).map((id) => world.get(id)).filter((e): e is Entity => !!e) : []))

/** child: second parent (defaults to the only spouse). */
const secondParent = ref<string | null>(spouses.value.length === 1 ? spouses.value[0].id : null)
/** parent: the existing single parent becomes the spouse of the new one. */
const marryExisting = ref(true)
const loneParent = computed(() => (props.kind === 'parent' && parents.value.length === 1 ? parents.value[0] : null))
/** sibling: link through the person's parents instead of an explicit sibling relation. */
const viaParents = ref(true)

const exclude = computed(() => {
  const ex = new Set<string>(pid.value ? [pid.value] : [])
  if (!pid.value) return [...ex]
  const g = props.graph
  if (props.kind === 'parent') keysOf(g.parents, pid.value).forEach((id) => ex.add(id))
  if (props.kind === 'child') keysOf(g.children, pid.value).forEach((id) => ex.add(id))
  if (props.kind === 'spouse') keysOf(g.spouses, pid.value).forEach((id) => ex.add(id))
  if (props.kind === 'sibling') keysOf(g.siblings, pid.value).forEach((id) => ex.add(id))
  return [...ex]
})

const picked = computed(() => world.get(pickedId.value))
const pickedInFamily = computed(() => !!props.family && (picked.value?.fields?.familyIds ?? []).includes(props.family.id))

const problem = computed(() => {
  if (mode.value === 'new') return newName.value.trim() ? '' : ' '
  const other = pickedId.value
  if (!other) return ' '
  if (!pid.value) return pickedInFamily.value ? 'Персонаж уже состоит в этой семье.' : ''
  if (other === pid.value) return 'Нельзя связать персонажа с самим собой.'
  if (props.kind === 'parent' && isDescendant(props.graph, pid.value, other)) return 'Этот персонаж — потомок выбранного: получится цикл.'
  if (props.kind === 'child' && isDescendant(props.graph, other, pid.value)) return 'Этот персонаж — предок выбранного: получится цикл.'
  if (exclude.value.includes(other)) return 'Такая связь уже есть.'
  return ''
})

async function rel(sourceId: string, targetId: string, kind: 'parent' | 'spouse' | 'sibling') {
  const s = sexOf(world.get(sourceId)?.fields?.sex)
  const t = sexOf(world.get(targetId)?.fields?.sex)
  const labels = kind === 'parent'
    ? { label: kinLabel.parent(s), reverseLabel: kinLabel.child(t) }
    : kind === 'spouse'
      ? { label: kinLabel.spouse(s), reverseLabel: kinLabel.spouse(t) }
      : { label: kinLabel.sibling(s), reverseLabel: kinLabel.sibling(t) }
  await world.saveRelation({ sourceId, targetId, kind, ...labels })
}

async function save() {
  if (problem.value || busy.value) return
  busy.value = true
  try {
    const famId = props.family?.id ?? null
    let other: string
    if (mode.value === 'new') {
      const fields = famId && (props.kind === 'member' || newInFamily.value) ? { familyIds: [famId] } : {}
      other = await world.createEntity('character', newName.value.trim(), { fields })
    } else {
      other = pickedId.value!
      const e = world.get(other)
      if (famId && e && (props.kind === 'member' || addToFamily.value) && !(e.fields?.familyIds ?? []).includes(famId)) {
        await world.updateEntity(other, { fields: { ...e.fields, familyIds: [...(e.fields?.familyIds ?? []), famId] } })
      }
    }
    const me = pid.value
    if (me) {
      if (props.kind === 'parent') {
        await rel(other, me, 'parent')
        if (loneParent.value && marryExisting.value && !keysOf(props.graph.spouses, loneParent.value.id).includes(other)) await rel(other, loneParent.value.id, 'spouse')
      } else if (props.kind === 'child') {
        await rel(me, other, 'parent')
        if (secondParent.value && secondParent.value !== other) await rel(secondParent.value, other, 'parent')
      } else if (props.kind === 'spouse') {
        await rel(me, other, 'spouse')
      } else if (props.kind === 'sibling') {
        if (viaParents.value && parents.value.length) {
          const already = new Set(keysOf(props.graph.parents, other))
          for (const p of parents.value) if (!already.has(p.id) && p.id !== other) await rel(p.id, other, 'parent')
        } else {
          await rel(me, other, 'sibling')
        }
      }
    }
    toast.success(props.kind === 'member' ? 'Персонаж добавлен в семью' : 'Связь добавлена')
    emit('added', other)
    emit('close')
  } catch {
    /* toast shown by the store */
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal :title="title" width="520px" @close="emit('close')">
    <form class="stack" @submit.prevent="save">
      <div class="tabs ar-tabs">
        <button type="button" class="tab" :class="{ on: mode === 'existing' }" @click="mode = 'existing'"><Icon name="search" :size="15" /> Существующий персонаж</button>
        <button v-if="canCreate" type="button" class="tab" :class="{ on: mode === 'new' }" @click="mode = 'new'"><Icon name="plus" :size="15" /> Новый персонаж</button>
      </div>

      <template v-if="mode === 'existing'">
        <div class="field">
          <span>Персонаж</span>
          <EntityPicker v-model="pickedId" :types="['character']" :exclude="exclude" :allow-create="false" placeholder="Найдите персонажа…" />
        </div>
        <label v-if="family && kind !== 'member' && picked && !pickedInFamily && world.canEdit(picked)" class="check small">
          <input v-model="addToFamily" type="checkbox" /> Также добавить в семью «{{ family.name }}»
        </label>
      </template>
      <template v-else>
        <label class="field">
          <span>Имя нового персонажа</span>
          <input v-model="newName" class="input" placeholder="Имя" autofocus />
        </label>
        <label v-if="family && kind !== 'member'" class="check small">
          <input v-model="newInFamily" type="checkbox" /> Член семьи «{{ family.name }}»
        </label>
        <p class="muted small">Будет создана статья-персонаж; подробности можно заполнить позже.</p>
      </template>

      <div v-if="kind === 'child' && spouses.length" class="field">
        <span>Второй родитель</span>
        <select v-model="secondParent" class="input">
          <option :value="null">— не указан —</option>
          <option v-for="s in spouses" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
      <label v-if="loneParent" class="check small">
        <input v-model="marryExisting" type="checkbox" /> Супруг(а) родителя «{{ loneParent.name }}»
      </label>
      <label v-if="kind === 'sibling' && parents.length" class="check small">
        <input v-model="viaParents" type="checkbox" /> Через общих родителей ({{ parents.map((p) => p.name).join(', ') }})
      </label>

      <p v-if="problem.trim()" class="ar-problem small"><Icon name="triangle-alert" :size="15" /> {{ problem }}</p>
    </form>
    <template #footer>
      <button type="button" class="btn btn-ghost" @click="emit('close')">Отмена</button>
      <button type="button" class="btn btn-primary" :disabled="!!problem || busy" @click="save">Добавить</button>
    </template>
  </Modal>
</template>

<style scoped>
.ar-tabs { margin-bottom: 4px; }
.ar-problem { display: flex; align-items: center; gap: 6px; color: var(--danger); margin: 0; }
</style>
