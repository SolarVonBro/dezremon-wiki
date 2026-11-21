<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useWorld, myWorlds } from '@/stores/world'
import { useSession } from '@/stores/session'
import { useGallery } from '@/stores/gallery'
import { SPARK, countWorldDocs, formatBytes, measureWorld } from '@/data/usage'
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

onMounted(async () => {
  void gallery.ensure()
  if (session.user) others.value = (await myWorlds(session.user.uid).catch(() => [])).filter((w) => w.id !== world.wid && w.ownerId === session.user!.uid)
})

const usage = computed(() => world.world?.usage ?? null)
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
const othersBytes = computed(() => others.value.reduce((s, w) => s + (w.usage?.bytes ?? 0), 0))
const othersUnmeasured = computed(() => others.value.filter((w) => !w.usage).length)
const projectBytes = computed(() => (usage.value?.bytes ?? 0) + othersBytes.value)

async function recount() {
  busy.value = 'count'
  try {
    const { total } = await countWorldDocs(world.wid!)
    const ok = confirm(`Пересчёт прочитает ${total} ${plural(total, 'документ', 'документа', 'документов')} мира (из ${SPARK.reads.toLocaleString('ru-RU')} бесплатных чтений в сутки). Картинки заново не скачиваются. Продолжить?`)
    if (!ok) return
    busy.value = 'measure'
    const res = await measureWorld(world.wid!, (done, t, name) => { progress.value = { done, total: t, name } })
    await world.updateWorld({ usage: res })
    toast.success(`Мир занимает ${formatBytes(res.bytes)}`)
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
        <h3 class="panel-title grow" style="margin: 0"><Icon name="database" /> Место в базе</h3>
        <button class="btn btn-primary btn-sm" :disabled="!!busy" @click="recount">
          <Icon name="refresh-cw" :size="14" :class="{ spin: !!busy }" /> {{ busy === 'measure' ? 'Считаю…' : busy === 'count' ? 'Оцениваю…' : 'Пересчитать' }}
        </button>
      </div>

      <template v-if="usage">
        <div class="meter-head">
          <b class="meter-big">{{ formatBytes(usage.bytes) }}</b>
          <span class="muted">из {{ formatBytes(SPARK.storageBytes) }} бесплатно · {{ pct(usage.bytes, SPARK.storageBytes).toFixed(1) }}%</span>
          <span class="grow" />
          <span class="faint small">посчитано {{ relativeTime(usage.at) }} · {{ usage.docs.toLocaleString('ru-RU') }} документов</span>
        </div>
        <div class="meter"><div class="meter-fill" :class="{ warn: usage.bytes > SPARK.storageBytes * 0.8 }" :style="{ width: pct(usage.bytes, SPARK.storageBytes) + '%' }" /></div>
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
        <span v-if="others.length">
          <Icon name="globe" :size="14" /> Все ваши миры в этом проекте: <b>{{ formatBytes(projectBytes) }}</b>
          <span v-if="othersUnmeasured" class="faint">(ещё не посчитано миров: {{ othersUnmeasured }})</span>
        </span>
      </div>
      <p class="faint small" style="margin: 0">
        Лимит 1 ГБ общий для всего Firebase-проекта. Число — расчёт по официальной формуле размера документов и индексов
        Firestore; оно близко к тому, что показывает Google, но может отличаться на несколько процентов.
        Объём, освобождённый удалением, Google пересчитывает у себя раз в сутки.
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
.live { padding: 8px 10px; background: var(--surface-2); border-radius: 8px; }
</style>
