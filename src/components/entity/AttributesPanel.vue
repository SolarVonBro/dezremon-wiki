<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import { randomId } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import type { Attribute, AttributeKind, Entity } from '@/model/types'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()
const edit = ref(false)
const KINDS: Array<{ v: AttributeKind; label: string }> = [
  { v: 'text', label: 'Текст' }, { v: 'multiline', label: 'Многострочный' }, { v: 'number', label: 'Число' },
  { v: 'checkbox', label: 'Флажок' }, { v: 'link', label: 'Ссылка' }, { v: 'section', label: 'Заголовок раздела' },
]

type Row = Attribute & { isPrivate: boolean }
const rows = ref<Row[]>([])
function load() {
  const priv = world.secretsState[props.entity.id]?.attributes ?? []
  rows.value = [
    ...props.entity.attributes.map((a) => ({ ...a, isPrivate: false })),
    ...priv.map((a) => ({ ...a, isPrivate: true })),
  ]
}
watch(() => [props.entity.attributes, world.secretsState[props.entity.id]], () => { if (!edit.value) load() }, { immediate: true })
// masters: make sure private attributes are loaded (they live in the secrets doc)
watch(() => [props.entity.id, world.canReadSecrets], async () => { if (world.canReadSecrets && props.entity.hasSecrets) { await world.loadText(props.entity.id); load() } }, { immediate: true })

const visible = computed(() => (edit.value ? rows.value : rows.value.filter((r) => !r.isPrivate || world.canReadSecrets)))

function add(kind: AttributeKind = 'text') { rows.value.push({ id: randomId(8), name: '', value: kind === 'checkbox' ? 'false' : '', kind, isPinned: false, isPrivate: false }) }
function move(i: number, d: -1 | 1) {
  const j = i + d
  if (j < 0 || j >= rows.value.length) return
  const r = rows.value
  ;[r[i], r[j]] = [r[j], r[i]]
}
async function save() {
  const clean = rows.value.filter((r) => r.name.trim() || r.kind === 'section')
  const pub = clean.filter((r) => !r.isPrivate).map(({ isPrivate, ...a }) => a)
  const priv = clean.filter((r) => r.isPrivate).map(({ isPrivate, ...a }) => ({ ...a, isPrivate: true }))
  await world.updateEntity(props.entity.id, { attributes: pub })
  if (world.isMaster && (priv.length || (world.secretsState[props.entity.id]?.attributes.length ?? 0))) await world.saveSecretsMeta(props.entity.id, { attributes: priv })
  edit.value = false
}
function cancel() { edit.value = false; load() }

const templates = computed(() => world.byType.get('attribute_template') ?? [])
function applyTemplate(id: string) {
  const collect = (tid: string, seen = new Set<string>()): Attribute[] => {
    const t = world.get(tid)
    if (!t || seen.has(tid)) return []
    seen.add(tid)
    return [...(t.parentId ? collect(t.parentId, seen) : []), ...t.attributes]
  }
  const have = new Set(rows.value.map((r) => r.name.toLowerCase()))
  for (const a of collect(id)) if (!have.has(a.name.toLowerCase())) rows.value.push({ ...a, id: randomId(8), isPrivate: false })
  edit.value = true
}
function display(a: Attribute) {
  if (a.kind === 'checkbox') return a.value === 'true' ? '✓ да' : '— нет'
  return a.value
}
</script>

