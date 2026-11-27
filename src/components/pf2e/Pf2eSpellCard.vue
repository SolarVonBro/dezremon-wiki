<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Pf2eLang, Pf2eMeta, Pf2eSpellIndex } from '@/model/pf2e'
import { ensureSpellDescriptions, getSpellDesc } from '@/data/pf2eCatalog'
import { formatActionSymbol, formatArea, localizeDamageType, pf2eIconUrl, RARITY_LABEL, renderPf2eHtml, SPELL_CAT_LABEL } from '@/data/pf2eFormat'
import { compilePf2eFormula, computeHeightenedSpell, executePf2eRoll, formatAvgNumber, type Pf2eFormulaContext, type Pf2eRollResult } from '@/data/pf2eRoll'
import { PF2E_TRADITIONS } from '@/data/pf2eSpellcasting'
import Icon from '@/components/common/Icon.vue'
import Pf2eRollPanel from './Pf2eRollPanel.vue'

const props = defineProps<{
  spell: Pf2eSpellIndex
  meta: Pf2eMeta | null
  lang: Pf2eLang
  standalone?: boolean
  initialRank?: number
  actorLevel?: number
}>()

// Each card has its own local language toggle synced initially with global lang
const cardLang = ref<Pf2eLang>(props.lang)
watch(() => props.lang, (l) => { cardLang.value = l })

const minRank = computed(() => Math.max(1, props.spell.baseRank || 1))
const castRank = ref<number>(Math.max(minRank.value, props.initialRank || minRank.value))
watch([() => props.spell.id, () => props.initialRank], () => {
  castRank.value = Math.max(minRank.value, props.initialRank || minRank.value)
  activeRoll.value = null
  rollHistory.value = []
})

const rawDesc = ref('')
const loadingDesc = ref(false)

async function loadDesc() {
  loadingDesc.value = true
  try {
    await ensureSpellDescriptions(cardLang.value)
    rawDesc.value = getSpellDesc(props.spell.id, cardLang.value)
  } finally {
    loadingDesc.value = false
  }
}

watch([() => props.spell.id, cardLang], () => { void loadDesc() }, { immediate: true })

const formulaCtx = computed<Pf2eFormulaContext>(() => ({
  rank: castRank.value,
  baseRank: minRank.value,
  level: castRank.value,
  actorLevel: props.actorLevel ?? Math.max(1, castRank.value * 2 - 1),
}))

const heightened = computed(() => computeHeightenedSpell(props.spell, castRank.value, formulaCtx.value))

const hasDynamicScaling = computed(() =>
  props.spell.heightenType !== 'none'
  || props.spell.cat === 'cantrip'
  || props.spell.cat === 'focus'
  || /@item\.(rank|level)|@actor\.level/i.test(rawDesc.value),
)

const descHtml = computed(() =>
  renderPf2eHtml(rawDesc.value, cardLang.value, props.meta, formulaCtx.value, heightened.value.baseOverrides),
)

// Interactive dice rolling inside card prose
const activeRoll = ref<Pf2eRollResult | null>(null)
const rollHistory = ref<Pf2eRollResult[]>([])

function runRoll(spec: string, note?: string) {
  const compiled = compilePf2eFormula(spec, formulaCtx.value)
  if (!compiled || !compiled.hasDice) return
  if (note && !compiled.note) compiled.note = note
  const res = executePf2eRoll(compiled)
  activeRoll.value = res
  rollHistory.value = [res, ...rollHistory.value].slice(0, 6)
}

function onProseClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('button.pf-roll-btn')
  if (!btn) return
  const spec = btn.dataset.rollSpec
  if (!spec) return
  e.preventDefault()
  runRoll(spec, btn.dataset.rollNote)
}

function rerollActive() {
  if (!activeRoll.value) return
  runRoll(activeRoll.value.formula.raw, activeRoll.value.formula.note)
}

const title = computed(() => (cardLang.value === 'ru' ? props.spell.ru : props.spell.en))
const subTitle = computed(() => (cardLang.value === 'ru' ? props.spell.en : props.spell.ru))
const action = computed(() => formatActionSymbol(props.spell.time, cardLang.value, props.spell.timeRu))

const rankLabel = computed(() => {
  const s = props.spell
  const cat = SPELL_CAT_LABEL[s.cat]?.[cardLang.value] ?? s.cat
  if (s.cat === 'cantrip') return cardLang.value === 'ru' ? 'Заговор' : 'Cantrip'
  return cardLang.value === 'ru' ? `${cat} ${s.baseRank} круга` : `${cat} ${s.baseRank}`
})

