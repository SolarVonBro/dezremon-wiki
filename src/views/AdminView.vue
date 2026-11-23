<script setup lang="ts">
// Service admin panel: every user, world, campaign and music room of the project, plus resources and settings.
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import {
  isServiceAdmin, listUsers, listWorlds, listWorldMemberships, listAllCampaigns, listAllRooms, listServiceBans,
  banUser, unbanUser, deleteWorldById, deleteCampaignTree, deleteRoomTree, deleteUserProfile, readServiceConfig, saveServiceConfig,
} from '@/data/admin'
import { readProjectUsage, formatBytes, type WorldUsageRow } from '@/data/usage'
import { STATUS_LABELS } from '@/data/campaigns'
import { relativeTime, formatDate, plural, errorText } from '@/data/util'
import { firebaseConfig } from '@/firebaseConfig'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import Modal from '@/components/common/Modal.vue'
import { toast } from '@/components/common/toast'
import type { Campaign, Member, Room, ServiceBan, ServiceConfig, UserProfile, World } from '@/model/types'

const AdminUsage = defineAsyncComponent(() => import('@/components/admin/AdminUsage.vue'))

const route = useRoute()
const router = useRouter()
const hasRooms = router.hasRoute('room')
const session = useSession()
const admin = computed(() => isServiceAdmin(session.user?.uid))
type Tab = 'users' | 'worlds' | 'campaigns' | 'rooms' | 'usage' | 'service'
const tab = computed<Tab>(() => (route.params.tab as Tab) || 'users')
function setTab(t: Tab) { void router.replace({ name: 'admin', params: { tab: t === 'users' ? undefined : t } }) }

const users = ref<UserProfile[]>([])
const worlds = ref<World[]>([])
const memberships = ref<Array<{ wid: string; member: Member }>>([])
const campaigns = ref<Campaign[]>([])
const rooms = ref<Room[]>([])
const bans = ref<ServiceBan[]>([])
const usage = ref<WorldUsageRow[]>([])
const loading = ref(false)
const loadedAt = ref(0)

async function load() {
  loading.value = true
  try {
    const [u, w, m, c, r, b, us] = await Promise.all([listUsers(), listWorlds(), listWorldMemberships(), listAllCampaigns(), listAllRooms(), listServiceBans(), readProjectUsage().catch(() => [])])
    users.value = u.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0)); worlds.value = w.sort((a, b) => b.updatedAt - a.updatedAt)
    memberships.value = m; campaigns.value = c.sort((a, b) => b.updatedAt - a.updatedAt); rooms.value = r.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    bans.value = b; usage.value = us
    loadedAt.value = Date.now()
  } catch (e: any) { toast.error('Не удалось загрузить данные: ' + errorText(e)) } finally { loading.value = false }
}
watch(() => [session.ready, admin.value] as const, ([ready, a]) => {
  if (ready && !session.user) { void router.replace({ name: 'login', query: { next: route.fullPath } }); return }
  if (a && !loadedAt.value) void load()
}, { immediate: true })

const userMap = computed(() => new Map(users.value.map((u) => [u.uid, u])))
const banMap = computed(() => new Map(bans.value.map((b) => [b.uid, b])))
const worldMap = computed(() => new Map(worlds.value.map((w) => [w.id, w])))
const nameOf = (uid: string) => userMap.value.get(uid)?.displayName || uid.slice(0, 8)
const membersOf = (wid: string) => memberships.value.filter((m) => m.wid === wid)
const worldsOf = (uid: string) => memberships.value.filter((m) => m.member.uid === uid).map((m) => ({ world: worldMap.value.get(m.wid), role: m.member.role })).filter((x) => x.world)
const campaignsOf = (uid: string) => campaigns.value.filter((c) => c.memberUids.includes(uid))
const sizeOf = (wid: string) => { const r = usage.value.find((x) => x.id === wid); return r?.at ? formatBytes(r.bytes) : '—' }

