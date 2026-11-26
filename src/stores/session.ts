import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider,
  signOut as fbSignOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  updateProfile, sendEmailVerification, EmailAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup,
  updatePassword, linkWithCredential, linkWithPopup, unlink, deleteUser, setPersistence,
  browserSessionPersistence, inMemoryPersistence,
  type User,
} from 'firebase/auth'
import { collection, collectionGroup, deleteDoc, deleteField, doc, getDoc, getDocFromServer, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { auth, db } from '@/firebase'
import { setUserTheme, type UserTheme } from '@/themes/apply'
import { publishProfile } from '@/data/profileCard'

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
  /** Error surfaced when returning from a failed Google redirect sign-in (or empty return under 3P cookie blocking). */
  const redirectError = ref('')
  const rev = ref(0)
  const theme = ref<ThemeMode>(readTheme())
  const textSize = ref<TextSize>(readTextSize())
  const REDIRECT_MARK = 'dw.googleRedirectAt'
  const REDIRECT_NEXT = 'dw.loginNext'
  watch(textSize, (t) => {
    try { localStorage.setItem('dw.textSize', t) } catch { /* private mode */ }
    document.documentElement.style.setProperty('--prose-size', `${(TEXT_SIZES[t] ?? TEXT_SIZES.m).px}px`)
  }, { immediate: true })

  let resolveReady: () => void
  const whenReady = new Promise<void>((r) => (resolveReady = r))

  /**
   * The user's own picture (users/{uid}.avatar: a small framed square as a data URL), shown instead of the sign-in
   * provider's photo everywhere: worlds, games, comments, rooms. The source and the frame are kept for re-framing.
   */
  const avatar = ref<string | null>(null)
  /**
   * Whether we know if the user has an own picture. Until then nothing is shown rather than the provider's photo
   * (it would flash and look like the old picture came back). This browser remembers the answer (AVATAR_KEY).
   */
  const avatarKnown = ref(false)
  const AVATAR_KEY = (uid: string) => `dw.avatar.${uid}`
  /**
   * The user's record as the server has it. Never read while a merge write to it is pending: Firestore (even
   * getDocFromServer) then answers with the fields of that write alone — without the own picture, which looked like
   * the old photo came back after every reload. Offline it fails, and the remembered picture stays.
   */
  const readMine = (uid: string) => getDocFromServer(doc(db, 'users', uid))
  function rememberAvatar(uid: string, v: string | null) { try { localStorage.setItem(AVATAR_KEY(uid), v ?? '') } catch { /* private mode */ } }
  function recallAvatar(uid: string): string | null | undefined {
    try { const v = localStorage.getItem(AVATAR_KEY(uid)); return v === null ? undefined : v || null } catch { return undefined }
  }
  /** The picture to show and to copy into new records (own picture → the provider's photo → none). */
  const photo = computed(() => { void rev.value; return avatar.value ?? (avatarKnown.value ? user.value?.photoURL ?? null : null) })
  /** The current user as new records copy him (name, e-mail, picture). */
  const me = computed(() => { void rev.value; const u = user.value; return u ? { uid: u.uid, displayName: u.displayName, email: u.email, photoURL: photo.value } : null })

  onAuthStateChanged(auth, (u) => {
    user.value = u
    const known = u ? recallAvatar(u.uid) : undefined
    avatar.value = known ?? null
    avatarKnown.value = known !== undefined
    ready.value = true
    resolveReady()
    if (u) {
      const visit = () => setDoc(doc(db, 'users', u.uid), {
        uid: u.uid, displayName: u.displayName ?? u.email ?? 'Без имени', email: u.email ?? '', photoURL: u.photoURL ?? null, lastSeen: Date.now(),
      }, { merge: true }).catch(() => {})
      // the own picture from the user's record, read before the visit is written (see readMine); the public card is
      // refreshed only once it is known (a failed read must not publish the provider's photo over the own one)
      void readMine(u.uid).then((s) => {
        if (user.value?.uid !== u.uid) return
        avatar.value = (s.data()?.avatar as string | undefined) ?? null
        avatarKnown.value = true
        rememberAvatar(u.uid, avatar.value)
        void publishProfile(u, photo.value).catch(() => {})
      }).catch(() => {
        // the record could not be read: show at least the provider's photo, but do not publish it
        if (user.value?.uid === u.uid && !avatarKnown.value) avatarKnown.value = true
      }).finally(visit)
      try { sessionStorage.removeItem(REDIRECT_MARK) } catch { /* private mode */ }
      redirectError.value = ''
    }
  })

  // Surface errors (or silent drops under third-party storage partitioning) when returning from signInWithRedirect.
  void getRedirectResult(auth).then((res) => {
    let ts = 0
    try { ts = Number(sessionStorage.getItem(REDIRECT_MARK) || 0); sessionStorage.removeItem(REDIRECT_MARK) } catch { /* private mode */ }
    if (!res && !auth.currentUser && ts && Date.now() - ts < 5 * 60 * 1000) {
      redirectError.value = 'Не удалось завершить вход через Google — браузер мог заблокировать сторонние cookies или хранилище. Попробуйте разрешить cookies, открыть сайт в другом браузере или войти по почте и паролю.'
    }
  }).catch((e) => {
    try { sessionStorage.removeItem(REDIRECT_MARK) } catch { /* private mode */ }
    redirectError.value = authErrorText(e)
  })

  watch(theme, (t) => {
    try { localStorage.setItem('dw.theme', t) } catch { /* private mode */ }
    setUserTheme(t)
  }, { immediate: true })

  function googleProvider() {
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    return provider
  }
  function isStoragePersistenceError(e: any): boolean {
    if (e?.code !== 'auth/internal-error') return false
    const orig = e?.customData?.originalError
    const msg = `${e?.message ?? ''} ${orig?.name ?? ''} ${orig?.message ?? ''}`
    return /QuotaExceeded|InvalidStateError|SecurityError|DB_TIMEOUT|database connection is closing|IndexedDB|storage/i.test(msg)
  }
  async function runWithStorageFallback<T>(fn: () => Promise<T>, retryFn: () => Promise<T> = fn): Promise<T> {
    try {
      return await fn()
    } catch (e: any) {
      if (!isStoragePersistenceError(e)) throw e
      let lastErr = e
      for (const p of [browserSessionPersistence, inMemoryPersistence]) {
        try {
          await setPersistence(auth, p)
          return await retryFn()
        } catch (err: any) {
          lastErr = err
          if (!isStoragePersistenceError(err)) throw err
        }
      }
      throw lastErr
    }
  }
  async function signInGoogleRedirect(nextPath?: string) {
    redirectError.value = ''
    try {
      sessionStorage.setItem(REDIRECT_MARK, String(Date.now()))
      if (nextPath && nextPath.startsWith('/') && !nextPath.startsWith('//') && !nextPath.startsWith('/login')) {
        sessionStorage.setItem(REDIRECT_NEXT, nextPath)
      }
    } catch { /* private mode */ }
    await signInWithRedirect(auth, googleProvider())
  }
  function consumeRedirectNext(): string | null {
    try {
      const v = sessionStorage.getItem(REDIRECT_NEXT)
      sessionStorage.removeItem(REDIRECT_NEXT)
      return v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/login') ? v : null
    } catch { return null }
  }
  async function signInGoogle(nextPath?: string) {
    redirectError.value = ''
    // iOS home-screen PWA: signInWithPopup creates a windowless popup whose promise never settles.
    const iosStandalone = /iphone|ipad|ipod/i.test(navigator.userAgent) && !!(navigator as any).standalone
    if (iosStandalone) { await signInGoogleRedirect(nextPath); return }
    try {
      await runWithStorageFallback(() => signInWithPopup(auth, googleProvider()))
    } catch (e: any) {
      if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
        await signInGoogleRedirect(nextPath)
        return
      }
      throw e
    }
  }
  async function signInEmail(email: string, password: string) {
    await runWithStorageFallback(() => signInWithEmailAndPassword(auth, email, password))
  }
  async function register(email: string, password: string, name: string) {
    registering.value = true
    try {
      // If persistence failed after creating the user on the server, retry via signIn before createUser.
      const cred = await runWithStorageFallback(
        () => createUserWithEmailAndPassword(auth, email, password),
        () => signInWithEmailAndPassword(auth, email, password).catch(() => createUserWithEmailAndPassword(auth, email, password)),
      )
      if (name) {
        await updateProfile(cred.user, { displayName: name })
        await setDoc(doc(db, 'users', cred.user.uid), { displayName: name }, { merge: true }).catch(() => {})
        void publishProfile(cred.user, photo.value).catch(() => {})
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
    if (avatarKnown.value) await publishProfile(u, photo.value).catch(() => {})
    const ms = await myMemberships()
    for (let i = 0; i < ms.length; i += 400) {
      const b = writeBatch(db)
      ms.slice(i, i + 400).forEach((d) => b.update(d.ref, { displayName: name.trim() }))
      await b.commit()
    }
    // games keep a copy of the name in their participant records, rooms the name of their owner
    const games = await getDocs(query(collection(db, 'campaigns'), where('memberUids', 'array-contains', u.uid))).catch(() => null)
    await Promise.all((games?.docs ?? []).map((g) => updateDoc(doc(db, 'campaigns', g.id, 'participants', u.uid), { displayName: name.trim() }).catch(() => {})))
    const rooms = await getDocs(query(collection(db, 'rooms'), where('memberUids', 'array-contains', u.uid))).catch(() => null)
    await Promise.all((rooms?.docs ?? []).filter((r) => r.data().ownerId === u.uid).map((r) => updateDoc(r.ref, { ownerName: name.trim() }).catch(() => {})))
    rev.value++
  }
  /**
   * Sets or removes the user's own picture: kept in users/{uid} (with its source and frame), published on the public
   * card and copied into the member records of every world and the participant records of every game.
   */
  async function setAvatar(next: { image: string; source: string; crop: { x: number; y: number; zoom: number } | null } | null) {
    const u = auth.currentUser
    if (!u) return
    await setDoc(doc(db, 'users', u.uid), next
      ? { avatar: next.image, avatarSource: next.source, avatarCrop: next.crop }
      : { avatar: deleteField(), avatarSource: deleteField(), avatarCrop: deleteField() }, { merge: true })
    avatar.value = next?.image ?? null
    avatarKnown.value = true
    rememberAvatar(u.uid, avatar.value)
    const p = photo.value
    await publishProfile(u, p).catch(() => {})
    const ms = await myMemberships()
    for (let i = 0; i < ms.length; i += 400) {
      const b = writeBatch(db)
      ms.slice(i, i + 400).forEach((d) => b.update(d.ref, { photoURL: p }))
      await b.commit()
    }
    const games = await getDocs(query(collection(db, 'campaigns'), where('memberUids', 'array-contains', u.uid))).catch(() => null)
    await Promise.all((games?.docs ?? []).map((g) => updateDoc(doc(db, 'campaigns', g.id, 'participants', u.uid), { photoURL: p }).catch(() => {})))
    rev.value++
  }
  /** The source picture and frame of the own picture (to frame it again). */
  async function avatarSource(): Promise<{ source: string; crop: { x: number; y: number; zoom: number } | null } | null> {
    const u = auth.currentUser
    if (!u) return null
    const d = (await readMine(u.uid).catch(() => getDoc(doc(db, 'users', u.uid)))).data()
    return d?.avatarSource ? { source: d.avatarSource as string, crop: (d.avatarCrop as { x: number; y: number; zoom: number } | null) ?? null } : null
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
    await deleteDoc(doc(db, 'profiles', u.uid)).catch(() => {})
    try { localStorage.removeItem(AVATAR_KEY(u.uid)) } catch { /* private mode */ }
    avatar.value = null
    await deleteUser(u)
  }

  return {
    user, ready, registering, redirectError, whenReady, theme, textSize, signInGoogle, signInGoogleRedirect, consumeRedirectNext,
    signInEmail, register, resetPassword, signOut, displayName,
    rev, providers, updateDisplayName, changePassword, addPassword, linkGoogle, unlinkProvider, sendVerification, deleteAccount,
    avatar, photo, me, setAvatar, avatarSource,
  }
})