const defenseText = computed(() => {
  const s = props.spell
  const parts: string[] = []
  if (s.defenseKind === 'attack' || s.defenseKind === 'both') {
    parts.push(cardLang.value === 'ru' ? 'КБ (атака заклинанием)' : 'AC (spell attack)')
  }
  if (s.save) {
    const saveRu: Record<string, string> = { fortitude: 'Стойкость', reflex: 'Реакция', will: 'Воля' }
    const saveEn: Record<string, string> = { fortitude: 'Fortitude', reflex: 'Reflex', will: 'Will' }
    const name = cardLang.value === 'ru' ? saveRu[s.save] : saveEn[s.save]
    const prefix = s.basicSave ? (cardLang.value === 'ru' ? 'простой ' : 'basic ') : ''
    parts.push(prefix + name)
  }
  return parts.join(' / ')
})

const rangeText = computed(() => heightened.value.rangeOverride ?? (cardLang.value === 'ru' ? props.spell.rangeRu : props.spell.range))
const targetText = computed(() => heightened.value.targetOverride ?? (cardLang.value === 'ru' ? props.spell.targetRu : props.spell.target))
const areaText = computed(() => formatArea(heightened.value.areaType, heightened.value.areaVal, cardLang.value))
const durationText = computed(() => {
  const d = cardLang.value === 'ru' ? props.spell.durationRu : props.spell.duration
  if (props.spell.sustained) {
    const sus = cardLang.value === 'ru' ? 'поддерживаемое' : 'sustained'
    return d ? `${sus} (${d})` : sus
  }
  return d
})
const costText = computed(() => (cardLang.value === 'ru' ? props.spell.costRu : props.spell.cost))
const reqText = computed(() => (cardLang.value === 'ru' ? props.spell.reqRu : props.spell.req))

const traditionBadges = computed(() =>
  props.spell.traditions.map((t) => {
    const info = PF2E_TRADITIONS.find((x) => x.id === t)
    return { id: t, label: info ? (cardLang.value === 'ru' ? info.ru : info.en) : t, color: info?.color ?? 'var(--accent)' }
  }),
)

const traitBadges = computed(() =>
  props.spell.traits.map((t) => ({ slug: t, label: props.meta?.traits?.[t]?.[cardLang.value] ?? t })),
)
const iconSrc = computed(() => pf2eIconUrl(props.spell.img))
const standaloneHref = computed(() => `#/tools/pf2e/spell/${encodeURIComponent(props.spell.id)}`)
</script>

