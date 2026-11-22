<script setup lang="ts">
// All campaigns of the user (as GM or player). A campaign is created inside a world the user runs.
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { myWorlds, type MyWorld } from '@/stores/world'
import { createCampaign, watchMyCampaigns, STATUS_LABELS } from '@/data/campaigns'
import { processImage } from '@/data/images'
import { formatDate, plural, errorText } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import CampaignCover from '@/components/campaign/CampaignCover.vue'
import { toast } from '@/components/common/toast'
import type { Campaign, CampaignStatus } from '@/model/types'

const session = useSession()
const route = useRoute()
const router = useRouter()
const rows = ref<Campaign[]>([])
const loading = ref(true)
let stop: (() => void) | null = null

watch(() => [session.ready, session.user?.uid] as const, ([ready, u]) => {
  stop?.(); stop = null
  if (ready && !u) { void router.replace({ name: 'login', query: { next: route.fullPath } }); return }
  if (!u) return
  stop = watchMyCampaigns(u, (r) => { rows.value = r; loading.value = false }, (e: any) => { loading.value = false; toast.error('Не удалось загрузить кампейны: ' + errorText(e)) })
}, { immediate: true })
onBeforeUnmount(() => stop?.())

const uid = computed(() => session.user?.uid ?? '')
const asGm = computed(() => rows.value.filter((c) => c.gmUids.includes(uid.value)))
const asPlayer = computed(() => rows.value.filter((c) => !c.gmUids.includes(uid.value)))

// ---------- new campaign ----------
const creating = ref(false)
const worlds = ref<MyWorld[] | null>(null)
const runnable = computed(() => (worlds.value ?? []).filter((w) => w.role === 'owner' || w.role === 'master'))
const form = ref({ name: '', description: '', worldId: '', status: 'active' as CampaignStatus, schedule: '', cover: null as string | null })
const busy = ref(false)

async function openCreate(worldId = '') {
  creating.value = true
  form.value = { name: '', description: '', worldId, status: 'active', schedule: '', cover: null }
  if (!worlds.value && session.user) worlds.value = await myWorlds(session.user.uid).catch(() => [])
  if (!form.value.worldId && runnable.value.length === 1) form.value.worldId = runnable.value[0].id
}
watch(() => [route.query.new, session.user?.uid], () => {
  if (route.query.new && session.user) {
    void openCreate(String(route.query.world ?? ''))
    void router.replace({ query: {} })
  }
}, { immediate: true })

async function pickCover(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  try { form.value.cover = (await processImage(f)).thumb } catch { toast.error('Не удалось прочитать картинку') }
}

async function create() {
  const w = runnable.value.find((x) => x.id === form.value.worldId)
  if (!session.user || !form.value.name.trim() || !w) return
  busy.value = true
  try {
    const id = await createCampaign(session.user, {
      name: form.value.name.trim(), description: form.value.description.trim(), worldId: w.id, worldName: w.name,
      status: form.value.status, schedule: form.value.schedule.trim(), cover: form.value.cover,
    })
    creating.value = false
    void router.push({ name: 'campaign', params: { cid: id } })
  } catch (e: any) { toast.error('Не удалось создать кампейн: ' + errorText(e)) } finally { busy.value = false }
}
</script>

