<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { Pf2eCharacter } from '@/model/pf2e'
import { usePf2eCatalog } from '@/data/pf2eCatalog'
import { usePf2eWorkspace } from '@/data/pf2eWorkspace'
import Icon from '@/components/common/Icon.vue'

const props = defineProps<{
  active: 'chars' | 'spells' | 'items'
  chars?: Pf2eCharacter[]
  currentChar?: Pf2eCharacter | null
  detailTitle?: string
}>()

const router = useRouter()
const catalog = usePf2eCatalog()
const ws = usePf2eWorkspace()

const activeChar = computed(() => {
  if (props.currentChar) return props.currentChar
  if (!props.chars?.length || !ws.activeCharId.value) return null
  return props.chars.find((c) => c.id === ws.activeCharId.value) ?? null
})

function onSelectActiveChar(cid: string) {
  ws.setActivePf2eChar(cid)
}

function goSpells() {
  if (props.currentChar) {
    ws.setSpellPickTarget(props.currentChar.id, props.currentChar.spellLists[0]?.id ?? '', null)
    void router.push({ name: 'toolPf2e', params: { tab: 'spells' }, query: { for: props.currentChar.id } })
  } else {
    void router.push({ name: 'toolPf2e', params: { tab: 'spells' } })
  }
}

function goItems() {
  if (props.currentChar) {
    ws.setItemPickTarget(props.currentChar.id, '')
    void router.push({ name: 'toolPf2e', params: { tab: 'items' }, query: { for: props.currentChar.id } })
  } else {
    void router.push({ name: 'toolPf2e', params: { tab: 'items' } })
  }
}
</script>

<template>
  <nav class="pf-nav" aria-label="Навигация Pathfinder 2e">
    <div class="pf-nav-left">
      <RouterLink :to="{ name: 'tools' }" class="pf-crumb" title="Все инструменты">
        <Icon name="wrench" :size="14" />
        <span class="hide-xs">Инструменты</span>
      </RouterLink>
      <span class="pf-sep">/</span>
      <span class="pf-brand">PF2e</span>

      <div class="pf-tabs" role="tablist">
        <RouterLink
          :to="{ name: 'toolPf2e' }"
          class="pf-tab"
          :class="{ on: active === 'chars' && !currentChar }"
          active-class=""
          exact-active-class=""
        >
          <Icon name="users" :size="15" />
          <span>Персонажи</span>
          <span v-if="chars?.length" class="pf-cnt">{{ chars.length }}</span>
        </RouterLink>

        <button type="button" class="pf-tab" :class="{ on: active === 'spells' }" @click="goSpells">
          <Icon name="sparkles" :size="15" />
          <span>Заклинания</span>
          <span v-if="catalog.meta.value" class="pf-cnt hide-sm">{{ catalog.meta.value.spellCount }}</span>
        </button>

        <button type="button" class="pf-tab" :class="{ on: active === 'items' }" @click="goItems">
          <Icon name="backpack" :size="15" />
          <span>Предметы</span>
          <span v-if="catalog.meta.value" class="pf-cnt hide-sm">{{ catalog.meta.value.itemCount }}</span>
        </button>
      </div>
    </div>

    <div class="pf-nav-right">
      <!-- Inside a specific character sheet -->
      <template v-if="currentChar">
        <span class="pf-cur-char">
          <img v-if="currentChar.portrait" :src="currentChar.portrait" alt="" class="pf-mini-ava" />
          <Icon v-else name="user" :size="14" />
          <b class="ellipsis">{{ currentChar.name }}</b>
          <span class="faint small">Ур. {{ currentChar.level }}</span>
        </span>
      </template>

      <!-- On library or standalone page: quick active character switcher -->
      <template v-else-if="chars && chars.length">
        <div class="pf-char-switch">
          <span class="faint small hide-sm">Персонаж:</span>
          <select
            class="input input-sm pf-char-sel"
            :value="activeChar?.id ?? ''"
            title="Активный персонаж для быстрого добавления заклинаний и предметов"
            @change="onSelectActiveChar(($event.target as HTMLSelectElement).value)"
          >
            <option value="">— не выбран —</option>
            <option v-for="c in chars" :key="c.id" :value="c.id">{{ c.name }} (Ур. {{ c.level }})</option>
          </select>
          <RouterLink
            v-if="activeChar"
            :to="{ name: 'toolPf2eChar', params: { cid: activeChar.id }, query: active === 'items' ? { tab: 'inventory' } : undefined }"
            class="btn btn-sm"
            :title="`Открыть лист персонажа «${activeChar.name}»`"
          >
            <Icon name="user-round" :size="13" />
            <span class="hide-sm">К персонажу</span>
          </RouterLink>
        </div>
      </template>

      <slot name="right" />
    </div>
  </nav>
</template>

<style scoped>
.pf-nav {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
  padding: 8px 12px; margin-bottom: 14px; border-radius: 12px;
  background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow);
}
.pf-nav-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.pf-nav-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.pf-crumb {
  display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: var(--text-muted);
  text-decoration: none !important; padding: 4px 6px; border-radius: 6px;
}
.pf-crumb:hover { background: var(--surface-2); color: var(--accent); }
.pf-sep { color: var(--text-faint); font-size: 13px; }
.pf-brand { font-family: var(--font-head); font-weight: 700; font-size: 16px; color: var(--text); margin-right: 4px; }

.pf-tabs { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.pf-tab {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 8px;
  border: 1px solid transparent; background: transparent; color: var(--text-muted);
  font-size: 13.5px; font-weight: 600; cursor: pointer; text-decoration: none !important;
  transition: background .12s, color .12s, border-color .12s;
}
.pf-tab:hover { background: var(--surface-2); color: var(--text); }
.pf-tab.on { background: var(--accent-soft); color: var(--text); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.pf-tab.on .icon { color: var(--accent); }
.pf-cnt {
  padding: 0 6px; border-radius: 999px; background: var(--surface-3); color: var(--text-muted);
  font-size: 11px; font-weight: 700; font-family: var(--font-mono);
}
.pf-tab.on .pf-cnt { background: var(--accent); color: var(--accent-fg); }

.pf-cur-char {
  display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border-radius: 999px;
  background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  font-size: 13px; max-width: 260px;
}
.pf-mini-ava { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }

.pf-char-switch { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pf-char-sel { width: auto; max-width: 195px; }

@media (max-width: 600px) {
  .hide-xs { display: none; }
}
</style>
