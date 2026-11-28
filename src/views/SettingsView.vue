<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import { useGallery } from '@/stores/gallery'
import { BUILTIN_TYPES, allTypes, typeDef } from '@/model/entityTypes'
import { formatDate, randomId, relativeTime } from '@/data/util'
import { VISIBILITY_LABELS } from '@/data/access'
import { ICON_NAMES } from '@/components/common/icons'
import { imageUrl } from '@/data/images'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import ImageModal, { type ImageSavePayload } from '@/components/common/ImageModal.vue'
import Modal from '@/components/common/Modal.vue'
import { openLightbox } from '@/components/viewer/lightbox'
import { toast } from '@/components/common/toast'
import type { CustomType, Invite, Role, Visibility } from '@/model/types'

const BackupPanel = defineAsyncComponent(() => import('@/components/modules/BackupPanel.vue'))
const MembersAdmin = defineAsyncComponent(() => import('@/components/admin/MembersAdmin.vue'))
const WorldThemePicker = defineAsyncComponent(() => import('@/components/admin/WorldThemePicker.vue'))
const route = useRoute()
const router = useRouter()
const world = useWorld()
const gallery = useGallery()
const tab = computed(() => (route.params.tab as string) || 'general')
const TABS = [
  { k: 'general', label: 'Общие', icon: 'settings' }, { k: 'members', label: 'Участники и права', icon: 'users' }, { k: 'modules', label: 'Разделы', icon: 'layout-grid' },
  { k: 'backup', label: 'Бэкап и импорт', icon: 'archive' }, { k: 'trash', label: 'Корзина', icon: 'trash2' },
]

// general
const name = ref(world.world?.name ?? '')
const description = ref(world.world?.description ?? '')
watch(() => world.world, (w) => { if (w) { name.value = w.name; description.value = w.description } })
const imgDialog = ref<false | 'imageId' | 'headerImageId'>(false)
const imgBusy = ref(false)
async function saveGeneral() { await world.updateWorld({ name: name.value.trim() || 'Мир', description: description.value.trim() }); toast.success('Сохранено') }
async function saveWorldImage(payload: ImageSavePayload) {
  const field = imgDialog.value
  if (!field || !world.world) return
  const cropField = field === 'imageId' ? 'imageCrop' : 'headerCrop'
  imgBusy.value = true
  try {
    let nextId = world.world[field] ?? null
    if (payload.file) {
      const [m] = await gallery.upload([payload.file], { folder: 'Мир', visibility: 'public' })
      nextId = m.id
    } else if (payload.changed) {
      nextId = payload.imageId
    }
    await world.updateWorld({ [field]: nextId, [cropField]: payload.crop })
    imgDialog.value = false
  } catch (e: any) { toast.error('Не удалось сохранить изображение: ' + (e?.message ?? e)) } finally { imgBusy.value = false }
}
async function removeWorldImage() {
  const field = imgDialog.value
  if (!field) return
  const cropField = field === 'imageId' ? 'imageCrop' : 'headerCrop'
  imgBusy.value = true
  try {
    await world.updateWorld({ [field]: null, [cropField]: null })
    imgDialog.value = false
  } finally { imgBusy.value = false }
}
async function viewWorldImage(field: 'imageId' | 'headerImageId') {
  const id = world.world?.[field]
  if (!id) { imgDialog.value = field; return }
  const src = await imageUrl(world.access, id, 'full').catch(() => null)
  if (src) openLightbox([{ src, caption: field === 'imageId' ? (world.world?.name ?? 'Эмблема') : `${world.world?.name ?? 'Мир'} — обложка` }])
}
async function togglePublic() {
  const next = !world.world?.isPublic
  if (next && !confirm('Открыть мир для гостей? Все статьи с видимостью «всем» станут доступны любому по ссылке без входа.')) return
  await world.updateWorld({ isPublic: next })
  if (!next) await world.bumpAcl()
}
const calendars = computed(() => world.byType.get('calendar') ?? [])

