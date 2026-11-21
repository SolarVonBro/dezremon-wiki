import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import {
  onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut as fbSignOut, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, updateProfile, type User,
} from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '@/firebase'

export type ThemeMode = 'auto' | 'dark' | 'light' | 'parchment'

function readTheme(): ThemeMode {
  try { return (localStorage.getItem('dw.theme') as ThemeMode) || 'auto' } catch { return 'auto' }
}

export const useSession = defineStore('session', () => {
  const user = ref<User | null>(null)
  const ready = ref(false)
  const theme = ref<ThemeMode>(readTheme())

  let resolveReady: () => void
  const whenReady = new Promise<void>((r) => (resolveReady = r))

  onAuthStateChanged(auth, (u) => {
    user.value = u
    ready.value = true
    resolveReady()
    if (u) {
      void setDoc(doc(db, 'users', u.uid), {
        uid: u.uid, displayName: u.displayName ?? u.email ?? 'Без имени', email: u.email ?? '', photoURL: u.photoURL ?? null, lastSeen: Date.now(),
      }, { merge: true }).catch(() => {})
    }
  })

  watch(theme, (t) => {
    try { localStorage.setItem('dw.theme', t) } catch { /* private mode */ }
    applyTheme(t)
  }, { immediate: true })

  async function signInGoogle() {
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    await signInWithPopup(auth, provider)
  }
  async function signInEmail(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password)
  }
  async function register(email: string, password: string, name: string) {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    if (name) await updateProfile(cred.user, { displayName: name })
    user.value = auth.currentUser
  }
  async function resetPassword(email: string) {
    await sendPasswordResetEmail(auth, email)
  }
  async function signOut() {
    await fbSignOut(auth)
  }
  const displayName = () => user.value?.displayName || user.value?.email || 'Гость'

  return { user, ready, whenReady, theme, signInGoogle, signInEmail, register, resetPassword, signOut, displayName }
})

export function applyTheme(t: ThemeMode) {
  const root = document.documentElement
  if (t === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
}

export function authErrorText(e: any): string {
  const code = String(e?.code ?? '')
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Неверная почта или пароль',
    'auth/wrong-password': 'Неверный пароль',
    'auth/user-not-found': 'Пользователь не найден',
    'auth/email-already-in-use': 'Эта почта уже зарегистрирована',
    'auth/weak-password': 'Слишком простой пароль (минимум 6 символов)',
    'auth/invalid-email': 'Некорректная почта',
    'auth/popup-closed-by-user': 'Окно входа закрыто',
    'auth/too-many-requests': 'Слишком много попыток, попробуйте позже',
    'auth/operation-not-allowed': 'Этот способ входа не включён в Firebase',
    'auth/unauthorized-domain': 'Домен сайта не добавлен в Firebase Authentication',
  }
  return map[code] ?? (e?.message || 'Ошибка входа')
}