<template>
  <article class="pf-card">
    <header class="pfc-head">
      <img v-if="iconSrc" :src="iconSrc" :alt="title" class="pfc-icon" loading="lazy" decoding="async" />
      <div class="grow" style="min-width: 0">
        <div class="row gap-sm wrap" style="align-items: baseline">
          <h3 class="pfc-title">{{ title }}</h3>
          <span v-if="action.glyph" class="pf-act-big" :title="action.text">{{ action.glyph }}</span>
          <span v-else-if="spell.time" class="badge">{{ action.text }}</span>
        </div>
        <div v-if="subTitle && subTitle !== title" class="faint small">{{ subTitle }}</div>
      </div>

      <div class="row gap-sm" style="flex-shrink: 0">
        <span class="rank-pill">{{ rankLabel }}</span>
        <div class="lang-switch" role="group" aria-label="Язык карточки">
          <button type="button" :class="{ on: cardLang === 'ru' }" @click="cardLang = 'ru'">RU</button>
          <button type="button" :class="{ on: cardLang === 'en' }" @click="cardLang = 'en'">EN</button>
        </div>
        <a
          v-if="!standalone"
          :href="standaloneHref"
          target="_blank"
          rel="noopener noreferrer"
          class="icon-btn"
          :title="cardLang === 'ru' ? 'Открыть заклинание на отдельной странице' : 'Open spell in new tab'"
        >
          <Icon name="external-link" :size="15" />
        </a>
      </div>
    </header>

    <div class="row gap-sm wrap pfc-traits">
      <span v-if="spell.rarity !== 'common'" class="pf-trait" :class="'rar-' + spell.rarity">
        {{ RARITY_LABEL[spell.rarity]?.[cardLang] }}
      </span>
      <span v-for="tr in traitBadges" :key="tr.slug" class="pf-trait">{{ tr.label }}</span>
    </div>

    <dl class="pfc-meta">
      <template v-if="traditionBadges.length">
        <dt>{{ cardLang === 'ru' ? 'Традиции' : 'Traditions' }}</dt>
        <dd>
          <span v-for="t in traditionBadges" :key="t.id" class="trad-pill" :style="{ '--tcol': t.color }">{{ t.label }}</span>
        </dd>
      </template>
      <template v-if="spell.time">
        <dt>{{ cardLang === 'ru' ? 'Сотворение' : 'Cast' }}</dt>
        <dd>{{ action.glyph ? `${action.glyph} (${action.text})` : action.text }}</dd>
      </template>
      <template v-if="costText">
        <dt>{{ cardLang === 'ru' ? 'Стоимость' : 'Cost' }}</dt>
        <dd>{{ costText }}</dd>
      </template>
      <template v-if="reqText">
        <dt>{{ cardLang === 'ru' ? 'Требования' : 'Requirements' }}</dt>
        <dd>{{ reqText }}</dd>
      </template>
      <template v-if="rangeText">
        <dt>{{ cardLang === 'ru' ? 'Дистанция' : 'Range' }}</dt>
        <dd>{{ rangeText }}</dd>
      </template>
      <template v-if="areaText">
        <dt>{{ cardLang === 'ru' ? 'Область' : 'Area' }}</dt>
        <dd>{{ areaText }}</dd>
      </template>
      <template v-if="targetText">
        <dt>{{ cardLang === 'ru' ? 'Цели' : 'Targets' }}</dt>
        <dd>{{ targetText }}</dd>
      </template>
      <template v-if="defenseText">
        <dt>{{ cardLang === 'ru' ? 'Защита' : 'Defense' }}</dt>
        <dd>{{ defenseText }}</dd>
      </template>
      <template v-if="durationText">
        <dt>{{ cardLang === 'ru' ? 'Длительность' : 'Duration' }}</dt>
        <dd>{{ durationText }}</dd>
      </template>
      <template v-if="spell.ritual">
        <dt>{{ cardLang === 'ru' ? 'Ритуал' : 'Ritual' }}</dt>
        <dd>
          {{ cardLang === 'ru' ? 'Осн. проверка:' : 'Primary:' }} {{ spell.ritual.primaryCheck }}
          <template v-if="spell.ritual.secondaryCasters">
            · {{ cardLang === 'ru' ? 'Вторичные:' : 'Secondary:' }} {{ spell.ritual.secondaryCasters }} ({{ spell.ritual.secondaryChecks }})
          </template>
        </dd>
      </template>
      <template v-if="spell.damageTypes.length">
        <dt>{{ cardLang === 'ru' ? 'Урон' : 'Damage' }}</dt>
        <dd>
          <span v-for="dt in spell.damageTypes" :key="dt" class="badge">{{ meta?.damageTypes?.[dt]?.[cardLang] ?? dt }}</span>
          <span v-if="spell.hasPersistent" class="badge">{{ cardLang === 'ru' ? 'продолжительный' : 'persistent' }}</span>
        </dd>
      </template>
      <template v-if="spell.conditions.length">
        <dt>{{ cardLang === 'ru' ? 'Состояния' : 'Conditions' }}</dt>
        <dd>
          <span v-for="c in spell.conditions" :key="c" class="badge">{{ meta?.conditions?.[c]?.[cardLang] ?? c }}</span>
        </dd>
      </template>
    </dl>

    <!-- Cast Rank scaler + Primary Scaled Roll Button -->
    <div v-if="hasDynamicScaling || heightened.compiled?.hasDice" class="cast-rank-bar">
      <template v-if="hasDynamicScaling">
        <span class="small muted">{{ cardLang === 'ru' ? 'Круг сотворения:' : 'Cast rank:' }}</span>
        <div class="cr-pills">
          <button
            v-for="r in Array.from({ length: 11 - minRank }, (_, i) => minRank + i)"
            :key="r"
            type="button"
            class="cr-pill"
            :class="{ on: castRank === r }"
            @click="castRank = r"
          >
            {{ r }}
          </button>
        </div>
      </template>
      <span v-if="hasDynamicScaling && heightened.compiled?.hasDice" class="grow" />
      <button
        v-if="heightened.compiled?.hasDice"
        type="button"
        class="btn btn-sm btn-primary primary-roll-btn"
        :title="cardLang === 'ru' ? `Бросить урон заклинания на ${castRank} круге` : `Roll spell damage at rank ${castRank}`"
        @click="runRoll(heightened.combinedSpec)"
      >
        🎲 {{ heightened.compiled.displayExpr }}
        <template v-if="heightened.damageEntries.length === 1 && heightened.damageEntries[0].type !== 'untyped'">
          ({{ localizeDamageType(heightened.damageEntries[0].type, cardLang, meta) }})
        </template>
        <span class="pr-avg">· {{ cardLang === 'ru' ? 'ср.' : 'avg' }} {{ formatAvgNumber(heightened.compiled.avg) }}</span>
      </button>
    </div>

    <!-- Active Interactive Dice Roll Panel -->
    <Pf2eRollPanel
      v-if="activeRoll"
      :result="activeRoll"
      :history="rollHistory"
      :lang="cardLang"
      :meta="meta"
      @reroll="rerollActive"
      @close="activeRoll = null"
      @select="activeRoll = $event"
    />

    <div class="pfc-body">
      <div v-if="loadingDesc" class="empty" style="padding: 16px"><Icon name="refresh-cw" class="spin" :size="18" /></div>
      <div v-else class="pf-prose" v-html="descHtml" @click="onProseClick" />
    </div>

    <details v-if="spell.deities.length" class="pfc-deities">
      <summary>{{ cardLang === 'ru' ? 'Даруется божествами' : 'Granted by deities' }} ({{ spell.deities.length }})</summary>
      <p class="small muted">{{ spell.deities.join(', ') }}</p>
    </details>

    <footer class="pfc-foot">
      <div class="row gap-sm wrap grow small faint">
        <span v-if="spell.pub">{{ spell.pub }}</span>
        <span v-if="spell.remaster" class="badge badge-public">Remaster</span>
        <span v-else class="badge">Legacy</span>
      </div>
      <slot name="actions" />
    </footer>
  </article>
