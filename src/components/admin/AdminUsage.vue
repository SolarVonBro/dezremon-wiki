<script setup lang="ts">
// "Ресурсы" (moved here from world settings): the free Spark quota is shared by the whole project, so the
// administrator sees every world's size, the service data, and can re-measure any of them.
import { computed, onMounted, ref } from 'vue'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { SPARK, SERVICE_USAGE_ID, countWorldDocs, formatBytes, measureService, measureWorld, readProjectUsage, saveWorldUsage, type WorldUsageRow } from '@/data/usage'
import { relativeTime, plural, errorText } from '@/data/util'
import { firebaseConfig } from '@/firebaseConfig'
import Icon from '@/components/common/Icon.vue'
import { toast } from '@/components/common/toast'
import type { UserProfile, World } from '@/model/types'

const props = defineProps<{ worlds: World[]; users: Map<string, UserProfile> }>()
const rows = ref<WorldUsageRow[] | null>(null)
const busy = ref('')   // id being measured, or 'all'
const progress = ref('')

async function load() { rows.value = await readProjectUsage().catch(() => []) }
onMounted(load)

const rowOf = (id: string) => rows.value?.find((r) => r.id === id) ?? null
const total = computed(() => (rows.value ?? []).reduce((s, r) => s + r.bytes, 0))
const free = computed(() => Math.max(0, SPARK.storageBytes - total.value))
const pct = (n: number, max = SPARK.storageBytes) => Math.min(100, (n / max) * 100)
const sorted = computed(() => [...props.worlds].sort((a, b) => (rowOf(b.id)?.bytes ?? 0) - (rowOf(a.id)?.bytes ?? 0)))
/** usage rows left from worlds that no longer exist */
const orphans = computed(() => (rows.value ?? []).filter((r) => r.id !== SERVICE_USAGE_ID && !props.worlds.some((w) => w.id === r.id)))

async function measureOne(w: World) {
  busy.value = w.id
  try {
    const res = await measureWorld(w.id, (done, t, name) => { progress.value = `${w.name}: ${name} ${done}/${t}` })
    await saveWorldUsage(w.id, res)
    await updateDoc(doc(db, 'worlds', w.id), { usage: res }).catch(() => {})
    await load()
  } finally { busy.value = ''; progress.value = '' }
}
async function measureSvc() {
  busy.value = SERVICE_USAGE_ID
  try {
    const res = await measureService((name) => { progress.value = 'служебные данные: ' + name })
    await saveWorldUsage(SERVICE_USAGE_ID, res)
    await load()
  } finally { busy.value = ''; progress.value = '' }
}
async function measureAll() {
  busy.value = 'all'
  progress.value = 'оцениваю…'
  try {
    let docs = 0
    for (const w of props.worlds) docs += (await countWorldDocs(w.id)).total
    if (!confirm(`Пересчёт всего прочитает около ${docs.toLocaleString('ru-RU')} ${plural(docs, 'документ', 'документа', 'документов')} миров плюс служебные данные (из ${SPARK.reads.toLocaleString('ru-RU')} бесплатных чтений в сутки на проект). Продолжить?`)) return
    for (const w of props.worlds) await measureOne(w)
    busy.value = 'all'
    await measureSvc()
    toast.success('Всё пересчитано')
  } catch (e: any) { toast.error('Не удалось: ' + errorText(e)) } finally { busy.value = ''; progress.value = '' }
}
async function run(fn: () => Promise<void>) {
  try { await fn() } catch (e: any) { toast.error('Не удалось посчитать: ' + errorText(e)) }
}
const svc = computed(() => rowOf(SERVICE_USAGE_ID))
const consoleUsage = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/-default-/usage`
const consoleProject = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/usage`
</script>

