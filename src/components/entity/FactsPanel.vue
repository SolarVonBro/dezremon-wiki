<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import { typeDef, allTypes, type FieldDef } from '@/model/entityTypes'
import Icon from '@/components/common/Icon.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import type { Entity } from '@/model/types'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()
const def = computed(() => typeDef(props.entity.type))

// local copies for text inputs (saved on blur)
const kind = ref(props.entity.kind)
const aliases = ref(props.entity.aliases.join(', '))
const local = ref<Record<string, any>>({ ...props.entity.fields })
watch(() => props.entity, (e) => {
  if (document.activeElement?.closest('.facts-edit')) return
  kind.value = e.kind
  aliases.value = e.aliases.join(', ')
  local.value = { ...e.fields }
})

function setField(key: string, value: any) {
  local.value[key] = value
  void world.updateEntity(props.entity.id, { fields: { ...props.entity.fields, [key]: value } })
}
function saveKind() { if (kind.value !== props.entity.kind) void world.updateEntity(props.entity.id, { kind: kind.value.trim() }) }
function saveAliases() {
  const list = aliases.value.split(',').map((s) => s.trim()).filter(Boolean)
  if (list.join(',') !== props.entity.aliases.join(',')) void world.updateEntity(props.entity.id, { aliases: list })
}
function setParent(id: string | null) { void world.updateEntity(props.entity.id, { parentId: id }) }
function toggleTag(id: string) {
  const s = new Set(props.entity.tagIds)
  if (s.has(id)) s.delete(id); else s.add(id)
  void world.updateEntity(props.entity.id, { tagIds: [...s] })
}
const tagPick = ref<string | null>(null)
watch(tagPick, (id) => { if (id) { toggleTag(id); tagPick.value = null } })

function addToList(key: string, id: string | null) {
  if (!id) return
  const cur: string[] = props.entity.fields?.[key] ?? []
  if (!cur.includes(id)) setField(key, [...cur, id])
}
function removeFromList(key: string, id: string) {
  setField(key, (props.entity.fields?.[key] ?? []).filter((x: string) => x !== id))
}
function pairs(key: string): Array<{ name: string; value: string }> { return props.entity.fields?.[key] ?? [] }
function setPairs(key: string, list: Array<{ name: string; value: string }>) { setField(key, list) }

const shown = computed(() => def.value.fields.filter((f) => {
  const v = props.entity.fields?.[f.key]
  if (f.kind === 'pairs') return false
  if (props.editing) return true
  if (f.kind === 'bool') return !!v
  if (Array.isArray(v)) return v.length > 0
  return v !== undefined && v !== null && v !== ''
}))
const pairFields = computed(() => def.value.fields.filter((f) => f.kind === 'pairs' && (props.editing || pairs(f.key).length)))
const hasAnything = computed(() => props.editing || shown.value.length || props.entity.kind || props.entity.parentId || pairFields.value.length)
const pickTypes = (f: FieldDef) => f.target ?? allTypes().map((t) => t.key)
const PAIR_PRIVATE_HINT = 'Для скрытых от игроков деталей используйте приватные атрибуты или секретные блоки.'
</script>

