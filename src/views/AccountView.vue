<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession, authErrorText, TEXT_SIZES, type ThemeMode, type TextSize } from '@/stores/session'
import { myWorlds, type MyWorld } from '@/stores/world'
import { formatDate, plural } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import { toast } from '@/components/common/toast'

const session = useSession()
const route = useRoute()
const router = useRouter()
// The personal cabinet: profile, sign-in methods, appearance. The worlds list is its own section (WorldsView).
type Tab = 'profile' | 'security' | 'appearance'
const tab = computed<Tab>(() => (route.query.tab === 'security' || route.query.tab === 'appearance' ? route.query.tab : 'profile'))
function setTab(t: Tab) { void router.replace({ query: { tab: t === 'profile' ? undefined : t } }) }

watch(() => [session.ready, session.user], () => {
  if (session.ready && !session.user) void router.replace({ name: 'login', query: { next: '/account' } })
}, { immediate: true })

// ---------- the user's worlds: only counted here (and owners cannot delete the account) ----------
const worlds = ref<MyWorld[]>([])
watch(() => session.user?.uid, (u) => {
  if (u) void myWorlds(u).then((w) => { worlds.value = w }).catch((e) => toast.error('Не удалось загрузить миры: ' + (e?.message ?? e)))
}, { immediate: true })
const owned = computed(() => worlds.value.filter((w) => w.role === 'owner'))
const joined = computed(() => worlds.value.filter((w) => w.role !== 'owner'))

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
          <div class="faint small">С нами с {{ formatDate(created) }} · <RouterLink :to="{ name: 'worlds' }">{{ owned.length }} {{ plural(owned.length, 'свой мир', 'своих мира', 'своих миров') }} · участвует в {{ joined.length }}</RouterLink></div>
        </div>
      </section>

      <div class="tabs">
        <button class="tab" :class="{ on: tab === 'profile' }" @click="setTab('profile')"><Icon name="user" :size="16" /> Профиль</button>
        <button class="tab" :class="{ on: tab === 'security' }" @click="setTab('security')"><Icon name="key-round" :size="16" /> Вход и безопасность</button>
        <button class="tab" :class="{ on: tab === 'appearance' }" @click="setTab('appearance')"><Icon name="palette" :size="16" /> Оформление</button>
      </div>

      <!-- ============ profile ============ -->
      <section v-if="tab === 'profile'" class="card card-pad stack" style="max-width: 640px">
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
          <p class="faint small" style="margin: 0">Настройки оформления сохраняются в этом браузере. Если мастер выбрал для мира свою тему, на страницах этого мира будет она, а размер текста останется вашим.</p>
        </section>
      </div>
    </div>

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
</style>