<template>
  <div class="card card-pad" style="max-width: 900px">
    <div class="row gap" style="margin-bottom: 12px">
      <h3 class="panel-title grow" style="margin: 0"><Icon name="list-checks" /> Атрибуты</h3>
      <template v-if="editing && !edit">
        <Dropdown v-if="templates.length">
          <template #trigger><button class="btn btn-sm"><Icon name="copy" :size="14" /> Из шаблона</button></template>
          <div class="menu"><button v-for="t in templates" :key="t.id" class="menu-item" @click="applyTemplate(t.id)">{{ t.name }}</button></div>
        </Dropdown>
        <button class="btn btn-sm btn-primary" @click="edit = true"><Icon name="pencil" :size="14" /> Изменить</button>
      </template>
    </div>

    <template v-if="!edit">
      <div v-if="visible.length" class="attr-grid">
        <template v-for="a in visible" :key="a.id">
          <div v-if="a.kind === 'section'" class="attr-section">{{ a.name }}</div>
          <template v-else>
            <div class="attr-name"><Icon v-if="a.isPrivate" name="lock" :size="12" style="color: var(--secret)" title="Видят только мастера" /> {{ a.name }} <Icon v-if="a.isPinned" name="pin" :size="11" class="faint" /></div>
            <div style="white-space: pre-wrap">
              <a v-if="a.kind === 'link' && a.value" :href="a.value" target="_blank" rel="noopener">{{ a.value }}</a>
              <template v-else>{{ display(a) }}</template>
            </div>
          </template>
        </template>
      </div>
      <div v-else class="empty">Атрибутов нет. Атрибуты — это произвольные характеристики: сила, возраст, население, валюта…</div>
    </template>

    <div v-else class="stack-sm">
      <div v-for="(a, i) in rows" :key="a.id" class="attr-edit-row" :class="{ section: a.kind === 'section' }">
        <input v-model="a.name" class="input input-sm" :placeholder="a.kind === 'section' ? 'Название раздела' : 'Название'" />
        <template v-if="a.kind !== 'section'">
          <label v-if="a.kind === 'checkbox'" class="check small"><input type="checkbox" :checked="a.value === 'true'" @change="a.value = String(($event.target as HTMLInputElement).checked)" /> {{ a.value === 'true' ? 'да' : 'нет' }}</label>
          <textarea v-else-if="a.kind === 'multiline'" v-model="a.value" class="input input-sm" rows="2" />
          <input v-else v-model="a.value" class="input input-sm" :type="a.kind === 'number' ? 'number' : a.kind === 'link' ? 'url' : 'text'" placeholder="Значение" />
        </template>
        <span v-else />
        <select v-model="a.kind" class="input input-sm"><option v-for="k in KINDS" :key="k.v" :value="k.v">{{ k.label }}</option></select>
        <button class="icon-btn" :class="{ on: a.isPinned }" title="Закрепить в карточке статьи" @click="a.isPinned = !a.isPinned"><Icon name="pin" :size="15" /></button>
        <button v-if="world.isMaster" class="icon-btn" :class="{ on: a.isPrivate }" :style="a.isPrivate ? 'color: var(--secret)' : ''" title="Приватный: видят только мастера" @click="a.isPrivate = !a.isPrivate"><Icon name="lock" :size="15" /></button>
        <button class="icon-btn" title="Выше" @click="move(i, -1)"><Icon name="arrow-up" :size="15" /></button>
        <button class="icon-btn" title="Ниже" @click="move(i, 1)"><Icon name="arrow-down" :size="15" /></button>
        <button class="icon-btn danger" title="Удалить" @click="rows.splice(i, 1)"><Icon name="x" :size="15" /></button>
      </div>
      <div class="row gap wrap">
        <button class="btn btn-sm" @click="add('text')"><Icon name="plus" :size="14" /> Атрибут</button>
        <button class="btn btn-sm" @click="add('section')"><Icon name="plus" :size="14" /> Раздел</button>
        <span class="grow" />
        <button class="btn btn-sm" @click="cancel">Отмена</button>
        <button class="btn btn-sm btn-primary" @click="save"><Icon name="save" :size="14" /> Сохранить</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.attr-edit-row { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(140px, 1.6fr) 140px repeat(5, auto); gap: 6px; align-items: center; }
.attr-edit-row.section input:first-child { font-weight: 700; }
@media (max-width: 720px) { .attr-edit-row { grid-template-columns: 1fr 1fr; } }
</style>
