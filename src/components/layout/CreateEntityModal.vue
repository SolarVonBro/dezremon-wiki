<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Modal from '@/components/common/Modal.vue'
import Icon from '@/components/common/Icon.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import VisibilitySelect from '@/components/common/VisibilitySelect.vue'
import MemberPicker from '@/components/common/MemberPicker.vue'
import CharTypeSwitch from '@/components/entity/CharTypeSwitch.vue'
import { useWorld } from '@/stores/world'
import { allTypes, typeDef } from '@/model/entityTypes'
import { randomId } from '@/data/util'
import { CHAR_TYPE_KIND, charTypeOfKind, type CharType } from '@/data/charType'
import type { Visibility } from '@/model/types'

const props = defineProps<{ initialType?: string | null; parentId?: string | null; mine?: boolean }>()
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

// characters: PC / NPC / no type (the «Тип» field; the PC / NPC tags follow) and «a player's character»: the new
// character goes to a member (a player creating it — to themselves) and only that member and the masters see it
const isChar = computed(() => type.value === 'character')
const charType = ref<CharType | null>(props.mine ? 'pc' : null)
const own = ref(!!props.mine)
// whoever creates it by default; only masters may give it to somebody else (a service admin who is not a member: a player)
const ownerUid = ref<string | null>(world.member || !world.isMaster ? world.uid : (world.players[0]?.uid ?? null))
const ownerIsMe = computed(() => ownerUid.value === world.uid)
const ownerName = computed(() => (ownerIsMe.value ? 'вы' : world.memberName(ownerUid.value ?? '')))
watch(own, (v) => { if (v && !charType.value) charType.value = 'pc' })
// the campaign whose tag the new article gets (not for tags); starts with the one switched on above the lists
const campaignTagId = ref<string | null>(world.autoCampaignTagId)
const showCampaign = computed(() => type.value !== 'tag' && world.campaignTags.length > 0)
watch(templateId, (id) => { const t = charTypeOfKind(id ? world.get(id)?.kind : null); if (t) charType.value = t })

async function create() {
  if (!type.value || !name.value.trim() || busy.value) return
  busy.value = true
  try {
    const owner = isChar.value && own.value ? ownerUid.value : null
    let extra: Record<string, any> = { parentId: parent.value, ...(owner ? { visibility: 'custom', allowedUids: [owner] } : vis.value) }
    let html = ''
    const tpl = templateId.value ? world.get(templateId.value) : null
    if (tpl) {
      extra = { ...extra, kind: tpl.kind, fields: JSON.parse(JSON.stringify(tpl.fields ?? {})), attributes: tpl.attributes.map((a) => ({ ...a, id: randomId(8) })), tagIds: [...tpl.tagIds] }
      html = await world.loadText(tpl.id)
    }
    // the chosen type wins over the template's; «no type» keeps a free-form type of the template («бог»)
    if (isChar.value) extra.kind = charType.value ? CHAR_TYPE_KIND[charType.value] : (tpl && !charTypeOfKind(tpl.kind) ? tpl.kind : '')
    const id = await world.createEntity(type.value, name.value, extra, html, { campaignTagId: showCampaign.value ? campaignTagId.value : null })
    if (owner) void world.assignCharacter(id, owner)
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
      <div v-if="isChar" class="field"><span>Тип персонажа</span><CharTypeSwitch v-model="charType" /></div>
      <div v-if="isChar" class="own-box stack-sm">
        <label class="check"><input v-model="own" type="checkbox" /> {{ world.isMaster ? 'Персонаж игрока — закрепить за участником' : 'Мой персонаж — закрепить за мной' }}</label>
        <MemberPicker v-if="own && world.isMaster" v-model="ownerUid" label="Чей персонаж" />
        <span v-if="own" class="faint small">Статью увидят только {{ ownerName }} и мастера, а в меню мира она появится в разделе «Мои персонажи»{{ ownerIsMe ? '' : ' у игрока' }}. Видимость можно поменять позже.</span>
      </div>
      <label v-if="showCampaign" class="field"><span>Кампейн</span>
        <select v-model="campaignTagId" class="input" aria-label="Кампейн">
          <option :value="null">— без кампейна —</option>
          <option v-for="t in world.campaignTags" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </label>
      <div v-if="!(isChar && own)" class="field"><span>Кто видит</span><VisibilitySelect v-model="vis" /></div>
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
.own-box { padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); }
</style>
