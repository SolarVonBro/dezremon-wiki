<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCountFromServer } from 'firebase/firestore'
import { useSession, authErrorText, TEXT_SIZES, type ThemeMode, type TextSize } from '@/stores/session'
import { createWorld, myWorlds, leaveWorldById, type MyWorld } from '@/stores/world'
import { coll } from '@/data/access'
import { cancelJoinRequest, myJoinRequests, pendingRequests } from '@/data/joinRequests'
import JoinRequestRow from '@/components/admin/JoinRequestRow.vue'
import { formatDate, relativeTime, plural } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import Modal from '@/components/common/Modal.vue'
import WorldImage from '@/components/common/WorldImage.vue'
import { toast } from '@/components/common/toast'
import type { JoinRequest, Role } from '@/model/types'

const session = useSession()
const route = useRoute()
const router = useRouter()
type Tab = 'worlds' | 'requests' | 'profile' | 'security' | 'appearance'
const tab = computed<Tab>(() => (route.query.tab as Tab) || 'worlds')
function setTab(t: Tab) { void router.replace({ query: { tab: t === 'worlds' ? undefined : t } }) }

watch(() => [session.ready, session.user], () => {
  if (session.ready && !session.user) void router.replace({ name: 'login', query: { next: '/account' } })
}, { immediate: true })

// ---------- worlds ----------
const worlds = ref<MyWorld[]>([])
const loading = ref(true)
const memberCounts = ref<Record<string, number>>({})
async function loadWorlds() {
  if (!session.user) return
  loading.value = true
  try {
    worlds.value = await myWorlds(session.user.uid)
    for (const w of worlds.value) {
      void getCountFromServer(coll(w.id, 'members')).then((s) => { memberCounts.value = { ...memberCounts.value, [w.id]: s.data().count } }).catch(() => {})
    }
    void loadRequests()
  } catch (e: any) { toast.error('Не удалось загрузить миры: ' + (e?.message ?? e)) } finally { loading.value = false }
}

// ---------- join requests: incoming (worlds I run) and my own ----------
const incoming = ref<Array<{ wid: string; name: string; canMaster: boolean; rows: JoinRequest[] }>>([])
const mine = ref<Array<JoinRequest & { wid: string }>>([])
const reqLoading = ref(false)
async function loadRequests() {
  if (!session.user) return
  reqLoading.value = true
  try {
    const run = worlds.value.filter((w) => w.role === 'owner' || w.role === 'master')
    const res = await Promise.all(run.map((w) => pendingRequests(w.id).then((rows) => ({ wid: w.id, name: w.name, canMaster: w.role === 'owner', rows })).catch(() => ({ wid: w.id, name: w.name, canMaster: false, rows: [] as JoinRequest[] }))))
    incoming.value = res.filter((g) => g.rows.length)
    mine.value = await myJoinRequests(session.user.uid).catch(() => [])
  } finally { reqLoading.value = false }
}
const incomingCount = computed(() => incoming.value.reduce((n, g) => n + g.rows.length, 0))
const requestsOf = (wid: string) => incoming.value.find((g) => g.wid === wid)?.rows.length ?? 0
function requestUrl(r: JoinRequest & { wid: string }) { return `#${r.fromPath && r.fromPath !== '/' ? r.fromPath : `/w/${r.wid}`}` }
async function withdraw(r: JoinRequest & { wid: string }) {
  await cancelJoinRequest(r.wid, r.uid)
  toast.success(r.status === 'rejected' ? 'Заявка удалена' : 'Заявка отменена')
  mine.value = mine.value.filter((x) => x.wid !== r.wid)
}
watch(() => session.user?.uid, (u) => { if (u) void loadWorlds() }, { immediate: true })
const owned = computed(() => worlds.value.filter((w) => w.role === 'owner'))
const joined = computed(() => worlds.value.filter((w) => w.role !== 'owner'))
const ROLE: Record<Role, string> = { owner: 'Владелец', master: 'Мастер', player: 'Игрок' }

const creating = ref(false)
const newWorld = ref({ name: '', description: '', isPublic: false })
const createBusy = ref(false)
async function create() {
  if (!session.user || !newWorld.value.name.trim()) return
  createBusy.value = true
  try {
    const id = await createWorld(session.user, newWorld.value.name.trim(), newWorld.value.description.trim(), newWorld.value.isPublic)
    void router.push({ name: 'dashboard', params: { wid: id } })
  } catch (e: any) { toast.error('Не удалось создать мир: ' + (e?.message ?? e)) } finally { createBusy.value = false }
}
async function leave(w: MyWorld) {
  if (!confirm(`Выйти из мира «${w.name}»? Вернуться можно будет только по новому приглашению.`)) return
  await leaveWorldById(w.id, session.user!.uid)
  toast.success('Вы вышли из мира')
  await loadWorlds()
}

