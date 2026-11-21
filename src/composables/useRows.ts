import { onBeforeUnmount, shallowRef, watch, type Ref, type ShallowRef } from 'vue'
import { useWorld } from '@/stores/world'

interface Shared { rows: ShallowRef<any[]>; refs: number; stop: () => void }
const shared = new Map<string, Shared>()

/**
 * Live rows of a child collection (posts, inventory, …) for one parent value.
 * Several components asking for the same rows share one Firestore listener.
 */
export function useRows<T>(collection: string, field: string, value: Ref<string | null | undefined> | (() => string | null | undefined), sortKey: string | null = 'order'): ShallowRef<T[]> {
  const world = useWorld()
  const out = shallowRef<T[]>([])
  let key: string | null = null

  const release = () => {
    if (!key) return
    const s = shared.get(key)
    if (s && --s.refs <= 0) { s.stop(); shared.delete(key) }
    key = null
  }

  watch([typeof value === 'function' ? value : () => value.value, () => world.wid, () => world.role, () => world.status], ([v]) => {
    release()
    if (!v || !world.wid || world.status !== 'ready') { out.value = []; return }
    key = `${world.wid}|${world.role}|${collection}|${field}|${v}|${sortKey}`
    let s = shared.get(key)
    if (!s) {
      const rows = shallowRef<any[]>([])
      const stop = world.watchRows<any>(collection, field, v as string, (r) => { rows.value = r }, sortKey as any)
      s = { rows, refs: 0, stop }
      shared.set(key, s)
    }
    s.refs++
    const src = s.rows
    out.value = src.value
    stopInner?.()
    stopInner = watch(src, (r) => { out.value = r })
  }, { immediate: true })

  let stopInner: (() => void) | null = null
  onBeforeUnmount(() => { stopInner?.(); release() })
  return out as ShallowRef<T[]>
}
