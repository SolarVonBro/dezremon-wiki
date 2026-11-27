<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Pf2eLang, Pf2eMeta } from '@/model/pf2e'
import { formatAvgNumber, type Pf2eRollResult, type RollVerdict } from '@/data/pf2eRoll'
import { localizeDamageType } from '@/data/pf2eFormat'
import Icon from '@/components/common/Icon.vue'

const props = defineProps<{
  result: Pf2eRollResult
  history: Pf2eRollResult[]
  lang: Pf2eLang
  meta: Pf2eMeta | null
}>()

const emit = defineEmits<{
  reroll: []
  close: []
  select: [r: Pf2eRollResult]
}>()

const mult = ref<1 | 2 | 0.5>(1)
watch(() => props.result.formula.raw, () => { mult.value = 1 })

const effectiveTotal = computed(() => {
  if (mult.value === 2) return props.result.total * 2
  if (mult.value === 0.5) return Math.floor(props.result.total / 2)
  return props.result.total
})
const effectiveAvg = computed(() => props.result.avg * mult.value)
const effectiveMin = computed(() => (mult.value === 0.5 ? Math.floor(props.result.min / 2) : props.result.min * mult.value))
const effectiveMax = computed(() => (mult.value === 0.5 ? Math.floor(props.result.max / 2) : props.result.max * mult.value))

const avgPosPct = computed(() => {
  const span = props.result.max - props.result.min
  if (span <= 0) return 50
  return Math.max(0, Math.min(100, ((props.result.avg - props.result.min) / span) * 100))
})
const valPosPct = computed(() => Math.max(0, Math.min(100, props.result.percentile * 100)))

const fillLeftPct = computed(() => Math.min(avgPosPct.value, valPosPct.value))
const fillWidthPct = computed(() => Math.abs(valPosPct.value - avgPosPct.value))

const VERDICT_META: Record<RollVerdict, { ru: string; en: string; cls: string }> = {
  great: { ru: 'Значительно выше среднего', en: 'Well above average', cls: 'v-great' },
  high: { ru: 'Выше среднего', en: 'Above average', cls: 'v-high' },
  avg: { ru: 'Около среднего', en: 'Near average', cls: 'v-avg' },
  low: { ru: 'Ниже среднего', en: 'Below average', cls: 'v-low' },
  poor: { ru: 'Значительно ниже среднего', en: 'Well below average', cls: 'v-poor' },
}

const verdictInfo = computed(() => VERDICT_META[props.result.verdict])

const diffText = computed(() => {
  const d = effectiveTotal.value - effectiveAvg.value
  const rounded = Math.round(d * 10) / 10
  if (Math.abs(rounded) < 0.05) return props.lang === 'ru' ? 'точно в среднее' : 'exact average'
  const sign = rounded > 0 ? '+' : '−'
  const absStr = formatAvgNumber(Math.abs(rounded))
  const pct = effectiveAvg.value !== 0 ? Math.round((d / Math.abs(effectiveAvg.value)) * 100) : 0
  const pctStr = pct !== 0 ? ` (${pct > 0 ? '+' : '−'}${Math.abs(pct)}%)` : ''
  return `${sign}${absStr}${pctStr}`
})
</script>

