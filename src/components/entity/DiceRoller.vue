<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWorld } from '@/stores/world'
import Icon from '@/components/common/Icon.vue'
import { rollFormula, type RollResult } from '@/data/dice'
import type { Entity } from '@/model/types'

const props = defineProps<{ entity: Entity; editing: boolean }>()
const world = useWorld()
const formula = ref<string>(props.entity.fields?.formula || '1d20')
const history = ref<RollResult[]>([])
const character = computed(() => world.get(props.entity.fields?.characterId))
const attrs = computed(() => {
  const m: Record<string, number> = {}
  for (const a of character.value?.attributes ?? []) { const n = Number(a.value); if (!isNaN(n)) m[a.name.toLowerCase()] = n }
  return m
})
function roll() {
  try { history.value.unshift(rollFormula(formula.value, attrs.value)) } catch (e: any) { history.value.unshift({ formula: formula.value, total: NaN, detail: e?.message ?? 'ошибка', at: Date.now() }) }
  history.value = history.value.slice(0, 30)
}
const QUICK = ['1d20', '2d20kh1', '2d20kl1', '1d100', '4d6kh3', '1d6', '2d6', '1d8', '1d10', '1d12']
</script>

<template>
  <div class="card card-pad" style="max-width: 720px">
    <h3 class="panel-title"><Icon name="dices" /> Броски кубов</h3>
    <p class="muted small">Формулы: <code>2d6+3</code>, <code>4d6kh3</code> (лучшие 3), <code>2d20kl1</code> (худший), атрибуты персонажа в фигурных скобках: <code>1d20 + {Сила}</code>.<span v-if="character"> Атрибуты берутся у «{{ character.name }}».</span></p>
    <form class="row gap" @submit.prevent="roll">
      <input v-model="formula" class="input grow" style="font-family: var(--font-mono)" />
      <button class="btn btn-primary"><Icon name="dice5" :size="16" /> Бросить</button>
    </form>
    <div class="row wrap gap-sm" style="margin-top: 8px">
      <button v-for="q in QUICK" :key="q" class="chip" @click="formula = q; roll()">{{ q }}</button>
    </div>
    <div class="stack-sm" style="margin-top: 16px">
      <div v-for="(h, i) in history" :key="h.at + '-' + i" class="roll" :class="{ last: i === 0 }">
        <span class="roll-total">{{ isNaN(h.total) ? '×' : h.total }}</span>
        <span><code>{{ h.formula }}</code><br /><span class="faint small">{{ h.detail }}</span></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.roll { display: flex; align-items: center; gap: 14px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px; }
.roll.last { border-color: var(--accent); background: var(--accent-soft); }
.roll-total { font-family: var(--font-head); font-size: 30px; font-weight: 700; min-width: 54px; text-align: center; color: var(--accent); }
</style>