<template>
  <div class="page">
    <div class="row gap wrap" style="margin-bottom: 14px">
      <h1 class="grow" style="margin: 0">Кампейны</h1>
      <button class="btn btn-primary" @click="openCreate()"><Icon name="plus" :size="16" /> Новый кампейн</button>
    </div>
    <p class="muted" style="margin: 0 0 18px; max-width: 760px">Кампейн — это игра, которая идёт в одном из миров: участники, журнал сессий, расписание и музыкальные комнаты. Мир хранит сеттинг, кампейн — то, что происходит за столом.</p>

    <div v-if="loading" class="empty"><Icon name="refresh-cw" class="spin" :size="24" /></div>
    <template v-else>
      <div v-if="!rows.length" class="card empty">
        <Icon name="swords" :size="34" />
        <p>Кампейнов пока нет. Создайте свой (нужен мир, где вы мастер) или попросите мастера прислать ссылку-приглашение.</p>
        <button class="btn btn-primary" @click="openCreate()"><Icon name="plus" :size="15" /> Создать кампейн</button>
      </div>
      <template v-for="[title, list] in ([['Веду', asGm], ['Играю', asPlayer]] as const)" :key="title">
        <h2 v-if="list.length" style="margin: 8px 0 10px">{{ title }}</h2>
        <div v-if="list.length" class="camp-grid">
          <RouterLink v-for="c in list" :key="c.id" class="camp-card" :to="{ name: 'campaign', params: { cid: c.id } }">
            <CampaignCover :campaign="c" class="camp-cover" />
            <div class="camp-body">
              <div class="camp-name">{{ c.name }}</div>
              <div class="muted small"><Icon name="globe" :size="13" /> {{ c.worldName || 'без мира' }}</div>
              <div class="row gap-sm wrap" style="margin-top: 6px">
                <span class="badge" :class="{ 'badge-public': c.status === 'active' }">{{ STATUS_LABELS[c.status] }}</span>
                <span class="faint small"><Icon name="users" :size="12" /> {{ c.memberUids.length }} {{ plural(c.memberUids.length, 'участник', 'участника', 'участников') }}</span>
                <span v-if="c.nextSessionAt && c.nextSessionAt > Date.now()" class="faint small"><Icon name="calendar-clock" :size="12" /> {{ formatDate(c.nextSessionAt) }}</span>
              </div>
            </div>
          </RouterLink>
        </div>
      </template>
    </template>

    <Modal v-if="creating" title="Новый кампейн" width="560px" @close="creating = false">
      <form class="stack" @submit.prevent="create">
        <label class="field"><span>Название</span><input v-model="form.name" class="input" maxlength="120" placeholder="Тени над Вельмором" autofocus /></label>
        <label class="field"><span>Мир, в котором идёт игра</span>
          <select v-model="form.worldId" class="input" required>
            <option value="" disabled>{{ worlds === null ? 'Загрузка…' : 'Выберите мир' }}</option>
            <option v-for="w in runnable" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>
        </label>
        <p v-if="worlds !== null && !runnable.length" class="small" style="margin: 0; color: var(--warning)">
          Кампейн создаётся в мире, где вы владелец или мастер. <RouterLink :to="{ name: 'worlds' }">Создайте мир</RouterLink>, а потом возвращайтесь.
        </p>
        <label class="field"><span>Описание</span><textarea v-model="form.description" class="input" rows="3" placeholder="О чём игра, тон, ожидания…" /></label>
        <div class="row gap wrap">
          <label class="field grow"><span>Статус</span>
            <select v-model="form.status" class="input"><option v-for="(l, k) in STATUS_LABELS" :key="k" :value="k">{{ l }}</option></select>
          </label>
          <label class="field grow"><span>Расписание</span><input v-model="form.schedule" class="input" placeholder="По пятницам, 19:00" /></label>
        </div>
        <div class="field"><span>Обложка (необязательно)</span>
          <div class="row gap">
            <img v-if="form.cover" :src="form.cover" alt="" style="width: 96px; height: 54px; object-fit: cover; border-radius: 8px" />
            <label class="btn btn-sm"><Icon name="image" :size="14" /> {{ form.cover ? 'Заменить' : 'Выбрать картинку' }}<input type="file" accept="image/*" hidden @change="pickCover" /></label>
            <button v-if="form.cover" type="button" class="btn btn-sm btn-ghost" @click="form.cover = null">Убрать</button>
          </div>
        </div>
        <div><button class="btn btn-primary" :disabled="busy || !form.name.trim() || !form.worldId"><Icon name="plus" :size="15" /> Создать кампейн</button></div>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.page { max-width: 1180px; margin: 0 auto; padding: 22px 24px 60px; }
.camp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 18px; }
.camp-card { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; color: var(--text); text-decoration: none !important; transition: border-color .12s, transform .12s; }
.camp-card:hover { border-color: var(--accent); transform: translateY(-2px); }
.camp-cover { height: 120px; }
.camp-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 3px; }
.camp-name { font: 700 22px var(--font-head); line-height: 1.15; }
@media (max-width: 720px) { .page { padding: 16px 14px 50px; } }
</style>