// members & invites
const invites = ref<Invite[]>([])
let stopInv: (() => void) | null = null
watch(tab, (t) => { if (t === 'members' && !stopInv && world.isMaster) stopInv = world.watchInvites((r) => (invites.value = r)) }, { immediate: true })
onBeforeUnmount(() => stopInv?.())
const invRole = ref<'player' | 'master'>('player')
const invDays = ref<number | null>(14)
const invNote = ref('')
function inviteUrl(code: string) { return `${location.origin}${location.pathname}#/join/${world.wid}/${code}` }
const guestUrl = computed(() => `${location.origin}${location.pathname}#/w/${world.wid}`)
function copyInvite(code: string) { void navigator.clipboard?.writeText(inviteUrl(code)).then(() => toast.success('Скопировано')) }
async function createInvite() {
  const code = await world.createInvite(invRole.value, invDays.value, invNote.value.trim())
  const copied = await navigator.clipboard?.writeText(inviteUrl(code)).then(() => true).catch(() => false)
  toast.success(copied ? 'Ссылка-приглашение создана и скопирована' : 'Ссылка-приглашение создана — скопируйте её из списка ниже')
  invNote.value = ''
}
const ROLE: Record<Role, string> = { owner: 'Владелец', master: 'Мастер', player: 'Игрок' }
async function changeRole(uid: string, r: Role) { await world.setMemberRole(uid, r); toast.success('Роль изменена') }
async function kick(uid: string, n: string) { if (confirm(`Исключить ${n} из мира?`)) await world.removeMember(uid) }

// modules
function toggleType(key: string) {
  const s = new Set(world.settings.disabledTypes)
  if (s.has(key)) s.delete(key); else s.add(key)
  void world.updateSettings({ disabledTypes: [...s] })
}
function togglePlayerType(key: string) {
  const s = new Set(world.settings.playerCreateTypes)
  if (s.has(key)) s.delete(key); else s.add(key)
  void world.updateSettings({ playerCreateTypes: [...s] })
}
const newType = ref<CustomType>({ key: '', label: '', plural: '', icon: 'file-text' })
async function addCustomType() {
  const t = newType.value
  if (!t.label.trim()) return
  await world.updateSettings({ customTypes: [...world.settings.customTypes, { key: 'c_' + randomId(6), label: t.label.trim(), plural: t.plural.trim() || t.label.trim(), icon: t.icon }] })
  newType.value = { key: '', label: '', plural: '', icon: 'file-text' }
}
async function removeCustomType(key: string) {
  if ((world.byType.get(key)?.length ?? 0) > 0) { toast.error('Сначала удалите или перенесите статьи этого типа'); return }
  await world.updateSettings({ customTypes: world.settings.customTypes.filter((c) => c.key !== key) })
}

// trash
async function purge(id: string, n: string) { if (confirm(`Удалить «${n}» навсегда? Это нельзя отменить.`)) { await world.purgeEntity(id); toast.success('Удалено навсегда') } }
async function purgeOld() {
  const old = world.trash.filter((e) => (e.deletedAt ?? 0) < Date.now() - 30 * 86400000)
  if (!old.length) { toast.info('Нет статей старше 30 дней'); return }
  if (!confirm(`Удалить навсегда ${old.length} статей старше 30 дней?`)) return
  for (const e of old) await world.purgeEntity(e.id)
}
const visOptions: Visibility[] = ['public', 'members', 'master']

// danger zone
const deleting = ref(false)
const deleteName = ref('')
const deleteProgress = ref<string | null>(null)
async function deleteWorld() {
  deleteProgress.value = 'начинаю…'
  try {
    await world.deleteWorld((done, what) => { deleteProgress.value = `${what}: удалено ${done}` })
    toast.success('Мир удалён')
    // leave the world's pages first, then drop its state (links would render without a world id otherwise)
    await router.replace({ name: 'worlds' })
    world.close()
  } catch (e: any) { toast.error('Ошибка удаления: ' + (e?.message ?? e)); deleteProgress.value = null }
}
async function leave() {
  if (!confirm(`Выйти из мира «${world.world?.name}»? Вернуться можно будет только по новому приглашению.`)) return
  await world.leaveWorld()
  await router.replace({ name: 'worlds' })
  world.close()
}