// ---------- profile ----------
const name = ref(session.user?.displayName ?? '')
watch(() => session.user?.displayName, (n) => { name.value = n ?? '' })
const nameBusy = ref(false)
async function saveName() {
  nameBusy.value = true
  try { await session.updateDisplayName(name.value); toast.success('Имя обновлено во всех мирах') } catch (e) { toast.error(authErrorText(e)) } finally { nameBusy.value = false }
}
const created = computed(() => (session.user?.metadata.creationTime ? new Date(session.user.metadata.creationTime).getTime() : 0))
const lastLogin = computed(() => (session.user?.metadata.lastSignInTime ? new Date(session.user.metadata.lastSignInTime).getTime() : 0))
const initials = computed(() => (session.user?.displayName || session.user?.email || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase())

// ---------- security ----------
const providers = computed(() => session.providers())
const hasPassword = computed(() => providers.value.includes('password'))
const hasGoogle = computed(() => providers.value.includes('google.com'))
const pw = ref({ current: '', next: '', next2: '' })
const secBusy = ref(false)
async function run(fn: () => Promise<void>, ok: string) {
  secBusy.value = true
  try { await fn(); toast.success(ok) } catch (e) { toast.error(authErrorText(e)) } finally { secBusy.value = false }
}
function changePw() {
  if (pw.value.next.length < 6) return toast.error('Пароль — минимум 6 символов')
  if (pw.value.next !== pw.value.next2) return toast.error('Пароли не совпадают')
  void run(async () => {
    if (hasPassword.value) await session.changePassword(pw.value.current, pw.value.next)
    else await session.addPassword(pw.value.next)
    pw.value = { current: '', next: '', next2: '' }
  }, hasPassword.value ? 'Пароль изменён' : 'Вход по паролю подключён')
}
const deleting = ref(false)
const delConfirm = ref('')
const delPassword = ref('')
async function deleteAccount() {
  secBusy.value = true
  try {
    await session.deleteAccount(hasPassword.value ? delPassword.value : undefined)
    toast.success('Аккаунт удалён')
    void router.replace('/')
  } catch (e) { toast.error(authErrorText(e)) } finally { secBusy.value = false }
}

// ---------- appearance ----------
const THEMES: Array<{ v: ThemeMode; label: string; bg: string; fg: string; accent: string }> = [
  { v: 'auto', label: 'Как в системе', bg: 'linear-gradient(135deg,#f4f1ea 50%,#14120f 50%)', fg: '#2a241c', accent: '#c9a227' },
  { v: 'dark', label: 'Тёмная', bg: '#14120f', fg: '#ebe3d3', accent: '#d4ad4a' },
  { v: 'light', label: 'Светлая', bg: '#f4f1ea', fg: '#2a241c', accent: '#9c7a1c' },
  { v: 'parchment', label: 'Пергамент', bg: '#e9dcc0', fg: '#33240f', accent: '#8b3a1c' },
]
</script>

<template>
  <div class="account">
    <div v-if="session.user" class="acc-wrap">
      <section class="acc-hero card">
        <span class="acc-avatar">
          <img v-if="session.user.photoURL" :src="session.user.photoURL" alt="" referrerpolicy="no-referrer" />
          <span v-else>{{ initials }}</span>
        </span>
        <div class="grow">
          <h1 style="margin: 0">{{ session.user.displayName || 'Без имени' }}</h1>
          <div class="muted">{{ session.user.email }}
            <span v-if="session.user.emailVerified" class="badge badge-public"><Icon name="check" :size="11" /> почта подтверждена</span>
            <span v-else-if="hasPassword" class="badge">почта не подтверждена</span>
          </div>
          <div class="faint small">С нами с {{ formatDate(created) }} · {{ owned.length }} {{ plural(owned.length, 'свой мир', 'своих мира', 'своих миров') }} · участвует в {{ joined.length }}</div>
        </div>
      </section>

      <div class="tabs">
        <button class="tab" :class="{ on: tab === 'worlds' }" @click="setTab('worlds')"><Icon name="globe" :size="16" /> Миры <span class="count">{{ worlds.length }}</span></button>
        <button class="tab" :class="{ on: tab === 'requests' }" @click="setTab('requests')"><Icon name="mail" :size="16" /> Заявки
          <span v-if="incomingCount" class="count" style="background: var(--danger); color: #fff">{{ incomingCount }}</span>
          <span v-else-if="mine.length" class="count">{{ mine.length }}</span>
        </button>
        <button class="tab" :class="{ on: tab === 'profile' }" @click="setTab('profile')"><Icon name="user" :size="16" /> Профиль</button>
        <button class="tab" :class="{ on: tab === 'security' }" @click="setTab('security')"><Icon name="key-round" :size="16" /> Вход и безопасность</button>
        <button class="tab" :class="{ on: tab === 'appearance' }" @click="setTab('appearance')"><Icon name="palette" :size="16" /> Оформление</button>
      </div>

      <!-- ============ worlds ============ -->
      <template v-if="tab === 'worlds'">
        <div v-if="loading" class="empty"><Icon name="refresh-cw" class="spin" :size="24" /></div>
        <template v-else>
          <div class="row gap" style="margin-bottom: 10px">
            <h2 class="grow" style="margin: 0">Мои миры</h2>
            <button class="btn btn-primary" @click="creating = true"><Icon name="plus" :size="16" /> Новый мир</button>
          </div>
          <div class="world-grid">
            <article v-for="w in owned" :key="w.id" class="wcard">
              <RouterLink class="wcard-img" :to="{ name: 'dashboard', params: { wid: w.id } }">
                <WorldImage :wid="w.id" :image-id="w.headerImageId || w.imageId" :uid="session.user.uid" :role="w.role"><Icon name="castle" :size="40" /></WorldImage>
              </RouterLink>
              <div class="wcard-body">
                <RouterLink class="wcard-name" :to="{ name: 'dashboard', params: { wid: w.id } }">{{ w.name }}</RouterLink>
                <p v-if="w.description" class="wcard-desc">{{ w.description }}</p>
                <div class="wcard-meta">
                  <span class="badge badge-public">{{ ROLE[w.role] }}</span>
                  <span class="badge">{{ w.isPublic ? 'открытый' : 'закрытый' }}</span>
                  <span v-if="memberCounts[w.id]" class="faint small"><Icon name="users" :size="12" /> {{ memberCounts[w.id] }}</span>
                  <span class="faint small">· {{ relativeTime(w.membership.lastSeenAt ?? w.updatedAt) }}</span>
                  <button v-if="requestsOf(w.id)" class="badge req-badge" @click="setTab('requests')"><Icon name="mail" :size="11" /> {{ requestsOf(w.id) }} {{ plural(requestsOf(w.id), 'заявка', 'заявки', 'заявок') }}</button>
                </div>
              </div>
              <div class="wcard-actions">
                <RouterLink class="btn btn-sm" :to="{ name: 'dashboard', params: { wid: w.id } }">Открыть</RouterLink>
                <RouterLink class="btn btn-sm btn-ghost" :to="{ name: 'settings', params: { wid: w.id, tab: 'members' } }"><Icon name="settings" :size="14" /> Управление</RouterLink>
              </div>
            </article>
            <button v-if="!owned.length" class="wcard wcard-new" @click="creating = true"><Icon name="plus" :size="30" /><span>Создать первый мир</span></button>
          </div>

          <h2 style="margin: 26px 0 10px">Миры, где я участвую</h2>
          <div v-if="!joined.length" class="card empty">Пока нет. Мастер может прислать вам ссылку-приглашение — откройте её, и мир появится здесь. Или откройте ссылку на открытый мир и нажмите «Попросить доступ».</div>
          <div class="world-grid">
            <article v-for="w in joined" :key="w.id" class="wcard">
              <RouterLink class="wcard-img" :to="{ name: 'dashboard', params: { wid: w.id } }">
                <WorldImage :wid="w.id" :image-id="w.headerImageId || w.imageId" :uid="session.user.uid" :role="w.role"><Icon name="castle" :size="40" /></WorldImage>
              </RouterLink>
              <div class="wcard-body">
                <RouterLink class="wcard-name" :to="{ name: 'dashboard', params: { wid: w.id } }">{{ w.name }}</RouterLink>
                <p v-if="w.description" class="wcard-desc">{{ w.description }}</p>
                <div class="wcard-meta">
                  <span class="badge" :class="{ 'badge-secret': w.role === 'master' }">{{ ROLE[w.role] }}</span>
                  <span v-if="memberCounts[w.id]" class="faint small"><Icon name="users" :size="12" /> {{ memberCounts[w.id] }}</span>
                  <span class="faint small">· с {{ formatDate(w.membership.joinedAt).split(',')[0] }}</span>
                </div>
              </div>
              <div class="wcard-actions">
                <RouterLink class="btn btn-sm" :to="{ name: 'dashboard', params: { wid: w.id } }">Открыть</RouterLink>
                <RouterLink v-if="w.membership.characterId" class="btn btn-sm btn-ghost" :to="{ name: 'entity', params: { wid: w.id, eid: w.membership.characterId } }"><Icon name="user" :size="14" /> Мой персонаж</RouterLink>
                <Dropdown placement="bottom-end">
                  <template #trigger><button class="icon-btn" title="Ещё"><Icon name="more-horizontal" /></button></template>
                  <div class="menu">
                    <RouterLink v-if="w.role === 'master'" class="menu-item" :to="{ name: 'settings', params: { wid: w.id } }"><Icon name="settings" :size="15" /> Настройки мира</RouterLink>
                    <button class="menu-item danger" @click="leave(w)"><Icon name="log-out" :size="15" /> Выйти из мира</button>
                  </div>
                </Dropdown>
              </div>
            </article>
          </div>
        </template>
      </template>

      <!-- ============ requests ============ -->
      <div v-else-if="tab === 'requests'" class="stack" style="max-width: 860px">
        <div class="row gap">
          <h2 class="grow" style="margin: 0">Заявки в мои миры</h2>
          <button class="btn btn-sm btn-ghost" :disabled="reqLoading" @click="loadRequests"><Icon name="refresh-cw" :size="14" :class="{ spin: reqLoading }" /> Обновить</button>
        </div>
        <div v-if="!incoming.length" class="card empty">Новых заявок нет. Когда кто-то откроет ваш мир и попросит доступ, заявка появится здесь и в настройках мира.</div>
        <section v-for="g in incoming" :key="g.wid" class="card card-pad">
          <div class="row gap" style="margin-bottom: 4px">
            <RouterLink class="grow" :to="{ name: 'settings', params: { wid: g.wid, tab: 'members' } }"><b>{{ g.name }}</b></RouterLink>
            <span class="faint small">{{ g.rows.length }} {{ plural(g.rows.length, 'заявка', 'заявки', 'заявок') }}</span>
          </div>
          <JoinRequestRow v-for="r in g.rows" :key="r.uid" :wid="g.wid" :request="r" :can-master="g.canMaster" :world-name="g.name" @done="loadRequests" />
        </section>

        <h2 style="margin: 16px 0 0">Мои заявки</h2>
        <div v-if="!mine.length" class="card empty">Вы ни у кого не просили доступ.</div>
        <section v-else class="card card-pad stack-sm">
          <div v-for="r in mine" :key="r.wid" class="rel-row">
            <Icon :name="r.status === 'pending' ? 'clock' : 'x'" :size="16" :style="{ color: r.status === 'pending' ? 'var(--accent)' : 'var(--danger)' }" />
            <span class="grow">
              <a :href="requestUrl(r)"><b>{{ r.worldName || 'Мир' }}</b></a>
              <span class="faint small"> · {{ r.status === 'pending' ? 'ждёт ответа мастера' : 'отклонена' }} · отправлена {{ formatDate(r.createdAt) }}</span>
            </span>
            <button class="btn btn-sm btn-ghost" @click="withdraw(r)">{{ r.status === 'pending' ? 'Отменить' : 'Удалить' }}</button>
          </div>
        </section>
      </div>

      <!-- ============ profile ============ -->
      <section v-else-if="tab === 'profile'" class="card card-pad stack" style="max-width: 640px">
        <label class="field"><span>Имя (видно другим участникам и в авторстве статей)</span>
          <div class="row gap"><input v-model="name" class="input" maxlength="80" /><button class="btn btn-primary" :disabled="nameBusy || !name.trim() || name === session.user.displayName" @click="saveName">Сохранить</button></div>
        </label>
        <label class="field"><span>Почта</span><input class="input" :value="session.user.email" disabled /></label>
        <div class="field"><span>Фото</span>
          <span class="muted small">{{ session.user.photoURL ? 'Берётся из аккаунта Google.' : 'Подключите вход через Google во вкладке «Вход и безопасность», чтобы использовать фото аккаунта.' }}</span>
        </div>
        <dl class="facts">
          <dt>Регистрация</dt><dd>{{ formatDate(created) }}</dd>
          <dt>Последний вход</dt><dd>{{ formatDate(lastLogin) }}</dd>
          <dt>Миров</dt><dd>{{ owned.length }} своих, участие в {{ joined.length }}</dd>
        </dl>
      </section>

      <!-- ============ security ============ -->
      <div v-else-if="tab === 'security'" class="stack" style="max-width: 720px">
        <section class="card card-pad stack">
          <h3 class="panel-title" style="margin: 0"><Icon name="log-in" /> Способы входа</h3>
          <div class="method">
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            <span class="grow"><b>Google</b><br /><span class="muted small">{{ hasGoogle ? 'Подключён' : 'Не подключён' }}</span></span>
            <button v-if="!hasGoogle" class="btn btn-sm" :disabled="secBusy" @click="run(() => session.linkGoogle(), 'Google подключён')">Подключить</button>
            <button v-else-if="providers.length > 1" class="btn btn-sm btn-ghost" :disabled="secBusy" @click="run(() => session.unlinkProvider('google.com'), 'Google отключён')">Отключить</button>
          </div>
          <div class="method">
            <Icon name="mail" :size="20" />
            <span class="grow"><b>Почта и пароль</b><br /><span class="muted small">{{ hasPassword ? 'Подключены' : 'Не подключены — можно задать пароль для входа по почте' }}</span></span>
            <button v-if="hasPassword && providers.length > 1" class="btn btn-sm btn-ghost" :disabled="secBusy" @click="run(() => session.unlinkProvider('password'), 'Вход по паролю отключён')">Отключить</button>
          </div>
          <div v-if="hasPassword && !session.user.emailVerified" class="row gap small">
            <Icon name="triangle-alert" :size="15" style="color: var(--warning)" /> <span class="grow">Почта не подтверждена — без этого не получится восстановить пароль.</span>
            <button class="btn btn-sm" :disabled="secBusy" @click="run(() => session.sendVerification(), 'Письмо отправлено')">Отправить письмо</button>
          </div>
        </section>
        <section class="card card-pad stack">
          <h3 class="panel-title" style="margin: 0"><Icon name="key-round" /> {{ hasPassword ? 'Сменить пароль' : 'Задать пароль' }}</h3>
          <form class="stack-sm" @submit.prevent="changePw">
            <input v-if="hasPassword" v-model="pw.current" class="input" type="password" autocomplete="current-password" placeholder="Текущий пароль" />
            <input v-model="pw.next" class="input" type="password" autocomplete="new-password" placeholder="Новый пароль (от 6 символов)" />
            <input v-model="pw.next2" class="input" type="password" autocomplete="new-password" placeholder="Повторите новый пароль" />
            <div><button class="btn btn-primary" :disabled="secBusy || !pw.next">{{ hasPassword ? 'Сменить пароль' : 'Подключить вход по паролю' }}</button></div>
          </form>
        </section>
        <section class="card card-pad stack danger-zone">
          <h3 class="panel-title" style="margin: 0"><Icon name="triangle-alert" /> Удаление аккаунта</h3>
          <p class="muted small" style="margin: 0">Вы выйдете из всех миров, профиль будет удалён. Статьи, которые вы написали, останутся в мирах. Миры, которыми вы владеете, нужно сначала передать другому участнику или удалить (Настройки мира → Общие).</p>
          <div><button class="btn btn-danger" :disabled="!!owned.length" :title="owned.length ? 'Сначала передайте или удалите свои миры' : ''" @click="deleting = true">Удалить аккаунт…</button></div>
        </section>
      </div>

      <!-- ============ appearance ============ -->
      <div v-else class="stack" style="max-width: 760px">
        <section class="card card-pad stack">
          <h3 class="panel-title" style="margin: 0"><Icon name="palette" /> Тема</h3>
          <div class="theme-grid">
            <button v-for="t in THEMES" :key="t.v" class="theme-tile" :class="{ on: session.theme === t.v }" @click="session.theme = t.v">
              <span class="theme-prev" :style="{ background: t.bg }"><span :style="{ background: t.accent }" /><i :style="{ color: t.fg }">Аа</i></span>
              <span>{{ t.label }}</span>
            </button>
          </div>
        </section>
        <section class="card card-pad stack">
          <h3 class="panel-title" style="margin: 0"><Icon name="type" /> Размер текста статей</h3>
          <div class="row gap wrap">
            <button v-for="(s, k) in TEXT_SIZES" :key="k" class="chip" :class="{ on: session.textSize === k }" @click="session.textSize = k as TextSize">{{ s.label }}</button>
          </div>
          <p class="prose" style="margin: 0">Летопись хранит то, что забыли люди: имена королей, клятвы и тайные тропы через перевал.</p>
          <p class="faint small" style="margin: 0">Настройки оформления сохраняются в этом браузере.</p>
        </section>
      </div>
    </div>

    <Modal v-if="creating" title="Новый мир" width="560px" @close="creating = false">
      <form class="stack" @submit.prevent="create">
        <label class="field"><span>Название</span><input v-model="newWorld.name" class="input" placeholder="Дезремон" maxlength="120" autofocus /></label>
        <label class="field"><span>Короткое описание</span><textarea v-model="newWorld.description" class="input" rows="2" placeholder="Мрачное фэнтези о…" /></label>
        <label class="check"><input v-model="newWorld.isPublic" type="checkbox" /> Открытый мир: статьи с видимостью «всем» читаются без входа</label>
        <div><button class="btn btn-primary" :disabled="!newWorld.name.trim() || createBusy">Создать мир</button></div>
      </form>
    </Modal>

    <Modal v-if="deleting" title="Удалить аккаунт" width="480px" @close="deleting = false">
      <div class="stack">
        <p>Это действие нельзя отменить. Чтобы продолжить, введите <b>УДАЛИТЬ</b>{{ hasPassword ? ' и текущий пароль' : ' (потом Google попросит подтвердить вход)' }}.</p>
        <input v-model="delConfirm" class="input" placeholder="УДАЛИТЬ" />
        <input v-if="hasPassword" v-model="delPassword" class="input" type="password" placeholder="Текущий пароль" autocomplete="current-password" />
      </div>
      <template #footer>
        <button class="btn" @click="deleting = false">Отмена</button>
        <button class="btn btn-danger" :disabled="secBusy || delConfirm !== 'УДАЛИТЬ' || (hasPassword && !delPassword)" @click="deleteAccount">Удалить навсегда</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.acc-wrap { max-width: 1180px; margin: 0 auto; padding: 20px 24px 60px; }
.acc-hero { display: flex; align-items: center; gap: 18px; padding: 20px 22px; margin-bottom: 18px; }
.acc-avatar { width: 84px; height: 84px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: var(--accent); color: var(--accent-fg); display: flex; align-items: center; justify-content: center; font: 700 30px var(--font-head); }
.acc-avatar img { width: 100%; height: 100%; object-fit: cover; }
.world-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.wcard { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.wcard:hover { border-color: var(--accent); }
.wcard-img { height: 130px; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 35%, var(--surface-2)), var(--surface-3)); display: flex; align-items: center; justify-content: center; color: var(--accent-fg); overflow: hidden; }
.wcard-img img { width: 100%; height: 100%; object-fit: cover; }
.wcard-body { padding: 12px 14px 6px; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.wcard-name { font: 700 22px var(--font-head); color: var(--text); text-decoration: none !important; }
.wcard-desc { margin: 0; color: var(--text-muted); font-size: 13.5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wcard-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; }
.wcard-actions { display: flex; align-items: center; gap: 6px; padding: 8px 12px 12px; }
.wcard-new { align-items: center; justify-content: center; gap: 8px; min-height: 220px; border-style: dashed; cursor: pointer; color: var(--text-muted); background: none; }
.method { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; }
.danger-zone { border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
.theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.theme-tile { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 2px solid var(--border); border-radius: 12px; background: var(--surface); cursor: pointer; }
.theme-tile.on { border-color: var(--accent); }
.theme-prev { height: 64px; border-radius: 8px; position: relative; display: flex; align-items: center; justify-content: center; border: 1px solid rgb(0 0 0 / 12%); }
.theme-prev span { position: absolute; left: 8px; top: 8px; width: 22px; height: 6px; border-radius: 3px; }
.theme-prev i { font: 700 24px var(--font-head); font-style: normal; }
@media (max-width: 720px) {
  .acc-wrap { padding-left: 14px; padding-right: 14px; }
  .acc-hero { flex-direction: column; text-align: center; }
}
.req-badge { border: 0; cursor: pointer; background: var(--danger); color: #fff; }
</style>
