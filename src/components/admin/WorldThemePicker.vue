<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useWorld } from '@/stores/world'
import Icon from '@/components/common/Icon.vue'
import { ALL_FONTS, DESIGNS, designById, type Design } from '@/themes/designs'

// World settings → «Тема мира»: one of the world themes (src/themes) or none (each reader keeps their own light or
// dark theme). Every tile is a small preview drawn by the theme itself: a `.wtheme[data-wtheme]` element gets that
// theme's tokens and background. The fonts of all the themes load while the picker is on the screen.
const world = useWorld()
const current = computed(() => designById(world.settings.theme)?.id ?? null)
const sets = computed(() => {
  const out: Array<{ name: string; items: Design[] }> = []
  for (const d of DESIGNS) {
    if (d.startsSet || !out.length) out.push({ name: d.startsSet ?? '', items: [] })
    out[out.length - 1].items.push(d)
  }
  return out
})
const labHref = computed(() => `#/design?d=${current.value ?? 'candle'}`)
const busy = ref(false)
async function pick(id: string | null) {
  if (id === current.value || busy.value) return
  busy.value = true
  try { await world.updateSettings({ theme: id }) } catch { /* the store shows the error */ } finally { busy.value = false }
}

let links: HTMLLinkElement[] = []
onMounted(() => {
  links = ALL_FONTS.map((href) => {
    const l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = href
    document.head.appendChild(l)
    return l
  })
})
onBeforeUnmount(() => links.forEach((l) => l.remove()))
</script>

<template>
  <section class="card card-pad stack">
    <h3 class="panel-title" style="margin: 0"><Icon name="palette" /> Тема мира</h3>
    <p class="small muted" style="margin: 0">
      Тема действует только на страницах этого мира — у всех, кто его открывает, — и заменяет светлую или тёмную тему,
      которую человек выбрал у себя. Все темы мира тёмные.
    </p>
    <div class="wt-grid">
      <button class="wt-tile" :class="{ on: !current }" :disabled="busy" @click="pick(null)">
        <span class="wt-prev wt-own"><b>Аа</b></span>
        <span class="wt-name">Без темы мира</span>
        <span class="wt-mood">У каждого своя тема: светлая или тёмная</span>
      </button>
    </div>
    <template v-for="s in sets" :key="s.name">
      <div class="section-title wt-set">{{ s.name }}</div>
      <div class="wt-grid">
        <button v-for="d in s.items" :key="d.id" class="wt-tile" :class="{ on: current === d.id }" :disabled="busy" :title="d.about + ' Шрифты: ' + d.fonts + '.'" @click="pick(d.id)">
          <span class="wtheme wt-prev" :data-wtheme="d.id"><i /><b>Аа</b><em>Летопись хранит…</em></span>
          <span class="wt-name">{{ d.name }}<Icon v-if="current === d.id" name="check" :size="14" class="wt-check" /></span>
          <span class="wt-mood">{{ d.mood }}</span>
        </button>
      </div>
    </template>
    <p class="small faint" style="margin: 0">
      <a :href="labHref" target="_blank" rel="noopener"><Icon name="external-link" :size="13" /> Все элементы сайта в каждой теме — лаборатория дизайна</a>
    </p>
  </section>
</template>

<style scoped>
.wt-set { margin: 6px 0 0; }
.wt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.wt-tile {
  display: flex; flex-direction: column; gap: 2px; padding: 6px 6px 8px; text-align: left; cursor: pointer; color: var(--text); font: inherit;
  border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface);
}
.wt-tile:hover:not(:disabled) { border-color: var(--border-strong); }
.wt-tile:disabled { cursor: progress; }
.wt-tile.on { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
/* the preview's background comes from the theme (its token rule paints the .wtheme element) */
.wt-prev {
  position: relative; height: 72px; margin-bottom: 4px; padding: 0 12px; border-radius: 5px; overflow: hidden;
  display: flex; flex-direction: column; justify-content: center; border: 1px solid rgb(127 127 127 / 25%);
  background-attachment: scroll !important;
}
.wt-prev b { font: 600 26px/1.05 var(--font-head); color: var(--text); }
.wt-prev em { font: italic 12px/1.3 var(--font-text); color: var(--text-muted); white-space: nowrap; }
.wt-prev i { position: absolute; right: 9px; top: 9px; width: 24px; height: 7px; border-radius: 4px; background: var(--accent); }
.wt-own { background: linear-gradient(135deg, #f4f1ea 50%, #14120f 50%); }
.wt-own b { color: #9c7a1c; text-shadow: 0 0 6px #fff; }
.wt-name { display: flex; align-items: center; gap: 5px; font-weight: 600; font-size: 14px; }
.wt-check { color: var(--accent); }
.wt-mood { font-size: 12px; line-height: 1.3; color: var(--text-faint); }
</style>
