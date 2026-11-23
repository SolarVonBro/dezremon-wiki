<script setup lang="ts">
// The campaign's players and the characters of the world each of them plays in it now («текущие персонажи»).
// A participant picks his own; GMs and the world's masters pick anyone's. Adding and removing players is in Settings.
import { computed, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { ROLE_LABELS, currentCharacters, setCampaignCharacters } from '@/data/campaigns'
import { characterIdsOf } from '@/data/access'
import { charTypeOfKind } from '@/data/charType'
import { cropOf } from '@/data/crop'
import { formatDate, errorText } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import Modal from '@/components/common/Modal.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import { toast } from '@/components/common/toast'
import type { Campaign, CampaignParticipant, Entity } from '@/model/types'

const props = defineProps<{ campaign: Campaign; participants: CampaignParticipant[]; isGm: boolean }>()
const world = useWorld()
const uid = computed(() => world.uid ?? '')

const people = computed(() => [...props.participants].sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName, 'ru') : a.role === 'gm' ? -1 : 1)))
const chars = (p: CampaignParticipant) => currentCharacters(props.campaign, p).map((id) => world.get(id)).filter((e): e is Entity => !!e)
const canEdit = (p: CampaignParticipant) => !world.preview && (props.isGm || p.uid === uid.value)

// ---------- choosing the current characters ----------
const editing = ref<{ p: CampaignParticipant; ids: string[] } | null>(null)
const pick = ref<string | null>(null)
function edit(p: CampaignParticipant) { editing.value = { p, ids: currentCharacters(props.campaign, p) } }
/** The characters the member plays in the world: offered first. */
const own = computed(() => {
  const m = editing.value ? world.members.find((x) => x.uid === editing.value!.p.uid) : null
  return characterIdsOf(m).map((id) => world.get(id)).filter((e): e is Entity => !!e)
})
const others = computed(() => (editing.value?.ids ?? []).filter((id) => !own.value.some((e) => e.id === id)).map((id) => world.get(id)).filter((e): e is Entity => !!e))
function toggle(id: string) {
  const f = editing.value
  if (!f) return
  f.ids = f.ids.includes(id) ? f.ids.filter((x) => x !== id) : [...f.ids, id]
}
function add(id: string | null) {
  pick.value = null
  if (id && editing.value && !editing.value.ids.includes(id)) editing.value.ids = [...editing.value.ids, id]
}
const busy = ref(false)
async function save() {
  const f = editing.value
  if (!f) return
  busy.value = true
  try {
    await setCampaignCharacters(props.campaign.id, f.p.uid, f.ids, f.p)
    editing.value = null
  } catch (e: any) { toast.error('Не удалось сохранить: ' + errorText(e)) } finally { busy.value = false }
}
const typeLabel = (e: Entity) => ({ pc: 'PC', npc: 'NPC' } as Record<string, string>)[charTypeOfKind(e.kind) ?? ''] ?? e.kind
</script>

<template>
  <section class="card card-pad">
    <h3 class="panel-title"><Icon name="users" /> Игроки и их текущие персонажи</h3>
    <p class="faint small" style="margin: -4px 0 10px">Текущие персонажи — те, которыми игрок играет в этой игре сейчас. Игрок выбирает их сам, мастер — за любого. Добавить или убрать участников можно в настройках игры{{ isGm ? '' : ' (у мастера)' }}.</p>
    <div v-if="!people.length" class="faint">Игроков пока нет.</div>
    <div v-for="p in people" :key="p.uid" class="person">
      <span class="avatar round" style="width: 40px; height: 40px"><img v-if="p.photoURL" :src="p.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="18" /></span>
      <div class="grow" style="min-width: 0">
        <div class="row gap-sm wrap">
          <RouterLink class="p-name" :to="{ name: 'user', params: { uid: p.uid } }">{{ p.displayName }}</RouterLink>
          <span class="badge" :class="{ 'badge-public': p.role === 'gm' }">{{ ROLE_LABELS[p.role] }}</span>
          <span v-if="p.uid === campaign.ownerId" class="badge">создатель</span>
          <span v-if="p.uid === uid" class="faint small">(вы)</span>
          <span class="faint small">с {{ formatDate(p.joinedAt).split(',')[0] }}</span>
        </div>
        <div class="p-chars">
          <RouterLink v-for="e in chars(p)" :key="e.id" class="p-char" :to="{ name: 'entity', params: { wid: world.wid!, eid: e.id } }">
            <span class="p-char-ava"><Thumb :id="e.imageId" :crop="cropOf(e)"><Icon name="user" :size="14" /></Thumb></span>
            <span class="ellipsis">{{ e.name }}</span><span v-if="typeLabel(e)" class="faint small">{{ typeLabel(e) }}</span>
          </RouterLink>
          <span v-if="!chars(p).length" class="faint small">{{ p.characterName || (p.role === 'gm' ? 'ведёт игру' : 'персонаж не выбран') }}</span>
        </div>
      </div>
      <button v-if="canEdit(p)" class="btn btn-sm" @click="edit(p)"><Icon name="pencil" :size="14" /> Персонажи</button>
    </div>
  </section>

  <Modal v-if="editing" :title="'Текущие персонажи: ' + editing.p.displayName" width="520px" @close="editing = null">
    <div class="stack">
      <div v-if="own.length" class="field"><span>Персонажи участника в мире</span>
        <label v-for="e in own" :key="e.id" class="check own-char"><input type="checkbox" :checked="editing.ids.includes(e.id)" @change="toggle(e.id)" />
          <span class="p-char-ava"><Thumb :id="e.imageId" :crop="cropOf(e)"><Icon name="user" :size="14" /></Thumb></span>{{ e.name }}<span v-if="typeLabel(e)" class="faint small">{{ typeLabel(e) }}</span>
        </label>
      </div>
      <p v-else class="faint small" style="margin: 0">За участником в мире пока не закреплены персонажи. Можно выбрать любого персонажа мира ниже.</p>
      <div v-if="others.length" class="field"><span>Ещё</span>
        <div v-for="e in others" :key="e.id" class="row gap-sm">
          <span class="p-char-ava"><Thumb :id="e.imageId" :crop="cropOf(e)"><Icon name="user" :size="14" /></Thumb></span><span class="grow">{{ e.name }}</span>
          <button class="icon-btn" title="Убрать" @click="toggle(e.id)"><Icon name="x" :size="14" /></button>
        </div>
      </div>
      <div class="field"><span>Добавить персонажа мира</span><EntityPicker :model-value="pick" :types="['character']" :allow-create="false" :exclude="editing.ids" placeholder="Выберите персонажа…" @update:model-value="add" /></div>
    </div>
    <template #footer>
      <button class="btn" @click="editing = null">Отмена</button>
      <button class="btn btn-primary" :disabled="busy" @click="save">Сохранить</button>
    </template>
  </Modal>
</template>

<style scoped>
.person { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); }
.person:last-child { border-bottom: 0; }
.p-name { font-weight: 700; color: var(--text); text-decoration: none; }
.p-name:hover { color: var(--accent); }
.p-chars { display: flex; flex-wrap: wrap; gap: 6px 8px; margin-top: 6px; }
.p-char { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 3px; border: 1px solid var(--border); border-radius: 99px; color: var(--text); text-decoration: none; background: var(--surface-2); max-width: 260px; }
.p-char:hover { border-color: var(--accent); }
.p-char-ava { width: 26px; height: 26px; border-radius: 50%; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; background: var(--surface-3); color: var(--accent); flex: none; }
.p-char-ava :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.own-char { gap: 8px; padding: 3px 0; }
</style>
