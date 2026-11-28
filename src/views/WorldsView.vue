<script setup lang="ts">
// «Миры» — the first section of the service (next to campaigns and music rooms): worlds the user runs or plays in,
// and join requests (incoming to the user's worlds and the user's own).
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getCountFromServer, getDoc } from 'firebase/firestore'
import { useSession } from '@/stores/session'
import { createWorld, myWorlds, leaveWorldById, type MyWorld } from '@/stores/world'
import { characterIdsOf, coll, docRef } from '@/data/access'
import { cancelJoinRequest, myJoinRequests, pendingRequests } from '@/data/joinRequests'
import JoinRequestRow from '@/components/admin/JoinRequestRow.vue'
import { formatDate, relativeTime, plural } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import Modal from '@/components/common/Modal.vue'
import WorldImage from '@/components/common/WorldImage.vue'
import { toast } from '@/components/common/toast'
import type { JoinRequest, Role } from '@/model/types'

const session = useSession()
const route = useRoute()
const router = useRouter()
type Tab = 'worlds' | 'requests'
const tab = computed<Tab>(() => (route.query.tab === 'requests' ? 'requests' : 'worlds'))
function setTab(t: Tab) { void router.replace({ query: { tab: t === 'worlds' ? undefined : t } }) }

watch(() => [session.ready, session.user], () => {
  if (session.ready && !session.user) void router.replace({ name: 'login', query: { next: route.fullPath } })
}, { immediate: true })

// ---------- worlds ----------
const worlds = ref<MyWorld[]>([])
const loading = ref(true)
const memberCounts = ref<Record<string, number>>({})
async function loadWorlds() {
  if (!session.user) return
  loading.value = true
  try {
    worlds.value = await myWorlds(session.user.uid)
    for (const w of worlds.value) {
      void getCountFromServer(coll(w.id, 'members')).then((s) => { memberCounts.value = { ...memberCounts.value, [w.id]: s.data().count } }).catch(() => {})
    }
    void loadRequests()
  } catch (e: any) { toast.error('Не удалось загрузить миры: ' + (e?.message ?? e)) } finally { loading.value = false }
}

// ---------- join requests: incoming (worlds I run) and my own ----------
const incoming = ref<Array<{ wid: string; name: string; canMaster: boolean; rows: JoinRequest[] }>>([])
const mine = ref<Array<JoinRequest & { wid: string }>>([])
const reqLoading = ref(false)
async function loadRequests() {
  if (!session.user) return
  reqLoading.value = true
  try {
    const run = worlds.value.filter((w) => w.role === 'owner' || w.role === 'master')
    const res = await Promise.all(run.map((w) => pendingRequests(w.id).then((rows) => ({ wid: w.id, name: w.name, canMaster: w.role === 'owner', rows })).catch(() => ({ wid: w.id, name: w.name, canMaster: false, rows: [] as JoinRequest[] }))))
    incoming.value = res.filter((g) => g.rows.length)
    mine.value = await myJoinRequests(session.user.uid).catch(() => [])
  } finally { reqLoading.value = false }
}
const incomingCount = computed(() => incoming.value.reduce((n, g) => n + g.rows.length, 0))
const requestsOf = (wid: string) => incoming.value.find((g) => g.wid === wid)?.rows.length ?? 0
function requestUrl(r: JoinRequest & { wid: string }) { return `#${r.fromPath && r.fromPath !== '/' ? r.fromPath : `/w/${r.wid}`}` }
async function withdraw(r: JoinRequest & { wid: string }) {
  await cancelJoinRequest(r.wid, r.uid)
  toast.success(r.status === 'rejected' ? 'Заявка удалена' : 'Заявка отменена')
  mine.value = mine.value.filter((x) => x.wid !== r.wid)
}
watch(() => session.user?.uid, (u) => { if (u) void loadWorlds() }, { immediate: true })
const owned = computed(() => worlds.value.filter((w) => w.role === 'owner'))
const joined = computed(() => worlds.value.filter((w) => w.role !== 'owner'))
const ROLE: Record<Role, string> = { owner: 'Владелец', master: 'Мастер', player: 'Игрок' }

