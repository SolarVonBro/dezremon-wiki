<script setup lang="ts">
// Campaign participants (GMs and players with their characters) and invite links.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useSession } from '@/stores/session'
import { useWorld } from '@/stores/world'
import {
  ROLE_LABELS, createCampaignInvite, deleteCampaignInvite, inviteUrl, removeParticipant, setParticipantRole, updateParticipant, watchCampaignInvites,
} from '@/data/campaigns'
import { formatDate, relativeTime, errorText } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import { toast } from '@/components/common/toast'
import type { Campaign, CampaignInvite, CampaignParticipant, CampaignRole } from '@/model/types'

const props = defineProps<{ campaign: Campaign; participants: CampaignParticipant[]; isGm: boolean; worldReady: boolean }>()
const session = useSession()
const world = useWorld()
const uid = computed(() => session.user?.uid ?? '')

function characterEntity(p: CampaignParticipant) {
  return props.worldReady && p.characterId ? world.get(p.characterId) ?? null : null
}

// ---------- character ----------
const editing = ref<{ uid: string; name: string; characterId: string | null; characterName: string } | null>(null)
function editCharacter(p: CampaignParticipant) {
  editing.value = { uid: p.uid, name: p.displayName, characterId: p.characterId, characterName: p.characterName }
}
watch(() => editing.value?.characterId, (id) => {
  if (!editing.value || !id) return
  const e = world.get(id)
  if (e) editing.value.characterName = e.name
})
async function saveCharacter() {
  const f = editing.value
  if (!f) return
  try {
    await updateParticipant(props.campaign.id, f.uid, { characterId: f.characterId || null, characterName: f.characterName.trim() })
    editing.value = null
  } catch (e: any) { toast.error('Не удалось сохранить: ' + errorText(e)) }
}

// ---------- roles ----------
async function setRole(p: CampaignParticipant, role: CampaignRole) {
  try { await setParticipantRole(props.campaign.id, p.uid, role) } catch (e: any) { toast.error('Не удалось: ' + errorText(e)) }
}
async function remove(p: CampaignParticipant) {
  if (!confirm(`Убрать «${p.displayName}» из кампейна? Доступ к миру это не отменяет — его настраивают в мире.`)) return
  try { await removeParticipant(props.campaign.id, p.uid) } catch (e: any) { toast.error('Не удалось: ' + errorText(e)) }
}

// ---------- invites ----------
const invites = ref<CampaignInvite[]>([])
let stop: (() => void) | null = null
watch(() => props.isGm, (gm) => {
  stop?.(); stop = null
  if (gm) stop = watchCampaignInvites(props.campaign.id, (r) => { invites.value = r.filter((i) => !i.expiresAt || i.expiresAt > Date.now()) })
}, { immediate: true })
onBeforeUnmount(() => stop?.())

const canInviteToWorld = computed(() => props.worldReady && world.isMaster)
const inv = ref({ role: 'player' as CampaignRole, days: 14 as number | null, withWorld: true })
const busy = ref(false)
async function createInvite() {
  if (!session.user) return
  busy.value = true
  try {
    const code = await createCampaignInvite(props.campaign, session.user.uid, inv.value.role, inv.value.days, inv.value.withWorld && canInviteToWorld.value)
    await navigator.clipboard.writeText(inviteUrl(props.campaign.id, code)).catch(() => {})
    toast.success('Ссылка создана и скопирована')
  } catch (e: any) { toast.error('Не удалось создать приглашение: ' + errorText(e)) } finally { busy.value = false }
}
function copy(i: CampaignInvite) {
  void navigator.clipboard.writeText(inviteUrl(props.campaign.id, i.code)).then(() => toast.success('Ссылка скопирована'))
}
async function revoke(i: CampaignInvite) {
  await deleteCampaignInvite(props.campaign, i).catch((e) => toast.error(errorText(e)))
}
</script>