export function authErrorText(e: any): string {
  const code = String(e?.code ?? '')
  const map: Record<string, string> = {
    'auth/invalid-credential': 'Неверная почта или пароль. Если раньше вы входили через Google — нажмите «Войти через Google»',
    'auth/wrong-password': 'Неверный пароль. Если раньше вы входили через Google — нажмите «Войти через Google»',
    'auth/user-not-found': 'Пользователь не найден',
    'auth/email-already-in-use': 'Эта почта уже зарегистрирована',
    'auth/weak-password': 'Слишком простой пароль (минимум 6 символов)',
    'auth/invalid-email': 'Некорректная почта',
    'auth/popup-closed-by-user': 'Окно входа Google закрылось до завершения. Если вы не закрывали его сами — нажмите «Войти без всплывающего окна» или разрешите сторонние cookies',
    'auth/popup-blocked': 'Браузер заблокировал всплывающее окно — разрешите всплывающие окна или нажмите «Войти без всплывающего окна»',
    'auth/cancelled-popup-request': 'Запрос входа отменён — попробуйте ещё раз',
    'auth/network-request-failed': 'Нет связи с сервером авторизации — проверьте интернет, VPN или блокировщик рекламы',
    'auth/internal-error': 'Ошибка авторизации — проверьте интернет, блокировщик рекламы/трекеров или очистите данные сайта и попробуйте снова',
    'auth/web-storage-unsupported': 'В браузере отключены cookies или хранилище сайта — включите их в настройках, чтобы войти',
    'auth/user-disabled': 'Этот аккаунт отключён администратором',
    'auth/user-token-expired': 'Сессия истекла — войдите заново',
    'auth/account-exists-with-different-credential': 'Эта почта уже привязана к другому способу входа',
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