const creating = ref(false)
const newWorld = ref({ name: '', description: '', isPublic: false })
const createBusy = ref(false)
async function create() {
  if (!session.user || !newWorld.value.name.trim()) return
  createBusy.value = true
  try {
    const id = await createWorld(session.me!, newWorld.value.name.trim(), newWorld.value.description.trim(), newWorld.value.isPublic)
    void router.push({ name: 'dashboard', params: { wid: id } })
  } catch (e: any) { toast.error('Не удалось создать мир: ' + (e?.message ?? e)) } finally { createBusy.value = false }
}
async function leave(w: MyWorld) {
  if (!confirm(`Выйти из мира «${w.name}»? Вернуться можно будет только по новому приглашению.`)) return
  await leaveWorldById(w.id, session.user!.uid)
  toast.success('Вы вышли из мира')
  await loadWorlds()
}

// «Мои персонажи» on a world card: the names load when the list is opened (the world itself is not loaded here)
const charNames = ref<Record<string, string | null>>({})
async function loadCharNames(wid: string, ids: string[]) {
  for (const id of ids) {
    const k = `${wid}/${id}`
    if (k in charNames.value) continue
    charNames.value = { ...charNames.value, [k]: '' }
    const d = await getDoc(docRef(wid, 'entities', id)).catch(() => null)
    const e = d?.exists() ? d.data() : null
    charNames.value = { ...charNames.value, [k]: e && !e.deleted ? String(e.name ?? '') : null }
  }
}
</script>

