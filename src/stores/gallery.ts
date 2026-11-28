import { defineStore } from 'pinia'
import { computed, shallowRef, watch } from 'vue'
import { writeBatch } from 'firebase/firestore'
import { db } from '@/firebase'
import { useWorld } from './world'
import { syncCollection, type SyncHandle } from '@/data/sync'
import { docRef, narrows } from '@/data/access'
import { uploadImage } from '@/data/images'
import { now } from '@/data/util'
import type { ImageMeta, Visibility } from '@/model/types'

/** World gallery: image metadata is delta-synced lazily (only when a picker or the gallery opens). */
export const useGallery = defineStore('gallery', () => {
  const world = useWorld()
  const images = shallowRef(new Map<string, ImageMeta>())
  let handle: SyncHandle | null = null
  let forWorld: string | null = null
  let starting: Promise<void> | null = null
  let gen = 0

  watch(() => [world.wid, world.role], () => { stop() })

  function stop() {
    gen++
    handle?.stop()
    handle = null
    forWorld = null
    starting = null
    images.value = new Map()
  }

  async function ensure() {
    if (!world.wid) return
    if (forWorld === world.wid && starting) return starting
    stop()
    const myGen = gen
    forWorld = world.wid
    starting = (async () => {
      const h = await syncCollection<ImageMeta>(world.access, 'images', world.world?.aclVersion ?? 0, (ups, rem) => {
        if (myGen !== gen) return
        const m = new Map(images.value)
        for (const u of ups) m.set(u.id, u)
        for (const r of rem) m.delete(r)
        images.value = m
      }, (e) => console.warn('gallery sync', e))
      if (myGen !== gen) { h.stop(); return }
      handle = h
      await h.ready
    })()
    return starting
  }

  const list = computed(() => [...images.value.values()].filter((i) => !i.deleted).sort((a, b) => b.createdAt - a.createdAt))
  const folders = computed(() => [...new Set(list.value.map((i) => i.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')))

  async function upload(files: File[], opts: { folder?: string; visibility?: Visibility; allowedUids?: string[] } = {}) {
    const out: ImageMeta[] = []
    for (const f of files) {
      const meta = await uploadImage(world.access, f, { folder: opts.folder ?? '', visibility: opts.visibility ?? (world.isMaster ? 'master' : 'members'), allowedUids: opts.allowedUids })
      images.value = new Map(images.value).set(meta.id, meta)
      out.push(meta)
    }
    return out
  }

  async function update(id: string, patch: Partial<ImageMeta>) {
    const prev = images.value.get(id)
    if (!prev) return
    const next = { ...prev, ...patch, updatedAt: now() }
    images.value = new Map(images.value).set(id, next)
    const b = writeBatch(db)
    b.update(docRef(world.wid!, 'images', id), { ...patch, updatedAt: next.updatedAt })
    if ('visibility' in patch || 'allowedUids' in patch) {
      for (let c = 0; c < (prev.chunkCount ?? 1); c++) b.update(docRef(world.wid!, 'imageChunks', `${id}_${c}`), { visibility: next.visibility, allowedUids: next.allowedUids ?? [] })
      if (narrows(prev, next)) await world.bumpAcl()
    }
    await b.commit()
  }

  /** Soft-delete the metadata (so other browsers' caches learn about it) and free the bytes. */
  async function remove(id: string) {
    const prev = images.value.get(id)
    if (!prev) return
    const b = writeBatch(db)
    b.update(docRef(world.wid!, 'images', id), { deleted: true, thumb: '', updatedAt: now() })
    for (let c = 0; c < (prev.chunkCount ?? 1); c++) b.delete(docRef(world.wid!, 'imageChunks', `${id}_${c}`))
    await b.commit()
    images.value = new Map(images.value).set(id, { ...prev, deleted: true })
  }

  return { images, list, folders, ensure, upload, update, remove, stop }
})