<template>
  <div v-if="hasAnything" class="card card-pad" :class="{ 'facts-edit': editing }">
    <div class="section-title">{{ def.label }}</div>
    <dl v-if="!editing" class="facts">
      <template v-if="entity.kind"><dt>Тип</dt><dd>{{ entity.kind }}</dd></template>
      <template v-if="entity.parentId && def.parentLabel"><dt>{{ def.parentLabel }}</dt><dd><EntityLink :id="entity.parentId" /></dd></template>
      <template v-for="f in shown" :key="f.key">
        <dt>{{ f.label }}</dt>
        <dd>
          <template v-if="f.kind === 'entity'"><EntityLink :id="entity.fields[f.key]" /></template>
          <template v-else-if="f.kind === 'entities'"><EntityLink v-for="id in entity.fields[f.key]" :key="id" :id="id" /></template>
          <template v-else-if="f.kind === 'bool'">да</template>
          <template v-else-if="f.kind === 'color'"><span class="swatch-sm" :style="{ background: entity.fields[f.key] }" /> {{ entity.fields[f.key] }}</template>
          <template v-else>{{ entity.fields[f.key] }}</template>
        </dd>
      </template>
    </dl>
    <div v-else class="stack-sm">
      <label class="field"><span>Тип (подтип)</span><input v-model="kind" class="input input-sm" :placeholder="def.kindPlaceholder" @blur="saveKind" /></label>
      <label v-if="def.parentLabel" class="field"><span>{{ def.parentLabel }}</span><EntityPicker :model-value="entity.parentId" :types="[entity.type]" :exclude="[entity.id]" @update:model-value="setParent" /></label>
      <template v-for="f in def.fields" :key="f.key">
        <label v-if="f.kind === 'text' || f.kind === 'number'" class="field"><span>{{ f.label }}</span>
          <input v-model="local[f.key]" class="input input-sm" :type="f.kind === 'number' ? 'number' : 'text'" :placeholder="f.placeholder" @blur="local[f.key] !== entity.fields[f.key] && setField(f.key, local[f.key])" />
        </label>
        <label v-else-if="f.kind === 'textarea'" class="field"><span>{{ f.label }}</span>
          <textarea v-model="local[f.key]" class="input input-sm" rows="2" @blur="setField(f.key, local[f.key])" />
        </label>
        <label v-else-if="f.kind === 'bool'" class="check small"><input type="checkbox" :checked="!!entity.fields[f.key]" @change="setField(f.key, ($event.target as HTMLInputElement).checked)" /> {{ f.label }}</label>
        <label v-else-if="f.kind === 'color'" class="field"><span>{{ f.label }}</span><input type="color" class="input input-sm" style="height: 32px; padding: 2px" :value="entity.fields[f.key] || '#c9a227'" @change="setField(f.key, ($event.target as HTMLInputElement).value)" /></label>
        <div v-else-if="f.kind === 'entity'" class="field"><span>{{ f.label }}</span><EntityPicker :model-value="entity.fields[f.key] ?? null" :types="pickTypes(f)" @update:model-value="(v) => setField(f.key, v)" /></div>
        <div v-else-if="f.kind === 'entities'" class="field"><span>{{ f.label }}</span>
          <div class="row wrap gap-sm">
            <span v-for="id in entity.fields[f.key] ?? []" :key="id" class="chip"><EntityLink :id="id" :icon="false" /><button class="icon-btn" style="width: 18px; height: 18px" @click="removeFromList(f.key, id)"><Icon name="x" :size="12" /></button></span>
          </div>
          <EntityPicker :model-value="null" :types="pickTypes(f)" placeholder="Добавить…" :exclude="entity.fields[f.key] ?? []" @update:model-value="(v) => addToList(f.key, v)" />
        </div>
      </template>
      <div v-if="entity.type === 'attribute_template'" class="field"><span>Автоматически добавлять к новым статьям типа</span>
        <select class="input input-sm" :value="entity.fields.autoType ?? ''" @change="setField('autoType', ($event.target as HTMLSelectElement).value || null)">
          <option value="">— не добавлять —</option><option v-for="t in allTypes()" :key="t.key" :value="t.key">{{ t.label }}</option>
        </select>
      </div>
      <label class="field"><span>Другие имена (через запятую)</span><input v-model="aliases" class="input input-sm" placeholder="Прозвища, старые названия" @blur="saveAliases" /></label>
      <div class="field"><span>Теги</span>
        <div class="row wrap gap-sm">
          <span v-for="id in entity.tagIds" :key="id" class="tag-chip" :style="{ '--tag-color': world.get(id)?.fields?.colour }">{{ world.get(id)?.name ?? '…' }}<button class="icon-btn" style="width: 16px; height: 16px" @click="toggleTag(id)"><Icon name="x" :size="11" /></button></span>
        </div>
        <EntityPicker v-model="tagPick" :types="['tag']" placeholder="Добавить тег…" :exclude="entity.tagIds" />
      </div>
    </div>

    <div v-for="f in pairFields" :key="f.key" class="pairs">
      <div class="section-title" style="margin-top: 14px">{{ f.label }}</div>
      <dl v-if="!editing" class="facts"><template v-for="(p, i) in pairs(f.key)" :key="i"><dt>{{ p.name }}</dt><dd>{{ p.value }}</dd></template></dl>
      <div v-else class="stack-sm">
        <div v-for="(p, i) in pairs(f.key)" :key="i" class="row gap-sm">
          <input class="input input-sm" style="width: 40%" :value="p.name" placeholder="Черта" @change="setPairs(f.key, pairs(f.key).map((x, j) => j === i ? { ...x, name: ($event.target as HTMLInputElement).value } : x))" />
          <input class="input input-sm grow" :value="p.value" placeholder="Значение" @change="setPairs(f.key, pairs(f.key).map((x, j) => j === i ? { ...x, value: ($event.target as HTMLInputElement).value } : x))" />
          <button class="icon-btn" title="Удалить" @click="setPairs(f.key, pairs(f.key).filter((_, j) => j !== i))"><Icon name="x" :size="14" /></button>
        </div>
        <button class="btn btn-sm btn-ghost" :title="PAIR_PRIVATE_HINT" @click="setPairs(f.key, [...pairs(f.key), { name: '', value: '' }])"><Icon name="plus" :size="14" /> Добавить ({{ f.placeholder }})</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.swatch-sm { display: inline-block; width: 14px; height: 14px; border-radius: 4px; vertical-align: middle; }
</style>