<template>
  <div class="stack">
    <section class="card card-pad stack">
      <div class="row gap wrap">
        <h3 class="panel-title grow" style="margin: 0"><Icon name="database" /> Место в базе — весь проект</h3>
        <button class="btn btn-primary btn-sm" :disabled="!!busy" @click="measureAll"><Icon name="refresh-cw" :size="14" :class="{ spin: busy === 'all' }" /> Пересчитать всё</button>
      </div>
      <div class="meter-head">
        <b class="meter-big">{{ formatBytes(total) }}</b>
        <span class="muted">из {{ formatBytes(SPARK.storageBytes) }} · {{ pct(total).toFixed(1) }}%</span>
        <span class="grow" />
        <span class="faint small">свободно {{ formatBytes(free) }}</span>
      </div>
      <div class="meter" :class="{ warn: total > SPARK.storageBytes * 0.8 }"><div class="meter-fill" :style="{ width: pct(total) + '%' }" /></div>
      <div v-if="progress" class="small muted"><Icon name="refresh-cw" class="spin" :size="13" /> {{ progress }}</div>

      <div class="table-scroll">
        <table class="table">
          <thead><tr><th>Что</th><th>Владелец</th><th style="text-align: right">Объём</th><th>Посчитано</th><th /></tr></thead>
          <tbody>
            <tr v-for="w in sorted" :key="w.id">
              <td><RouterLink :to="{ name: 'dashboard', params: { wid: w.id } }"><Icon name="globe" :size="14" /> {{ w.name }}</RouterLink></td>
              <td class="muted small">{{ users.get(w.ownerId)?.displayName ?? '—' }}</td>
              <td class="nowrap" style="text-align: right"><b v-if="rowOf(w.id)?.at">{{ formatBytes(rowOf(w.id)!.bytes) }}</b><span v-else class="faint">не посчитан</span></td>
              <td class="faint small nowrap">{{ rowOf(w.id)?.at ? relativeTime(rowOf(w.id)!.at) : '—' }}</td>
              <td style="width: 1%"><button class="btn btn-sm btn-ghost" :disabled="!!busy" @click="run(() => measureOne(w))"><Icon name="refresh-cw" :size="13" :class="{ spin: busy === w.id }" /><span class="hide-sm"> Пересчитать</span></button></td>
            </tr>
            <tr>
              <td><Icon name="server-cog" :size="14" /> Служебные данные <span class="faint small">(кампейны, комнаты, профили)</span></td>
              <td class="muted small">—</td>
              <td class="nowrap" style="text-align: right"><b v-if="svc?.at">{{ formatBytes(svc.bytes) }}</b><span v-else class="faint">не посчитаны</span></td>
              <td class="faint small nowrap">{{ svc?.at ? relativeTime(svc.at) : '—' }}</td>
              <td><button class="btn btn-sm btn-ghost" :disabled="!!busy" @click="run(measureSvc)"><Icon name="refresh-cw" :size="13" :class="{ spin: busy === SERVICE_USAGE_ID }" /><span class="hide-sm"> Пересчитать</span></button></td>
            </tr>
            <tr v-for="o in orphans" :key="o.id">
              <td class="faint"><Icon name="triangle-alert" :size="14" /> Замер удалённого мира {{ o.id }}</td><td /><td style="text-align: right">{{ formatBytes(o.bytes) }}</td><td /><td />
            </tr>
          </tbody>
        </table>
      </div>
      <p class="faint small" style="margin: 0">
        Бесплатный 1 ГБ Firebase (Spark) — один на весь проект: его делят все миры всех мастеров и служебные данные. Google не отдаёт
        реальный объём через API на бесплатном тарифе, поэтому объём считается приложением по официальной формуле размера документов
        и индексов Firestore (может отличаться от консоли на несколько процентов). Пересчёт мира читает все его документы, кроме байтов картинок.
      </p>
    </section>

    <section class="card card-pad stack">
      <h3 class="panel-title" style="margin: 0"><Icon name="gauge" /> Суточные лимиты</h3>
      <table class="table">
        <tbody>
          <tr><td>Чтения документов</td><td style="text-align: right"><b>{{ SPARK.reads.toLocaleString('ru-RU') }}</b> в сутки</td></tr>
          <tr><td>Записи</td><td style="text-align: right"><b>{{ SPARK.writes.toLocaleString('ru-RU') }}</b> в сутки</td></tr>
          <tr><td>Удаления</td><td style="text-align: right"><b>{{ SPARK.deletes.toLocaleString('ru-RU') }}</b> в сутки</td></tr>
        </tbody>
      </table>
      <p class="muted small" style="margin: 0">
        Счётчики общие на весь проект и сбрасываются в полночь по тихоокеанскому времени (около 11:00 по Москве). Сколько израсходовано
        сегодня, Google показывает только в консоли. Музыкальные комнаты пишут в базу при каждом действии с плеером и раз в минуту отмечают слушателей.
      </p>
      <div class="row gap wrap">
        <a class="btn btn-sm" :href="consoleUsage" target="_blank" rel="noopener"><Icon name="external-link" :size="14" /> Статистика базы в консоли Firebase</a>
        <a class="btn btn-sm btn-ghost" :href="consoleProject" target="_blank" rel="noopener"><Icon name="external-link" :size="14" /> Все лимиты проекта</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.meter-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.meter-big { font-family: var(--font-head); font-size: 30px; }
.meter { height: 12px; border-radius: 6px; background: var(--surface-3); overflow: hidden; }
.meter-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); border-radius: inherit; min-width: 2px; transition: width .4s; }
.meter.warn .meter-fill { background: linear-gradient(90deg, var(--warning), var(--danger)); }
</style>
