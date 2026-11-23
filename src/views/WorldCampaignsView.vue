<script setup lang="ts">
// The campaigns of this world: all of them for its masters, one's own for players. Masters create campaigns here;
// a new campaign gets its tag «⚔ name» in the world and a music room of the same name at once.
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { useWorld } from '@/stores/world'
import { FORMAT_HINTS, FORMAT_LABELS, STATUS_LABELS, cleanIntro } from '@/data/campaigns'
import { createWorldCampaign, worldCampaigns } from '@/data/worldCampaigns'
import { processImage } from '@/data/images'
import { formatDate, plural, errorText } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Modal from '@/components/common/Modal.vue'
import CampaignCover from '@/components/campaign/CampaignCover.vue'
import CampaignIntroEditor from '@/components/campaign/CampaignIntroEditor.vue'
import { toast } from '@/components/common/toast'
import type { CampaignFormat, CampaignStatus } from '@/model/types'

const route = useRoute()
const router = useRouter()
const session = useSession()
const world = useWorld()
const canCreate = computed(() => world.isMaster && !!world.member)
const uid = computed(() => world.uid ?? '')

const creating = ref(false)
const blankIntro = () => ['Жанр', 'Настроение', 'Система', 'Уровень персонажей'].map((name) => ({ name, value: '' }))
const form = ref({ name: '', description: '', status: 'active' as CampaignStatus, schedule: '', cover: null as string | null, format: null as CampaignFormat | null, intro: blankIntro() })
const busy = ref(false)
function openCreate() {
  form.value = { name: '', description: '', status: 'active', schedule: '', cover: null, format: null, intro: blankIntro() }
  creating.value = true
}
watch(() => route.query.new, (n) => {
  if (n && canCreate.value) openCreate()
  if (n) void router.replace({ query: {} })
}, { immediate: true })

async function pickCover(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  try { form.value.cover = (await processImage(f)).thumb } catch { toast.error('Не удалось прочитать картинку') }
}
async function create() {
  if (!session.user || !form.value.name.trim() || busy.value) return
  busy.value = true
  try {
    const cid = await createWorldCampaign(session.user, {
      name: form.value.name.trim(), description: form.value.description.trim(), status: form.value.status, schedule: form.value.schedule.trim(), cover: form.value.cover,
      format: form.value.format, intro: cleanIntro(form.value.intro),
    })
    creating.value = false
    void router.push({ name: 'wcampaign', params: { wid: world.wid!, cid } })
  } catch (e: any) { toast.error('Не удалось создать игру: ' + errorText(e)) } finally { busy.value = false }
}
</script>

<template>
  <Teleport defer to="#crumbs">
    <RouterLink :to="{ name: 'dashboard', params: { wid: world.wid! } }">{{ world.world?.name }}</RouterLink>
    <Icon name="chevron-right" :size="13" /><span style="color: var(--text)">Игры</span>
  </Teleport>
  <div class="content">
    <div class="page-head">
      <Icon name="swords" :size="30" style="color: var(--accent)" />
      <h1 class="grow">Игры <span class="faint" style="font-size: 20px">{{ worldCampaigns.length }}</span></h1>
      <button v-if="canCreate" class="btn btn-primary" @click="openCreate"><Icon name="plus" :size="16" /> Новая игра</button>
    </div>
    <p class="muted" style="margin: -8px 0 18px; max-width: 760px">
      Игра — то, что идёт за столом в этом мире: участники и их текущие персонажи, вводная, журнал сессий, расписание, музыкальная комната.
      У каждой игры есть тег «⚔ название»: им отмечают статьи, которые к ней относятся.
    </p>

    <div v-if="!worldCampaigns.length" class="card empty">
      <Icon name="swords" :size="34" />
      <p>{{ canCreate ? 'В этом мире пока нет игр.' : 'Вы пока не участвуете ни в одной игре этого мира.' }}</p>
      <button v-if="canCreate" class="btn btn-primary" @click="openCreate"><Icon name="plus" :size="15" /> Создать игру</button>
    </div>
    <div v-else class="camp-grid">
      <RouterLink v-for="c in worldCampaigns" :key="c.id" class="camp-card" :to="{ name: 'wcampaign', params: { wid: world.wid!, cid: c.id } }">
        <CampaignCover :campaign="c" class="camp-cover" />
        <div class="camp-body">
          <div class="camp-name">{{ c.name }}</div>
          <div class="row gap-sm wrap" style="margin-top: 4px">
            <span class="badge" :class="{ 'badge-public': c.status === 'active' }">{{ STATUS_LABELS[c.status] }}</span>
            <span v-if="c.format" class="badge">{{ FORMAT_LABELS[c.format] }}</span>
            <span v-if="c.memberUids.includes(uid)" class="badge">{{ c.gmUids.includes(uid) ? 'вы ведёте' : 'вы играете' }}</span>
            <span class="faint small"><Icon name="users" :size="12" /> {{ c.memberUids.length }} {{ plural(c.memberUids.length, 'участник', 'участника', 'участников') }}</span>
          </div>
          <div v-if="c.schedule || (c.nextSessionAt && c.nextSessionAt > Date.now())" class="faint small" style="margin-top: 4px">
            <template v-if="c.nextSessionAt && c.nextSessionAt > Date.now()"><Icon name="calendar-clock" :size="12" /> {{ formatDate(c.nextSessionAt) }}</template>
            <template v-else><Icon name="clock" :size="12" /> {{ c.schedule }}</template>
          </div>
          <div v-if="c.intro?.length" class="camp-intro small">{{ c.intro.slice(0, 3).map((r) => r.value).join(' · ') }}</div>
          <div v-if="c.description" class="camp-desc small muted">{{ c.description }}</div>
        </div>
      </RouterLink>
    </div>

    <Modal v-if="creating" title="Новая игра" width="560px" @close="creating = false">
      <form class="stack" @submit.prevent="create">
        <label class="field"><span>Название</span><input v-model="form.name" class="input" maxlength="120" placeholder="Тени над Вельмором" autofocus /></label>
        <p class="faint small" style="margin: -6px 0 0">Игра пройдёт в мире «{{ world.world?.name }}». В мире появится тег «⚔ {{ form.name.trim() || 'название' }}» и музыкальная комната с тем же названием (её владелец — вы).</p>
        <label class="field"><span>Формат</span>
          <select v-model="form.format" class="input" aria-label="Формат игры">
            <option :value="null">— не указан —</option>
            <option v-for="(l, k) in FORMAT_LABELS" :key="k" :value="k">{{ l }} — {{ FORMAT_HINTS[k] }}</option>
          </select>
        </label>
        <label class="field"><span>Описание</span><textarea v-model="form.description" class="input" rows="3" placeholder="О чём игра, тон, ожидания…" /></label>
        <div class="field"><span>Вводная <span class="faint">(что знать до игры; пустые пункты не сохранятся)</span></span><CampaignIntroEditor v-model="form.intro" /></div>
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
        <div><button class="btn btn-primary" :disabled="busy || !form.name.trim()"><Icon name="plus" :size="15" /> Создать игру</button></div>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.camp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.camp-card { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; color: var(--text); text-decoration: none !important; transition: border-color .12s, transform .12s; }
.camp-card:hover { border-color: var(--accent); transform: translateY(-2px); }
.camp-cover { height: 120px; }
.camp-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 2px; }
.camp-name { font: 700 22px var(--font-head); line-height: 1.15; }
.camp-intro { margin-top: 6px; color: var(--text-muted); }
.camp-desc { margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
</style>
