<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import { useSession } from '@/stores/session'
import Icon from '@/components/common/Icon.vue'
import { toast } from '@/components/common/toast'
import { downloadBlob, formatDate, plural, relativeTime } from '@/data/util'
import {
  SAFE_DAILY_WRITES, exportWorldDetailed, inspectBackup, restoreWorld, type BackupInspection, type PortProgress, type RestoreReport,
} from '@/data/backup'
import { importKanka, inspectKanka, type KankaInspection, type KankaReport } from '@/data/kanka'
import { typeDef } from '@/model/entityTypes'

const world = useWorld()
const allowed = computed(() => world.isMaster)

const COLLECTION_LABELS: Record<string, string> = {
  entities: 'Статьи', bodies: 'Тексты статей', secrets: 'Секреты мастера', posts: 'Посты', relations: 'Связи',
  orgMembers: 'Участники организаций', inventory: 'Инвентарь', entityAbilities: 'Способности статей', questElements: 'Элементы квестов',
  reminders: 'Даты календарей', timelineEras: 'Эпохи хронологий', timelineElements: 'События хронологий', mapLayers: 'Слои карт',
  mapGroups: 'Группы меток', mapMarkers: 'Метки карт', messages: 'Сообщения', images: 'Изображения', imageChunks: 'Части изображений',
  revisions: 'История правок', bookmarks: 'Закладки', members: 'Участники', invites: 'Приглашения', users: 'Профили',
}
const colLabel = (k: string) => COLLECTION_LABELS[k] ?? k
const fmt = (n: number) => n.toLocaleString('ru-RU')
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`
const pct = (p: PortProgress | null) => (p && p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0)

// ---------- leaving the page mid-operation ----------
const busy = ref<null | 'export' | 'restore' | 'kanka'>(null)
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!busy.value) return
  e.preventDefault()
  e.returnValue = ''
}
window.addEventListener('beforeunload', onBeforeUnload)
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

// =====================================================================================
// Full backup
// =====================================================================================
const lastKey = computed(() => `dw.lastBackup.${world.wid ?? ''}`)
function readLast(): number | null {
  try { return Number(localStorage.getItem(lastKey.value)) || null } catch { return null }
}
const lastBackup = ref<number | null>(readLast())
watch(lastKey, () => { lastBackup.value = readLast() })
const backupStale = computed(() => !lastBackup.value || Date.now() - lastBackup.value > 7 * 86400_000)

const expHtmlSecrets = ref(true)
const expRevisions = ref(true)
const expProgress = ref<PortProgress | null>(null)
const expResult = ref<{ filename: string; size: number; reads: number; docs: number; images: number; warnings: string[] } | null>(null)
const expError = ref('')

async function doExport() {
  if (busy.value || !world.wid) return
  busy.value = 'export'
  expError.value = ''
  expResult.value = null
  try {
    const r = await exportWorldDetailed(world, (p) => { expProgress.value = p }, { htmlSecrets: expHtmlSecrets.value, revisions: expRevisions.value })
    downloadBlob(r.blob, r.filename)
    const t = Date.now()
    try { localStorage.setItem(lastKey.value, String(t)) } catch { /* private mode */ }
    lastBackup.value = t
    expResult.value = {
      filename: r.filename, size: r.blob.size, reads: r.reads, warnings: r.warnings,
      docs: Object.values(r.manifest.counts).reduce((s, n) => s + n, 0), images: r.manifest.images.count,
    }
    toast.success('Резервная копия скачана')
  } catch (e: any) {
    console.error(e)
    expError.value = e?.message ?? String(e)
  } finally {
    busy.value = null
    expProgress.value = null
  }
}

// =====================================================================================
// Restore
// =====================================================================================
const rFile = ref<File | null>(null)
const rInfo = ref<BackupInspection | null>(null)
const rInspecting = ref(false)
const rMode = ref<'new' | 'replace'>('new')
const rName = ref('')
const rConfirm = ref('')
const rSkipRevisions = ref(false)
const rMembers = ref(false)
const rProgress = ref<PortProgress | null>(null)
const rReport = ref<RestoreReport | null>(null)
const rError = ref('')
const confirmWord = computed(() => (world.world?.name ?? '').trim() || 'ЗАМЕНИТЬ')
const rCanStart = computed(() => !!rInfo.value && !busy.value && (rMode.value === 'new' || rConfirm.value.trim() === confirmWord.value))
const rWrites = computed(() => {
  if (!rInfo.value) return 0
  let n = rInfo.value.estimatedWrites
  if (rSkipRevisions.value) n -= rInfo.value.counts.revisions ?? 0
  return n
})

async function onRestoreFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const f = input.files?.[0] ?? null
  rFile.value = f
  rInfo.value = null
  rReport.value = null
  rError.value = ''
  if (!f) return
  rInspecting.value = true
  try {
    rInfo.value = await inspectBackup(f)
    rName.value = `${rInfo.value.worldName} (копия)`
  } catch (e: any) {
    rError.value = e?.message ?? String(e)
  } finally {
    rInspecting.value = false
  }
}

function reload() {
  window.location.reload()
}

async function doRestore() {
  if (!rFile.value || !rCanStart.value) return
  busy.value = 'restore'
  rError.value = ''
  rReport.value = null
  try {
    rReport.value = await restoreWorld(rFile.value, rMode.value, world.wid ?? undefined, (p) => { rProgress.value = p }, {
      name: rName.value, restoreMembers: rMembers.value, skipCollections: rSkipRevisions.value ? ['revisions'] : [], photoURL: useSession().photo,
    })
    if (rReport.value.ok) toast.success(rMode.value === 'new' ? 'Мир восстановлен' : 'Содержимое мира заменено')
    else toast.error('Восстановление прервано')
  } catch (e: any) {
    console.error(e)
    rError.value = e?.message ?? String(e)
  } finally {
    busy.value = null
    rConfirm.value = ''
  }
}

// =====================================================================================
// Kanka import
// =====================================================================================
const kFile = ref<File | null>(null)
const kInfo = ref<KankaInspection | null>(null)
const kInspecting = ref(false)
const kVisibility = ref<'members' | 'public'>('members')
const kMergeTags = ref(true)
const kGallery = ref(false)
const kProgress = ref<PortProgress | null>(null)
const kLog = ref<Array<{ level: string; text: string }>>([])
const kReport = ref<KankaReport | null>(null)
const kError = ref('')
const kConfirmed = ref(false)
const kLogEl = ref<HTMLElement | null>(null)

const kOptions = () => ({ publicByDefault: kVisibility.value === 'public', mergeTags: kMergeTags.value, importUnusedGallery: kGallery.value })
const customLabel = (key: string, list?: Array<{ key: string; plural: string }>) => list?.find((c) => c.key === key)?.plural ?? typeDef(key).plural

async function inspectK() {
  if (!kFile.value) return
  kInspecting.value = true
  kError.value = ''
  try {
    kInfo.value = await inspectKanka(kFile.value, kOptions(), world.list)
  } catch (e: any) {
    kInfo.value = null
    kError.value = e?.message ?? String(e)
  } finally {
    kInspecting.value = false
  }
}

function onKankaFile(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0] ?? null
  kFile.value = f
  kInfo.value = null
  kReport.value = null
  kLog.value = []
  kConfirmed.value = false
  if (f) void inspectK()
}
watch([kVisibility, kMergeTags, kGallery], () => { if (kFile.value && !busy.value) void inspectK() })

function pushLog(level: string, text: string) {
  kLog.value.push({ level, text })
  if (kLog.value.length > 600) kLog.value.splice(0, kLog.value.length - 600)
  requestAnimationFrame(() => { if (kLogEl.value) kLogEl.value.scrollTop = kLogEl.value.scrollHeight })
}

async function doKanka() {
  if (!kFile.value || !kInfo.value || busy.value || !world.wid || !world.uid) return
  busy.value = 'kanka'
  kError.value = ''
  kReport.value = null
  kLog.value = []
  let lastPhase = ''
  try {
    kReport.value = await importKanka(kFile.value, { wid: world.wid, uid: world.uid, role: world.role, existingEntities: world.list }, kOptions(), (p) => {
      kProgress.value = p
      if (p.message && (p.level === 'warn' || p.level === 'error' || p.phase !== 'Изображения')) pushLog(p.level ?? 'info', `${p.phase}: ${p.message}`)
      else if (p.phase !== lastPhase) pushLog('info', p.phase)
      lastPhase = p.phase
    })
    if (kReport.value.ok) toast.success('Импорт из Kanka завершён')
    else toast.error('Импорт прерван')
  } catch (e: any) {
    console.error(e)
    kError.value = e?.message ?? String(e)
  } finally {
    busy.value = null
    kConfirmed.value = false
  }
}
</script>

<template>
  <div class="backup-panel">
    <div v-if="!allowed" class="empty">
      <Icon name="lock" :size="28" />
      <p>Резервные копии и импорт доступны только мастерам и владельцу мира.</p>
    </div>

    <template v-else>
      <p class="quota-note small muted">
        <Icon name="info" :size="15" />
        <span>Бесплатный тариф Firebase (Spark) позволяет <b>20&nbsp;000 записей</b> и <b>50&nbsp;000 чтений</b> в сутки на весь проект.
        Скачивание копии тратит чтения, восстановление и импорт — записи. Большие операции лучше делать, когда в мире никто не работает.</span>
      </p>

      <!-- ================= Full backup ================= -->
      <section class="card card-pad block">
        <h3 class="panel-title"><Icon name="archive" /> Полный бэкап</h3>
        <p class="muted">Скачивает весь мир одним ZIP-архивом. Внутри:</p>
        <ul class="inside small">
          <li><code>data/*.json</code> — все документы мира (статьи, тексты, посты, связи, карты, календари, хронологии, закладки…), включая секреты мастера, историю правок, участников и приглашения;</li>
          <li><code>images/</code> — оригиналы всех изображений галереи;</li>
          <li><code>html/index.html</code> — читаемая офлайн-копия: все статьи со ссылками друг на друга, открывается в браузере без приложения и интернета;</li>
          <li><code>manifest.json</code> и <code>world.json</code> — описание копии и настройки мира. Этот же архив можно восстановить ниже.</li>
        </ul>
        <div class="row wrap gap opts">
          <label class="check small"><input v-model="expHtmlSecrets" type="checkbox" :disabled="!!busy" /> Показывать секреты мастера в HTML-копии</label>
          <label class="check small"><input v-model="expRevisions" type="checkbox" :disabled="!!busy" /> Включить историю правок</label>
        </div>
        <div class="row wrap gap">
          <button class="btn btn-primary" type="button" :disabled="!!busy" @click="doExport">
            <Icon :name="busy === 'export' ? 'refresh-cw' : 'download'" :class="{ spin: busy === 'export' }" />
            {{ busy === 'export' ? 'Создаётся…' : 'Скачать ZIP' }}
          </button>
          <span class="small" :class="backupStale ? 'warn-text' : 'muted'">
            <Icon name="clock" :size="14" />
            <template v-if="lastBackup">Последняя копия в этом браузере: {{ formatDate(lastBackup) }} ({{ relativeTime(lastBackup) }})</template>
            <template v-else>В этом браузере копий ещё не делали</template>
          </span>
        </div>
        <div v-if="busy === 'export' && expProgress" class="progress">
          <div class="bar"><div class="fill" :style="{ width: pct(expProgress) + '%' }" /></div>
          <div class="small muted">{{ expProgress.phase }}<template v-if="expProgress.total"> — {{ expProgress.done }} / {{ expProgress.total }}</template><template v-if="expProgress.message"> · {{ expProgress.message }}</template></div>
        </div>
        <div v-if="expResult" class="result ok small">
          <Icon name="circle-check" :size="16" />
          <div>
            Скачан файл <b>{{ expResult.filename }}</b> ({{ mb(expResult.size) }}): {{ fmt(expResult.docs) }} документов, {{ fmt(expResult.images) }} изображений.
            Потрачено чтений: ~{{ fmt(expResult.reads) }}.
            <ul v-if="expResult.warnings.length" class="warn-list"><li v-for="(w, i) in expResult.warnings" :key="i">{{ w }}</li></ul>
          </div>
        </div>
        <p v-if="expError" class="result err small"><Icon name="triangle-alert" :size="16" /> {{ expError }}</p>
        <p class="small faint">Совет: настройте ежедневный автоматический бэкап через GitHub Actions — инструкция в папке <code>backup-runner/</code> репозитория.</p>
      </section>

      <!-- ================= Restore ================= -->
      <section class="card card-pad block">
        <h3 class="panel-title"><Icon name="rotate-ccw" /> Восстановление</h3>
        <p class="muted small">Выберите ZIP, созданный кнопкой выше или автоматическим бэкапом (<code>backup-runner/zip-backup.mjs</code>).</p>
        <label class="file-pick">
          <input type="file" accept=".zip,application/zip" :disabled="!!busy" @change="onRestoreFile" />
        </label>
        <p v-if="rInspecting" class="small muted"><Icon name="refresh-cw" :size="14" class="spin" /> Читаю архив…</p>

        <template v-if="rInfo">
          <div class="summary">
            <div><b>{{ rInfo.worldName }}</b> <span class="muted small">· копия от {{ formatDate(rInfo.exportedAt) }} · {{ rInfo.manifest.generator === 'backup-runner' ? 'автобэкап' : 'из браузера' }}{{ rInfo.manifest.scope === 'visible' ? ' · неполная' : '' }}</span></div>
            <div class="counts small">
              <span v-for="(n, k) in rInfo.counts" :key="k" class="chip-count">{{ colLabel(String(k)) }}: <b>{{ fmt(n) }}</b></span>
              <span class="chip-count">Файлов изображений: <b>{{ fmt(rInfo.images) }}</b> ({{ mb(rInfo.imageBytes) }})</span>
            </div>
            <ul v-if="rInfo.warnings.length" class="warn-list small"><li v-for="(w, i) in rInfo.warnings" :key="i">{{ w }}</li></ul>
          </div>

          <div class="modes">
            <label class="mode" :class="{ on: rMode === 'new' }">
              <input v-model="rMode" type="radio" value="new" :disabled="!!busy" />
              <div>
                <b>В новый мир</b>
                <div class="small muted">Создаётся отдельный мир, вы — его владелец. Текущий мир не меняется. Записей: ~{{ fmt(rWrites) }}.</div>
              </div>
            </label>
            <label class="mode" :class="{ on: rMode === 'replace' }">
              <input v-model="rMode" type="radio" value="replace" :disabled="!!busy || !world.isOwner && !world.isMaster" />
              <div>
                <b>Заменить текущий мир «{{ world.world?.name }}»</b>
                <div class="small muted">Всё содержимое мира станет таким, как в копии; то, чего в копии нет, будет удалено. Совпадающие документы не перезаписываются (экономит лимит). Участники и приглашения не трогаются.</div>
              </div>
            </label>
          </div>

          <div class="stack-sm opts">
            <label v-if="rMode === 'new'" class="field">
              <span>Название нового мира</span>
              <input v-model="rName" class="input" :disabled="!!busy" />
            </label>
            <label v-if="rMode === 'new' && rInfo.counts.members" class="check small"><input v-model="rMembers" type="checkbox" :disabled="!!busy" /> Восстановить участников и приглашения (иначе в новом мире будете только вы)</label>
            <label v-if="rInfo.counts.revisions" class="check small"><input v-model="rSkipRevisions" type="checkbox" :disabled="!!busy" /> Не восстанавливать историю правок (−{{ fmt(rInfo.counts.revisions) }} записей)</label>
            <label v-if="rMode === 'replace'" class="field danger-field">
              <span>Это необратимо. Для подтверждения введите название мира: <b>{{ confirmWord }}</b></span>
              <input v-model="rConfirm" class="input" :placeholder="confirmWord" :disabled="!!busy" autocomplete="off" />
            </label>
          </div>
          <p v-if="rWrites > SAFE_DAILY_WRITES" class="result err small">
            <Icon name="triangle-alert" :size="16" />
            Понадобится ~{{ fmt(rWrites) }} записей — это больше безопасного дневного объёма ({{ fmt(SAFE_DAILY_WRITES) }} из 20 000). Восстановление может оборваться на лимите;
            тогда повторите его на следующий день в режиме «Заменить» — уже записанное будет пропущено.
          </p>
          <button class="btn" :class="rMode === 'replace' ? 'btn-danger' : 'btn-primary'" type="button" :disabled="!rCanStart" @click="doRestore">
            <Icon :name="busy === 'restore' ? 'refresh-cw' : 'upload'" :class="{ spin: busy === 'restore' }" />
            {{ busy === 'restore' ? 'Восстановление…' : rMode === 'new' ? 'Восстановить в новый мир' : 'Заменить содержимое мира' }}
          </button>
        </template>

        <div v-if="busy === 'restore' && rProgress" class="progress">
          <div class="bar"><div class="fill" :style="{ width: pct(rProgress) + '%' }" /></div>
          <div class="small muted">{{ rProgress.phase }}<template v-if="rProgress.message"> · {{ rProgress.message }}</template></div>
        </div>
        <div v-if="rReport" class="result small" :class="rReport.ok ? 'ok' : 'err'">
          <Icon :name="rReport.ok ? 'circle-check' : 'triangle-alert'" :size="16" />
          <div class="grow">
            <template v-if="rReport.ok && rReport.mode === 'new'">Создан мир «<b>{{ rReport.worldName }}</b>» — он появился в списке ваших миров.</template>
            <template v-else-if="rReport.ok">Содержимое мира заменено. Перезагрузите страницу, чтобы увидеть восстановленные данные.</template>
            <template v-else>{{ rReport.error }}</template>
            <div class="muted">
              Записей: {{ fmt(rReport.writes) }}<template v-if="rReport.reads">, чтений: {{ fmt(rReport.reads) }}</template><template v-if="rReport.mode === 'replace'">, без изменений: {{ fmt(rReport.unchanged) }}, удалено: {{ fmt(rReport.deleted) }}</template>.
              Изображений восстановлено: {{ rReport.images.restored }}<template v-if="rReport.images.reused">, уже были на месте: {{ rReport.images.reused }}</template><template v-if="rReport.images.missing">, без файла: {{ rReport.images.missing }}</template>.
            </div>
            <div v-if="Object.keys(rReport.written).length" class="counts">
              <span v-for="(n, k) in rReport.written" :key="k" class="chip-count">{{ colLabel(String(k)) }}: <b>{{ fmt(n) }}</b></span>
            </div>
            <ul v-if="rReport.warnings.length" class="warn-list"><li v-for="(w, i) in rReport.warnings.slice(0, 50)" :key="i">{{ w }}</li></ul>
            <button v-if="rReport.ok && rReport.mode === 'replace'" class="btn btn-sm" type="button" @click="reload"><Icon name="refresh-cw" :size="14" /> Перезагрузить</button>
          </div>
        </div>
        <p v-if="rError" class="result err small"><Icon name="triangle-alert" :size="16" /> {{ rError }}</p>
      </section>

      <!-- ================= Kanka ================= -->
      <section class="card card-pad block">
        <h3 class="panel-title"><Icon name="file-up" /> Импорт из Kanka</h3>
        <p class="muted small">
          В Kanka: <i>Настройки кампании → Экспорт</i>, дождитесь письма и скачайте ZIP. Импорт добавляет в <b>текущий</b> мир все статьи
          (включая пользовательские модули), тексты с упоминаниями и картинками, посты, атрибуты, связи, теги, инвентарь, способности,
          календари с датами, хронологии, карты со слоями и метками, участников организаций и элементы квестов.
          Приватное в Kanka становится видимым только мастерам.
        </p>
        <label class="file-pick">
          <input type="file" accept=".zip,application/zip" :disabled="!!busy" @change="onKankaFile" />
        </label>
        <div class="stack-sm opts">
          <div class="small"><b>Видимость неприватных статей и постов:</b></div>
          <div class="row wrap gap">
            <label class="check small"><input v-model="kVisibility" type="radio" value="members" :disabled="!!busy" /> Участникам мира</label>
            <label class="check small"><input v-model="kVisibility" type="radio" value="public" :disabled="!!busy" /> Всем (публично, если мир открыт)</label>
          </div>
          <label class="check small"><input v-model="kMergeTags" type="checkbox" :disabled="!!busy" /> Объединять теги с существующими по названию</label>
          <label class="check small"><input v-model="kGallery" type="checkbox" :disabled="!!busy" /> Загрузить всю галерею Kanka, включая картинки, которые нигде не используются</label>
        </div>
        <p v-if="kInspecting" class="small muted"><Icon name="refresh-cw" :size="14" class="spin" /> Разбираю архив…</p>

        <div v-if="kInfo && !kReport" class="summary">
          <div><b>{{ kInfo.campaign || 'Кампания Kanka' }}</b> <span class="muted small">· {{ fmt(kInfo.totalEntities) }} {{ plural(kInfo.totalEntities, 'статья', 'статьи', 'статей') }} · {{ fmt(kInfo.images) }} изображений · ~{{ fmt(kInfo.estimatedWrites) }} записей</span></div>
          <div class="counts small">
            <span v-for="(n, k) in kInfo.byType" :key="k" class="chip-count">{{ customLabel(String(k), kInfo.customTypes) }}: <b>{{ n }}</b></span>
          </div>
          <div class="counts small">
            <template v-for="(n, k) in kInfo.rows" :key="k"><span v-if="n" class="chip-count">{{ colLabel(String(k)) }}: <b>{{ n }}</b></span></template>
          </div>
          <p v-if="kInfo.customTypes.length" class="small muted">Будут добавлены пользовательские типы: {{ kInfo.customTypes.map((c) => c.label).join(', ') }}.</p>
          <details v-if="kInfo.warnings.length || kInfo.skipped.length" class="small">
            <summary>Предупреждения ({{ kInfo.warnings.length + kInfo.skipped.length }})</summary>
            <ul class="warn-list"><li v-for="(w, i) in [...kInfo.warnings, ...kInfo.skipped]" :key="i">{{ w }}</li></ul>
          </details>
          <p v-if="kInfo.estimatedWrites > SAFE_DAILY_WRITES" class="result err small">
            <Icon name="triangle-alert" :size="16" />
            Импорт потребует ~{{ fmt(kInfo.estimatedWrites) }} записей — больше дневного лимита бесплатного тарифа. Он оборвётся на полпути,
            а повтор создаст дубликаты. Разделите кампанию в Kanka или перейдите на тариф Blaze на время импорта.
          </p>
          <p v-else-if="kInfo.estimatedWrites > 5000" class="small warn-text"><Icon name="triangle-alert" :size="14" /> Это заметная часть дневного лимита (20 000 записей): сегодня останется ~{{ fmt(20000 - kInfo.estimatedWrites) }}.</p>
          <label class="check small"><input v-model="kConfirmed" type="checkbox" :disabled="!!busy" /> Понимаю, что повторный импорт того же архива создаст дубликаты</label>
          <div>
            <button class="btn btn-primary" type="button" :disabled="!!busy || !kConfirmed" @click="doKanka">
              <Icon :name="busy === 'kanka' ? 'refresh-cw' : 'file-up'" :class="{ spin: busy === 'kanka' }" />
              {{ busy === 'kanka' ? 'Импорт…' : 'Импортировать в этот мир' }}
            </button>
          </div>
        </div>

        <div v-if="busy === 'kanka' && kProgress" class="progress">
          <div class="bar"><div class="fill" :style="{ width: pct(kProgress) + '%' }" /></div>
          <div class="small muted">{{ kProgress.phase }}<template v-if="kProgress.total"> — {{ kProgress.done }} / {{ kProgress.total }}</template></div>
        </div>
        <div v-if="kLog.length" ref="kLogEl" class="log">
          <div v-for="(l, i) in kLog" :key="i" :class="'log-' + l.level">{{ l.text }}</div>
        </div>

        <div v-if="kReport" class="result small" :class="kReport.ok ? 'ok' : 'err'">
          <Icon :name="kReport.ok ? 'circle-check' : 'triangle-alert'" :size="16" />
          <div class="grow">
            <template v-if="kReport.ok">Импорт «<b>{{ kReport.campaign || 'Kanka' }}</b>» завершён.</template>
            <template v-else>{{ kReport.error }}</template>
            <div class="muted">
              Записей Firestore: {{ fmt(kReport.writes) }} из ~{{ fmt(kReport.estimatedWrites) }}. Изображений: {{ kReport.images.uploaded }}<template v-if="kReport.images.failed">, не загружено: {{ kReport.images.failed }}</template>.
              Упоминаний: {{ kReport.mentions.converted }}<template v-if="kReport.mentions.unresolved">, не найдено: {{ kReport.mentions.unresolved }}</template>.
            </div>
            <div class="counts">
              <span v-for="(n, k) in kReport.byType" :key="k" class="chip-count">{{ customLabel(String(k), kInfo?.customTypes) }}: <b>{{ n }}</b></span>
              <template v-for="(n, k) in kReport.rows" :key="'r' + k"><span v-if="n" class="chip-count">{{ colLabel(String(k)) }}: <b>{{ n }}</b></span></template>
            </div>
            <details v-if="kReport.warnings.length || kReport.skipped.length">
              <summary>Предупреждения и пропущенное ({{ kReport.warnings.length + kReport.skipped.length }})</summary>
              <ul class="warn-list"><li v-for="(w, i) in [...kReport.warnings, ...kReport.skipped]" :key="i">{{ w }}</li></ul>
            </details>
          </div>
        </div>
        <p v-if="kError" class="result err small"><Icon name="triangle-alert" :size="16" /> {{ kError }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.backup-panel { display: flex; flex-direction: column; gap: 16px; max-width: 860px; }
.quota-note { display: flex; gap: 8px; align-items: flex-start; margin: 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
.quota-note .icon { margin-top: 2px; color: var(--info); }
.block { display: flex; flex-direction: column; gap: 10px; }
.block .panel-title { margin-bottom: 0; }
.block p { margin: 0; }
.inside { margin: 0; padding-left: 20px; color: var(--text-muted); display: flex; flex-direction: column; gap: 3px; }
.inside code, .block code { font-family: var(--font-mono); font-size: 12px; background: var(--surface-2); padding: 0 4px; border-radius: 4px; }
.opts { padding: 2px 0; }
.file-pick input { font-size: 13.5px; color: var(--text-muted); max-width: 100%; }
.progress { display: flex; flex-direction: column; gap: 4px; }
.bar { height: 8px; border-radius: 4px; background: var(--surface-3); overflow: hidden; }
.fill { height: 100%; background: var(--accent); transition: width .25s ease; }
.result { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface-2); }
.result > .icon { margin-top: 2px; flex-shrink: 0; }
.result.ok { border-color: color-mix(in srgb, var(--success) 45%, transparent); }
.result.ok > .icon { color: var(--success); }
.result.err { border-color: color-mix(in srgb, var(--danger) 45%, transparent); }
.result.err > .icon { color: var(--danger); }
.result .btn { margin-top: 8px; }
.warn-text { color: var(--warning); }
.warn-list { margin: 6px 0 0; padding-left: 18px; color: var(--text-muted); max-height: 220px; overflow-y: auto; }
.summary { display: flex; flex-direction: column; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
.counts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.chip-count { padding: 2px 8px; border-radius: 6px; background: var(--surface-3); color: var(--text-muted); }
.chip-count b { color: var(--text); font-weight: 600; }
.modes { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 8px; }
.mode { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; background: var(--surface); }
.mode:hover { border-color: var(--accent); }
.mode.on { border-color: var(--accent); background: var(--accent-soft); }
.mode input { margin-top: 3px; accent-color: var(--accent); }
.danger-field > span { color: var(--danger); }
.log { max-height: 220px; overflow-y: auto; font-family: var(--font-mono); font-size: 12px; line-height: 1.5; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text-muted); }
.log-warn { color: var(--warning); }
.log-error { color: var(--danger); }
details summary { cursor: pointer; color: var(--text-muted); }
</style>