<template>
  <div class="page">
    <div v-if="!session.ready" class="empty"><Icon name="refresh-cw" class="spin" :size="24" /></div>
    <div v-else-if="session.user">
      <div class="row gap wrap" style="margin-bottom: 14px">
        <h1 class="grow" style="margin: 0">Миры</h1>
        <button class="btn btn-primary" @click="creating = true"><Icon name="plus" :size="16" /> Новый мир</button>
      </div>
      <p class="muted" style="margin: 0 0 18px; max-width: 760px">Мир — это сеттинг: статьи о персонажах, местах и событиях, карты, календари и хронологии. Игры мира ведутся в его разделе «Игры».</p>

      <div class="tabs">
        <button class="tab" :class="{ on: tab === 'worlds' }" @click="setTab('worlds')"><Icon name="globe" :size="16" /> Миры <span class="count">{{ worlds.length }}</span></button>
        <button class="tab" :class="{ on: tab === 'requests' }" @click="setTab('requests')"><Icon name="mail" :size="16" /> Заявки
          <span v-if="incomingCount" class="count" style="background: var(--danger); color: #fff">{{ incomingCount }}</span>
          <span v-else-if="mine.length" class="count">{{ mine.length }}</span>
        </button>
      </div>

      <!-- ============ worlds ============ -->
      <template v-if="tab === 'worlds'">
        <div v-if="loading" class="empty"><Icon name="refresh-cw" class="spin" :size="24" /></div>
        <template v-else>
          <h2 style="margin: 0 0 10px">Мои миры</h2>
          <div class="world-grid">
            <article v-for="w in owned" :key="w.id" class="wcard">
              <RouterLink class="wcard-img" :to="{ name: 'dashboard', params: { wid: w.id } }">
                <WorldImage :wid="w.id" :image-id="w.headerImageId || w.imageId" :crop="w.headerImageId ? (w.headerCrop ?? null) : (w.imageCrop ?? null)" :uid="session.user.uid" :role="w.role"><Icon name="castle" :size="40" /></WorldImage>
              </RouterLink>
              <div class="wcard-body">
                <RouterLink class="wcard-name" :to="{ name: 'dashboard', params: { wid: w.id } }">{{ w.name }}</RouterLink>
                <p v-if="w.description" class="wcard-desc">{{ w.description }}</p>
                <div class="wcard-meta">
                  <span class="badge badge-public">{{ ROLE[w.role] }}</span>
                  <span class="badge">{{ w.isPublic ? 'открытый' : 'закрытый' }}</span>
                  <span v-if="memberCounts[w.id]" class="faint small"><Icon name="users" :size="12" /> {{ memberCounts[w.id] }}</span>
                  <span class="faint small">· {{ relativeTime(w.membership.lastSeenAt ?? w.updatedAt) }}</span>
                  <button v-if="requestsOf(w.id)" class="badge req-badge" @click="setTab('requests')"><Icon name="mail" :size="11" /> {{ requestsOf(w.id) }} {{ plural(requestsOf(w.id), 'заявка', 'заявки', 'заявок') }}</button>
                </div>
              </div>
              <div class="wcard-actions">
                <RouterLink class="btn btn-sm" :to="{ name: 'dashboard', params: { wid: w.id } }">Открыть</RouterLink>
                <RouterLink class="btn btn-sm btn-ghost" :to="{ name: 'settings', params: { wid: w.id, tab: 'members' } }"><Icon name="settings" :size="14" /> Управление</RouterLink>
              </div>
            </article>
            <button v-if="!owned.length" class="wcard wcard-new" @click="creating = true"><Icon name="plus" :size="30" /><span>Создать первый мир</span></button>
          </div>

          <h2 style="margin: 26px 0 10px">Миры, где я участвую</h2>
          <div v-if="!joined.length" class="card empty">Пока нет. Мастер может прислать вам ссылку-приглашение — откройте её, и мир появится здесь. Или откройте ссылку на открытый мир и нажмите «Попросить доступ».</div>
          <div class="world-grid">
            <article v-for="w in joined" :key="w.id" class="wcard">
              <RouterLink class="wcard-img" :to="{ name: 'dashboard', params: { wid: w.id } }">
                <WorldImage :wid="w.id" :image-id="w.headerImageId || w.imageId" :crop="w.headerImageId ? (w.headerCrop ?? null) : (w.imageCrop ?? null)" :uid="session.user.uid" :role="w.role"><Icon name="castle" :size="40" /></WorldImage>
              </RouterLink>
              <div class="wcard-body">
                <RouterLink class="wcard-name" :to="{ name: 'dashboard', params: { wid: w.id } }">{{ w.name }}</RouterLink>
                <p v-if="w.description" class="wcard-desc">{{ w.description }}</p>
                <div class="wcard-meta">
                  <span class="badge" :class="{ 'badge-secret': w.role === 'master' }">{{ ROLE[w.role] }}</span>
                  <span v-if="memberCounts[w.id]" class="faint small"><Icon name="users" :size="12" /> {{ memberCounts[w.id] }}</span>
                  <span class="faint small">· с {{ formatDate(w.membership.joinedAt).split(',')[0] }}</span>
                </div>
              </div>
              <div class="wcard-actions">
                <RouterLink class="btn btn-sm" :to="{ name: 'dashboard', params: { wid: w.id } }">Открыть</RouterLink>
                <RouterLink v-if="characterIdsOf(w.membership).length === 1" class="btn btn-sm btn-ghost" :to="{ name: 'entity', params: { wid: w.id, eid: characterIdsOf(w.membership)[0] } }"><Icon name="user" :size="14" /> Мой персонаж</RouterLink>
                <Dropdown v-else-if="characterIdsOf(w.membership).length > 1" placement="bottom-start">
                  <template #trigger><button class="btn btn-sm btn-ghost" @click="loadCharNames(w.id, characterIdsOf(w.membership))"><Icon name="user" :size="14" /> Мои персонажи · {{ characterIdsOf(w.membership).length }}</button></template>
                  <div class="menu">
                    <template v-for="id in characterIdsOf(w.membership)" :key="id">
                      <RouterLink v-if="charNames[`${w.id}/${id}`] !== null" class="menu-item" :to="{ name: 'entity', params: { wid: w.id, eid: id } }"><Icon name="user" :size="15" /> {{ charNames[`${w.id}/${id}`] || '…' }}</RouterLink>
                    </template>
                  </div>
                </Dropdown>
                <Dropdown placement="bottom-end">
                  <template #trigger><button class="icon-btn" title="Ещё"><Icon name="more-horizontal" /></button></template>
                  <div class="menu">
                    <RouterLink v-if="w.role === 'master'" class="menu-item" :to="{ name: 'settings', params: { wid: w.id } }"><Icon name="settings" :size="15" /> Настройки мира</RouterLink>
                    <button class="menu-item danger" @click="leave(w)"><Icon name="log-out" :size="15" /> Выйти из мира</button>
                  </div>
                </Dropdown>
              </div>
            </article>
          </div>
        </template>
      </template>

      <!-- ============ requests ============ -->
      <div v-else class="stack" style="max-width: 860px">
        <div class="row gap">
          <h2 class="grow" style="margin: 0">Заявки в мои миры</h2>
          <button class="btn btn-sm btn-ghost" :disabled="reqLoading" @click="loadRequests"><Icon name="refresh-cw" :size="14" :class="{ spin: reqLoading }" /> Обновить</button>
        </div>
        <div v-if="!incoming.length" class="card empty">Новых заявок нет. Когда кто-то откроет ваш мир и попросит доступ, заявка появится здесь и в настройках мира.</div>
        <section v-for="g in incoming" :key="g.wid" class="card card-pad">
          <div class="row gap" style="margin-bottom: 4px">
            <RouterLink class="grow" :to="{ name: 'settings', params: { wid: g.wid, tab: 'members' } }"><b>{{ g.name }}</b></RouterLink>
            <span class="faint small">{{ g.rows.length }} {{ plural(g.rows.length, 'заявка', 'заявки', 'заявок') }}</span>
          </div>
          <JoinRequestRow v-for="r in g.rows" :key="r.uid" :wid="g.wid" :request="r" :can-master="g.canMaster" :world-name="g.name" @done="loadRequests" />
        </section>

        <h2 style="margin: 16px 0 0">Мои заявки</h2>
        <div v-if="!mine.length" class="card empty">Вы ни у кого не просили доступ.</div>
        <section v-else class="card card-pad stack-sm">
          <div v-for="r in mine" :key="r.wid" class="rel-row">
            <Icon :name="r.status === 'pending' ? 'clock' : 'x'" :size="16" :style="{ color: r.status === 'pending' ? 'var(--accent)' : 'var(--danger)' }" />
            <span class="grow">
              <a :href="requestUrl(r)"><b>{{ r.worldName || 'Мир' }}</b></a>
              <span class="faint small"> · {{ r.status === 'pending' ? 'ждёт ответа мастера' : 'отклонена' }} · отправлена {{ formatDate(r.createdAt) }}</span>
            </span>
            <button class="btn btn-sm btn-ghost" @click="withdraw(r)">{{ r.status === 'pending' ? 'Отменить' : 'Удалить' }}</button>
          </div>
        </section>
      </div>
    </div>

    <Modal v-if="creating" title="Новый мир" width="560px" @close="creating = false">
      <form class="stack" @submit.prevent="create">
        <label class="field"><span>Название</span><input v-model="newWorld.name" class="input" placeholder="Дезремон" maxlength="120" autofocus /></label>
        <label class="field"><span>Короткое описание</span><textarea v-model="newWorld.description" class="input" rows="2" placeholder="Мрачное фэнтези о…" /></label>
        <label class="check"><input v-model="newWorld.isPublic" type="checkbox" /> Открытый мир: статьи с видимостью «всем» читаются без входа</label>
        <div><button class="btn btn-primary" :disabled="!newWorld.name.trim() || createBusy">Создать мир</button></div>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.page { max-width: 1180px; margin: 0 auto; padding: 22px 24px 60px; }
.world-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.wcard { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
.wcard:hover { border-color: var(--accent); }
.wcard-img { height: 130px; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 35%, var(--surface-2)), var(--surface-3)); display: flex; align-items: center; justify-content: center; color: var(--accent-fg); overflow: hidden; }
.wcard-img img { width: 100%; height: 100%; object-fit: cover; }
.wcard-body { padding: 12px 14px 6px; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.wcard-name { font: 700 22px var(--font-head); color: var(--text); text-decoration: none !important; }
.wcard-desc { margin: 0; color: var(--text-muted); font-size: 13.5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wcard-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; }
.wcard-actions { display: flex; align-items: center; gap: 6px; padding: 8px 12px 12px; }
.wcard-new { align-items: center; justify-content: center; gap: 8px; min-height: 220px; border-style: dashed; cursor: pointer; color: var(--text-muted); background: none; }
.req-badge { border: 0; cursor: pointer; background: var(--danger); color: #fff; }
@media (max-width: 720px) { .page { padding: 16px 14px 50px; } }
</style>
