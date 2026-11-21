<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { sanitize } from '@/data/html'
import { imageUrl } from '@/data/images'
import { useWorld } from '@/stores/world'
import { typeDef } from '@/model/entityTypes'
import { escapeHtml, slugify } from '@/data/util'
import { showPreview, hidePreview } from './preview'
import { openLightbox } from './lightbox'
import type { Heading } from './types'

const props = defineProps<{ html: string }>()
const emit = defineEmits<{ headings: [h: Heading[]] }>()
const world = useWorld()
const router = useRouter()
const root = ref<HTMLElement | null>(null)

async function render() {
  const el = root.value
  if (!el) return
  el.innerHTML = sanitize(props.html || '')
  await nextTick()
  // mentions: current names, links, broken references
  el.querySelectorAll<HTMLAnchorElement>('a[data-entity-id]').forEach((a) => {
    const id = a.getAttribute('data-entity-id')!
    const e = world.get(id)
    if (!e) {
      const span = document.createElement('span')
      span.className = 'mention mention-missing'
      span.textContent = a.textContent ?? ''
      span.title = 'Статья недоступна или удалена'
      a.replaceWith(span)
      return
    }
    if (!a.hasAttribute('data-label')) a.textContent = e.name
    a.href = router.resolve({ name: 'entity', params: { wid: world.wid!, eid: id } }).href
    a.classList.add('mention')
    a.style.setProperty('--mention-color', typeDef(e.type).color)
    a.removeAttribute('target')
  })
  // images
  el.querySelectorAll<HTMLImageElement>('img[data-image-id]').forEach((img) => {
    const id = img.getAttribute('data-image-id')!
    img.loading = 'lazy'
    img.classList.add('img-loading')
    imageUrl(world.access, id).then((u) => { img.src = u; img.classList.remove('img-loading') })
      .catch(() => { img.classList.remove('img-loading'); img.classList.add('img-broken'); img.alt = img.alt || 'Изображение недоступно' })
  })
  // heading anchors for the table of contents
  const used = new Set<string>()
  const hs: Heading[] = []
  el.querySelectorAll<HTMLElement>('h1, h2, h3, h4').forEach((h) => {
    let id = 'h-' + slugify(h.textContent ?? '')
    while (used.has(id)) id += '-1'
    used.add(id)
    h.id = id
    hs.push({ id, text: h.textContent ?? '', level: Number(h.tagName[1]) })
  })
  emit('headings', hs)
}

watch(() => [props.html, world.entities], () => { void render() }, { flush: 'post' })
watch(root, (r) => { if (r) void render() })

function onClick(e: MouseEvent) {
  const t = e.target as HTMLElement
  const a = t.closest('a[data-entity-id]') as HTMLAnchorElement | null
  if (a && !e.ctrlKey && !e.metaKey && e.button === 0) {
    e.preventDefault()
    hidePreview()
    void router.push({ name: 'entity', params: { wid: world.wid!, eid: a.getAttribute('data-entity-id')! } })
    return
  }
  if (t.tagName === 'IMG' && !t.closest('a')) {
    const imgs = [...(root.value?.querySelectorAll<HTMLImageElement>('img') ?? [])].filter((i) => i.src)
    openLightbox(imgs.map((i) => ({ src: i.src, caption: i.closest('.wiki-img')?.querySelector('.wiki-img-cap')?.textContent || i.alt })), imgs.indexOf(t as HTMLImageElement))
  }
}
let hoverTimer: ReturnType<typeof setTimeout> | null = null
function onOver(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a[data-entity-id]') as HTMLElement | null
  if (!a) return
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = setTimeout(() => showPreview(a, a.getAttribute('data-entity-id')!), 350)
}
function onOut(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest('a[data-entity-id]')
  if (!a) return
  if (hoverTimer) clearTimeout(hoverTimer)
  hidePreview(250)
}
onBeforeUnmount(() => { if (hoverTimer) clearTimeout(hoverTimer); hidePreview() })
defineExpose({ escapeHtml })
</script>

<template>
  <div ref="root" class="prose wiki-view" @click="onClick" @mouseover="onOver" @mouseout="onOut" />
</template>
