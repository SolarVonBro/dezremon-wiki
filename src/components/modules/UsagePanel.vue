<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useWorld, myWorlds } from '@/stores/world'
import { useSession } from '@/stores/session'
import { useGallery } from '@/stores/gallery'
import { SPARK, countWorldDocs, formatBytes, measureWorld, readProjectUsage, saveWorldUsage, type WorldUsageRow } from '@/data/usage'
import { relativeTime, plural } from '@/data/util'
import { firebaseConfig } from '@/firebaseConfig'
import Icon from '@/components/common/Icon.vue'
import { toast } from '@/components/common/toast'
import type { Role, World } from '@/model/types'

const world = useWorld()
const session = useSession()
const gallery = useGallery()
const busy = ref<'' | 'count' | 'measure'>('')
const progress = ref<{ done: number; total: number; name: string } | null>(null)
const others = ref<Array<World & { role: Role }>>([])
const rows = ref<WorldUsageRow[] | null | undefined>(undefined) // undefined = loading, null = failed

const usage = computed(() => world.world?.usage ?? null)

/** Totals of every world in the project; our own row is refreshed if it lags behind the last measurement. */
async function loadProject() {
  try {
    rows.value = await readProjectUsage()
    const u = usage.value
    const mine = rows.value.find((r) => r.id === world.wid)
    if (u && world.wid && (!mine || mine.at !== u.at)) await publish(u)
  } catch { rows.value = null }
}
async function publish(u: { bytes: number; docs: number; at: number }) {
  await saveWorldUsage(world.wid!, u)
  const row = { id: world.wid!, bytes: u.bytes, docs: u.docs, at: u.at }
  rows.value = [...(rows.value ?? []).filter((r) => r.id !== row.id), row]
}

onMounted(async () => {
  void gallery.ensure()
  void loadProject()
  if (session.user) others.value = (await myWorlds(session.user.uid).catch(() => [])).filter((w) => w.id !== world.wid && w.ownerId === session.user!.uid)
})

const pct = (n: number, max: number) => Math.min(100, (n / max) * 100)

/** Grouped breakdown of the last measurement. */
const groups = computed(() => {
  const by = usage.value?.byCollection ?? {}
  const sum = (names: string[]) => names.reduce((s, n) => ({ docs: s.docs + (by[n]?.docs ?? 0), bytes: s.bytes + (by[n]?.bytes ?? 0) }), { docs: 0, bytes: 0 })
  const known = ['images', 'imageChunks', 'bodies', 'secrets', 'posts', 'revisions', 'entities']
  return [
    { label: 'Изображения', icon: 'images', ...sum(['images', 'imageChunks']) },
    { label: 'Тексты статей и разделов', icon: 'book-open', ...sum(['bodies', 'secrets', 'posts']) },
    { label: 'История версий', icon: 'clock', ...sum(['revisions']) },
    { label: 'Карточки статей', icon: 'file-text', ...sum(['entities']) },
    { label: 'Связи, карты, календари и прочее', icon: 'network', ...sum(Object.keys(by).filter((n) => !known.includes(n))) },
  ]
})

// Live numbers that cost nothing: image bytes are stored in the gallery metadata.
const liveImages = computed(() => gallery.list.reduce((s, i) => s + (i.size || 0), 0))
// ---------- the whole project (the free 1 GiB is shared by all worlds) ----------
const thisBytes = computed(() => usage.value?.bytes ?? 0)
const otherRows = computed(() => (rows.value ?? []).filter((r) => r.id !== world.wid))
const otherBytes = computed(() => otherRows.value.reduce((s, r) => s + r.bytes, 0))
const otherUnmeasured = computed(() => otherRows.value.filter((r) => !r.at).length)
const totalBytes = computed(() => thisBytes.value + otherBytes.value)
const freeBytes = computed(() => Math.max(0, SPARK.storageBytes - totalBytes.value))
function sizeOf(id: string) { const r = rows.value?.find((x) => x.id === id); return r?.at ? formatBytes(r.bytes) : 'не посчитан' }
const oldestOther = computed(() => otherRows.value.filter((r) => r.at).reduce((m, r) => Math.min(m, r.at), Infinity))

