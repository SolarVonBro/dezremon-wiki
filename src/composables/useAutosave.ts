import { onBeforeUnmount, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'

/**
 * Debounced autosave: saves `delay` ms after the last change, but at least every `maxWait` ms while
 * the user keeps typing. Flushes on route leave / unmount and warns before closing the tab.
 */
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

  const onUnload = (e: BeforeUnloadEvent) => {
    if (dirty.value || saving.value) { void run(); e.preventDefault(); e.returnValue = '' }
  }
  window.addEventListener('beforeunload', onUnload)
  onBeforeRouteLeave(async () => { await run() })
  onBeforeUnmount(() => { window.removeEventListener('beforeunload', onUnload); void run() })

  return { touch, flush, dirty, saving, lastSaved }
}
