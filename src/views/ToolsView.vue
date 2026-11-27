<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { watchStatSets } from '@/data/statSets'
import { watchPf2eCharacters } from '@/data/pf2eCharacters'
import { plural } from '@/data/util'
import Icon from '@/components/common/Icon.vue'

const session = useSession()
const route = useRoute()
const router = useRouter()

const statCount = ref<number | null>(null)
const pf2eCount = ref<number | null>(null)
let stops: Array<() => void> = []

watch(() => [session.ready, session.user?.uid] as const, ([ready, u]) => {
  stops.forEach((s) => s())
  stops = []
  if (ready && !u) { void router.replace({ name: 'login', query: { next: route.fullPath } }); return }
  if (!u) return
  stops.push(watchStatSets(u, (rows) => { statCount.value = rows.length }))
  stops.push(watchPf2eCharacters(u, (rows) => { pf2eCount.value = rows.length }))
}, { immediate: true })
onBeforeUnmount(() => stops.forEach((s) => s()))
</script>

<template>
  <div class="page">
    <div class="row gap wrap" style="margin-bottom: 10px">
      <h1 class="grow" style="margin: 0">Инструменты</h1>
    </div>
    <p class="muted" style="margin: 0 0 22px; max-width: 780px">
      Утилиты для подготовки к играм: расчёт характеристик, справочники и наборы заклинаний и снаряжения Pathfinder 2e.
      Ваши наборы и персонажи сохраняются в аккаунте и доступны на любом устройстве.
    </p>

    <div class="tool-grid">
      <RouterLink class="tool-card" :to="{ name: 'toolStats' }">
        <div class="tc-icon"><Icon name="calculator" :size="30" /></div>
        <div class="tc-body">
          <div class="row gap-sm wrap">
            <h2 class="tc-title">Калькулятор характеристик</h2>
            <span class="badge">D&amp;D 5e</span>
            <span v-if="statCount !== null" class="badge">{{ statCount }} {{ plural(statCount, 'набор', 'набора', 'наборов') }}</span>
          </div>
          <p class="muted small tc-desc">
            Поинтбай (стандартный и расширенный 3–18), стандартный набор, броски по любым формулам костей с историей и перебросами,
            ручной ввод, бонусы от расы, черт и классов, Здравомыслие и Честь, итоговая сводка и быстрое копирование.
          </p>
          <span class="tc-cta">Открыть калькулятор <Icon name="arrow-right" :size="14" /></span>
        </div>
      </RouterLink>

      <RouterLink class="tool-card" :to="{ name: 'toolPf2e' }">
        <div class="tc-icon tc-icon-pf"><Icon name="sparkles" :size="30" /></div>
        <div class="tc-body">
          <div class="row gap-sm wrap">
            <h2 class="tc-title">Pathfinder 2e: Заклинания и снаряжение</h2>
            <span class="badge">PF2e Remaster</span>
            <span v-if="pf2eCount !== null" class="badge">{{ pf2eCount }} {{ plural(pf2eCount, 'персонаж', 'персонажа', 'персонажей') }}</span>
          </div>
          <p class="muted small tc-desc">
            Персонажи PF2e со списками заклинаний (традиции, ключевые характеристики, мастерство, ячейки, фокус, ритуалы)
            и полноценным инвентарём с контейнерами, точным подсчётом массы (Bulk), инвестированием и монетами.
            Полные актуальные библиотеки всех официальных заклинаний и предметов на русском и английском с расширенными фильтрами.
          </p>
          <span class="tc-cta">Открыть PF2e <Icon name="arrow-right" :size="14" /></span>
        </div>
      </RouterLink>
    </div>

    <div class="quick-links">
      <div class="section-title">Быстрый переход к справочникам PF2e</div>
      <div class="row gap wrap">
        <RouterLink class="btn" :to="{ name: 'toolPf2e', params: { tab: 'spells' } }">
          <Icon name="book-open" :size="16" /> Библиотека заклинаний PF2e
        </RouterLink>
        <RouterLink class="btn" :to="{ name: 'toolPf2e', params: { tab: 'items' } }">
          <Icon name="backpack" :size="16" /> Библиотека предметов PF2e
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { max-width: 1180px; margin: 0 auto; padding: 22px 24px 60px; }
.tool-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
.tool-card {
  display: flex; align-items: flex-start; gap: 16px; padding: 18px 20px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  color: var(--text); text-decoration: none !important; box-shadow: var(--shadow);
  transition: border-color .14s, transform .14s, box-shadow .14s;
}
.tool-card:hover { border-color: var(--accent); transform: translateY(-2px); }
.tc-icon {
  width: 56px; height: 56px; border-radius: 14px; flex-shrink: 0;
  background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 42%, var(--surface-2)), var(--surface-3));
  color: var(--accent-fg); display: flex; align-items: center; justify-content: center;
}
.tc-icon-pf {
  background: linear-gradient(135deg, color-mix(in srgb, var(--info) 46%, var(--surface-2)), color-mix(in srgb, var(--accent) 32%, var(--surface-3)));
}
.tc-body { min-width: 0; display: flex; flex-direction: column; gap: 8px; flex: 1; }
.tc-title { font-size: 23px; margin: 0; }
.tc-desc { margin: 0; line-height: 1.5; }
.tc-cta { display: inline-flex; align-items: center; gap: 5px; font-size: 13.5px; font-weight: 600; color: var(--accent); margin-top: 2px; }
.quick-links { margin-top: 26px; padding-top: 18px; border-top: 1px solid var(--border); }
@media (max-width: 720px) {
  .page { padding: 16px 14px 50px; }
  .tool-grid { grid-template-columns: minmax(0, 1fr); }
  .tool-card { flex-direction: column; gap: 12px; }
}
</style>
