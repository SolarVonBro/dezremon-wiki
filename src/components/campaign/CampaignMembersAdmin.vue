<script setup lang="ts">
// Settings → the campaign's players: members of the world are added here (or in the member's card in the world's
// «Участники и права»), made co-GMs or removed; people outside the world come in by an invite link.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useSession } from '@/stores/session'
import { useWorld } from '@/stores/world'
import {
  ROLE_LABELS, addParticipants, createCampaignInvite, deleteCampaignInvite, inviteUrl, removeParticipant, setParticipantRole, watchCampaignInvites,
} from '@/data/campaigns'
import { characterIdsOf } from '@/data/access'
import { formatDate, relativeTime, errorText } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import MemberPicker from '@/components/common/MemberPicker.vue'
import { toast } from '@/components/common/toast'
import type { Campaign, CampaignInvite, CampaignParticipant, CampaignRole } from '@/model/types'

const props = defineProps<{ campaign: Campaign; participants: CampaignParticipant[] }>()
const session = useSession()
const world = useWorld()
const uid = computed(() => world.uid ?? '')
const busy = ref(false)

async function run(fn: () => Promise<unknown>, ok?: string) {
  busy.value = true
  try { await fn(); if (ok) toast.success(ok) } catch (e: any) { toast.error('Не удалось: ' + errorText(e)) } finally { busy.value = false }
}

// ---------- players ----------
const inCampaign = computed(() => props.participants.map((p) => p.uid))
const people = computed(() => [...props.participants].sort((a, b) => (a.role === b.role ? a.displayName.localeCompare(b.displayName, 'ru') : a.role === 'gm' ? -1 : 1)))
const adding = ref<string | null>(null)
function add(u: string) {
  adding.value = null
  const m = world.members.find((x) => x.uid === u)
  if (!m || inCampaign.value.includes(u)) return
  // the characters the member plays in the world become his current ones in the campaign when they carry its tag
  const tagged = characterIdsOf(m).filter((id) => props.campaign.tagId && world.getAny(id)?.tagIds?.includes(props.campaign.tagId))
  void run(() => addParticipants(props.campaign.id, [{ uid: m.uid, displayName: m.displayName, photoURL: m.photoURL, characters: tagged }]), `${m.displayName} в кампейне`)
}
function setRole(p: CampaignParticipant, role: CampaignRole) { void run(() => setParticipantRole(props.campaign.id, p.uid, role)) }
function remove(p: CampaignParticipant) {
  if (!confirm(`Убрать «${p.displayName}» из кампейна? Участником мира он останется.`)) return
  void run(() => removeParticipant(props.campaign.id, p.uid), `${p.displayName} больше не в кампейне`)
}

// ---------- invites (people who are not in the world yet) ----------
const invites = ref<CampaignInvite[]>([])
let stop: (() => void) | null = null
watch(() => props.campaign.id, (cid) => {
  stop?.()
  stop = watchCampaignInvites(cid, (r) => { invites.value = r.filter((i) => !i.expiresAt || i.expiresAt > Date.now()) })
}, { immediate: true })
onBeforeUnmount(() => stop?.())
const inv = ref({ role: 'player' as CampaignRole, days: 14 as number | null })
async function createInvite() {
  if (!session.user) return
  await run(async () => {
    const code = await createCampaignInvite(props.campaign, session.user!.uid, inv.value.role, inv.value.days, world.isMaster)
    await navigator.clipboard.writeText(inviteUrl(props.campaign.id, code)).catch(() => {})
  }, 'Ссылка создана и скопирована')
}
function copy(i: CampaignInvite) {
  void navigator.clipboard.writeText(inviteUrl(props.campaign.id, i.code)).then(() => toast.success('Ссылка скопирована'))
}
function revoke(i: CampaignInvite) { void run(() => deleteCampaignInvite(props.campaign, i)) }
</script>

<template>
  <div class="cma-grid">
    <section class="card card-pad stack-sm">
      <h3 class="panel-title" style="margin: 0"><Icon name="users" /> Игроки кампейна</h3>
      <div v-for="p in people" :key="p.uid" class="rel-row cma-row">
        <span class="avatar round" style="width: 28px; height: 28px"><img v-if="p.photoURL" :src="p.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="14" /></span>
        <span class="grow" style="min-width: 0"><b>{{ p.displayName }}</b> <span class="badge" :class="{ 'badge-public': p.role === 'gm' }">{{ ROLE_LABELS[p.role] }}</span>
          <span v-if="p.uid === campaign.ownerId" class="badge">создатель</span><span v-if="p.uid === uid" class="faint small"> (вы)</span></span>
        <template v-if="p.uid !== campaign.ownerId">
          <button v-if="p.role === 'player'" class="icon-btn" title="Сделать мастером (со-ведущим)" :disabled="busy" @click="setRole(p, 'gm')"><Icon name="crown" :size="15" /></button>
          <button v-else class="icon-btn" title="Сделать игроком" :disabled="busy" @click="setRole(p, 'player')"><Icon name="user" :size="15" /></button>
          <button class="icon-btn" title="Убрать из кампейна" :disabled="busy" @click="remove(p)"><Icon name="user-x" :size="15" /></button>
        </template>
      </div>
      <div class="field" style="margin-top: 6px"><span>Добавить участника мира</span>
        <MemberPicker :model-value="adding" :exclude="inCampaign" label="Добавить в кампейн" placeholder="Выберите участника мира…" @update:model-value="add" />
      </div>
      <span class="faint small">Добавлять игроков можно и в мире: «Участники и права» → карточка участника → «Кампейны». Персонажи участника с тегом кампейна сразу станут его текущими.</span>
    </section>

    <section class="card card-pad stack-sm">
      <h3 class="panel-title" style="margin: 0"><Icon name="user-plus" /> Пригласить по ссылке</h3>
      <p class="muted small" style="margin: 0">Для тех, кого ещё нет в мире: по ссылке человек войдёт в кампейн{{ world.isMaster ? ` и в мир «${campaign.worldName}»` : '' }}.</p>
      <div class="row gap wrap">
        <select v-model="inv.role" class="input" style="width: auto"><option value="player">Игроком</option><option value="gm">Мастером</option></select>
        <select v-model="inv.days" class="input" style="width: auto">
          <option :value="1">на сутки</option><option :value="7">на неделю</option><option :value="14">на 2 недели</option><option :value="30">на месяц</option><option :value="null">бессрочно</option>
        </select>
        <button class="btn btn-primary" :disabled="busy" @click="createInvite"><Icon name="link" :size="15" /> Создать ссылку</button>
      </div>
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
  </div>
</template>

<style scoped>
.cma-grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 18px; align-items: start; }
.cma-row { gap: 10px; }
.inv-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 8px; }
@media (max-width: 960px) { .cma-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
