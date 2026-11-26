<script setup lang="ts">
const logo = import.meta.env.BASE_URL + 'favicon.svg'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession, authErrorText } from '@/stores/session'
import Icon from '@/components/common/Icon.vue'
import { toast } from '@/components/common/toast'

const session = useSession()
const route = useRoute()
const router = useRouter()
const mode = ref<'login' | 'register' | 'reset'>('login')
const email = ref('')
const password = ref('')
const name = ref('')
const googleBusy = ref(false)
const googleSlow = ref(false)
const googleFailed = ref(false)
const emailBusy = ref(false)
const error = ref('')

const inAppBrowser = /Telegram|Discord|VKAndroidApp|vkShare|Instagram|FBAN|FBAV|WhatsApp|Line\/|wv\)/i.test(navigator.userAgent)
const storageBlocked = ref(false)
try {
  const k = '__dw_probe__'
  localStorage.setItem(k, '1')
  localStorage.removeItem(k)
} catch {
  try {
    const req = indexedDB.open('firebaseLocalStorageDb')
    req.onerror = () => { storageBlocked.value = true }
    req.onsuccess = () => { req.result.close() }
  } catch {
    storageBlocked.value = true
  }
}

function sanitizeNext(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (!v.startsWith('/') || v.startsWith('//') || v === '/login' || v.startsWith('/login?') || v.startsWith('/login/')) return null
  return v
}
const next = () => sanitizeNext(route.query.next) ?? session.consumeRedirectNext() ?? '/'

watch(() => [session.user, session.registering] as const, ([u, r]) => {
  if (u && !r) void router.replace(next())
}, { immediate: true })

const shownError = computed(() => error.value || session.redirectError)

let googleToken = 0
let slowTimer: ReturnType<typeof setTimeout> | null = null
let hangTimer: ReturnType<typeof setTimeout> | null = null
function clearGoogleTimers() {
  if (slowTimer) { clearTimeout(slowTimer); slowTimer = null }
  if (hangTimer) { clearTimeout(hangTimer); hangTimer = null }
}
onBeforeUnmount(clearGoogleTimers)

function cancelGoogle() {
  googleToken++
  clearGoogleTimers()
  googleBusy.value = false
  googleSlow.value = false
}

async function google() {
  const token = ++googleToken
  clearGoogleTimers()
  googleBusy.value = true
  googleSlow.value = false
  googleFailed.value = false
  error.value = ''
  session.redirectError = ''
  slowTimer = setTimeout(() => { if (token === googleToken) googleSlow.value = true }, 4500)
  hangTimer = setTimeout(() => {
    if (token !== googleToken || !googleBusy.value) return
    googleToken++
    googleBusy.value = false
    googleSlow.value = false
    googleFailed.value = true
    error.value = 'Окно Google не отвечает — возможно, его блокирует браузер, блокировщик рекламы или VPN. Попробуйте «Войти без всплывающего окна» или вход по почте.'
  }, 18000)
  try {
    await session.signInGoogle(sanitizeNext(route.query.next) ?? undefined)
  } catch (e) {
    if (token !== googleToken) return
    googleFailed.value = true
    error.value = authErrorText(e)
  } finally {
    if (token === googleToken) {
      clearGoogleTimers()
      googleBusy.value = false
      googleSlow.value = false
    }
  }
}

async function googleRedirect() {
  cancelGoogle()
  googleBusy.value = true
  error.value = ''
  session.redirectError = ''
  try {
    await session.signInGoogleRedirect(sanitizeNext(route.query.next) ?? undefined)
  } catch (e) {
    googleBusy.value = false
    error.value = authErrorText(e)
  }
}

async function submit() {
  emailBusy.value = true
  error.value = ''
  session.redirectError = ''
  try {
    if (mode.value === 'login') await session.signInEmail(email.value.trim(), password.value)
    else if (mode.value === 'register') await session.register(email.value.trim(), password.value, name.value.trim())
    else { await session.resetPassword(email.value.trim()); toast.success('Письмо для сброса пароля отправлено'); mode.value = 'login' }
  } catch (e) {
    error.value = authErrorText(e)
  } finally {
    emailBusy.value = false
  }
}
</script>

<template>
  <div class="landing">
    <div class="card auth-card stack">
      <RouterLink to="/" class="brand" style="font-size: 24px; color: var(--text)"><img class="brand-mark" :src="logo" alt="" /> Вики сеттинга</RouterLink>
      <h2 style="margin: 4px 0 0">{{ mode === 'login' ? 'Вход' : mode === 'register' ? 'Регистрация' : 'Сброс пароля' }}</h2>
      <p v-if="inAppBrowser" class="auth-hint small" style="margin: 0">
        <Icon name="triangle-alert" :size="14" /> Вы открыли сайт во встроенном браузере — вход через Google в нём может не работать. Откройте ссылку в обычном браузере (Chrome, Safari, Firefox) или войдите по почте.
      </p>
      <p v-if="storageBlocked" class="auth-hint small" style="margin: 0">
        <Icon name="triangle-alert" :size="14" /> В браузере отключено сохранение данных сайтов — вход может сбрасываться после обновления страницы.
      </p>
      <template v-if="mode !== 'reset'">
        <button class="btn btn-lg" :disabled="googleBusy" @click="google">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          {{ googleBusy ? 'Ожидание окна Google…' : 'Войти через Google' }}
        </button>
        <div v-if="googleSlow || googleFailed" class="row gap small" style="justify-content: space-between; margin-top: -4px">
          <a href="#" @click.prevent="googleRedirect">Войти без всплывающего окна</a>
          <a v-if="googleBusy" href="#" class="muted" @click.prevent="cancelGoogle">Отмена</a>
        </div>
        <div class="divider-text">или по почте</div>
      </template>
      <form class="stack" @submit.prevent="submit">
        <label v-if="mode === 'register'" class="field"><span>Имя (видно другим участникам)</span><input v-model="name" class="input" autocomplete="nickname" /></label>
        <label class="field"><span>Почта</span><input v-model="email" class="input" type="email" autocomplete="email" required /></label>
        <label v-if="mode !== 'reset'" class="field"><span>Пароль</span><input v-model="password" class="input" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" minlength="6" required /></label>
        <p v-if="shownError" class="danger small" style="margin: 0"><Icon name="triangle-alert" :size="14" /> {{ shownError }}</p>
        <button class="btn btn-primary" :disabled="emailBusy">{{ mode === 'login' ? 'Войти' : mode === 'register' ? 'Зарегистрироваться' : 'Отправить письмо' }}</button>
      </form>
      <div class="row gap small" style="justify-content: space-between">
        <a v-if="mode !== 'login'" href="#" @click.prevent="mode = 'login'">Уже есть аккаунт</a>
        <a v-if="mode === 'login'" href="#" @click.prevent="mode = 'register'">Регистрация</a>
        <a v-if="mode === 'login'" href="#" @click.prevent="mode = 'reset'">Забыли пароль?</a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-hint {
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--warning) 14%, var(--surface-2));
  border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border));
  color: var(--text);
  line-height: 1.4;
}
</style>