// ---------- users ----------
const q = ref('')
const filter = ref<'all' | 'banned' | 'active30'>('all')
const shownUsers = computed(() => {
  const s = q.value.trim().toLowerCase()
  return users.value.filter((u) => (!s || u.displayName.toLowerCase().includes(s) || u.email.toLowerCase().includes(s) || u.uid.toLowerCase().includes(s))
    && (filter.value !== 'banned' || banMap.value.has(u.uid))
    && (filter.value !== 'active30' || (u.lastSeen ?? 0) > Date.now() - 30 * 86400000))
})
const openUser = ref<string | null>(null)
async function ban(u: UserProfile) {
  const reason = prompt(`Заблокировать «${u.displayName || u.email}»? Он не сможет создавать миры, игры и комнаты и вступать в новые. Причина (видна пользователю):`, '')
  if (reason === null) return
  await banUser(u.uid, reason.trim(), session.user!.uid)
  bans.value = await listServiceBans()
  toast.success('Пользователь заблокирован')
}
async function unban(u: UserProfile) {
  await unbanUser(u.uid)
  bans.value = await listServiceBans()
  toast.success('Блокировка снята')
}
async function removeProfile(u: UserProfile) {
  if (!confirm(`Удалить профиль «${u.displayName || u.email}» из базы? Сам аккаунт входа удаляется в консоли Firebase (Authentication). Миры и игры пользователя останутся.`)) return
  await deleteUserProfile(u.uid)
  users.value = users.value.filter((x) => x.uid !== u.uid)
}
const consoleAuth = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/users`

// ---------- deleting worlds / campaigns / rooms ----------
const deleting = ref<{ kind: 'world' | 'campaign' | 'room'; id: string; name: string } | null>(null)
const confirmText = ref('')
const delBusy = ref('')
async function doDelete() {
  const d = deleting.value
  if (!d || confirmText.value.trim() !== d.name) return
  delBusy.value = 'начинаю…'
  try {
    if (d.kind === 'world') {
      await deleteWorldById(d.id, (n, what) => { delBusy.value = `${what}: ${n}` })
      worlds.value = worlds.value.filter((w) => w.id !== d.id)
      memberships.value = memberships.value.filter((m) => m.wid !== d.id)
    } else if (d.kind === 'campaign') {
      await deleteCampaignTree(d.id)
      campaigns.value = campaigns.value.filter((c) => c.id !== d.id)
    } else {
      await deleteRoomTree(d.id)
      rooms.value = rooms.value.filter((r) => r.id !== d.id)
    }
    toast.success('Удалено')
    deleting.value = null
    confirmText.value = ''
  } catch (e: any) { toast.error('Не удалось удалить: ' + errorText(e)) } finally { delBusy.value = '' }
}

// ---------- service settings ----------
const config = ref<ServiceConfig | null>(null)
watch(tab, async (t) => { if (t === 'service' && !config.value && admin.value) config.value = await readServiceConfig() }, { immediate: true })
async function saveConfig() {
  if (!config.value) return
  try { await saveServiceConfig({ youtubeApiKey: config.value.youtubeApiKey.trim() }); toast.success('Сохранено') } catch (e: any) { toast.error(errorText(e)) }
}
const ROLE: Record<string, string> = { owner: 'владелец', master: 'мастер', player: 'игрок' }
</script>

<template>
  <div class="page">
    <div v-if="!session.ready" class="empty"><Icon name="refresh-cw" class="spin" :size="24" /></div>
    <div v-else-if="!admin" class="card empty" style="max-width: 520px; margin: 40px auto">
      <Icon name="lock" :size="34" />
      <h2>Только для администратора сервиса</h2>
      <RouterLink class="btn" :to="{ name: 'worlds' }">К мирам</RouterLink>
    </div>
    <template v-else>
      <div class="row gap wrap" style="margin-bottom: 12px">
        <h1 class="grow" style="margin: 0"><Icon name="shield-check" :size="30" /> Админка сервиса</h1>
        <span v-if="loadedAt" class="faint small">данные на {{ formatDate(loadedAt).split(', ')[1] }}</span>
        <button class="btn btn-sm" :disabled="loading" @click="load"><Icon name="refresh-cw" :size="14" :class="{ spin: loading }" /> Обновить</button>
      </div>
      <div class="stat-row" style="margin-bottom: 14px">
        <span class="stat"><Icon name="users" :size="16" /> <b>{{ users.length }}</b> пользователей</span>
        <span class="stat"><Icon name="globe" :size="16" /> <b>{{ worlds.length }}</b> миров</span>
        <span class="stat"><Icon name="swords" :size="16" /> <b>{{ campaigns.length }}</b> игр</span>
        <span class="stat"><Icon name="headphones" :size="16" /> <b>{{ rooms.length }}</b> комнат</span>
        <span v-if="bans.length" class="stat"><Icon name="ban" :size="16" /> <b>{{ bans.length }}</b> заблокировано</span>
      </div>

      <div class="tabs">
        <button class="tab" :class="{ on: tab === 'users' }" @click="setTab('users')"><Icon name="users" :size="16" /> Пользователи</button>
        <button class="tab" :class="{ on: tab === 'worlds' }" @click="setTab('worlds')"><Icon name="globe" :size="16" /> Миры</button>
        <button class="tab" :class="{ on: tab === 'campaigns' }" @click="setTab('campaigns')"><Icon name="swords" :size="16" /> Игры</button>
        <button class="tab" :class="{ on: tab === 'rooms' }" @click="setTab('rooms')"><Icon name="headphones" :size="16" /> Комнаты</button>
        <button class="tab" :class="{ on: tab === 'usage' }" @click="setTab('usage')"><Icon name="database" :size="16" /> Ресурсы</button>
        <button class="tab" :class="{ on: tab === 'service' }" @click="setTab('service')"><Icon name="server-cog" :size="16" /> Сервис</button>
      </div>

      <!-- ============ users ============ -->
      <section v-if="tab === 'users'" class="card card-pad stack">
        <div class="row gap wrap">
          <input v-model="q" class="input" style="max-width: 320px" placeholder="Имя, почта или uid…" />
          <select v-model="filter" class="input" style="width: auto">
            <option value="all">Все</option><option value="active30">Заходили за 30 дней</option><option value="banned">Заблокированные</option>
          </select>
          <span class="grow" />
          <a class="btn btn-sm btn-ghost" :href="consoleAuth" target="_blank" rel="noopener"><Icon name="external-link" :size="14" /> Аккаунты входа (Firebase)</a>
        </div>
        <p class="faint small" style="margin: 0">Список строится по профилям, которые пишутся при каждом входе. Удалить сам аккаунт входа или сменить его пароль можно только в консоли Firebase.</p>
        <div v-for="u in shownUsers" :key="u.uid" class="urow" :class="{ banned: banMap.has(u.uid) }">
          <div class="row gap" style="cursor: pointer" @click="openUser = openUser === u.uid ? null : u.uid">
            <span class="avatar round" style="width: 36px; height: 36px"><img v-if="u.photoURL" :src="u.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="17" /></span>
            <div class="grow" style="min-width: 0">
              <div class="row gap-sm wrap"><b class="ellipsis">{{ u.displayName || '(без имени)' }}</b>
                <span v-if="isServiceAdmin(u.uid)" class="badge badge-public">админ</span>
                <span v-if="banMap.has(u.uid)" class="badge badge-dead" :title="banMap.get(u.uid)!.reason">заблокирован</span>
              </div>
              <div class="faint small ellipsis">{{ u.email || 'без почты' }} · был {{ u.lastSeen ? relativeTime(u.lastSeen) : 'давно' }}</div>
            </div>
            <span class="muted small nowrap hide-sm"><Icon name="globe" :size="13" /> {{ worldsOf(u.uid).length }} · <Icon name="swords" :size="13" /> {{ campaignsOf(u.uid).length }}</span>
            <span @click.stop><Dropdown placement="bottom-end">
              <template #trigger><button class="icon-btn" title="Действия"><Icon name="more-horizontal" /></button></template>
              <div class="menu">
                <button v-if="!banMap.has(u.uid)" class="menu-item" :disabled="isServiceAdmin(u.uid)" @click="ban(u)"><Icon name="ban" :size="15" /> Заблокировать</button>
                <button v-else class="menu-item" @click="unban(u)"><Icon name="user-check" :size="15" /> Снять блокировку</button>
                <button class="menu-item" @click="openUser = u.uid"><Icon name="globe" :size="15" /> Миры и игры</button>
                <div class="menu-sep" />
                <button class="menu-item danger" :disabled="isServiceAdmin(u.uid)" @click="removeProfile(u)"><Icon name="trash2" :size="15" /> Удалить профиль</button>
              </div>
            </Dropdown></span>
          </div>
          <div v-if="openUser === u.uid" class="udetail small">
            <div class="faint">uid: <code>{{ u.uid }}</code><template v-if="banMap.get(u.uid)"> · заблокирован {{ formatDate(banMap.get(u.uid)!.createdAt) }}{{ banMap.get(u.uid)!.reason ? ': ' + banMap.get(u.uid)!.reason : '' }}</template></div>
            <div><b>Миры:</b>
              <template v-if="worldsOf(u.uid).length"><span v-for="x in worldsOf(u.uid)" :key="x.world!.id" class="chip-link"><RouterLink :to="{ name: 'dashboard', params: { wid: x.world!.id } }">{{ x.world!.name }}</RouterLink> <span class="faint">({{ ROLE[x.role] }})</span></span></template>
              <span v-else class="faint"> нет</span>
            </div>
            <div><b>Игры:</b>
              <template v-if="campaignsOf(u.uid).length"><span v-for="c in campaignsOf(u.uid)" :key="c.id" class="chip-link"><RouterLink :to="{ name: 'campaign', params: { cid: c.id } }">{{ c.name }}</RouterLink> <span class="faint">({{ c.gmUids.includes(u.uid) ? 'мастер' : 'игрок' }})</span></span></template>
              <span v-else class="faint"> нет</span>
            </div>
          </div>
        </div>
        <div v-if="!shownUsers.length" class="empty">Никого не нашлось.</div>
      </section>

      <!-- ============ worlds ============ -->
      <section v-else-if="tab === 'worlds'" class="card card-pad">
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Мир</th><th>Владелец</th><th>Участники</th><th>Доступ</th><th style="text-align: right">Объём</th><th>Изменён</th><th /></tr></thead>
            <tbody>
              <tr v-for="w in worlds" :key="w.id">
                <td><RouterLink :to="{ name: 'dashboard', params: { wid: w.id } }"><b>{{ w.name }}</b></RouterLink></td>
                <td class="small">{{ nameOf(w.ownerId) }}</td>
                <td class="small">{{ membersOf(w.id).length }}</td>
                <td><span class="badge" :class="{ 'badge-public': w.isPublic }">{{ w.isPublic ? 'открытый' : 'закрытый' }}</span></td>
                <td class="nowrap" style="text-align: right">{{ sizeOf(w.id) }}</td>
                <td class="faint small nowrap">{{ relativeTime(w.updatedAt) }}</td>
                <td class="nowrap">
                  <RouterLink class="icon-btn" title="Настройки мира" :to="{ name: 'settings', params: { wid: w.id, tab: 'members' } }"><Icon name="settings" :size="15" /></RouterLink>
                  <button class="icon-btn" title="Удалить мир" @click="deleting = { kind: 'world', id: w.id, name: w.name }; confirmText = ''"><Icon name="trash2" :size="15" /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!worlds.length" class="empty">Миров нет.</div>
      </section>

      <!-- ============ campaigns ============ -->
      <section v-else-if="tab === 'campaigns'" class="card card-pad">
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Игра</th><th>Создатель</th><th>Мир</th><th>Участники</th><th>Статус</th><th>Изменён</th><th /></tr></thead>
            <tbody>
              <tr v-for="c in campaigns" :key="c.id">
                <td><RouterLink :to="{ name: 'campaign', params: { cid: c.id } }"><b>{{ c.name }}</b></RouterLink></td>
                <td class="small">{{ nameOf(c.ownerId) }}</td>
                <td class="small"><RouterLink v-if="c.worldId && worldMap.get(c.worldId)" :to="{ name: 'dashboard', params: { wid: c.worldId } }">{{ c.worldName }}</RouterLink><span v-else class="faint">{{ c.worldName || '—' }}</span></td>
                <td class="small">{{ c.memberUids.length }}</td>
                <td><span class="badge">{{ STATUS_LABELS[c.status] }}</span></td>
                <td class="faint small nowrap">{{ relativeTime(c.updatedAt) }}</td>
                <td><button class="icon-btn" title="Удалить игру" @click="deleting = { kind: 'campaign', id: c.id, name: c.name }; confirmText = ''"><Icon name="trash2" :size="15" /></button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!campaigns.length" class="empty">Игр нет.</div>
      </section>

      <!-- ============ rooms ============ -->
      <section v-else-if="tab === 'rooms'" class="card card-pad">
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Комната</th><th>Владелец</th><th>Игра</th><th>Заходили</th><th>Активность</th><th /></tr></thead>
            <tbody>
              <tr v-for="r in rooms" :key="r.id">
                <td><RouterLink v-if="hasRooms" :to="{ name: 'room', params: { rid: r.id } }"><b>{{ r.name }}</b></RouterLink><b v-else>{{ r.name }}</b></td>
                <td class="small">{{ nameOf(r.ownerId) }}</td>
                <td class="small">{{ r.campaignName || '—' }}</td>
                <td class="small">{{ r.memberUids.length }} {{ plural(r.memberUids.length, 'человек', 'человека', 'человек') }}</td>
                <td class="faint small nowrap">{{ relativeTime(r.lastActiveAt) }}</td>
                <td><button class="icon-btn" title="Удалить комнату" @click="deleting = { kind: 'room', id: r.id, name: r.name }; confirmText = ''"><Icon name="trash2" :size="15" /></button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!rooms.length" class="empty">Комнат нет.</div>
      </section>

      <AdminUsage v-else-if="tab === 'usage'" :worlds="worlds" :users="userMap" />

      <!-- ============ service ============ -->
      <section v-else-if="tab === 'service'" class="card card-pad stack" style="max-width: 760px">
        <h3 class="panel-title" style="margin: 0"><Icon name="headphones" /> Поиск YouTube в музыкальных комнатах</h3>
        <p class="muted small" style="margin: 0">
          Добавлять музыку по ссылке можно всегда. Для поиска по YouTube прямо в комнате нужен ключ YouTube Data API v3
          (бесплатно, 10 000 единиц в сутки — около 100 поисков). Создайте ключ в Google Cloud Console проекта
          «{{ firebaseConfig.projectId }}», включите для него YouTube Data API v3 и ограничьте по HTTP-referrer адресом сайта.
        </p>
        <div v-if="!config" class="empty"><Icon name="refresh-cw" class="spin" /></div>
        <template v-else>
          <label class="field"><span>Ключ YouTube Data API</span><input v-model="config.youtubeApiKey" class="input" placeholder="AIza…" autocomplete="off" /></label>
          <div><button class="btn btn-primary" @click="saveConfig"><Icon name="check" :size="15" /> Сохранить</button></div>
        </template>
      </section>
    </template>

    <Modal v-if="deleting" :title="'Удалить: ' + deleting.name" width="480px" @close="deleting = null">
      <div class="stack">
        <p v-if="deleting.kind === 'world'">Мир удалится со всеми статьями, картинками, участниками и приглашениями, а вместе с ним — его игры. Это нельзя отменить.</p>
        <p v-else-if="deleting.kind === 'campaign'">Игра удалится с журналом, участниками и приглашениями. Мир не затрагивается.</p>
        <p v-else>Комната удалится с дорожками, очередью и чатом.</p>
        <label class="field"><span>Введите название, чтобы подтвердить</span><input v-model="confirmText" class="input" :placeholder="deleting.name" /></label>
        <div v-if="delBusy" class="small muted"><Icon name="refresh-cw" class="spin" :size="13" /> {{ delBusy }}</div>
      </div>
      <template #footer>
        <button class="btn" @click="deleting = null">Отмена</button>
        <button class="btn btn-danger" :disabled="!!delBusy || confirmText.trim() !== deleting.name" @click="doDelete"><Icon name="trash2" :size="14" /> Удалить навсегда</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.page { max-width: 1180px; margin: 0 auto; padding: 22px 24px 60px; }
.urow { border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; }
.urow.banned { border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); background: color-mix(in srgb, var(--danger) 5%, var(--surface)); }
.udetail { display: flex; flex-direction: column; gap: 4px; padding: 8px 2px 2px 46px; }
.chip-link { display: inline-block; margin: 0 8px 0 4px; }
@media (max-width: 720px) {
  .page { padding: 16px 14px 50px; }
  .udetail { padding-left: 2px; }
}
</style>
