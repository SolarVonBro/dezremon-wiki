import { onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'

/**
 * Debounced autosave: saves `delay` ms after the last change, but at least every `maxWait` ms while
 * the user keeps typing. Flushes on route leave / unmount and warns before closing the tab.
 */
/** Number of editors with changes not yet written (drives the "Сохранение…" indicator). */
export const unsavedEditors = ref(0)

export function useAutosave(save: () => Promise<boolean | void>, opts: { delay?: number; maxWait?: number } = {}) {
  const delay = opts.delay ?? 1200
  const maxWait = opts.maxWait ?? 12000
  const dirty = ref(false)
  const saving = ref(false)
  const lastSaved = ref(0)
  let timer: ReturnType<typeof setTimeout> | null = null
  let firstDirtyAt = 0
  let again = false

  async function run() {
    if (timer) { clearTimeout(timer); timer = null }
    if (!dirty.value) return
    if (saving.value) { again = true; return }
    saving.value = true
    dirty.value = false
    firstDirtyAt = 0
    try {
      const ok = await save()
      if (ok === false) { dirty.value = true; schedule(1000) } else lastSaved.value = Date.now()
    } catch {
      dirty.value = true
      schedule(5000)
    } finally {
      saving.value = false
      if (again) { again = false; void run() }
    }
  }
  function schedule(ms: number) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void run(), ms)
  }
  function touch() {
    dirty.value = true
    const t = Date.now()
    if (!firstDirtyAt) firstDirtyAt = t
    schedule(t - firstDirtyAt > maxWait ? 0 : delay)
  }
  const flush = () => run()

  let counted = false
  watch([dirty, saving], ([d, s]) => {
    const busy = d || s
    if (busy && !counted) { counted = true; unsavedEditors.value++ }
    if (!busy && counted) { counted = false; unsavedEditors.value-- }
  })

  const onUnload = (e: BeforeUnloadEvent) => {
    if (dirty.value || saving.value) { void run(); e.preventDefault(); e.returnValue = '' }
  }
  window.addEventListener('beforeunload', onUnload)
  // Moving between two articles only changes route params (an "update", not a "leave").
  onBeforeRouteLeave(async () => { await run() })
  onBeforeRouteUpdate(async () => { await run() })
  onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', onUnload)
    void run().finally(() => { if (counted) { counted = false; unsavedEditors.value-- } })
  })

  return { touch, flush, dirty, saving, lastSaved }
}
