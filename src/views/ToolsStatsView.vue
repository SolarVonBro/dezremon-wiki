<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import {
  ABIL, ALL, BONUS_KINDS, CORE, FORMULA_PRESETS, FormulaError, METHODS, PB_BASE, PB_PER_OPTIONAL,
  active, arrayPool, assignInOrder, baseScores, bonusParts, bonusTargets, copyText, emptyData,
  finalScores, isEmptyStatData, keptRolls, mod, normalizeStatData, pbBudget, pbRange, pbSpent, pbTable,
  pointBuyCost, restoreAttempt, rollMissing, rollSet, sameData, scoreIssue, scoresLine, setMethod, setTitle,
  signed, swap, toggleOptional,
  type Ability, type Bonus, type BonusKind, type StatData, type StatSet,
} from '@/data/statCalc'
import { averageOf, parseFormula } from '@/data/statDice'
import {
  createStatSet, deleteStatSet, exportStatSets, importStatSets, readStatDraft, saveStatSet,
  watchStatSets, writeStatDraft, type StatDraft,
} from '@/data/statSets'
import { errorText, plural, randomId } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import { toast } from '@/components/common/toast'

const BONUS_SOURCES = [
  'Раса', 'Подраса', 'Происхождение', 'Предыстория', 'Человек',
  'Увеличение характеристик (4 ур.)', 'Увеличение характеристик (8 ур.)',
  'Черта', 'Магический предмет', 'Благословение', 'Решение мастера', 'Прочее',
]
const BONUS_ORDER: BonusKind[] = ['p21', 'p111', 'all1', 'p2', 'p11', 'p1', 'custom']

const session = useSession()
const route = useRoute()
const router = useRouter()

const sets = ref<StatSet[]>([])
const loading = ref(true)
const draft = ref<StatDraft>({ savedId: null, data: emptyData() })
const rollError = ref<string | null>(null)
const busy = ref(false)
const customFormula = ref(false)
const copiedKey = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const topEl = ref<HTMLElement | null>(null)

let stopWatch: (() => void) | null = null
let copyTimer: number | null = null

function initCustomFlag(formula: string) {
  const norm = formula.replace(/\s+/g, '').toLowerCase()
  customFormula.value = !FORMULA_PRESETS.some((p) => p.formula === norm)
}

watch(() => [session.ready, session.user?.uid] as const, ([ready, u]) => {
  stopWatch?.()
  stopWatch = null
  if (ready && !u) { void router.replace({ name: 'login', query: { next: route.fullPath } }); return }
  if (!u) return
  draft.value = readStatDraft(u)
  initCustomFlag(draft.value.data.formula)
  loading.value = true
  stopWatch = watchStatSets(
    u,
    (rows) => { sets.value = rows; loading.value = false },
    (e) => { loading.value = false; toast.error('Не удалось загрузить наборы: ' + errorText(e)) },
  )
}, { immediate: true })

onBeforeUnmount(() => {
  stopWatch?.()
  if (copyTimer) window.clearTimeout(copyTimer)
})

const d = computed(() => draft.value.data)
function setDraft(next: StatDraft) {
  draft.value = next
  if (session.user?.uid) writeStatDraft(session.user.uid, next)
}
function setData(data: StatData) { setDraft({ ...draft.value, data }) }
function patchData(p: Partial<StatData>) { setData({ ...d.value, ...p }) }

const act = computed(() => active(d.value))
const base = computed(() => baseScores(d.value))
const parts = computed(() => bonusParts(d.value))
const final = computed(() => finalScores(d.value))
const saved = computed(() => (draft.value.savedId ? sets.value.find((s) => s.id === draft.value.savedId) ?? null : null))
const dirty = computed(() => (saved.value ? !sameData(saved.value.data, d.value) : !isEmptyStatData(d.value)))

