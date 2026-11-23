<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import { formatDate, relativeTime } from '@/data/util'
import { characterIdsOf } from '@/data/access'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import MemberModal from './MemberModal.vue'
import JoinRequestRow from './JoinRequestRow.vue'
import { toast } from '@/components/common/toast'
import type { Ban, Invite, Member, Role } from '@/model/types'

const world = useWorld()
const router = useRouter()
const ROLE: Record<Role, string> = { owner: 'Владелец', master: 'Мастер', player: 'Игрок' }
const RANK: Record<Role, number> = { owner: 0, master: 1, player: 2 }
const q = ref('')
const roleFilter = ref<'' | Role>('')
const opened = ref<Member | null>(null)

const authoredBy = computed(() => {
  const m = new Map<string, number>()
  for (const e of world.entities.values()) if (!e.deleted) m.set(e.createdBy, (m.get(e.createdBy) ?? 0) + 1)
  return m
})
const members = computed(() => world.members
  .filter((m) => (!roleFilter.value || m.role === roleFilter.value) && (!q.value || `${m.displayName} ${m.email}`.toLowerCase().includes(q.value.toLowerCase())))
  .sort((a, b) => RANK[a.role] - RANK[b.role] || a.displayName.localeCompare(b.displayName, 'ru')))
const pending = computed(() => world.joinRequests.filter((r) => r.status === 'pending'))
const rejected = computed(() => world.joinRequests.filter((r) => r.status === 'rejected'))
const showRejected = ref(false)
const counts = computed(() => ({ owner: world.members.filter((m) => m.role === 'owner').length, master: world.members.filter((m) => m.role === 'master').length, player: world.members.filter((m) => m.role === 'player').length }))

// ---------- invites ----------
const invites = ref<Invite[]>([])
const stopInv = world.watchInvites((r) => (invites.value = r.sort((a, b) => b.createdAt - a.createdAt)))
const activeInvites = computed(() => invites.value.filter((i) => !i.expiresAt || i.expiresAt > Date.now()))
const invRole = ref<'player' | 'master'>('player')
const invDays = ref<number | null>(14)
const invNote = ref('')
function inviteUrl(code: string) { return `${location.origin}${location.pathname}#/join/${world.wid}/${code}` }
async function createInvite() {
  const code = await world.createInvite(invRole.value, invDays.value, invNote.value.trim())
  const copied = await navigator.clipboard?.writeText(inviteUrl(code)).then(() => true).catch(() => false)
  toast.success(copied ? 'Ссылка создана и скопирована' : 'Ссылка создана — скопируйте её из списка')
  invNote.value = ''
}
function copyInvite(code: string) { void navigator.clipboard?.writeText(inviteUrl(code)).then(() => toast.success('Скопировано')) }
const joinedBy = (code: string) => world.members.filter((m) => m.inviteCode === code).length

// ---------- bans ----------
const bans = ref<Ban[]>([])
const stopBans = world.watchBans((r) => (bans.value = r))
onBeforeUnmount(() => { stopInv(); stopBans() })

function quickRole(m: Member, r: Role) { void world.setMemberRole(m.uid, r).then(() => toast.success(`${m.displayName}: ${ROLE[r]}`)) }
function viewAs(m: Member) { world.startPreview({ uid: m.uid, name: m.displayName }); void router.push({ name: 'dashboard', params: { wid: world.wid! } }) }
</script>