</template>

<style scoped>
.pf-card { display: flex; flex-direction: column; gap: 12px; }
.pfc-head { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; border-bottom: 2px solid var(--accent); padding-bottom: 10px; }
.pfc-icon {
  width: 52px; height: 52px; border-radius: 8px; object-fit: cover; flex-shrink: 0;
  border: 1px solid var(--border-strong); background: var(--surface-2); box-shadow: 0 2px 6px rgba(0,0,0,.18);
}
.pfc-title { font-family: var(--font-head); font-size: 26px; font-weight: 700; margin: 0; line-height: 1.15; }
.pf-act-big { font-size: 19px; color: var(--accent); letter-spacing: -1px; font-weight: 700; }
.rank-pill { padding: 3px 10px; border-radius: 6px; background: var(--accent-soft); color: var(--accent); font-weight: 700; font-size: 12.5px; white-space: nowrap; }

.lang-switch { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 6px; overflow: hidden; }
.lang-switch button { border: 0; background: var(--surface-2); padding: 3px 8px; font-size: 12px; font-weight: 600; cursor: pointer; color: var(--text-muted); }
.lang-switch button.on { background: var(--accent); color: var(--accent-fg); }

.pfc-traits { gap: 5px; }
.pf-trait {
  display: inline-flex; padding: 2px 8px; border-radius: 4px; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  background: color-mix(in srgb, var(--accent) 18%, var(--surface-2)); color: var(--text); border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border));
}
.pf-trait.rar-uncommon { background: color-mix(in srgb, #c2640c 22%, var(--surface-2)); border-color: #c2640c; }
.pf-trait.rar-rare { background: color-mix(in srgb, #1d5aa6 24%, var(--surface-2)); border-color: #2f6f95; }
.pf-trait.rar-unique { background: color-mix(in srgb, #7c3aed 22%, var(--surface-2)); border-color: var(--secret); }

.pfc-meta { display: grid; grid-template-columns: minmax(105px, auto) 1fr; gap: 5px 14px; margin: 0; font-size: 13.5px; padding: 10px 12px; background: var(--surface-2); border-radius: var(--radius-sm); border: 1px solid var(--border); }
.pfc-meta dt { color: var(--text-muted); font-weight: 600; }
.pfc-meta dd { margin: 0; display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }

.trad-pill {
  display: inline-flex; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600;
  background: color-mix(in srgb, var(--tcol) 18%, transparent); border: 1px solid color-mix(in srgb, var(--tcol) 48%, transparent);
}

.cast-rank-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 10px; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px solid var(--border);
}
.cr-pills { display: inline-flex; gap: 3px; flex-wrap: wrap; }
.cr-pill {
  min-width: 26px; height: 24px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--border-strong);
  background: var(--surface); color: var(--text-muted); font-family: var(--font-mono); font-size: 12px; font-weight: 700;
  cursor: pointer; transition: background .1s, border-color .1s;
}
.cr-pill:hover { border-color: var(--accent); color: var(--text); }
.cr-pill.on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }

.pfc-body { font-family: var(--font-text); font-size: 15px; line-height: 1.65; }
.pf-prose :deep(p) { margin: 0 0 10px; }
.pf-prose :deep(p:last-child) { margin-bottom: 0; }
.pf-prose :deep(hr) { border: 0; border-top: 1px solid var(--border); margin: 10px 0; }
.pf-prose :deep(ul), .pf-prose :deep(ol) { margin: 6px 0 10px; padding-left: 20px; }
.pf-prose :deep(table) { width: 100%; border-collapse: collapse; margin: 10px 0; font-family: var(--font-ui); font-size: 13px; }
.pf-prose :deep(th), .pf-prose :deep(td) { padding: 5px 8px; border: 1px solid var(--border); text-align: left; }
.pf-prose :deep(th) { background: var(--surface-2); }
.pf-prose :deep(.pf-act) { font-family: var(--font-ui); color: var(--accent); font-weight: 700; letter-spacing: -1px; padding: 0 2px; }
.pf-prose :deep(.pf-inline-dmg) { font-family: var(--font-ui); font-size: .88em; font-weight: 600; padding: 1px 6px; border-radius: 5px; background: color-mix(in srgb, var(--danger) 14%, transparent); border: 1px solid color-mix(in srgb, var(--danger) 38%, transparent); color: var(--text); }
.pf-prose :deep(.pf-inline-check) { font-family: var(--font-ui); font-size: .88em; font-weight: 600; padding: 1px 5px; border-radius: 4px; background: color-mix(in srgb, var(--info) 15%, transparent); border: 1px solid color-mix(in srgb, var(--info) 35%, transparent); }
.pf-prose :deep(.pf-inline-tpl) { font-family: var(--font-ui); font-size: .88em; font-weight: 600; padding: 1px 5px; border-radius: 4px; background: color-mix(in srgb, var(--warning) 15%, transparent); border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent); }
.pf-prose :deep(.pf-inline-ref) { font-family: var(--font-ui); font-size: .92em; font-weight: 600; color: var(--text); text-decoration: underline dotted var(--border-strong); text-underline-offset: 2px; }
.pf-prose :deep(.pf-uuid-link) {
  font-family: var(--font-ui); font-size: .93em; font-weight: 600; color: var(--accent);
  text-decoration: underline; text-underline-offset: 2px; border-radius: 3px; padding: 0 2px; transition: background .12s;
}
.pf-prose :deep(.pf-uuid-link::after) { content: ' ↗'; font-size: .78em; opacity: .72; }
.pf-prose :deep(.pf-uuid-link:hover) { background: var(--accent-soft); }
.pf-prose :deep(.pf-inline-trait) { font-family: var(--font-ui); font-size: .82em; font-weight: 700; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; background: var(--surface-3); }
.pf-prose :deep(.pf-inline-roll) { font-family: var(--font-ui); font-size: .88em; font-weight: 600; padding: 1px 6px; border-radius: 5px; background: var(--surface-2); border: 1px solid var(--border-strong); color: var(--text); }
.pf-prose :deep(.pf-roll-btn) {
  display: inline-flex; align-items: baseline; gap: 4px; cursor: pointer; vertical-align: baseline;
  line-height: 1.35; transition: transform .08s, border-color .12s, background .12s;
}
.pf-prose :deep(.pf-roll-btn:hover) { border-color: var(--accent); background: var(--accent-soft); transform: translateY(-1px); }
.pf-prose :deep(.pf-roll-btn:active) { transform: translateY(0); }
.pf-prose :deep(.pf-roll-btn.pf-heightened) {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}
.pf-prose :deep(.pf-roll-ic) { font-size: .9em; }
.pf-prose :deep(.pf-roll-avg) { font-size: .86em; font-weight: 500; color: var(--text-muted); }
.primary-roll-btn { font-family: var(--font-ui); }
.pr-avg { opacity: .88; font-weight: 500; }

.pfc-deities { font-size: 13px; padding-top: 6px; border-top: 1px solid var(--border); }
.pfc-deities summary { cursor: pointer; color: var(--accent); font-weight: 500; }
.pfc-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 10px; border-top: 1px solid var(--border); }
</style>