async function recount() {
  busy.value = 'count'
  try {
    const { total } = await countWorldDocs(world.wid!)
    const ok = confirm(`Пересчёт прочитает ${total} ${plural(total, 'документ', 'документа', 'документов')} мира (из ${SPARK.reads.toLocaleString('ru-RU')} бесплатных чтений в сутки). Картинки заново не скачиваются. Продолжить?`)
    if (!ok) return
    busy.value = 'measure'
    const res = await measureWorld(world.wid!, (done, t, name) => { progress.value = { done, total: t, name } })
    await world.updateWorld({ usage: res })
    await publish(res).catch(() => {})
    toast.success(`Мир занимает ${formatBytes(res.bytes)} — ${pct(res.bytes, SPARK.storageBytes).toFixed(1)}% общего лимита проекта`)
  } catch (e: any) {
    toast.error('Не удалось посчитать: ' + (e?.message ?? e))
  } finally {
    busy.value = ''
    progress.value = null
  }
}
const consoleUsage = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/-default-/usage`
const consoleAuth = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/usage`
</script>

<template>
  <div class="stack">
    <section class="card card-pad stack">
      <div class="row gap wrap">
        <h3 class="panel-title grow" style="margin: 0"><Icon name="database" /> Место в базе — весь проект</h3>
        <button class="btn btn-primary btn-sm" :disabled="!!busy" @click="recount">
          <Icon name="refresh-cw" :size="14" :class="{ spin: !!busy }" /> {{ busy === 'measure' ? 'Считаю…' : busy === 'count' ? 'Оцениваю…' : 'Пересчитать этот мир' }}
        </button>
      </div>

      <div class="meter-head">
        <b class="meter-big">{{ formatBytes(totalBytes) }}</b>
        <span class="muted">из {{ formatBytes(SPARK.storageBytes) }} на весь проект · {{ pct(totalBytes, SPARK.storageBytes).toFixed(1) }}%</span>
        <span class="grow" />
        <span class="faint small">свободно {{ formatBytes(freeBytes) }}</span>
      </div>
      <div class="meter stacked" :class="{ warn: totalBytes > SPARK.storageBytes * 0.8 }" title="Этот мир / другие миры проекта">
        <div class="seg seg-this" :style="{ width: pct(thisBytes, SPARK.storageBytes) + '%' }" />
        <div class="seg seg-other" :style="{ width: pct(otherBytes, SPARK.storageBytes) + '%' }" />
      </div>
      <div class="legend small">
        <span><i class="dot dot-this" /> Этот мир:
          <template v-if="usage"><b>{{ formatBytes(thisBytes) }}</b> · {{ pct(thisBytes, SPARK.storageBytes).toFixed(1) }}% лимита · посчитано {{ relativeTime(usage.at) }}</template>
          <template v-else><b>ещё не посчитан</b></template>
        </span>
        <span v-if="rows"><i class="dot dot-other" /> Другие миры ({{ otherRows.length }}): <b>{{ formatBytes(otherBytes) }}</b>
          <template v-if="otherUnmeasured"> · не посчитано: {{ otherUnmeasured }}</template>
          <template v-if="oldestOther !== Infinity"> · самый старый замер {{ relativeTime(oldestOther) }}</template>
        </span>
        <span v-else-if="rows === undefined" class="faint"><Icon name="refresh-cw" class="spin" :size="12" /> Другие миры: загружаю…</span>
        <span v-else class="faint">Другие миры: не удалось загрузить</span>
      </div>

      <template v-if="usage">
        <h4 class="sub-title">Из чего состоит этот мир <span class="faint small">· {{ usage.docs.toLocaleString('ru-RU') }} документов</span></h4>
        <table class="table">
          <tbody>
            <tr v-for="g in groups" :key="g.label">
              <td><Icon :name="g.icon" :size="15" class="faint" /> {{ g.label }}</td>
              <td class="muted small nowrap">{{ g.docs.toLocaleString('ru-RU') }} док.</td>
              <td class="nowrap" style="text-align: right"><b>{{ formatBytes(g.bytes) }}</b></td>
              <td style="width: 34%"><div class="meter meter-sm"><div class="meter-fill" :style="{ width: pct(g.bytes, Math.max(1, usage.bytes)) + '%' }" /></div></td>
            </tr>
          </tbody>
        </table>
      </template>
      <div v-else class="empty" style="padding: 18px">
        Ещё не считали. Нажмите «Пересчитать»: приложение прочитает документы мира один раз и посчитает объём
        по формуле Google (документы + индексы).
      </div>

      <div v-if="progress" class="small muted"><Icon name="refresh-cw" class="spin" :size="13" /> {{ progress.name }} — {{ progress.done }} / {{ progress.total }}</div>

      <div class="live row gap wrap small">
        <span><Icon name="images" :size="14" /> Изображения прямо сейчас: <b>{{ formatBytes(liveImages) }}</b> <span class="faint">(обновляется сразу при загрузке)</span></span>
        <span v-for="o in others" :key="o.id">
          <Icon name="globe" :size="14" /> {{ o.name }}: <b>{{ sizeOf(o.id) }}</b>
        </span>
      </div>
      <p class="faint small" style="margin: 0">
        Бесплатный 1 ГБ — один на весь Firebase-проект: его делят все миры всех мастеров (плюс служебные данные —
        профили пользователей, несколько КБ). Google не отдаёт реальный объём через API на бесплатном тарифе, поэтому
        каждый мир считает себя сам кнопкой «Пересчитать» у своего мастера, а здесь замеры складываются; у чужих миров
        видны только числа, без названий. Расчёт идёт по официальной формуле размера документов и индексов Firestore и
        может отличаться от консоли на несколько процентов; освобождённое удалением место Google пересчитывает раз в сутки.
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
        Счётчики сбрасываются в полночь по тихоокеанскому времени (около 11:00 по Москве). Сколько израсходовано сегодня,
        Google показывает только в консоли Firebase: на бесплатном тарифе эти данные не выдаются через API.
      </p>
      <div class="row gap wrap">
        <a class="btn btn-sm" :href="consoleUsage" target="_blank" rel="noopener"><Icon name="external-link" :size="14" /> Статистика базы в консоли Firebase</a>
        <a class="btn btn-sm btn-ghost" :href="consoleAuth" target="_blank" rel="noopener"><Icon name="external-link" :size="14" /> Все лимиты проекта</a>
      </div>
      <details class="small muted">
        <summary>На что уходят лимиты</summary>
        <ul>
          <li>Первое открытие мира на устройстве читает все статьи; дальше браузер помнит их и подтягивает только изменения.</li>
          <li>Автосохранение текста — 2–3 записи за раз (не чаще раза в пару секунд при наборе).</li>
          <li>Картинка читается из базы один раз на устройство, затем берётся из кэша браузера.</li>
          <li>Ежесуточный бэкап читает все документы всех миров один раз.</li>
          <li>«Пересчитать» здесь читает все документы этого мира (кроме байтов картинок).</li>
        </ul>
      </details>
    </section>
  </div>
</template>

<style scoped>
.meter-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.meter-big { font-family: var(--font-head); font-size: 30px; }
.meter { height: 12px; border-radius: 6px; background: var(--surface-3); overflow: hidden; }
.meter-sm { height: 6px; }
.meter-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--accent-2)); border-radius: inherit; min-width: 2px; transition: width .4s; }
.meter-fill.warn { background: linear-gradient(90deg, var(--warning), var(--danger)); }
.meter.stacked { display: flex; height: 14px; }
.seg { height: 100%; transition: width .4s; }
.seg-this { background: linear-gradient(90deg, var(--accent), var(--accent-2)); min-width: 2px; }
.seg-other { background: color-mix(in srgb, var(--text-faint) 55%, var(--surface-3)); }
.meter.stacked.warn .seg-this { background: linear-gradient(90deg, var(--warning), var(--danger)); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; vertical-align: -1px; margin-right: 2px; }
.dot-this { background: var(--accent); }
.dot-other { background: color-mix(in srgb, var(--text-faint) 55%, var(--surface-3)); }
.sub-title { margin: 8px 0 0; font-size: 15px; }
.live { padding: 8px 10px; background: var(--surface-2); border-radius: 8px; }
</style>