const charNames = computed(() =>
  [...new Set(sets.value.map((s) => s.data.character.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
)

const formulaInfo = computed(() => {
  try {
    const f = parseFormula(d.value.formula)
    return { f, avg: averageOf(f), error: null as string | null }
  } catch (e) {
    return { f: null, avg: 0, error: e instanceof FormulaError ? e.message : 'Ошибка в формуле.' }
  }
})

const activePreset = computed(() => {
  const norm = d.value.formula.replace(/\s+/g, '').toLowerCase()
  return FORMULA_PRESETS.find((p) => p.formula === norm) ?? null
})

// Point buy helpers
const budget = computed(() => pbBudget(d.value))
const spent = computed(() => pbSpent(d.value))
const pbLeft = computed(() => budget.value - spent.value)
const pbStd = computed(() => PB_BASE + PB_PER_OPTIONAL * (Number(d.value.san) + Number(d.value.hon)))
const pbCostTable = computed(() => pbTable(d.value.extended))
const pbValues = computed(() => Object.keys(pbCostTable.value).map(Number).sort((a, b) => a - b))
const pbBarPct = computed(() => Math.max(0, Math.min(100, (spent.value / Math.max(1, budget.value)) * 100)))

// Rolling helpers
const rollNeed = computed(() => act.value.length)
const rollTotal = computed(() => Math.max(rollNeed.value, d.value.count ?? rollNeed.value))
const rollKept = computed(() => keptRolls(d.value))
const rollMissingList = computed(() => act.value.filter((a) => !d.value.rollAssign[a]))
function rollHolder(id: string): Ability | undefined {
  return act.value.find((a) => d.value.rollAssign[a] === id)
}

// Totals
const sumFinal = computed(() => (act.value.every((a) => final.value[a] != null) ? act.value.reduce((s, a) => s + final.value[a]!, 0) : null))
const sumMods = computed(() => (act.value.every((a) => final.value[a] != null) ? act.value.reduce((s, a) => s + mod(final.value[a]!), 0) : null))
const pbEq = computed(() => {
  const coreBase = CORE.map((a) => base.value[a])
  return coreBase.every((v) => v != null) ? pointBuyCost(coreBase as number[]) : null
})
const pbEqExt = computed(() => {
  if (pbEq.value != null) return null
  const coreBase = CORE.map((a) => base.value[a])
  return coreBase.every((v) => v != null) ? pointBuyCost(coreBase as number[], true) : null
})

const lineValues = computed(() => scoresLine(d.value, 'values'))
const lineMods = computed(() => scoresLine(d.value, 'mods'))
const lineBase = computed(() => scoresLine(d.value, 'values', 'base'))

// Saved sets grouped by character
const groupedSets = computed(() => {
  const m = new Map<string, StatSet[]>()
  for (const s of [...sets.value].sort((a, b) => b.updated - a.updated)) {
    const k = s.data.character?.trim() || ''
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(s)
  }
  return [...m.entries()]
})

const fmtDate = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
const fmtTime = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
function clampInt(s: string, lo: number, hi: number, fallback: number) {
  const v = Math.round(Number(s))
  return Number.isFinite(v) && s.trim() !== '' ? Math.min(hi, Math.max(lo, v)) : fallback
}

async function copyLine(key: string, text: string | null) {
  if (!text) return
  const ok = await copyText(text)
  if (!ok) { toast.error('Не удалось скопировать'); return }
  copiedKey.value = key
  if (copyTimer) window.clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => { copiedKey.value = null }, 1600)
}

// Actions
async function doSave() {
  const uid = session.user?.uid
  if (!uid) return
  busy.value = true
  try {
    if (saved.value) {
      await saveStatSet(uid, saved.value.id, d.value)
      toast.success('Изменения сохранены')
    } else {
      const id = await createStatSet(uid, d.value)
      setDraft({ savedId: id, data: d.value })
      toast.success('Набор сохранён')
    }
  } catch (e) { toast.error('Не удалось сохранить: ' + errorText(e)) }
  finally { busy.value = false }
}

async function doSaveAsNew() {
  const uid = session.user?.uid
  if (!uid) return
  busy.value = true
  try {
    const data: StatData = { ...d.value, name: d.value.name.trim() ? `${d.value.name.trim()} (копия)` : '' }
    const id = await createStatSet(uid, data)
    setDraft({ savedId: id, data })
    toast.success('Сохранено как новый набор')
  } catch (e) { toast.error('Не удалось сохранить копию: ' + errorText(e)) }
  finally { busy.value = false }
}

function confirmLeave() {
  return !dirty.value || confirm('В калькуляторе есть несохранённые изменения — они пропадут. Продолжить?')
}

function loadSet(s: StatSet) {
  if (s.id === draft.value.savedId && !dirty.value) return
  if (!confirmLeave()) return
  const norm = normalizeStatData(s.data)
  setDraft({ savedId: s.id, data: norm })
  initCustomFlag(norm.formula)
  rollError.value = null
  topEl.value?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

function resetCalc() {
  if (!confirmLeave()) return
  const fresh: StatData = { ...emptyData(), character: d.value.character }
  setDraft({ savedId: null, data: fresh })
  initCustomFlag(fresh.formula)
  rollError.value = null
}

async function removeSet(s: StatSet) {
  const uid = session.user?.uid
  if (!uid) return
  if (!confirm(`Удалить набор «${setTitle(s.data)}»${s.data.character ? ` (${s.data.character})` : ''}?`)) return
  try {
    await deleteStatSet(uid, s.id)
    if (draft.value.savedId === s.id) setDraft({ savedId: null, data: d.value })
    toast.success('Набор удалён')
  } catch (e) { toast.error('Не удалось удалить: ' + errorText(e)) }
}

function runRoll(fn: (x: StatData) => StatData) {
  try {
    setData(fn(d.value))
    rollError.value = null
  } catch (e) {
    rollError.value = e instanceof FormulaError ? e.message : 'Не удалось бросить.'
  }
}

// Point buy controls
function onBudgetChange(e: Event) {
  const v = clampInt((e.target as HTMLInputElement).value, 0, 200, pbStd.value)
  setData({ ...d.value, budget: v === pbStd.value ? null : v })
}
function onExtendedToggle(e: Event) {
  const on = (e.target as HTMLInputElement).checked
  const [lo, hi] = pbRange(on)
  const pb = { ...d.value.pb }
  for (const a of ALL) pb[a] = Math.min(hi, Math.max(lo, pb[a]))
  setData({ ...d.value, extended: on, pb })
}
function stepPb(a: Ability, delta: -1 | 1) {
  setData({ ...d.value, pb: { ...d.value.pb, [a]: d.value.pb[a] + delta } })
}
function pbUpCost(a: Ability): number | null {
  const [, hi] = pbRange(d.value.extended)
  const v = d.value.pb[a]
  return v < hi ? pbCostTable.value[v + 1] - pbCostTable.value[v] : null
}

// Pool assignment for array / roll
function poolOptions() {
  return d.value.method === 'array' ? arrayPool(d.value) : rollKept.value
}
function poolOwner(id: string): Ability | undefined {
  const assign = (d.value.method === 'array' ? d.value.arrayAssign : d.value.rollAssign) as Partial<Record<Ability, string | null>>
  return act.value.find((b) => assign[b] === id)
}
function onPoolPick(a: Ability, id: string) {
  if (!id) return
  if (d.value.method === 'array') setData({ ...d.value, arrayAssign: swap(d.value.arrayAssign, a, id) })
  else setData({ ...d.value, rollAssign: swap(d.value.rollAssign, a, id as string | null) })
}

// Bonuses
function addBonus(kind: BonusKind) {
  const b: Bonus = { id: randomId(10), source: '', kind, picks: BONUS_KINDS[kind].slots.map(() => ''), custom: {} }
  setData({ ...d.value, bonuses: [...d.value.bonuses, b] })
}
function changeBonus(id: string, p: Partial<Bonus>) {
  setData({ ...d.value, bonuses: d.value.bonuses.map((b) => (b.id === id ? { ...b, ...p } : b)) })
}
function removeBonus(id: string) {
  setData({ ...d.value, bonuses: d.value.bonuses.filter((b) => b.id !== id) })
}
function onBonusKindChange(b: Bonus, kind: BonusKind) {
  changeBonus(b.id, { kind, picks: BONUS_KINDS[kind].slots.map((_, i) => b.picks[i] ?? '') })
}
function onBonusPickChange(b: Bonus, idx: number, val: string) {
  const picks = [...b.picks]
  picks[idx] = val as Ability | ''
  changeBonus(b.id, { picks })
}
function onBonusCustomChange(b: Bonus, a: Ability, raw: string) {
  const custom = { ...b.custom }
  if (raw.trim() === '' || Number(raw) === 0) delete custom[a]
  else custom[a] = clampInt(raw, -10, 10, 0)
  changeBonus(b.id, { custom })
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f || !session.user?.uid) return
  try {
    const n = await importStatSets(session.user.uid, f)
    toast.success(`Загружено наборов: ${n}`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Это не файл с наборами характеристик.')
  }
}

// Facts computed helpers
const strVal = computed(() => final.value.str)
const dexMod = computed(() => (final.value.dex == null ? null : mod(final.value.dex)))
const conMod = computed(() => (final.value.con == null ? null : mod(final.value.con)))
const sanMod = computed(() => (act.value.includes('san') && final.value.san != null ? mod(final.value.san) : null))
const honMod = computed(() => (act.value.includes('hon') && final.value.hon != null ? mod(final.value.hon) : null))
const castFacts = computed(() =>
  (['int', 'wis', 'cha'] as Ability[])
    .filter((a) => final.value[a] != null)
    .map((a) => ({ a, score: final.value[a]!, m: mod(final.value[a]!) })),
)
const hasAnyFact = computed(() => strVal.value != null || dexMod.value != null || conMod.value != null || castFacts.value.length > 0 || sanMod.value != null || honMod.value != null)
</script>

<template>
  <div ref="topEl" class="page">
    <div class="crumbs-row">
      <RouterLink :to="{ name: 'tools' }" class="back-link"><Icon name="arrow-left" :size="15" /> Инструменты</RouterLink>
    </div>

    <div class="page-head" style="margin-bottom: 16px">
      <div class="grow">
        <h1>Калькулятор характеристик</h1>
        <p class="muted small" style="margin: 2px 0 0">Поинтбай, стандартный набор, броски и увеличения — по правилам D&amp;D 5e</p>
      </div>
    </div>

    <div class="stats-layout">
      <!-- ==================== MAIN ==================== -->
      <div class="stats-main stack" style="gap: 18px">
        <!-- Identity -->
        <section class="card card-pad">
          <div class="set-fields">
            <label class="field">
              <span>Персонаж</span>
              <input
                type="text"
                class="input"
                list="stat-chars"
                maxlength="80"
                placeholder="Имя персонажа"
                :value="d.character"
                @input="patchData({ character: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label class="field">
              <span>Название набора</span>
              <input
                type="text"
                class="input"
                maxlength="80"
                placeholder="Например: «Броски, сессия 0»"
                :value="d.name"
                @input="patchData({ name: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <datalist id="stat-chars">
              <option v-for="n in charNames" :key="n" :value="n" />
            </datalist>
          </div>
        </section>

        <!-- Method & Optional abilities -->
        <section class="card card-pad stack">
          <div class="section-title" style="margin: 0">Способ определения</div>
          <div class="methods" role="radiogroup" aria-label="Способ определения характеристик">
            <button
              v-for="m in METHODS"
              :key="m.id"
              type="button"
              role="radio"
              :aria-checked="d.method === m.id"
              class="mcard"
              :class="{ on: d.method === m.id }"
              @click="setData(setMethod(d, m.id))"
            >
              <b>{{ m.label }}</b>
              <span class="muted small">
                {{ m.id === 'pointbuy' && d.budget != null ? `${d.budget} очков, значения ${pbRange(d.extended).join('–')}` : m.hint }}
              </span>
            </button>
          </div>

          <div class="optional-box">
            <label class="check">
              <input type="checkbox" :checked="d.san" @change="setData(toggleOptional(d, 'san', ($event.target as HTMLInputElement).checked))" />
              <span><b>Здравомыслие</b> <span class="muted small">— спасброски от безумия, проверки вместо Интеллекта при встрече с непостижимым</span></span>
            </label>
            <label class="check">
              <input type="checkbox" :checked="d.hon" @change="setData(toggleOptional(d, 'hon', ($event.target as HTMLInputElement).checked))" />
              <span><b>Честь</b> <span class="muted small">— следование кодексу; не растёт от увеличения характеристик, пределы 1–20</span></span>
            </label>
            <p class="faint small" style="margin: 2px 0 0">
              Дополнительные характеристики из «Руководства мастера» (с. 264): +{{ PB_PER_OPTIONAL }} очка поинтбая и ещё одно значение 11
              в стандартный набор за каждую, при бросках — ещё один бросок.
            </p>
          </div>

          <!-- Method Panel: Point Buy -->
          <div v-if="d.method === 'pointbuy'" class="mpanel stack-sm">
            <div class="pb-head">
              <label class="field" style="width: 100px">
                <span>Очков</span>
                <input type="number" inputmode="numeric" class="input input-sm" min="0" max="200" :value="budget" @change="onBudgetChange" />
              </label>
              <div class="pb-left" :class="{ over: pbLeft < 0, zero: pbLeft === 0 }" role="status">
                <b>{{ pbLeft }}</b>
                <span>{{ pbLeft < 0 ? 'перерасход' : plural(pbLeft, 'очко осталось', 'очка осталось', 'очков осталось') }}</span>
                <small class="muted">потрачено {{ spent }} из {{ budget }}</small>
              </div>
              <button v-if="d.budget != null" type="button" class="btn btn-sm btn-ghost" @click="setData({ ...d, budget: null })">
                вернуть {{ pbStd }}
              </button>
            </div>
            <div class="pb-bar" aria-hidden="true">
              <span :class="{ over: pbLeft < 0 }" :style="{ width: `${pbBarPct}%` }" />
            </div>
            <p class="muted small" style="margin: 0">
              Стандарт — {{ PB_BASE }} очков{{ d.san || d.hon ? ` + ${PB_PER_OPTIONAL} за каждую дополнительную характеристику = ${pbStd}` : '' }}.
              Своё число очков впишите в поле — например, 32 для более сильных героев.
            </p>
            <label class="check">
              <input type="checkbox" :checked="d.extended" @change="onExtendedToggle" />
              <span>Расширенная таблица 3–18 <span class="muted small">(домашнее правило: значения ниже 8 возвращают очки, выше 15 стоят дороже)</span></span>
            </label>
            <details class="sub-details">
              <summary>Таблица стоимости</summary>
              <div class="table-scroll" style="margin-top: 8px">
                <table class="pb-table">
                  <tbody>
                    <tr><th>Значение</th><td v-for="v in pbValues" :key="v">{{ v }}</td></tr>
                    <tr><th>Стоимость</th><td v-for="v in pbValues" :key="v" :class="{ ext: v < 8 || v > 15 }">{{ pbCostTable[v] }}</td></tr>
                  </tbody>
                </table>
              </div>
            </details>
          </div>

          <!-- Method Panel: Standard Array -->
          <div v-else-if="d.method === 'array'" class="mpanel">
            <p class="small" style="margin: 0">
              Значения <b>{{ arrayPool(d).map((p) => p.value).join(', ') }}</b> распределяются между характеристиками.
              Выберите значение у характеристики — оно поменяется местами с той, у которой было.
            </p>
          </div>

          <!-- Method Panel: Roll -->
          <div v-else-if="d.method === 'roll'" class="mpanel stack">
            <div class="row gap-sm wrap">
              <button
                v-for="p in FORMULA_PRESETS"
                :key="p.formula"
                type="button"
                class="chip"
                :class="{ on: !customFormula && activePreset === p }"
                :title="p.hint"
                @click="customFormula = false; patchData({ formula: p.formula })"
              >
                {{ p.label }}
              </button>
              <button
                type="button"
                class="chip"
                :class="{ on: customFormula || !activePreset }"
                @click="customFormula = true"
              >
                Своя формула
              </button>
            </div>

            <label v-if="customFormula || !activePreset" class="field">
              <span>Формула одного значения</span>
              <input
                type="text"
                class="input"
                spellcheck="false"
                autocomplete="off"
                placeholder="например, 4d6kh3"
                :aria-invalid="Boolean(formulaInfo.error)"
                :value="d.formula"
                @input="patchData({ formula: ($event.target as HTMLInputElement).value })"
              />
            </label>

            <p class="small" :class="formulaInfo.error ? 'danger' : 'muted'" style="margin: 0" role="status">
              <template v-if="formulaInfo.error">{{ formulaInfo.error }}</template>
              <template v-else-if="formulaInfo.f">
                <code>{{ formulaInfo.f.text }}</code>: от {{ formulaInfo.f.min }} до {{ Number.isFinite(formulaInfo.f.max) ? formulaInfo.f.max : '∞' }},
                в среднем ≈ {{ formulaInfo.avg.toFixed(1).replace('.', ',') }}
                <span v-if="formulaInfo.f.min < 1 || formulaInfo.f.max > 30" class="warn-txt"> · выходит за пределы 1–30</span>
              </template>
            </p>

            <details v-if="customFormula || !activePreset" class="sub-details">
              <summary>Как записать формулу</summary>
              <div class="formula-help-body small">
                <p>Формула — это кости и числа, соединённые знаками <code>+</code> и <code>−</code>. Пробелы и регистр не важны; вместо <code>d</code> можно писать русские <code>к</code> или <code>д</code> (<code>4к6</code>). Каждое значение характеристики — один бросок формулы.</p>
                <div class="table-scroll">
                  <table class="table">
                    <tbody>
                      <tr><th><code>NdM</code></th><td>N костей с M гранями: <code>3d6</code>, <code>2d8</code>. Без N — одна кость: <code>d20</code>. <code>d%</code> — кость на 100.</td></tr>
                      <tr><th><code>khK</code> / <code>kK</code></th><td>оставить K наибольших костей: <code>4d6kh3</code> — правило «Книги игрока».</td></tr>
                      <tr><th><code>klK</code></th><td>оставить K наименьших: <code>3d6kl2</code>.</td></tr>
                      <tr><th><code>dlK</code> / <code>dK</code></th><td>отбросить K наименьших: <code>4d6dl1</code> — то же, что <code>4d6kh3</code>.</td></tr>
                      <tr><th><code>dhK</code></th><td>отбросить K наибольших.</td></tr>
                      <tr><th><code>rX</code></th><td>перебрасывать кость, пока выпадает X: <code>4d6r1kh3</code> — единицы не в счёт.</td></tr>
                      <tr><th><code>r&lt;X</code>, <code>r&gt;X</code></th><td>перебрасывать результаты X и меньше / X и больше: <code>4d6r&lt;2kh3</code>.</td></tr>
                      <tr><th><code>roX</code>, <code>ro&lt;X</code></th><td>перебросить только один раз — второй результат остаётся.</td></tr>
                      <tr><th><code>!</code></th><td>«взрыв»: при максимуме кость бросается ещё раз и результат прибавляется: <code>1d6!</code>.</td></tr>
                      <tr><th><code>+ −</code></th><td>сложить или вычесть: <code>2d6+6</code>, <code>1d10+8</code>, <code>3d6+1d4-2</code>.</td></tr>
                    </tbody>
                  </table>
                </div>
                <p class="muted" style="margin-top: 8px">
                  <b>Примеры:</b> <code>4d6kh3</code> — стандарт (3–18, ≈12,2); <code>3d6</code> — классика (≈10,5); <code>2d6+6</code> — без провалов (8–18);
                  <code>5d6kh3</code> — героические (≈13,4); <code>4d6r1kh3</code> — без единиц (≈13); <code>1d20</code> — хаос.
                </p>
              </div>
            </details>

            <div class="stack-sm">
              <div class="row gap wrap">
                <label class="row gap-sm small">
                  <span class="muted">Бросков:</span>
                  <input
                    type="number"
                    inputmode="numeric"
                    class="input input-sm"
                    style="width: 72px"
                    :min="rollNeed"
                    max="20"
                    :value="rollTotal"
                    @change="(e) => { const v = clampInt((e.target as HTMLInputElement).value, rollNeed, 20, rollNeed); patchData({ count: v === rollNeed ? null : v }) }"
                  />
                  <span class="faint">{{ rollTotal > rollNeed ? `${rollTotal - rollNeed} худш${rollTotal - rollNeed === 1 ? 'ее' : 'их'} отбросится` : 'по одному на характеристику' }}</span>
                </label>
              </div>

              <label class="check small">
                <input
                  type="checkbox"
                  :checked="d.inOrder"
                  @change="(e) => { const on = (e.target as HTMLInputElement).checked; setData(on ? assignInOrder({ ...d, inOrder: true }) : { ...d, inOrder: false }) }"
                />
                <span>По порядку: значения идут в {{ act.map((a) => ABIL[a].short).join(', ') }} как выпали, без перестановки</span>
              </label>

              <label class="check small wrap-check">
                <input
                  type="checkbox"
                  :checked="d.minMods != null"
                  @change="patchData({ minMods: ($event.target as HTMLInputElement).checked ? 1 : null })"
                />
                <span>
                  Домашнее правило: перебрасывать весь набор, пока сумма модификаторов меньше
                  <input
                    type="number"
                    class="input input-sm inline-num"
                    min="-10"
                    max="20"
                    :value="d.minMods ?? 1"
                    :disabled="d.minMods == null"
                    @change="patchData({ minMods: clampInt(($event.target as HTMLInputElement).value, -10, 20, 1) })"
                  />
                </span>
              </label>
            </div>

            <div class="row gap wrap">
              <button type="button" class="btn btn-primary" :disabled="Boolean(formulaInfo.error)" @click="runRoll(rollSet)">
                <Icon name="dices" :size="17" /> {{ d.rolls.length ? 'Бросить заново' : 'Бросить' }}
              </button>
              <span v-if="d.rolledAt" class="faint small">
                Брошено {{ fmtDate(d.rolledAt) }}, {{ fmtTime(d.rolledAt) }}
                <template v-if="d.attempts > 1"> · наборов по домашнему правилу: {{ d.attempts }}{{ d.attempts >= 1000 ? ' (предел)' : '' }}</template>
              </span>
            </div>
            <p v-if="rollError" class="danger small" role="alert" style="margin: 0">{{ rollError }}</p>

            <ul v-if="d.rolls.length" class="rolls-grid">
              <li v-for="r in d.rolls" :key="r.id" class="rcard" :class="{ dropped: r.dropped }">
                <span class="rval">{{ r.value }}</span>
                <span class="rdetail">
                  <template v-for="(p, pi) in r.roll.parts" :key="pi">
                    <span v-if="p.dice" class="dterm">
                      <span v-if="pi > 0 || p.sign < 0" class="dop">{{ p.sign < 0 ? '−' : '+' }}</span>
                      <span
                        v-for="(die, di) in p.dice"
                        :key="di"
                        class="die"
                        :class="{ dropped: die.dropped, boom: die.exploded }"
                        :title="`${die.dropped ? 'отброшена' : 'учтена'}${die.rerolls.length ? `; переброшено: ${die.rerolls.join(', ')}` : ''}${die.exploded ? '; взрыв' : ''}`"
                      >
                        <s v-if="die.rerolls.length" class="rr">{{ die.rerolls.join(' ') }}</s>{{ die.v }}
                      </span>
                    </span>
                    <span v-else class="dterm"><span class="dop">{{ p.sign < 0 ? '−' : '+' }}</span>{{ Math.abs(p.value) }}</span>
                  </template>
                </span>
                <span class="rwho">
                  {{ r.dropped ? 'отброшено' : rollHolder(r.id) ? ABIL[rollHolder(r.id)!].short : 'не назначено' }}{{ r.extra ? ' · доброшено' : '' }}
                </span>
              </li>
            </ul>

            <p v-if="d.rolls.length && rollMissingList.length" class="warn-txt small row gap-sm wrap" style="margin: 0">
              <span>Не хватает {{ rollMissingList.length === 1 ? 'значения' : 'значений' }} для: {{ rollMissingList.map((a) => ABIL[a].name).join(', ') }}.</span>
              <button type="button" class="btn btn-sm" @click="runRoll(rollMissing)"><Icon name="dices" :size="14" /> Добросить</button>
            </p>
            <p v-if="d.rolls.length && !d.inOrder && rollKept.length >= rollNeed" class="faint small" style="margin: 0">
              Значения можно переставить: выберите другое значение у характеристики в таблице ниже.
            </p>

            <details v-if="d.history.length" class="sub-details">
              <summary>Предыдущие броски ({{ d.history.length }})</summary>
              <ul class="hist-list">
                <li v-for="(h, hi) in d.history" :key="h.at + '-' + hi">
                  <span class="faint small">{{ fmtTime(h.at) }}</span>
                  <code>{{ h.rolls.map((r) => (r.dropped ? `(${r.value})` : r.value)).join(' ') }}</code>
                  <span class="muted small">{{ h.formula }}</span>
                  <button type="button" class="btn btn-sm btn-ghost" @click="setData(restoreAttempt(d, hi))">вернуть</button>
                </li>
              </ul>
            </details>
          </div>

          <!-- Method Panel: Manual -->
          <div v-else class="mpanel">
            <p class="small" style="margin: 0">Впишите значения сами — например, полученные от мастера или из другого источника (от 1 до 30).</p>
          </div>
        </section>

        <!-- Result Table -->
        <section class="card card-pad stack">
          <div class="section-title" style="margin: 0">Итог</div>
          <div class="table-scroll">
            <table class="table stat-table">
              <thead>
                <tr>
                  <th>Характеристика</th>
                  <th>{{ d.method === 'pointbuy' ? 'Основа · цена' : 'Основа' }}</th>
                  <th>Бонусы</th>
                  <th>Итог</th>
                  <th>Мод.</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in act" :key="a" :class="{ opt: a === 'san' || a === 'hon' }">
                  <td class="sname">
                    <b>{{ ABIL[a].name }}</b>
                    <small class="faint">{{ ABIL[a].short }}</small>
                  </td>
                  <td>
                    <!-- Point Buy stepper -->
                    <span v-if="d.method === 'pointbuy'" class="pbctl">
                      <span class="stepper">
                        <button
                          type="button"
                          class="step-btn"
                          :aria-label="`${ABIL[a].name}: меньше`"
                          :disabled="d.pb[a] <= pbRange(d.extended)[0]"
                          @click="stepPb(a, -1)"
                        >−</button>
                        <b class="step-val">{{ d.pb[a] }}</b>
                        <button
                          type="button"
                          class="step-btn"
                          :aria-label="`${ABIL[a].name}: больше`"
                          :disabled="pbUpCost(a) == null || pbUpCost(a)! > pbLeft"
                          :title="pbUpCost(a) == null ? `Максимум ${pbRange(d.extended)[1]}` : pbUpCost(a)! > pbLeft ? `Нужно ${pbUpCost(a)} очк., осталось ${pbLeft}` : `Стоит ещё ${pbUpCost(a)} очк.`"
                          @click="stepPb(a, 1)"
                        >+</button>
                      </span>
                      <small class="faint">{{ pbCostTable[d.pb[a]] }} очк.</small>
                    </span>

                    <!-- Manual input -->
                    <input
                      v-else-if="d.method === 'manual'"
                      type="number"
                      inputmode="numeric"
                      class="input input-sm mnum"
                      min="1"
                      max="30"
                      :aria-label="`${ABIL[a].name}: значение`"
                      :value="d.manual[a]"
                      @change="setData({ ...d, manual: { ...d.manual, [a]: clampInt(($event.target as HTMLInputElement).value, 1, 30, d.manual[a]) } })"
                    />

                    <!-- Roll not rolled yet -->
                    <span v-else-if="d.method === 'roll' && !d.rolls.length" class="faint small">бросьте</span>

                    <!-- Array / Roll select -->
                    <select
                      v-else
                      class="input input-sm pick"
                      :value="(d.method === 'array' ? d.arrayAssign[a] : d.rollAssign[a]) ?? ''"
                      :disabled="d.method === 'roll' && d.inOrder"
                      :aria-label="`${ABIL[a].name}: значение`"
                      @change="onPoolPick(a, ($event.target as HTMLSelectElement).value)"
                    >
                      <option v-if="!(d.method === 'array' ? d.arrayAssign[a] : d.rollAssign[a])" value="">—</option>
                      <option v-for="p in poolOptions()" :key="p.id" :value="p.id">
                        {{ p.value }}{{ poolOwner(p.id) && poolOwner(p.id) !== a ? ` — сейчас у ${ABIL[poolOwner(p.id)!].short}` : !poolOwner(p.id) ? ' — свободно' : '' }}{{ 'note' in p && p.note ? ` (${p.note})` : '' }}
                      </option>
                    </select>
                  </td>
                  <td
                    class="sbonus"
                    :title="parts[a].map((p) => `${p.source}: ${signed(p.value)}`).join('\n') || 'нет'"
                  >
                    <template v-if="parts[a].reduce((s, p) => s + p.value, 0)">
                      <b>{{ signed(parts[a].reduce((s, p) => s + p.value, 0)) }}</b>
                      <small class="faint block">{{ parts[a].map((p) => p.source).join(', ') }}</small>
                    </template>
                    <span v-else class="faint">—</span>
                  </td>
                  <td>
                    <span
                      class="stotal"
                      :class="{ warn: Boolean(scoreIssue(a, final[a])) }"
                      :title="scoreIssue(a, final[a]) ?? undefined"
                    >
                      {{ final[a] ?? '—' }}
                      <span v-if="scoreIssue(a, final[a])" class="issue-dot" :aria-label="scoreIssue(a, final[a])!">!</span>
                    </span>
                  </td>
                  <td class="smod">{{ final[a] == null ? '—' : signed(mod(final[a]!)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="ssum">
            <span>Сумма: <b>{{ sumFinal ?? '—' }}</b></span>
            <span>Сумма модификаторов: <b>{{ sumMods == null ? '—' : signed(sumMods) }}</b></span>
            <span title="Сколько стоили бы основные шесть значений (без бонусов) по таблице поинтбая">
              Цена основы по поинтбаю:
              <b>{{ pbEq != null ? `${pbEq} очк.` : pbEqExt != null ? `${pbEqExt} очк. (расширенная таблица)` : 'вне таблицы' }}</b>
            </span>
          </div>

          <div class="copies">
            <button type="button" class="copyline" :class="{ ok: copiedKey === 'final' }" :disabled="!lineValues" @click="copyLine('final', lineValues)">
              <span class="copyline-k">Итог</span>
              <code>{{ lineValues ?? '—' }}</code>
              <span class="copyline-ic"><Icon :name="copiedKey === 'final' ? 'check' : 'copy'" :size="14" />{{ copiedKey === 'final' ? ' скопировано' : '' }}</span>
            </button>
            <button type="button" class="copyline small" :class="{ ok: copiedKey === 'mods' }" :disabled="!lineMods" @click="copyLine('mods', lineMods)">
              <span class="copyline-k">Модификаторы</span>
              <code>{{ lineMods ?? '—' }}</code>
              <span class="copyline-ic"><Icon :name="copiedKey === 'mods' ? 'check' : 'copy'" :size="14" />{{ copiedKey === 'mods' ? ' скопировано' : '' }}</span>
            </button>
            <button v-if="d.bonuses.length" type="button" class="copyline small" :class="{ ok: copiedKey === 'base' }" :disabled="!lineBase" @click="copyLine('base', lineBase)">
              <span class="copyline-k">Без бонусов</span>
              <code>{{ lineBase ?? '—' }}</code>
              <span class="copyline-ic"><Icon :name="copiedKey === 'base' ? 'check' : 'copy'" :size="14" />{{ copiedKey === 'base' ? ' скопировано' : '' }}</span>
            </button>
          </div>
          <p class="faint small" style="margin: 0">
            Порядок: {{ act.map((a) => ABIL[a].short).join(' ') }}. Нажмите на строку — она скопируется через пробел.
          </p>
        </section>

        <!-- Bonuses -->
        <section class="card card-pad stack">
          <div class="section-title" style="margin: 0">Бонусы к характеристикам</div>
          <p v-if="!d.bonuses.length" class="muted small" style="margin: 0">
            Бонусов пока нет. Добавьте увеличения от расы или происхождения, классов и черт.
          </p>

          <div v-for="b in d.bonuses" :key="b.id" class="brow stack-sm">
            <div class="row gap-sm wrap">
              <input
                type="text"
                class="input input-sm grow"
                style="min-width: 160px"
                list="bonus-sources"
                maxlength="60"
                :placeholder="BONUS_KINDS[b.kind].source"
                aria-label="Источник бонуса"
                :value="b.source"
                @input="changeBonus(b.id, { source: ($event.target as HTMLInputElement).value })"
              />
              <select
                class="input input-sm"
                style="width: auto"
                aria-label="Вид бонуса"
                :value="b.kind"
                @change="onBonusKindChange(b, ($event.target as HTMLSelectElement).value as BonusKind)"
              >
                <option v-for="x in BONUS_ORDER" :key="x" :value="x">{{ BONUS_KINDS[x].label }}</option>
              </select>
              <button type="button" class="icon-btn" title="Убрать бонус" aria-label="Убрать бонус" @click="removeBonus(b.id)">
                <Icon name="x" :size="16" />
              </button>
            </div>

            <div v-if="BONUS_KINDS[b.kind].slots.length" class="row gap wrap">
              <label v-for="(amt, si) in BONUS_KINDS[b.kind].slots" :key="si" class="row gap-sm small">
                <b>+{{ amt }}</b>
                <select
                  class="input input-sm"
                  style="width: auto"
                  :value="b.picks[si] ?? ''"
                  :aria-label="`+${amt}: характеристика`"
                  @change="onBonusPickChange(b, si, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">выберите…</option>
                  <option
                    v-for="a in bonusTargets(d, b.kind)"
                    :key="a"
                    :value="a"
                    :disabled="b.picks.some((p, j) => j !== si && p === a)"
                  >{{ ABIL[a].name }}</option>
                </select>
              </label>
            </div>

            <p v-if="b.kind === 'all1'" class="small" style="margin: 0">
              {{ CORE.map((a) => `${ABIL[a].short} +1`).join(' · ') }}
            </p>

            <div v-if="b.kind === 'custom'" class="bcustom">
              <label v-for="a in act" :key="a" class="field">
                <span>{{ ABIL[a].short }}</span>
                <input
                  type="number"
                  inputmode="numeric"
                  class="input input-sm"
                  min="-10"
                  max="10"
                  placeholder="0"
                  :value="b.custom[a] ?? ''"
                  @change="onBonusCustomChange(b, a, ($event.target as HTMLInputElement).value)"
                />
              </label>
            </div>

            <p class="small" :class="BONUS_KINDS[b.kind].slots.some((_, i) => !b.picks[i]) ? 'warn-txt' : 'faint'" style="margin: 0">
              {{ BONUS_KINDS[b.kind].slots.some((_, i) => !b.picks[i]) ? 'Выберите характеристики. ' : '' }}{{ BONUS_KINDS[b.kind].hint }}.
            </p>
          </div>

          <datalist id="bonus-sources">
            <option v-for="s in BONUS_SOURCES" :key="s" :value="s" />
          </datalist>

          <div class="row gap-sm wrap">
            <span class="muted small">Добавить:</span>
            <button
              v-for="x in BONUS_ORDER"
              :key="x"
              type="button"
              class="chip"
              :title="BONUS_KINDS[x].hint"
              @click="addBonus(x)"
            >
              {{ x === 'p2' || x === 'p11' ? `Увеличение ${BONUS_KINDS[x].label}` : x === 'p1' ? 'Черта +1' : BONUS_KINDS[x].label }}
            </button>
          </div>
          <p class="faint small" style="margin: 0">
            Увеличение характеристик классы дают на 4, 8, 12, 16 и 19 уровнях (воин — ещё на 6 и 14, плут — на 10): +2 к одной
            характеристике или +1 к двум; выше 20 так подняться нельзя. Честь увеличениями не растёт — её меняет мастер (на 1 в конце приключения),
            поэтому для неё доступны только «Свои значения».
          </p>
        </section>

        <!-- Facts -->
        <section class="card card-pad stack-sm">
          <div class="section-title" style="margin: 0">Что дают итоговые значения</div>
          <p v-if="!hasAnyFact" class="muted small" style="margin: 0">Сначала определите значения.</p>
          <ul v-else class="facts-list">
            <li v-if="strVal != null">
              <b class="fact-k">Сила {{ strVal }}</b>
              <span>
                Грузоподъёмность <b>{{ strVal * 15 }}</b> фунтов; толкать, тянуть, поднимать — до <b>{{ strVal * 30 }}</b> фунтов.
                Прыжок в длину с разбега — <b>{{ strVal }}</b> фт (с места — {{ Math.floor(strVal / 2) }}),
                в высоту с разбега — <b>{{ Math.max(0, 3 + mod(strVal)) }}</b> фт (с места — {{ Math.floor(Math.max(0, 3 + mod(strVal)) / 2) }}).
                Для существа среднего размера.
              </span>
            </li>
            <li v-if="dexMod != null">
              <b class="fact-k">Ловкость {{ final.dex }}</b>
              <span>Инициатива <b>{{ signed(dexMod) }}</b>; КД без доспехов — <b>{{ 10 + dexMod }}</b>; лёгкие доспехи прибавляют весь модификатор, средние — не больше +2.</span>
            </li>
            <li v-if="conMod != null">
              <b class="fact-k">Телосложение {{ final.con }}</b>
              <span>
                Хиты за уровень: кость хитов <b>{{ signed(conMod) }}</b> (не меньше 1).
                Задержать дыхание — на <b>{{ 1 + conMod >= 1 ? `${1 + conMod} ${plural(1 + conMod, 'минуту', 'минуты', 'минут')}` : '30 секунд' }}</b>;
                спасброски концентрации.
              </span>
            </li>
            <li v-for="f in castFacts" :key="f.a">
              <b class="fact-k">{{ ABIL[f.a].name }} {{ f.score }}</b>
              <span>
                Для заклинателя с этой характеристикой на 1–4 уровне: СЛ спасброска <b>{{ 8 + 2 + f.m }}</b>, бонус атаки заклинанием <b>{{ signed(2 + f.m) }}</b>.
                <template v-if="f.a === 'wis'"> Пассивная Мудрость (Внимательность) — <b>{{ 10 + f.m }}</b>.</template>
                <template v-if="f.a === 'int'"> Проверки знаний: Магия, История, Природа, Религия, Анализ.</template>
                <template v-if="f.a === 'cha'"> Обман, Убеждение, Запугивание, Выступление.</template>
              </span>
            </li>
            <li v-if="sanMod != null">
              <b class="fact-k">Здравомыслие {{ final.san }}</b>
              <span>Спасброски Здравомыслия <b>{{ signed(sanMod) }}</b> — от безумия (существа Дальнего Предела, некоторые заклинания, психический урон); проверки — вместо Интеллекта, чтобы понять чуждые тексты и знания. Долгосрочное или бессрочное безумие снижает Здравомыслие на 1.</span>
            </li>
            <li v-if="honMod != null">
              <b class="fact-k">Честь {{ final.hon }}</b>
              <span>Проверки Чести <b>{{ signed(honMod) }}</b> — в общении, как Харизма, когда важны кодекс и этикет; спасброски — чтобы по неосторожности не совершить бесчестный поступок. Значение меняет мастер (±1 в конце приключения), пределы 1–20.</span>
            </li>
          </ul>
        </section>

        <!-- Notes -->
        <section class="card card-pad stack-sm">
          <div class="section-title" style="margin: 0">Заметки</div>
          <textarea
            class="input"
            rows="3"
            maxlength="4000"
            placeholder="Например: кто и когда бросал, договорённости с мастером"
            :value="d.notes"
            @input="patchData({ notes: ($event.target as HTMLTextAreaElement).value })"
          />
        </section>
      </div>

      <!-- ==================== SIDEBAR ==================== -->
      <aside class="stats-side stack">
        <section class="card card-pad stack-sm">
          <p class="small" :class="dirty ? 'warn-txt' : 'muted'" style="margin: 0" role="status">
            {{ saved ? (dirty ? `Есть несохранённые изменения в «${setTitle(saved.data)}»` : `Открыт сохранённый набор «${setTitle(saved.data)}»`) : dirty ? 'Набор не сохранён' : 'Новый набор' }}
          </p>
          <div class="row gap-sm wrap">
            <button type="button" class="btn btn-primary btn-sm" :disabled="busy || Boolean(saved && !dirty)" @click="doSave">
              <Icon name="check" :size="15" /> {{ saved ? 'Сохранить изменения' : 'Сохранить набор' }}
            </button>
            <button v-if="saved" type="button" class="btn btn-sm" :disabled="busy" @click="doSaveAsNew">Как новый</button>
            <button type="button" class="btn btn-sm btn-ghost" @click="resetCalc"><Icon name="plus" :size="15" /> Новый</button>
          </div>
        </section>

        <section class="card card-pad stack-sm">
          <div class="section-title" style="margin: 0">Сохранённые наборы{{ sets.length ? ` (${sets.length})` : '' }}</div>
          <div v-if="loading" class="empty" style="padding: 16px"><Icon name="refresh-cw" class="spin" :size="20" /></div>
          <p v-else-if="!sets.length" class="muted small" style="margin: 0">
            Пока пусто. Определите характеристики, впишите имя персонажа и нажмите «Сохранить набор».
          </p>
          <div v-else class="stack">
            <div v-for="[charName, list] in groupedSets" :key="charName" class="sgroup">
              <div class="sgroup-title">{{ charName || 'Без персонажа' }}</div>
              <div class="stack-sm">
                <div v-for="s in list" :key="s.id" class="sset" :class="{ cur: s.id === draft.savedId }">
                  <div class="row gap-sm">
                    <button type="button" class="sset-main grow" title="Открыть в калькуляторе" @click="loadSet(s)">
                      <b class="ellipsis">{{ setTitle(s.data) }}</b>
                      <small class="faint ellipsis">
                        {{ METHODS.find((m) => m.id === s.data.method)!.label }}{{ s.data.san || s.data.hon ? ` · ${[s.data.san && 'ЗДР', s.data.hon && 'ЧСТ'].filter(Boolean).join(', ')}` : '' }} · {{ fmtDate(s.updated) }}
                      </small>
                    </button>
                    <button type="button" class="icon-btn" title="Удалить" :aria-label="`Удалить набор «${setTitle(s.data)}»`" @click="removeSet(s)">
                      <Icon name="trash2" :size="15" />
                    </button>
                  </div>
                  <button
                    type="button"
                    class="copyline small"
                    style="width: 100%; justify-content: space-between"
                    :class="{ ok: copiedKey === 's-' + s.id }"
                    :disabled="!scoresLine(s.data, 'values')"
                    @click="copyLine('s-' + s.id, scoresLine(s.data, 'values'))"
                  >
                    <code>{{ scoresLine(s.data, 'values') ?? '—' }}</code>
                    <span class="copyline-ic"><Icon :name="copiedKey === 's-' + s.id ? 'check' : 'copy'" :size="13" /></span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="card card-pad stack-sm">
          <div class="section-title" style="margin: 0">Резервная копия</div>
          <p class="faint small" style="margin: 0">
            Наборы хранятся в вашем аккаунте и синхронизируются между устройствами. Также можно выгрузить или загрузить JSON-копию (совместима со старым форматом).
          </p>
          <div class="row gap-sm wrap">
            <button type="button" class="btn btn-sm" :disabled="!sets.length" @click="exportStatSets(sets)">
              <Icon name="download" :size="14" /> В файл
            </button>
            <button type="button" class="btn btn-sm" @click="fileInput?.click()">
              <Icon name="upload" :size="14" /> Из файла
            </button>
          </div>
          <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onImportFile" />
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.page { max-width: 1260px; margin: 0 auto; padding: 18px 24px 60px; }
.crumbs-row { margin-bottom: 8px; }
.back-link { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; color: var(--text-muted); }
.back-link:hover { color: var(--accent); text-decoration: none; }

.stats-layout { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 20px; align-items: start; }
.stats-side { position: sticky; top: calc(var(--topbar-h) + 14px); }
.set-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }

.methods { display: grid; grid-template-columns: repeat(auto-fill, minmax(175px, 1fr)); gap: 8px; }
.mcard {
  display: flex; flex-direction: column; gap: 3px; text-align: left; padding: 10px 12px;
  border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface-2);
  cursor: pointer; transition: border-color .12s, background .12s;
}
.mcard:hover { border-color: var(--accent); }
.mcard.on { border-color: var(--accent); background: var(--accent-soft); }
.mcard b { font-size: 14.5px; }

.optional-box { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--border); }
.mpanel { padding: 12px 14px; border-radius: var(--radius-sm); background: var(--surface-2); border: 1px solid var(--border); }

.pb-head { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
.pb-left { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.pb-left b { font-size: 26px; font-family: var(--font-head); line-height: 1; color: var(--accent); }
.pb-left.zero b { color: var(--success); }
.pb-left.over b, .pb-left.over span { color: var(--danger); }
.pb-bar { height: 7px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
.pb-bar span { display: block; height: 100%; background: var(--accent); transition: width .15s; }
.pb-bar span.over { background: var(--danger); }

.sub-details summary { cursor: pointer; font-size: 13px; color: var(--accent); font-weight: 500; user-select: none; }
.pb-table { border-collapse: collapse; font-size: 13px; }
.pb-table th, .pb-table td { padding: 4px 8px; border: 1px solid var(--border); text-align: center; }
.pb-table th { background: var(--surface); color: var(--text-muted); text-align: left; }
.pb-table td.ext { color: var(--accent); font-weight: 600; }

.formula-help-body p { margin: 8px 0; }
.wrap-check { align-items: flex-start; }
.inline-num { display: inline-block; width: 66px; margin-left: 4px; vertical-align: middle; }
.warn-txt { color: var(--warning); }

.rolls-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.rcard {
  display: flex; flex-direction: column; gap: 4px; padding: 8px 10px;
  border-radius: var(--radius-sm); background: var(--surface); border: 1px solid var(--border);
}
.rcard.dropped { opacity: .55; }
.rval { font-family: var(--font-head); font-size: 24px; font-weight: 700; line-height: 1; }
.rdetail { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 12.5px; }
.dterm { display: inline-flex; align-items: center; gap: 3px; }
.dop { color: var(--text-faint); font-weight: 600; }
.die { display: inline-flex; align-items: center; gap: 2px; padding: 1px 5px; border-radius: 4px; background: var(--surface-2); border: 1px solid var(--border); font-family: var(--font-mono); font-size: 12px; }
.die.dropped { text-decoration: line-through; opacity: .5; }
.die.boom { border-color: var(--accent); color: var(--accent); font-weight: 700; }
.rr { font-size: 10.5px; color: var(--text-faint); margin-right: 2px; }
.rwho { font-size: 11.5px; color: var(--text-muted); }

.hist-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.hist-list li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; border-bottom: 1px solid var(--border); }
.hist-list li:last-child { border-bottom: 0; }

.stat-table tr.opt td { background: color-mix(in srgb, var(--accent) 5%, transparent); }
.sname { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
.pbctl { display: inline-flex; align-items: center; gap: 8px; }
.stepper { display: inline-flex; align-items: center; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; background: var(--surface); }
.step-btn { width: 28px; height: 28px; border: 0; background: var(--surface-2); cursor: pointer; font-weight: 700; }
.step-btn:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); }
.step-btn:disabled { opacity: .35; cursor: not-allowed; }
.step-val { min-width: 30px; text-align: center; font-family: var(--font-mono); }
.mnum { width: 74px; }
.pick { width: auto; max-width: 220px; }
.sbonus .block { display: block; font-size: 11.5px; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stotal { font-family: var(--font-head); font-size: 21px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; }
.stotal.warn { color: var(--warning); }
.issue-dot {
  display: inline-flex; align-items: center; justify-content: center; width: 17px; height: 17px;
  border-radius: 50%; background: var(--warning); color: #fff; font: 700 11px var(--font-ui);
}
.smod { font-family: var(--font-mono); font-weight: 700; font-size: 15px; color: var(--accent); }

.ssum { display: flex; flex-wrap: wrap; gap: 10px 20px; font-size: 13.5px; color: var(--text-muted); padding: 8px 12px; border-radius: var(--radius-sm); background: var(--surface-2); }
.ssum b { color: var(--text); }

.copies { display: flex; flex-wrap: wrap; gap: 8px; }
.copyline {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px;
  border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--surface-2);
  cursor: pointer; font-size: 13.5px; transition: border-color .12s, background .12s;
}
.copyline:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-soft); }
.copyline:disabled { opacity: .5; cursor: not-allowed; }
.copyline.ok { border-color: var(--success); color: var(--success); }
.copyline-k { font-size: 12px; color: var(--text-muted); font-weight: 600; }
.copyline code { font-family: var(--font-mono); font-weight: 600; }
.copyline-ic { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; color: var(--text-muted); }
.copyline.ok .copyline-ic { color: var(--success); }

.brow { padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface-2); }
.bcustom { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 8px; }

.facts-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 14px; }
.facts-list li { display: flex; flex-direction: column; gap: 2px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.facts-list li:last-child { border-bottom: 0; padding-bottom: 0; }
.fact-k { font-family: var(--font-head); font-size: 17px; color: var(--accent); }

.sgroup-title { font-size: 12.5px; font-weight: 700; color: var(--text-muted); margin-bottom: 4px; }
.sset { padding: 8px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface-2); display: flex; flex-direction: column; gap: 6px; }
.sset.cur { border-color: var(--accent); background: var(--accent-soft); }
.sset-main { border: 0; background: none; padding: 0; text-align: left; cursor: pointer; display: flex; flex-direction: column; min-width: 0; }
.sset-main:hover b { color: var(--accent); }

@media (max-width: 980px) {
  .stats-layout { grid-template-columns: minmax(0, 1fr); }
  .stats-side { position: static; }
}
@media (max-width: 720px) {
  .page { padding: 14px 12px 50px; }
  .set-fields { grid-template-columns: minmax(0, 1fr); }
}
</style>
