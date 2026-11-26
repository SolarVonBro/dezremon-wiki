import { initializeApp } from 'firebase/app'
import {
  initializeAuth, getAuth, connectAuthEmulator, browserPopupRedirectResolver,
  browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence,
} from 'firebase/auth'
import { initializeFirestore, memoryLocalCache, connectFirestoreEmulator, setLogLevel } from 'firebase/firestore'
import { firebaseConfig } from './firebaseConfig'

// Local development against the Firebase emulators: `VITE_EMULATOR=1 npm run dev`
// (or ?emulator=1 in the URL of a dev build).
const useEmulator = import.meta.env.VITE_EMULATOR === '1'

export const app = initializeApp(useEmulator ? { ...firebaseConfig, projectId: 'demo-dezremon', apiKey: 'demo-key' } : firebaseConfig)
// Prefer localStorage over IndexedDB for auth persistence: IndexedDB stalls/locks across suspended tabs or corrupt
// DB states would otherwise drop the session on reload or block signing back in. Keeping indexedDBLocalPersistence
// in the hierarchy transparently migrates existing sessions stored in IDB to localStorage on the next visit.
export const auth = (() => {
  try {
    return initializeAuth(app, {
      popupRedirectResolver: browserPopupRedirectResolver,
      persistence: [browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence],
    })
  } catch {
    return getAuth(app)
  }
})()
// Our own IndexedDB cache (src/data/cache.ts) does delta sync, so Firestore keeps only a memory cache.
export const db = initializeFirestore(app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true })

if (useEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
export const isEmulator = useEmulator
try { if (localStorage.getItem('dw.fsdebug')) setLogLevel('debug') } catch { /* no storage */ }