<template>
  <div class="stack">
    <div class="stat-row">
      <span class="stat"><Icon name="crown" :size="17" style="color: var(--accent)" /> <b>{{ counts.owner }}</b> владелец</span>
      <span class="stat"><Icon name="shield" :size="17" style="color: var(--secret)" /> <b>{{ counts.master }}</b> мастеров</span>
      <span class="stat"><Icon name="users" :size="17" /> <b>{{ counts.player }}</b> игроков</span>
      <span class="stat"><Icon name="mail" :size="17" /> <b>{{ activeInvites.length }}</b> активных приглашений</span>
      <span v-if="bans.length" class="stat"><Icon name="lock" :size="17" /> <b>{{ bans.length }}</b> заблокировано</span>
    </div>

    <section v-if="world.joinRequests.length" class="card card-pad requests" :class="{ hot: pending.length }">
      <div class="row gap" style="margin-bottom: 4px">
        <h3 class="panel-title grow" style="margin: 0"><Icon name="mail" /> Заявки на вступление <span v-if="pending.length" class="count-pill">{{ pending.length }}</span></h3>
        <button v-if="rejected.length" class="btn btn-sm btn-ghost" @click="showRejected = !showRejected">{{ showRejected ? 'Скрыть' : 'Показать' }} отклонённые ({{ rejected.length }})</button>
      </div>
      <p v-if="!pending.length && !showRejected" class="faint small" style="margin: 0">Новых заявок нет.</p>
      <JoinRequestRow v-for="r in pending" :key="r.uid" :wid="world.wid!" :request="r" :can-master="world.isOwner" :world-name="world.world?.name" />
      <template v-if="showRejected">
        <JoinRequestRow v-for="r in rejected" :key="r.uid" :wid="world.wid!" :request="r" :can-master="world.isOwner" :world-name="world.world?.name" />
      </template>
      <p class="faint small" style="margin: 6px 0 0">Заявку присылает вошедший пользователь, открывший ссылку на мир. Принятый сразу видит статьи для участников — страницу обновлять не нужно.</p>
    </section>

    <section class="card card-pad">
      <div class="row gap wrap" style="margin-bottom: 10px">
        <h3 class="panel-title grow" style="margin: 0"><Icon name="users" /> Участники</h3>
        <input v-model="q" class="input input-sm" style="max-width: 220px" placeholder="Имя или почта…" />
        <select v-model="roleFilter" class="input input-sm" style="width: auto"><option value="">Все роли</option><option value="owner">Владелец</option><option value="master">Мастера</option><option value="player">Игроки</option></select>
      </div>
      <div style="overflow-x: auto">
        <table class="table">
          <thead><tr><th>Участник</th><th>Роль</th><th>Персонажи</th><th>Статей</th><th>Был(а)</th><th>В мире с</th><th /></tr></thead>
          <tbody>
            <tr v-for="m in members" :key="m.uid">
              <td>
                <button class="member-btn" @click="opened = m">
                  <span class="avatar round" style="width: 32px; height: 32px"><img v-if="m.photoURL" :src="m.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="15" /></span>
                  <span><b>{{ m.displayName }}</b><span v-if="m.uid === world.uid" class="faint small"> (вы)</span><br /><span class="faint small">{{ m.email }}</span></span>
                </button>
              </td>
              <td>
                <select v-if="world.isOwner && m.role !== 'owner'" class="input input-sm" style="width: auto" :value="m.role" @change="quickRole(m, ($event.target as HTMLSelectElement).value as Role)">
                  <option value="master">Мастер</option><option value="player">Игрок</option>
                </select>
                <span v-else class="badge" :class="{ 'badge-public': m.role === 'owner', 'badge-secret': m.role === 'master' }">{{ ROLE[m.role] }}</span>
                <div v-if="m.createTypes?.length" class="faint small">+ права: {{ m.createTypes.length }}</div>
              </td>
              <td><div v-if="characterIdsOf(m).length" class="stack-sm"><EntityLink v-for="id in characterIdsOf(m)" :key="id" :id="id" avatar /></div><span v-else class="faint">—</span></td>
              <td>{{ authoredBy.get(m.uid) ?? 0 }}</td>
              <td class="faint small nowrap">{{ m.lastSeenAt ? relativeTime(m.lastSeenAt) : '—' }}</td>
              <td class="faint small nowrap">{{ formatDate(m.joinedAt).split(',')[0] }}</td>
              <td class="nowrap">
                <button class="btn btn-sm" @click="opened = m"><Icon name="shield" :size="14" /> Права</button>
                <Dropdown v-if="m.role === 'player'" placement="bottom-end">
                  <template #trigger><button class="icon-btn" title="Ещё"><Icon name="more-horizontal" /></button></template>
                  <div class="menu"><button class="menu-item" @click="viewAs(m)"><Icon name="eye" :size="15" /> Глазами этого игрока</button></div>
                </Dropdown>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <details class="small muted roles-help">
        <summary>Что может каждая роль</summary>
        <ul>
          <li><b>Владелец</b> — всё, что мастер, плюс роли участников, передача владения и удаление мира.</li>
          <li><b>Мастер</b> — видит и правит всё: статьи, секреты, настройки, приглашения; исключает игроков.</li>
          <li><b>Игрок</b> — видит статьи «всем» и «участникам», а также открытые лично ему; создаёт разрешённые разделы, правит свои статьи и те, где он указан редактором; добавляет свои заметки (если включено).</li>
        </ul>
      </details>
    </section>

    <section class="card card-pad stack">
      <h3 class="panel-title" style="margin: 0"><Icon name="user-plus" /> Приглашения</h3>
      <div class="row gap wrap">
        <select v-model="invRole" class="input" style="width: auto"><option value="player">Игроком</option><option value="master">Мастером</option></select>
        <select v-model="invDays" class="input" style="width: auto"><option :value="1">на 1 день</option><option :value="7">на неделю</option><option :value="14">на 2 недели</option><option :value="30">на месяц</option><option :value="null">бессрочно</option></select>
        <input v-model="invNote" class="input grow" placeholder="Для кого (заметка)" />
        <button class="btn btn-primary" @click="createInvite"><Icon name="link" :size="15" /> Создать ссылку</button>
      </div>
      <div v-for="i in invites" :key="i.code" class="rel-row" :class="{ expired: i.expiresAt && i.expiresAt < Date.now() }">
        <Icon name="mail" :size="15" />
        <span class="nowrap"><b>{{ i.role === 'master' ? 'Мастер' : 'Игрок' }}</b> {{ i.note }} <span class="faint small">· {{ i.expiresAt ? (i.expiresAt < Date.now() ? 'истекло' : 'до ' + formatDate(i.expiresAt)) : 'бессрочно' }} · вступило: {{ joinedBy(i.code) }}</span></span>
        <input class="input input-sm grow invite-url" readonly :value="inviteUrl(i.code)" @focus="($event.target as HTMLInputElement).select()" />
        <button class="btn btn-sm" @click="copyInvite(i.code)"><Icon name="copy" :size="13" /></button>
        <button class="icon-btn danger" title="Отозвать" @click="world.deleteInvite(i.code)"><Icon name="trash2" :size="15" /></button>
      </div>
      <p class="faint small" style="margin: 0">Человек открывает ссылку, входит через Google или почту и становится участником. Отзовите ссылку, когда все присоединились.</p>
    </section>

    <section v-if="bans.length" class="card card-pad stack-sm">
      <h3 class="panel-title" style="margin: 0"><Icon name="lock" /> Заблокированные</h3>
      <div v-for="b in bans" :key="b.uid" class="rel-row">
        <span class="grow"><b>{{ b.displayName }}</b> <span class="faint small">{{ b.email }} · {{ formatDate(b.at) }}</span></span>
        <button class="btn btn-sm" @click="world.unban(b.uid).then(() => toast.success('Блокировка снята'))">Разблокировать</button>
      </div>
    </section>

    <MemberModal v-if="opened" :member="opened" @close="opened = null" />
  </div>
</template>

<style scoped>
.member-btn { display: flex; align-items: center; gap: 10px; border: 0; background: none; padding: 0; cursor: pointer; text-align: left; color: var(--text); }
.member-btn:hover b { color: var(--accent); }
.expired { opacity: .55; }
.requests.hot { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
.count-pill { display: inline-flex; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--danger); color: #fff; font-size: 12px; align-items: center; justify-content: center; margin-left: 4px; }
.roles-help { margin-top: 12px; }
.roles-help ul { margin: 6px 0 0; padding-left: 18px; }
</style>