// Publish everything players can see to guests, or hide it again (all collections at once).
const publishBusy = ref<string | null>(null)
async function publishAll(to: 'public' | 'members') {
  const msg = to === 'public'
    ? 'Сделать видимым ГОСТЯМ всё, что сейчас видят участники мира: статьи, разделы, связи, метки, хронологии, картинки? Мастерские и выборочные материалы останутся скрытыми.'
    : 'Скрыть от гостей всё публичное (видимость «всем» → «участникам»)?'
  if (!confirm(msg)) return
  publishBusy.value = 'начинаю…'
  try {
    const n = await world.setWorldVisibility(to === 'public' ? 'members' : 'public', to, (done, name) => { publishBusy.value = `${name}: ${done}` })
    toast.success(`Готово, обновлено записей: ${n}`)
  } catch (e: any) { toast.error('Ошибка: ' + (e?.message ?? e)) } finally { publishBusy.value = null }
}
</script>

<template>
  <Teleport defer to="#crumbs"><span style="color: var(--text)">Настройки мира</span></Teleport>
  <div v-if="!world.isMaster" class="content empty">
    <template v-if="world.adminReadOnly">Настройки доступны в режиме редактирования администратора.</template>
    <template v-else>Настройки доступны только мастерам.</template>
  </div>
  <div v-else class="content content-narrow">
    <div class="page-head"><Icon name="settings" :size="28" /><h1>Настройки мира</h1></div>
    <div class="tabs">
      <button v-for="t in TABS" :key="t.k" class="tab" :class="{ on: tab === t.k }" @click="router.replace({ name: 'settings', params: { wid: world.wid!, tab: t.k } })">
        <Icon :name="t.icon" :size="16" /> {{ t.label }}<span v-if="t.k === 'members' && world.pendingRequestCount" class="count" style="background: var(--danger); color: #fff">{{ world.pendingRequestCount }}</span>
      </button>
    </div>

    <div v-if="tab === 'general'" class="stack">
      <section class="card card-pad stack">
        <label class="field"><span>Название мира</span><input v-model="name" class="input" /></label>
        <label class="field"><span>Описание (на главной)</span><textarea v-model="description" class="input" rows="3" /></label>
        <div><button class="btn btn-primary" @click="saveGeneral">Сохранить</button></div>
      </section>
      <section class="card card-pad stack">
        <h3 class="panel-title"><Icon name="image" /> Оформление</h3>
        <div class="row gap wrap" style="align-items: flex-start">
          <div class="stack-sm">
            <span class="field-label">Эмблема</span>
            <div class="set-img-wrap">
              <button type="button" class="avatar avatar-lg set-img-box" :class="{ zoomable: !!world.world?.imageId }" :title="world.world?.imageId ? 'Открыть крупно' : 'Выбрать эмблему'" @click="viewWorldImage('imageId')">
                <Thumb :id="world.world?.imageId" variant="full" :crop="world.world?.imageCrop ?? null"><Icon name="castle" /></Thumb>
              </button>
              <button type="button" class="set-img-edit" :title="world.world?.imageId ? 'Изменить эмблему и фокус' : 'Выбрать эмблему'" @click="imgDialog = 'imageId'"><Icon name="pencil" :size="13" /></button>
            </div>
          </div>
          <div class="stack-sm grow">
            <span class="field-label">Обложка главной</span>
            <div class="set-img-wrap set-cover-wrap">
              <button type="button" class="set-cover-box" :class="{ zoomable: !!world.world?.headerImageId }" :title="world.world?.headerImageId ? 'Открыть крупно' : 'Выбрать обложку'" @click="viewWorldImage('headerImageId')">
                <Thumb :id="world.world?.headerImageId" variant="full" :crop="world.world?.headerCrop ?? null">Выбрать изображение</Thumb>
              </button>
              <button type="button" class="set-img-edit" :title="world.world?.headerImageId ? 'Изменить обложку и фокус' : 'Выбрать обложку'" @click="imgDialog = 'headerImageId'"><Icon name="pencil" :size="13" /></button>
            </div>
          </div>
        </div>
      </section>
      <WorldThemePicker />
      <section class="card card-pad stack">
        <h3 class="panel-title"><Icon name="globe" /> Доступ</h3>
        <label class="check"><input type="checkbox" :checked="world.world?.isPublic" @change="togglePublic" /> Открытый мир: статьи с видимостью «всем» читаются без входа</label>
        <p v-if="world.world?.isPublic" class="small muted" style="margin: 0">Ссылка для гостей: <code>{{ guestUrl }}</code></p>
        <div class="row gap wrap">
          <button v-if="world.world?.isPublic" class="btn btn-sm" :disabled="!!publishBusy" @click="publishAll('public')"><Icon name="globe" :size="14" /> Открыть гостям всё, что видят участники</button>
          <button class="btn btn-sm btn-ghost" :disabled="!!publishBusy" @click="publishAll('members')"><Icon name="eye-off" :size="14" /> Скрыть от гостей всё публичное</button>
          <span v-if="publishBusy" class="muted small"><Icon name="refresh-cw" class="spin" :size="13" /> {{ publishBusy }}</span>
        </div>
        <label class="field"><span>Видимость новых статей по умолчанию</span>
          <select class="input" :value="world.settings.defaultVisibility" @change="world.updateSettings({ defaultVisibility: ($event.target as HTMLSelectElement).value as Visibility })">
            <option v-for="v in visOptions" :key="v" :value="v">{{ VISIBILITY_LABELS[v] }}</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" :checked="world.settings.playersCanPost" @change="world.updateSettings({ playersCanPost: ($event.target as HTMLInputElement).checked })" /> Игроки могут добавлять свои заметки к статьям</label>
        <label class="field"><span>Основной календарь (для дат и виджета)</span>
          <select class="input" :value="world.settings.mainCalendarId ?? ''" @change="world.updateSettings({ mainCalendarId: ($event.target as HTMLSelectElement).value || null })">
            <option value="">—</option><option v-for="c in calendars" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
      </section>
      <section v-if="world.isOwner || world.member" class="card card-pad stack danger-zone">
        <h3 class="panel-title" style="margin: 0"><Icon name="triangle-alert" /> Опасная зона</h3>
        <template v-if="world.isOwner">
          <p class="muted small" style="margin: 0">Передать мир другому участнику можно в «Участники и права» → карточка участника → «Передать владение».</p>
          <div class="row gap wrap">
            <span class="grow small">Удалить мир со всеми статьями, картинками и участниками. <b>Это нельзя отменить</b> — сначала скачайте бэкап.</span>
            <RouterLink class="btn btn-sm" :to="{ name: 'settings', params: { wid: world.wid!, tab: 'backup' } }"><Icon name="download" :size="14" /> Бэкап</RouterLink>
            <button class="btn btn-sm btn-danger" @click="deleting = true">Удалить мир…</button>
          </div>
        </template>

        <div v-else class="row gap wrap">
          <span class="grow small">Выйти из мира. Вернуться можно будет только по новому приглашению.</span>
          <button class="btn btn-sm btn-danger" @click="leave">Выйти из мира</button>
        </div>
      </section>
      <Modal v-if="deleting" title="Удалить мир" width="500px" :closable="!deleteProgress" @close="deleting = false">
        <div class="stack">
          <p style="margin: 0">Будут удалены все статьи, тексты, картинки, карты, календари, участники и приглашения мира <b>«{{ world.world?.name }}»</b>. Восстановить можно только из бэкапа.</p>
          <label class="field"><span>Введите название мира для подтверждения</span><input v-model="deleteName" class="input" :placeholder="world.world?.name" :disabled="!!deleteProgress" /></label>
          <p v-if="deleteProgress" class="muted small" style="margin: 0"><Icon name="refresh-cw" class="spin" :size="13" /> {{ deleteProgress }}</p>
        </div>
        <template #footer>
          <button class="btn" :disabled="!!deleteProgress" @click="deleting = false">Отмена</button>
          <button class="btn btn-danger" :disabled="deleteName.trim() !== world.world?.name || !!deleteProgress" @click="deleteWorld">Удалить навсегда</button>
        </template>
      </Modal>
      <ImageModal
        v-if="imgDialog"
        :title="imgDialog === 'imageId' ? 'Эмблема мира' : 'Обложка главной'"
        :image-id="world.world?.[imgDialog] ?? null"
        :initial-crop="imgDialog === 'imageId' ? (world.world?.imageCrop ?? null) : (world.world?.headerCrop ?? null)"
        :kind="imgDialog === 'imageId' ? 'emblem' : 'header'"
        :remove-label="imgDialog === 'imageId' ? 'Убрать эмблему' : 'Убрать обложку'"
        :busy="imgBusy"
        @save="saveWorldImage"
        @remove="removeWorldImage"
        @close="imgDialog = false"
      />
    </div>

    <MembersAdmin v-else-if="tab === 'members'" />

    <div v-else-if="tab === 'modules'" class="stack">
      <section class="card card-pad">
        <h3 class="panel-title"><Icon name="layout-grid" /> Разделы мира</h3>
        <div class="table-scroll"><table class="table">
          <thead><tr><th>Раздел</th><th>Включён</th><th>Игроки могут создавать</th><th>Статей</th></tr></thead>
          <tbody>
            <tr v-for="t in allTypes()" :key="t.key">
              <td><Icon :name="t.icon" :size="16" :style="{ color: t.color }" /> {{ t.plural }}</td>
              <td><input type="checkbox" :checked="world.enabledTypes(t.key)" @change="toggleType(t.key)" /></td>
              <td><input type="checkbox" :checked="world.settings.playerCreateTypes.includes(t.key)" @change="togglePlayerType(t.key)" /></td>
              <td class="muted">{{ world.byType.get(t.key)?.length ?? 0 }}<button v-if="t.custom" class="icon-btn danger" title="Удалить тип" @click="removeCustomType(t.key)"><Icon name="trash2" :size="14" /></button></td>
            </tr>
          </tbody>
        </table></div>
      </section>
      <section class="card card-pad stack">
        <h3 class="panel-title"><Icon name="plus" /> Свой тип статей</h3>
        <p class="muted small" style="margin: 0">Например: «Божество», «Заклинание», «Корабль». У своих типов есть текст, атрибуты, связи, иерархия и всё остальное.</p>
        <div class="row gap wrap">
          <input v-model="newType.label" class="input" style="width: 200px" placeholder="Название (ед. ч.)" />
          <input v-model="newType.plural" class="input" style="width: 200px" placeholder="Мн. число" />
          <select v-model="newType.icon" class="input" style="width: 170px"><option v-for="n in ICON_NAMES" :key="n" :value="n">{{ n }}</option></select>
          <Icon :name="newType.icon" :size="22" />
          <button class="btn btn-primary" :disabled="!newType.label.trim()" @click="addCustomType">Добавить</button>
        </div>
      </section>
    </div>

    <BackupPanel v-else-if="tab === 'backup'" />

    <div v-else-if="tab === 'trash'" class="card card-pad">
      <div class="row gap" style="margin-bottom: 10px">
        <h3 class="panel-title grow" style="margin: 0"><Icon name="trash2" /> Корзина ({{ world.trash.length }})</h3>
        <button v-if="world.trash.length" class="btn btn-sm btn-danger" @click="purgeOld">Очистить старше 30 дней</button>
      </div>
      <div v-if="!world.trash.length" class="empty">Корзина пуста.</div>
      <div v-for="e in world.trash" :key="e.id" class="rel-row">
        <Icon :name="typeDef(e.type).icon" :size="15" :style="{ color: typeDef(e.type).color }" />
        <span class="grow">{{ e.name }} <span class="faint small">· {{ typeDef(e.type).label }} · удалено {{ relativeTime(e.deletedAt ?? e.updatedAt) }}</span></span>
        <button class="btn btn-sm" @click="world.restoreEntity(e.id)"><Icon name="rotate-ccw" :size="13" /> Восстановить</button>
        <button class="icon-btn danger" title="Удалить навсегда" @click="purge(e.id, e.name)"><Icon name="x" :size="15" /></button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.danger-zone { border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
.set-img-wrap { position: relative; display: inline-flex; }
.set-cover-wrap { display: flex; width: 100%; }
.set-img-box { border: 1px dashed var(--border-strong); cursor: pointer; }
.set-cover-box { width: 100%; height: 90px; border-radius: 10px; overflow: hidden; border: 1px dashed var(--border-strong); background: var(--surface-2); cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center; color: var(--text-faint); }
.set-cover-box :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.set-img-box.zoomable, .set-cover-box.zoomable { cursor: zoom-in; border-style: solid; border-color: var(--border); }
.set-img-edit { position: absolute; right: -6px; bottom: -6px; width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--surface); background: var(--accent); color: var(--accent-fg); display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; box-shadow: var(--shadow); }
.set-img-edit:hover { background: var(--accent-2); }
</style>