<template>
  <div class="roll-panel" role="region" :aria-label="lang === 'ru' ? 'Результат броска' : 'Roll result'">
    <header class="rp-head">
      <div class="row gap-sm wrap grow" style="min-width: 0">
        <Icon name="dices" :size="16" class="rp-ic" />
        <b class="rp-expr">{{ result.formula.displayExpr }}</b>
        <template v-for="(c, ci) in result.components" :key="ci">
          <span v-for="t in c.types" :key="t" class="badge">{{ localizeDamageType(t, lang, meta) }}</span>
        </template>
        <span v-if="result.formula.note" class="faint small">({{ result.formula.note }})</span>
      </div>

      <div class="row gap-sm" style="flex-shrink: 0">
        <div class="mult-grp" role="group" :aria-label="lang === 'ru' ? 'Множитель урона' : 'Damage multiplier'">
          <button type="button" :class="{ on: mult === 0.5 }" :title="lang === 'ru' ? 'Половина (успешный простой спасбросок)' : 'Half (basic save success)'" @click="mult = 0.5">½</button>
          <button type="button" :class="{ on: mult === 1 }" :title="lang === 'ru' ? 'Обычный урон' : 'Normal'" @click="mult = 1">×1</button>
          <button type="button" :class="{ on: mult === 2 }" :title="lang === 'ru' ? 'Двойной урон (крит)' : 'Double (critical)'" @click="mult = 2">×2</button>
        </div>
        <button type="button" class="btn btn-sm btn-primary" @click="emit('reroll')">
          <Icon name="rotate-cw" :size="13" /> {{ lang === 'ru' ? 'Бросить ещё' : 'Reroll' }}
        </button>
        <button type="button" class="icon-btn" :title="lang === 'ru' ? 'Скрыть' : 'Close'" @click="emit('close')">
          <Icon name="x" :size="14" />
        </button>
      </div>
    </header>

    <div class="rp-main">
      <div class="rp-total-box" :class="verdictInfo.cls">
        <div class="rp-total">{{ effectiveTotal }}</div>
        <div class="rp-sub">
          {{ lang === 'ru' ? 'ср.' : 'avg' }} <b>{{ formatAvgNumber(effectiveAvg) }}</b>
        </div>
      </div>

      <div class="rp-stats grow">
        <div class="row gap-sm wrap" style="align-items: center">
          <span class="verdict-pill" :class="verdictInfo.cls">{{ verdictInfo[lang] }}</span>
          <span class="small" style="font-weight: 600">{{ diffText }}</span>
          <span class="faint small">· {{ lang === 'ru' ? 'Диапазон' : 'Range' }}: {{ effectiveMin }}–{{ effectiveMax }}</span>
        </div>

        <!-- Visual Gauge: Min --- Avg --- Max with Rolled Marker -->
        <div class="gauge-wrap" :title="`${lang === 'ru' ? 'Мин' : 'Min'}: ${effectiveMin}, ${lang === 'ru' ? 'Среднее' : 'Avg'}: ${formatAvgNumber(effectiveAvg)}, ${lang === 'ru' ? 'Макс' : 'Max'}: ${effectiveMax}`">
          <div class="gauge-track">
            <div
              class="gauge-fill"
              :class="result.diff >= 0 ? 'above' : 'below'"
              :style="{ left: `${fillLeftPct}%`, width: `${fillWidthPct}%` }"
            />
            <div class="gauge-avg" :style="{ left: `${avgPosPct}%` }" />
            <div class="gauge-dot" :class="verdictInfo.cls" :style="{ left: `${valPosPct}%` }" />
          </div>
          <div class="gauge-labels">
            <span>{{ effectiveMin }}</span>
            <span class="gauge-avg-lbl" :style="{ left: `${avgPosPct}%` }">
              {{ lang === 'ru' ? 'ср.' : 'avg' }} {{ formatAvgNumber(effectiveAvg) }}
            </span>
            <span>{{ effectiveMax }}</span>
          </div>
        </div>

        <!-- Individual Dice Breakdown -->
        <div class="rp-breakdown">
          <div v-for="(comp, ci) in result.components" :key="ci" class="rp-comp">
            <span v-if="result.components.length > 1" class="small muted">
              {{ comp.types.length ? comp.types.map((t) => localizeDamageType(t, lang, meta)).join(', ') : comp.displayExpr }}:
              <b>{{ comp.subtotal }}</b>
            </span>
            <template v-for="(g, gi) in comp.groups" :key="gi">
              <span v-if="g.sign < 0" class="faint">−</span>
              <span
                v-for="(val, ri) in g.rolls"
                :key="ri"
                class="die-chip"
                :class="{ max: val === g.sides, min: val === 1 }"
                :title="`d${g.sides}`"
              >
                {{ val }}<small>d{{ g.sides }}</small>
              </span>
            </template>
            <span v-if="comp.flat !== 0" class="die-flat">
              {{ comp.flat > 0 ? `+${comp.flat}` : `−${-comp.flat}` }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="history.length > 1" class="rp-hist">
      <span class="faint small">{{ lang === 'ru' ? 'История:' : 'Recent:' }}</span>
      <button
        v-for="(h, hi) in history"
        :key="h.rolledAt + '-' + hi"
        type="button"
        class="hist-chip"
        :class="[VERDICT_META[h.verdict].cls, { on: h === result }]"
        :title="`${h.formula.displayExpr} → ${h.total} (${lang === 'ru' ? 'ср.' : 'avg'} ${formatAvgNumber(h.avg)})`"
        @click="emit('select', h)"
      >
        {{ h.total }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.roll-panel {
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.rp-ic { color: var(--accent); flex-shrink: 0; }
.rp-expr { font-family: var(--font-mono); font-size: 13.5px; }

.mult-grp { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 6px; overflow: hidden; }
.mult-grp button {
  border: 0; background: var(--surface); padding: 3px 8px; font-size: 12px; font-weight: 700;
  cursor: pointer; color: var(--text-muted);
}
.mult-grp button.on { background: var(--accent); color: var(--accent-fg); }

.rp-main { display: flex; align-items: stretch; gap: 12px; flex-wrap: wrap; }
.rp-total-box {
  min-width: 78px; padding: 8px 12px; border-radius: 8px; background: var(--surface);
  border: 2px solid var(--border-strong); display: flex; flex-direction: column;
  align-items: center; justify-content: center; flex-shrink: 0;
}
.rp-total { font-family: var(--font-head); font-size: 32px; font-weight: 700; line-height: 1; }
.rp-sub { font-size: 11.5px; color: var(--text-muted); margin-top: 3px; }

.rp-total-box.v-great { border-color: var(--success); }
.rp-total-box.v-great .rp-total { color: var(--success); }
.rp-total-box.v-high { border-color: color-mix(in srgb, var(--success) 65%, var(--accent)); }
.rp-total-box.v-high .rp-total { color: var(--success); }
.rp-total-box.v-avg { border-color: var(--accent); }
.rp-total-box.v-avg .rp-total { color: var(--accent); }
.rp-total-box.v-low { border-color: var(--warning); }
.rp-total-box.v-low .rp-total { color: var(--warning); }
.rp-total-box.v-poor { border-color: var(--danger); }
.rp-total-box.v-poor .rp-total { color: var(--danger); }

.rp-stats { min-width: 220px; display: flex; flex-direction: column; gap: 8px; }
.verdict-pill {
  display: inline-flex; padding: 2px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700;
  background: var(--surface-3); color: var(--text);
}
.verdict-pill.v-great { background: color-mix(in srgb, var(--success) 24%, transparent); color: var(--success); }
.verdict-pill.v-high { background: color-mix(in srgb, var(--success) 16%, transparent); color: var(--success); }
.verdict-pill.v-avg { background: var(--accent-soft); color: var(--accent); }
.verdict-pill.v-low { background: color-mix(in srgb, var(--warning) 22%, transparent); color: var(--warning); }
.verdict-pill.v-poor { background: color-mix(in srgb, var(--danger) 20%, transparent); color: var(--danger); }

.gauge-wrap { display: flex; flex-direction: column; gap: 3px; }
.gauge-track {
  position: relative; height: 8px; border-radius: 999px; background: var(--surface-3);
  border: 1px solid var(--border);
}
.gauge-fill { position: absolute; top: 0; bottom: 0; border-radius: 999px; }
.gauge-fill.above { background: color-mix(in srgb, var(--success) 55%, transparent); }
.gauge-fill.below { background: color-mix(in srgb, var(--warning) 55%, transparent); }
.gauge-avg {
  position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--text-muted);
  transform: translateX(-50%);
}
.gauge-dot {
  position: absolute; top: 50%; width: 14px; height: 14px; border-radius: 50%;
  transform: translate(-50%, -50%); border: 2px solid var(--surface); box-shadow: 0 1px 4px rgba(0,0,0,.35);
  background: var(--accent);
}
.gauge-dot.v-great, .gauge-dot.v-high { background: var(--success); }
.gauge-dot.v-low { background: var(--warning); }
.gauge-dot.v-poor { background: var(--danger); }

.gauge-labels {
  position: relative; display: flex; justify-content: space-between;
  font-size: 11px; color: var(--text-faint); font-family: var(--font-mono);
}
.gauge-avg-lbl { position: absolute; transform: translateX(-50%); color: var(--text-muted); font-weight: 600; }

.rp-breakdown { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.rp-comp { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.die-chip {
  display: inline-flex; align-items: baseline; gap: 2px; padding: 1px 6px; border-radius: 5px;
  background: var(--surface); border: 1px solid var(--border-strong);
  font-family: var(--font-mono); font-size: 12.5px; font-weight: 700;
}
.die-chip small { font-size: 10px; font-weight: 500; color: var(--text-faint); }
.die-chip.max { border-color: var(--success); color: var(--success); background: color-mix(in srgb, var(--success) 10%, var(--surface)); }
.die-chip.min { border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); color: var(--danger); }
.die-flat { font-family: var(--font-mono); font-size: 12.5px; font-weight: 700; color: var(--text-muted); padding: 0 3px; }

.rp-hist {
  display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
  padding-top: 6px; border-top: 1px solid var(--border);
}
.hist-chip {
  border: 1px solid var(--border-strong); background: var(--surface); border-radius: 999px;
  padding: 1px 8px; font-family: var(--font-mono); font-size: 12px; font-weight: 700; cursor: pointer;
  color: var(--text-muted);
}
.hist-chip.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
.hist-chip.v-great, .hist-chip.v-high { border-color: color-mix(in srgb, var(--success) 55%, var(--border)); }
.hist-chip.v-poor { border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); }
</style>
