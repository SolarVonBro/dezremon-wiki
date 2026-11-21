<script setup lang="ts">
// Sidebar list of markers grouped by marker group, with search and per-group visibility toggles.
import { computed, ref } from 'vue'
import { typeDef } from '@/model/entityTypes'
import Icon from '@/components/common/Icon.vue'
import MarkerGlyph from './MarkerGlyph.vue'
import { NO_GROUP, norm, type ListItem } from './mapUtils'
import type { MapGroup } from '@/model/types'

const props = defineProps<{ items: ListItem[]; groups: MapGroup[]; hidden: Set<string>; editing: boolean; activeId: string | null }>()
const emit = defineEmits<{ focus: [id: string]; edit: [id: string]; toggle: [groupKey: string] }>()

const q = ref('')
const collapsed = ref(new Set<string>())

const filtered = computed(() => {
  const s = norm(q.value.trim())
  if (!s) return props.items
  return props.items.filter((it) => norm(it.name).includes(s) ||
    (it.entity && (norm(it.entity.name).includes(s) || norm(it.entity.kind).includes(s) || (it.entity.aliases ?? []).some((a) => norm(a).includes(s)))))
})

const sections = computed(() => {
  const by = new Map<string, ListItem[]>()
  for (const it of filtered.value) {
    if (!by.has(it.group)) by.set(it.group, [])
    by.get(it.group)!.push(it)
  }
  const out = props.groups.map((g) => ({ key: g.id, name: g.name || 'Без названия', items: by.get(g.id) ?? [] }))
  out.push({ key: NO_GROUP, name: props.groups.length ? 'Без группы' : 'Метки', items: by.get(NO_GROUP) ?? [] })
  // empty groups stay visible for editors (so they can be seen and toggled), never while searching
  return out.filter((s) => s.items.length || (props.editing && !q.value && s.key !== NO_GROUP))
})

function fold(key: string) {
  const s = new Set(collapsed.value)
  if (s.has(key)) s.delete(key); else s.add(key)
  collapsed.value = s
}
</script>

<template>
  <div class="ml">
    <div class="ml-search">
      <Icon name="search" :size="15" class="faint" />
      <input v-model="q" class="input input-sm" type="search" placeholder="Поиск меток…" aria-label="Поиск меток" />
    </div>
    <div class="ml-scroll">
      <section v-for="s in sections" :key="s.key" class="ml-sec">
        <header class="ml-head">
          <button type="button" class="ml-fold" :aria-expanded="!collapsed.has(s.key)" @click="fold(s.key)">
            <Icon :name="collapsed.has(s.key) && !q ? 'chevron-right' : 'chevron-down'" :size="14" />
            <span class="ellipsis">{{ s.name }}</span>
            <span class="ml-count">{{ s.items.length }}</span>
          </button>
          <button type="button" class="icon-btn ml-eye" :class="{ off: hidden.has(s.key) }" :title="hidden.has(s.key) ? 'Показать на карте' : 'Скрыть с карты'" @click="emit('toggle', s.key)">
            <Icon :name="hidden.has(s.key) ? 'eye-off' : 'eye'" :size="15" />
          </button>
        </header>
        <ul v-if="!collapsed.has(s.key) || q" class="ml-items">
          <li v-for="it in s.items" :key="it.marker.id" class="ml-li">
            <button type="button" class="ml-item" :class="{ on: it.marker.id === activeId, dim: hidden.has(s.key) }" @click="emit('focus', it.marker.id)">
              <MarkerGlyph :marker="it.marker" :entity="it.entity" />
              <span class="ml-text">
                <span class="ml-name ellipsis">{{ it.name }}</span>
                <span v-if="it.entity" class="ml-sub ellipsis">{{ typeDef(it.entity.type).label }}{{ it.entity.kind ? ' · ' + it.entity.kind : '' }}</span>
              </span>
              <span v-if="it.marker.visibility === 'master'" class="ml-lock" title="Только мастерам"><Icon name="lock" :size="13" /></span>
            </button>
            <button v-if="editing" type="button" class="icon-btn ml-edit" title="Изменить метку" @click="emit('edit', it.marker.id)"><Icon name="pencil" :size="14" /></button>
          </li>
          <li v-if="!s.items.length" class="ml-empty">Пусто</li>
        </ul>
      </section>
      <p v-if="!items.length" class="ml-none">
        {{ editing ? 'Меток пока нет. Выберите инструмент на панели над картой и щёлкните по карте.' : 'На карте пока нет меток.' }}
      </p>
      <p v-else-if="!filtered.length" class="ml-none">Ничего не найдено.</p>
    </div>
  </div>
</template>

<style scoped>
.ml { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
.ml-search { display: flex; align-items: center; gap: 6px; padding: 10px 10px 8px; border-bottom: 1px solid var(--border); }
.ml-scroll { flex: 1 1 auto; overflow-y: auto; padding: 4px 6px 10px; min-height: 0; }
.ml-sec + .ml-sec { margin-top: 4px; }
.ml-head { display: flex; align-items: center; gap: 2px; position: sticky; top: 0; background: var(--surface); z-index: 1; }
.ml-fold { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 6px 4px; border: 0; background: none; cursor: pointer; text-align: left;
  font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--text-muted); }
.ml-fold:hover { color: var(--text); }
.ml-count { margin-left: auto; font-size: 11px; font-weight: 600; background: var(--surface-3); color: var(--text-muted); padding: 0 6px; border-radius: 8px; letter-spacing: 0; }
.ml-eye { width: 28px; height: 28px; }
.ml-eye.off { color: var(--text-faint); }
.ml-items { list-style: none; margin: 0; padding: 0; }
.ml-li { display: flex; align-items: center; }
.ml-item { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 5px 6px; border: 0; border-radius: 6px; background: none; cursor: pointer; text-align: left; color: var(--text); }
.ml-item:hover { background: var(--surface-2); }
.ml-item.on { background: var(--accent-soft); }
.ml-item.dim { opacity: .5; }
.ml-text { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
.ml-name { font-size: 14px; }
.ml-sub { font-size: 11.5px; color: var(--text-faint); }
.ml-lock { color: var(--text-faint); display: inline-flex; }
.ml-edit { width: 28px; height: 28px; flex: 0 0 28px; }
.ml-empty { font-size: 12.5px; color: var(--text-faint); padding: 2px 8px 6px 26px; }
.ml-none { font-size: 13px; color: var(--text-muted); padding: 12px 8px; margin: 0; }
</style>