<template>
  <div class="people-grid">
    <section class="card card-pad">
      <h3 class="panel-title"><Icon name="users" /> Участники</h3>
      <div v-for="p in participants" :key="p.uid" class="person">
        <span class="avatar round" style="width: 38px; height: 38px"><img v-if="p.photoURL" :src="p.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="18" /></span>
        <div class="grow" style="min-width: 0">
          <div class="row gap-sm wrap">
            <b>{{ p.displayName }}</b>
            <span class="badge" :class="{ 'badge-public': p.role === 'gm' }">{{ ROLE_LABELS[p.role] }}</span>
            <span v-if="p.uid === campaign.ownerId" class="badge">создатель</span>
            <span v-if="p.uid === uid" class="faint small">(вы)</span>
          </div>
          <div class="small muted char">
            <Icon name="user" :size="13" />
            <RouterLink v-if="characterEntity(p)" :to="{ name: 'entity', params: { wid: campaign.worldId!, eid: p.characterId! } }">{{ characterEntity(p)!.name }}</RouterLink>
            <span v-else-if="p.characterName">{{ p.characterName }}</span>
            <span v-else class="faint">{{ p.role === 'gm' ? 'ведёт игру' : 'персонаж не указан' }}</span>
            <span class="faint"> · с {{ formatDate(p.joinedAt).split(',')[0] }}</span>
          </div>
        </div>
        <button v-if="isGm || p.uid === uid" class="icon-btn" title="Персонаж" @click="editCharacter(p)"><Icon name="pencil" :size="15" /></button>
        <template v-if="isGm && p.uid !== campaign.ownerId">
          <button v-if="p.role === 'player'" class="icon-btn" title="Сделать мастером (со-ведущим)" @click="setRole(p, 'gm')"><Icon name="crown" :size="15" /></button>
          <button v-else class="icon-btn" title="Сделать игроком" @click="setRole(p, 'player')"><Icon name="user" :size="15" /></button>
          <button class="icon-btn" title="Убрать из кампейна" @click="remove(p)"><Icon name="user-x" :size="15" /></button>
        </template>
      </div>
    </section>

    <section v-if="isGm" class="card card-pad stack">
      <h3 class="panel-title" style="margin: 0"><Icon name="user-plus" /> Пригласить</h3>
      <p class="muted small" style="margin: 0">Человек открывает ссылку, входит через Google или почту и становится участником кампейна.</p>
      <div class="row gap wrap">
        <select v-model="inv.role" class="input" style="width: auto"><option value="player">Игроком</option><option value="gm">Мастером</option></select>
        <select v-model="inv.days" class="input" style="width: auto">
          <option :value="1">на сутки</option><option :value="7">на неделю</option><option :value="14">на 2 недели</option><option :value="30">на месяц</option><option :value="null">бессрочно</option>
        </select>
      </div>
      <label v-if="canInviteToWorld" class="check small"><input v-model="inv.withWorld" type="checkbox" /> Заодно пустить в мир «{{ campaign.worldName }}» ({{ inv.role === 'gm' ? 'мастером' : 'игроком' }})</label>
      <p v-else-if="campaign.worldId" class="faint small" style="margin: 0">Доступ к миру «{{ campaign.worldName }}» выдаёт его мастер в настройках мира.</p>
      <div><button class="btn btn-primary" :disabled="busy" @click="createInvite"><Icon name="link" :size="15" /> Создать ссылку</button></div>

      <div v-if="invites.length" class="stack-sm">
        <div class="section-title" style="margin: 6px 0 0">Действующие ссылки</div>
        <div v-for="i in invites" :key="i.code" class="inv-row">
          <div class="grow" style="min-width: 0">
            <div class="small"><b>{{ ROLE_LABELS[i.role] }}</b>{{ i.worldInviteCode ? ' + доступ к миру' : '' }}</div>
            <div class="faint small">{{ i.expiresAt ? 'до ' + formatDate(i.expiresAt) : 'бессрочно' }} · создана {{ relativeTime(i.createdAt) }}</div>
          </div>
          <button class="icon-btn" title="Скопировать ссылку" @click="copy(i)"><Icon name="copy" :size="15" /></button>
          <button class="icon-btn" title="Отозвать" @click="revoke(i)"><Icon name="trash2" :size="15" /></button>
        </div>
      </div>
    </section>

    <Modal v-if="editing" :title="'Персонаж: ' + editing.name" width="480px" @close="editing = null">
      <div class="stack">
        <div v-if="worldReady" class="field"><span>Статья персонажа в мире «{{ campaign.worldName }}»</span>
          <EntityPicker v-model="editing.characterId" :types="['character']" :allow-create="false" placeholder="Выберите персонажа…" />
        </div>
        <label class="field"><span>Имя персонажа</span><input v-model="editing.characterName" class="input" maxlength="120" placeholder="Аэлин Тарн" /></label>
        <p v-if="!worldReady && campaign.worldId" class="faint small" style="margin: 0">Чтобы связать со статьёй, нужен доступ к миру «{{ campaign.worldName }}».</p>
      </div>
      <template #footer>
        <button v-if="editing.characterId" class="btn btn-ghost" style="margin-right: auto" @click="editing.characterId = null">Отвязать статью</button>
        <button class="btn" @click="editing = null">Отмена</button>
        <button class="btn btn-primary" @click="saveCharacter">Сохранить</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.people-grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 18px; align-items: start; }
.person { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--border); }
.person:last-child { border-bottom: 0; }
.char { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 2px; }
.inv-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; }
@media (max-width: 960px) { .people-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
