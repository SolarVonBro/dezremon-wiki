import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import {
  onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut as fbSignOut, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, updateProfile, sendEmailVerification, EmailAuthProvider,
  reauthenticateWithCredential, reauthenticateWithPopup, updatePassword, linkWithCredential, linkWithPopup, unlink, deleteUser,
  type User,
} from 'firebase/auth'
import { collectionGroup, deleteDoc, doc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore'
import { auth, db } from '@/firebase'
import { setUserTheme, type UserTheme } from '@/themes/apply'

export type ThemeMode = UserTheme

function readTheme(): ThemeMode {
  let t: string | null = null
  try { t = localStorage.getItem('dw.theme') } catch { /* private mode */ }
  // the old «Пергамент» theme is gone; it was a light one
  if (t === 'parchment') return 'light'
  return t === 'dark' || t === 'light' ? t : 'auto'
}

export type TextSize = 's' | 'm' | 'l' | 'xl'
export const TEXT_SIZES: Record<TextSize, { label: string; px: number }> = { s: { label: 'Мелкий', px: 15 }, m: { label: 'Обычный', px: 17 }, l: { label: 'Крупный', px: 19 }, xl: { label: 'Очень крупный', px: 21 } }
function readTextSize(): TextSize {
  try { return (localStorage.getItem('dw.textSize') as TextSize) || 'm' } catch { return 'm' }
}

export const useSession = defineStore('session', () => {
  const user = ref<User | null>(null)
  const ready = ref(false)
  /** true between "account created" and "name saved": pages wait for it so they see the chosen name */
  const registering = ref(false)
  const rev = ref(0)
  const theme = ref<ThemeMode>(readTheme())
  const textSize = ref<TextSize>(readTextSize())
  watch(textSize, (t) => {
    try { localStorage.setItem('dw.textSize', t) } catch { /* private mode */ }
    document.documentElement.style.setProperty('--prose-size', `${(TEXT_SIZES[t] ?? TEXT_SIZES.m).px}px`)
  }, { immediate: true })

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
    setUserTheme(t)
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
    registering.value = true
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      if (name) {
        await updateProfile(cred.user, { displayName: name })
        await setDoc(doc(db, 'users', cred.user.uid), { displayName: name }, { merge: true }).catch(() => {})
      }
      user.value = auth.currentUser
      rev.value++
    } finally { registering.value = false }
  }
  async function resetPassword(email: string) {
    await sendPasswordResetEmail(auth, email)
  }
  async function signOut() {
    await fbSignOut(auth)
  }
  const displayName = () => { void rev.value; return user.value?.displayName || user.value?.email || 'Гость' }

  // ---------- account (personal cabinet) ----------
  /** Bumped after profile/provider changes: Firebase mutates the User object in place. */
  const providers = () => { void rev.value; return (user.value?.providerData ?? []).map((p) => p.providerId) }
  const myMemberships = async () => (user.value ? (await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', user.value.uid)))).docs : [])

  /** New display name everywhere: Auth profile, users doc and the member doc in every world. */
  async function updateDisplayName(name: string) {
    const u = auth.currentUser
    if (!u || !name.trim()) return
    await updateProfile(u, { displayName: name.trim() })
    await setDoc(doc(db, 'users', u.uid), { displayName: name.trim() }, { merge: true })
    const ms = await myMemberships()
    for (let i = 0; i < ms.length; i += 400) {
      const b = writeBatch(db)
      ms.slice(i, i + 400).forEach((d) => b.update(d.ref, { displayName: name.trim() }))
      await b.commit()
    }
    rev.value++
  }
  async function reauth(password?: string) {
    const u = auth.currentUser!
    if (password && u.email) await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password))
    else await reauthenticateWithPopup(u, new GoogleAuthProvider())
  }
  async function changePassword(current: string, next: string) {
    await reauth(current)
    await updatePassword(auth.currentUser!, next)
  }
  /** Google-only accounts can add a password for signing in by e-mail. */
  async function addPassword(password: string) {
    const u = auth.currentUser!
    if (!u.email) throw new Error('У аккаунта нет почты')
    await linkWithCredential(u, EmailAuthProvider.credential(u.email, password))
    rev.value++
  }
  async function linkGoogle() {
    await linkWithPopup(auth.currentUser!, new GoogleAuthProvider())
    rev.value++
  }
  async function unlinkProvider(providerId: string) {
    if (providers().length < 2) throw new Error('Нельзя отключить единственный способ входа')
    await unlink(auth.currentUser!, providerId)
    rev.value++
  }
  async function sendVerification() {
    await sendEmailVerification(auth.currentUser!)
  }
  /**
   * Deletes the account: leaves every world (owners must transfer or delete their worlds first),
   * removes the profile doc, then the Firebase account.
   */
  async function deleteAccount(password?: string) {
    const u = auth.currentUser
    if (!u) return
    const ms = await myMemberships()
    if (ms.some((d) => d.data().role === 'owner')) throw new Error('Сначала передайте или удалите миры, которыми вы владеете')
    await reauth(password)
    for (const d of ms) await deleteDoc(d.ref)
    await deleteDoc(doc(db, 'users', u.uid)).catch(() => {})
    await deleteUser(u)
  }

  return {
    user, ready, registering, whenReady, theme, textSize, signInGoogle, signInEmail, register, resetPassword, signOut, displayName,
    rev, providers, updateDisplayName, changePassword, addPassword, linkGoogle, unlinkProvider, sendVerification, deleteAccount,
  }
})

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
    'auth/requires-recent-login': 'Для этого действия войдите заново',
    'auth/credential-already-in-use': 'Этот аккаунт Google уже привязан к другому пользователю',
    'auth/provider-already-linked': 'Этот способ входа уже подключён',
    'auth/no-such-provider': 'Этот способ входа не подключён',
    'auth/missing-password': 'Введите пароль',
  }
  return map[code] ?? (e?.message || 'Ошибка входа')
}
