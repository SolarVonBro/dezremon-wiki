<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWorld } from '@/stores/world'
import { useGallery } from '@/stores/gallery'
import { BUILTIN_TYPES, allTypes, typeDef } from '@/model/entityTypes'
import { formatDate, randomId, relativeTime } from '@/data/util'
import { VISIBILITY_LABELS } from '@/data/access'
import { ICON_NAMES } from '@/components/common/icons'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import ImageDialog from '@/components/editor/ImageDialog.vue'
import { toast } from '@/components/common/toast'
import type { CustomType, Invite, Role, Visibility } from '@/model/types'

const BackupPanel = defineAsyncComponent(() => import('@/components/modules/BackupPanel.vue'))
const route = useRoute()
const router = useRouter()
const world = useWorld()
const gallery = useGallery()
const tab = computed(() => (route.params.tab as string) || 'general')
const TABS = [
  { k: 'general', label: 'Общие', icon: 'settings' }, { k: 'members', label: 'Участники', icon: 'users' }, { k: 'modules', label: 'Разделы', icon: 'layout-grid' },
  { k: 'backup', label: 'Бэкап и импорт', icon: 'archive' }, { k: 'trash', label: 'Корзина', icon: 'trash2' },
]

// general
const name = ref(world.world?.name ?? '')
const description = ref(world.world?.description ?? '')
watch(() => world.world, (w) => { if (w) { name.value = w.name; description.value = w.description } })
const imgDialog = ref<false | 'imageId' | 'headerImageId'>(false)
async function saveGeneral() { await world.updateWorld({ name: name.value.trim() || 'Мир', description: description.value.trim() }); toast.success('Сохранено') }
async function onFiles(files: File[]) {
  const field = imgDialog.value
  if (!field) return
  const [m] = await gallery.upload(files.slice(0, 1), { folder: 'Мир', visibility: 'public' })
  await world.updateWorld({ [field]: m.id })
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
  await navigator.clipboard?.writeText(inviteUrl(code)).catch(() => {})
  toast.success('Ссылка-приглашение создана и скопирована')
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
</script>

<template>
  <Teleport defer to="#crumbs"><span style="color: var(--text)">Настройки мира</span></Teleport>
  <div v-if="!world.isMaster" class="content empty">Настройки доступны только мастерам.</div>
  <div v-else class="content content-narrow">
    <div class="page-head"><Icon name="settings" :size="28" /><h1>Настройки мира</h1></div>
    <div class="tabs">
      <button v-for="t in TABS" :key="t.k" class="tab" :class="{ on: tab === t.k }" @click="router.replace({ name: 'settings', params: { wid: world.wid!, tab: t.k } })"><Icon :name="t.icon" :size="16" /> {{ t.label }}</button>
    </div>

    <div v-if="tab === 'general'" class="stack">
      <section class="card card-pad stack">
        <label class="field"><span>Название мира</span><input v-model="name" class="input" /></label>
        <label class="field"><span>Описание (на главной)</span><textarea v-model="description" class="input" rows="3" /></label>
        <div><button class="btn btn-primary" @click="saveGeneral">Сохранить</button></div>
      </section>
      <section class="card card-pad stack">
        <h3 class="panel-title"><Icon name="image" /> Оформление</h3>
        <div class="row gap wrap">
          <div class="stack-sm"><span class="field-label">Эмблема</span>
            <button class="avatar avatar-lg" style="border: 1px dashed var(--border-strong); cursor: pointer" @click="imgDialog = 'imageId'"><Thumb :id="world.world?.imageId"><Icon name="castle" /></Thumb></button>
          </div>
          <div class="stack-sm grow"><span class="field-label">Обложка главной</span>
            <button style="height: 90px; border-radius: 10px; overflow: hidden; border: 1px dashed var(--border-strong); background: var(--surface-2); cursor: pointer; padding: 0" @click="imgDialog = 'headerImageId'"><Thumb :id="world.world?.headerImageId" variant="full" style="width: 100%; height: 100%; object-fit: cover">Выбрать изображение</Thumb></button>
          </div>
        </div>
      </section>
      <section class="card card-pad stack">
        <h3 class="panel-title"><Icon name="globe" /> Доступ</h3>
        <label class="check"><input type="checkbox" :checked="world.world?.isPublic" @change="togglePublic" /> Открытый мир: статьи с видимостью «всем» читаются без входа</label>
        <p v-if="world.world?.isPublic" class="small muted" style="margin: 0">Ссылка для гостей: <code>{{ guestUrl }}</code></p>
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
      <ImageDialog v-if="imgDialog" :multiple="false" @close="imgDialog = false" @files="onFiles" @pick="(id) => world.updateWorld({ [imgDialog as string]: id })" />
    </div>

    <div v-else-if="tab === 'members'" class="stack">
      <section class="card card-pad">
        <h3 class="panel-title"><Icon name="users" /> Участники ({{ world.members.length }})</h3>
        <table class="table">
          <tbody>
            <tr v-for="m in world.members" :key="m.uid">
              <td><span class="row gap-sm"><span class="avatar round" style="width: 30px; height: 30px"><img v-if="m.photoURL" :src="m.photoURL" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="15" /></span> {{ m.displayName }}</span></td>
              <td class="muted small">{{ m.email }}</td>
              <td>
                <select v-if="world.isOwner && m.role !== 'owner'" class="input input-sm" :value="m.role" @change="changeRole(m.uid, ($event.target as HTMLSelectElement).value as Role)">
                  <option value="master">Мастер</option><option value="player">Игрок</option>
                </select>
                <span v-else class="badge">{{ ROLE[m.role] }}</span>
              </td>
              <td class="faint small">{{ relativeTime(m.joinedAt) }}</td>
              <td><button v-if="world.isOwner && m.role !== 'owner'" class="icon-btn danger" title="Исключить" @click="kick(m.uid, m.displayName)"><Icon name="x" :size="15" /></button></td>
            </tr>
          </tbody>
        </table>
      </section>
      <section class="card card-pad stack">
        <h3 class="panel-title"><Icon name="user-plus" /> Пригласить</h3>
        <div class="row gap wrap">
          <select v-model="invRole" class="input" style="width: auto"><option value="player">Игроком</option><option value="master">Мастером</option></select>
          <select v-model="invDays" class="input" style="width: auto"><option :value="1">на 1 день</option><option :value="7">на неделю</option><option :value="14">на 2 недели</option><option :value="30">на месяц</option><option :value="null">бессрочно</option></select>
          <input v-model="invNote" class="input grow" placeholder="Для кого (заметка)" />
          <button class="btn btn-primary" @click="createInvite"><Icon name="link" :size="15" /> Создать ссылку</button>
        </div>
        <div v-for="i in invites" :key="i.code" class="rel-row">
          <Icon name="mail" :size="15" />
          <span class="grow ellipsis"><b>{{ i.role === 'master' ? 'Мастер' : 'Игрок' }}</b> {{ i.note }} <span class="faint small">· {{ i.expiresAt ? (i.expiresAt < Date.now() ? 'истекло' : 'до ' + formatDate(i.expiresAt)) : 'бессрочно' }}</span></span>
          <button class="btn btn-sm" @click="copyInvite(i.code)"><Icon name="copy" :size="13" /> Ссылка</button>
          <button class="icon-btn danger" title="Отозвать" @click="world.deleteInvite(i.code)"><Icon name="trash2" :size="15" /></button>
        </div>
        <p class="faint small" style="margin: 0">Человек открывает ссылку, входит через Google или почту и становится участником. Отзовите ссылку, когда все присоединились.</p>
      </section>
    </div>

    <div v-else-if="tab === 'modules'" class="stack">
      <section class="card card-pad">
        <h3 class="panel-title"><Icon name="layout-grid" /> Разделы мира</h3>
        <table class="table">
          <thead><tr><th>Раздел</th><th>Включён</th><th>Игроки могут создавать</th><th>Статей</th></tr></thead>
          <tbody>
            <tr v-for="t in allTypes()" :key="t.key">
              <td><Icon :name="t.icon" :size="16" :style="{ color: t.color }" /> {{ t.plural }}</td>
              <td><input type="checkbox" :checked="world.enabledTypes(t.key)" @change="toggleType(t.key)" /></td>
              <td><input type="checkbox" :checked="world.settings.playerCreateTypes.includes(t.key)" @change="togglePlayerType(t.key)" /></td>
              <td class="muted">{{ world.byType.get(t.key)?.length ?? 0 }}<button v-if="t.custom" class="icon-btn danger" title="Удалить тип" @click="removeCustomType(t.key)"><Icon name="trash2" :size="14" /></button></td>
            </tr>
          </tbody>
        </table>
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
