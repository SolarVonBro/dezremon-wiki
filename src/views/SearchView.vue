<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getDoc } from 'firebase/firestore'
import { useWorld } from '@/stores/world'
import { cache } from '@/data/cache'
import { docRef } from '@/data/access'
import { buildFullText, snippet, type FullTextDoc } from '@/data/search'
import { htmlToText } from '@/data/util'
import { typeDef, allTypes } from '@/model/entityTypes'
import Icon from '@/components/common/Icon.vue'
import EntityLink from '@/components/common/EntityLink.vue'

const route = useRoute()
const router = useRouter()
const world = useWorld()
const q = ref((route.query.q as string) ?? '')
const types = ref<string[]>([])
const progress = ref<{ done: number; total: number } | null>(null)
const texts = shallowRef(new Map<string, string>())
let index: ReturnType<typeof buildFullText> | null = null
const indexVersion = ref(0)

/** Article texts are fetched once per change (cached by revision in IndexedDB) and indexed locally. */
async function prepare() {
  const cached = await cache.allBodies(world.wid!)
  const m = new Map<string, string>()
  const missing = world.list.filter((e) => {
    const c = cached.get(e.id)
    if (c && c.rev === e.bodyRev && (c.secret === (world.canReadSecrets && e.hasSecrets))) { m.set(e.id, c.text); return false }
    return e.bodyRev > 0
  })
  progress.value = { done: 0, total: missing.length }
  const queue = [...missing]
  const worker = async () => {
    while (queue.length) {
      const e = queue.shift()!
      try {
        const wantSecret = world.canReadSecrets && e.hasSecrets
        const s = await getDoc(docRef(world.wid!, wantSecret ? 'secrets' : 'bodies', e.id))
        const html = (s.data()?.html as string) ?? ''
        const text = htmlToText(html)
        m.set(e.id, text)
        void cache.putBody(world.wid!, e.id, { rev: e.bodyRev, html, text, secret: wantSecret })
      } catch { /* hidden or missing */ }
      progress.value = { done: progress.value!.done + 1, total: progress.value!.total }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  texts.value = m
  const docs: FullTextDoc[] = world.list.map((e) => ({
    id: e.id, type: e.type, name: e.name, aliases: e.aliases.join(' '), kind: e.kind, text: m.get(e.id) ?? e.excerpt,
    attrs: e.attributes.map((a) => `${a.name} ${a.value}`).join(' '), tags: e.tagIds.map((t) => world.get(t)?.name ?? '').join(' '),
  }))
  index = buildFullText(docs)
  indexVersion.value++
  progress.value = null
}
onMounted(prepare)
watch(() => world.canReadSecrets, () => void prepare())

const results = computed(() => {
  void indexVersion.value
  if (!index || !q.value.trim()) return []
  let r = index.search(q.value)
  if (types.value.length) r = r.filter((x) => types.value.includes(x.type as string))
  return r.slice(0, 100).map((x) => ({ id: x.id as string, score: x.score, snip: snippet(texts.value.get(x.id as string) ?? world.get(x.id as string)?.excerpt ?? '', q.value) }))
})
watch(q, (v) => void router.replace({ query: { q: v || undefined } }))
function mark(text: string) {
  const terms = q.value.trim().split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const esc = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  return terms.length ? esc.replace(new RegExp(`(${terms.join('|')})`, 'gi'), '<mark>$1</mark>') : esc
}
function toggleType(t: string) { types.value = types.value.includes(t) ? types.value.filter((x) => x !== t) : [...types.value, t] }
</script>

<template>
  <Teleport defer to="#crumbs"><span style="color: var(--text)">Поиск</span></Teleport>
  <div class="content content-narrow">
    <div class="page-head"><Icon name="text-search" :size="28" /><h1>Поиск по всем текстам</h1></div>
    <input v-model="q" class="input" style="font-size: 18px; padding: 12px 14px" placeholder="Что ищем? Имя, событие, слово из текста…" autofocus />
    <div class="row wrap gap-sm" style="margin: 10px 0 16px">
      <button v-for="t in allTypes().filter((x) => world.byType.get(x.key)?.length)" :key="t.key" class="chip" :class="{ on: types.includes(t.key) }" @click="toggleType(t.key)">
        <Icon :name="t.icon" :size="13" /> {{ t.plural }}
      </button>
    </div>
    <div v-if="progress" class="card card-pad muted small"><Icon name="refresh-cw" class="spin" :size="14" /> Индексирую тексты: {{ progress.done }} из {{ progress.total }}… (только при первом поиске и после изменений)</div>
    <div class="stack-sm">
      <div v-for="r in results" :key="r.id" class="card card-pad">
        <div class="row gap"><EntityLink :id="r.id" avatar /><span class="faint small">{{ typeDef(world.get(r.id)?.type ?? '').label }}</span></div>
        <p v-if="r.snip" class="small muted" style="margin: 6px 0 0; font-family: var(--font-text); font-size: 15px" v-html="mark(r.snip)" />
      </div>
      <div v-if="q.trim() && !results.length && !progress" class="empty">Ничего не найдено.</div>
    </div>
  </div>
</template>
