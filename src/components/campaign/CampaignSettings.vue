<script setup lang="ts">
import { errorText } from '@/data/util'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { updateCampaign, FORMAT_HINTS, FORMAT_LABELS, STATUS_LABELS, cleanIntro } from '@/data/campaigns'
import { deleteWorldCampaign, setCampaignImage, syncCampaignTag } from '@/data/worldCampaigns'
import { useWorld } from '@/stores/world'
import { toLocalInput, fromLocalInput } from './dates'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import CampaignCover from './CampaignCover.vue'
import CampaignIntroEditor from './CampaignIntroEditor.vue'
import ImageDialog from '@/components/editor/ImageDialog.vue'
import ImageCropModal from '@/components/entity/ImageCropModal.vue'
import { toast } from '@/components/common/toast'
import type { Campaign, CampaignFormat, CampaignStatus } from '@/model/types'
import type { ImageCrop } from '@/data/crop'

const props = defineProps<{ campaign: Campaign; isOwner: boolean }>()
const router = useRouter()
const world = useWorld()
const c = props.campaign
const form = ref({
  name: c.name, description: c.description, status: c.status as CampaignStatus, schedule: c.schedule,
  next: toLocalInput(c.nextSessionAt), format: (c.format ?? null) as CampaignFormat | null,
  intro: (c.intro?.length ? c.intro : [{ name: 'Жанр', value: '' }, { name: 'Система', value: '' }]).map((r) => ({ ...r })),
})
const busy = ref(false)

async function save() {
  if (!form.value.name.trim()) return
  busy.value = true
  try {
    const name = form.value.name.trim()
    // the live campaign may already carry the new name when the write returns: remember the old one first
    const before = { ...props.campaign }
    await updateCampaign(c.id, {
      name, description: form.value.description.trim(), status: form.value.status, schedule: form.value.schedule.trim(),
      nextSessionAt: fromLocalInput(form.value.next), format: form.value.format, intro: cleanIntro(form.value.intro),
    })
    if (name !== before.name || form.value.status !== before.status) {
      await syncCampaignTag(before, { name: name !== before.name ? name : undefined, status: form.value.status !== before.status ? form.value.status : undefined })
    }
    toast.success('Сохранено')
  } catch (e: any) { toast.error('Не удалось сохранить: ' + errorText(e)) } finally { busy.value = false }
}

// ---------- pictures: the cover and the page background (saved at once, framed like article pictures) ----------
const choosing = ref<false | 'cover' | 'background'>(false)
const framing = ref<false | 'cover' | 'background'>(false)
async function setPicture(which: 'cover' | 'background', pick: { file?: File; imageId?: string } | null) {
  busy.value = true
  try {
    const id = await setCampaignImage(c.id, which, pick)
    if (id) framing.value = which // a new picture starts centred: offer to frame it right away
  } catch (e: any) { toast.error('Не удалось сохранить картинку: ' + errorText(e)) } finally { busy.value = false }
}
async function saveFrame(which: 'cover' | 'background', crop: ImageCrop | null) {
  await updateCampaign(c.id, which === 'cover' ? { coverCrop: crop } : { backgroundCrop: crop }).catch((e) => toast.error('Не удалось сохранить кадр: ' + errorText(e)))
}

const confirmName = ref('')
async function remove() {
  busy.value = true
  try {
    await deleteWorldCampaign(props.campaign)
    toast.success('Игра удалена')
    void router.replace({ name: 'wcampaigns', params: { wid: world.wid! } })
  } catch (e: any) { toast.error('Не удалось удалить: ' + errorText(e)) } finally { busy.value = false }
}
</script>

<template>
  <div class="stack" style="max-width: 760px">
    <section class="card card-pad stack">
      <h3 class="panel-title" style="margin: 0"><Icon name="settings" /> Игра</h3>
      <label class="field"><span>Название</span><input v-model="form.name" class="input" maxlength="120" /></label>
      <label class="field"><span>Формат</span>
        <select v-model="form.format" class="input" aria-label="Формат игры">
          <option :value="null">— не указан —</option>
          <option v-for="(l, k) in FORMAT_LABELS" :key="k" :value="k">{{ l }} — {{ FORMAT_HINTS[k] }}</option>
        </select>
      </label>
      <label class="field"><span>Описание</span><textarea v-model="form.description" class="input" rows="5" /></label>
      <div class="field"><span>Вводная <span class="faint">(жанр, настроение, система, уровень…)</span></span><CampaignIntroEditor v-model="form.intro" /></div>
      <div class="row gap wrap">
        <label class="field grow"><span>Статус</span>
          <select v-model="form.status" class="input"><option v-for="(l, k) in STATUS_LABELS" :key="k" :value="k">{{ l }}</option></select>
        </label>
        <label class="field grow"><span>Расписание</span><input v-model="form.schedule" class="input" placeholder="По пятницам, 19:00" /></label>
        <label class="field grow"><span>Следующая встреча</span><input v-model="form.next" type="datetime-local" class="input" /></label>
      </div>
      <p class="faint small" style="margin: 0">Тег игры в мире и её музыкальная комната переименуются вместе с ней.</p>
      <div><button class="btn btn-primary" :disabled="busy || !form.name.trim()" @click="save"><Icon name="check" :size="15" /> Сохранить</button></div>
    </section>

    <section class="card card-pad stack pictures">
      <h3 class="panel-title" style="margin: 0"><Icon name="image" /> Оформление</h3>
      <div class="pic-row">
        <CampaignCover :campaign="campaign" hires class="pic-prev" />
        <div class="grow stack-sm">
          <b>Обложка</b>
          <span class="faint small">На странице игры и в списках игр. По щелчку открывается на весь экран.</span>
          <span v-if="campaign.cover && !campaign.coverImageId" class="small old-cover"><Icon name="triangle-alert" :size="13" /> Эта обложка загружена раньше и хранится только маленькой копией, поэтому выглядит размыто. Загрузите её заново («Заменить») — будет чёткой и откроется в полном размере.</span>
          <div class="row gap-sm wrap">
            <button class="btn btn-sm" :disabled="busy" @click="choosing = 'cover'"><Icon name="image" :size="14" /> {{ campaign.cover || campaign.coverImageId ? 'Заменить' : 'Выбрать картинку' }}</button>
            <button v-if="campaign.cover || campaign.coverImageId" class="btn btn-sm" :disabled="busy" title="Центрирование и масштаб" @click="framing = 'cover'"><Icon name="crosshair" :size="14" /> Кадр</button>
            <button v-if="campaign.cover || campaign.coverImageId" class="btn btn-sm btn-ghost" :disabled="busy" @click="setPicture('cover', null)">Убрать</button>
          </div>
        </div>
      </div>
      <div class="pic-row">
        <div class="pic-prev pic-bg">
          <Thumb v-if="campaign.backgroundImageId" :id="campaign.backgroundImageId" variant="full" :crop="campaign.backgroundCrop ?? null" />
          <Icon v-else name="image" :size="22" />
        </div>
        <div class="grow stack-sm">
          <b>Фон страницы</b>
          <span class="faint small">Лежит под всей страницей игры (меню не затрагивает), слегка размыт и притемнён, чтобы не мешать читать.</span>
          <div class="row gap-sm wrap">
            <button class="btn btn-sm" :disabled="busy" @click="choosing = 'background'"><Icon name="image" :size="14" /> {{ campaign.backgroundImageId ? 'Заменить' : 'Выбрать картинку' }}</button>
            <button v-if="campaign.backgroundImageId" class="btn btn-sm" :disabled="busy" title="Какая часть картинки видна" @click="framing = 'background'"><Icon name="crosshair" :size="14" /> Кадр</button>
            <button v-if="campaign.backgroundImageId" class="btn btn-sm btn-ghost" :disabled="busy" @click="setPicture('background', null)">Убрать</button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="isOwner" class="card card-pad stack danger-zone">
      <h3 class="panel-title" style="margin: 0"><Icon name="triangle-alert" /> Удаление</h3>
      <p class="small muted" style="margin: 0">Удалится игра с журналом сессий, списком участников и приглашениями. Статьи мира не затрагиваются, тег игры останется обычным тегом. Чтобы подтвердить, введите название игры.</p>
      <div class="row gap wrap">
        <input v-model="confirmName" class="input" style="max-width: 320px" :placeholder="campaign.name" />
        <button class="btn btn-danger" :disabled="busy || confirmName.trim() !== campaign.name" @click="remove"><Icon name="trash2" :size="14" /> Удалить игру</button>
      </div>
    </section>

    <ImageDialog v-if="choosing" :title="choosing === 'cover' ? 'Обложка игры' : 'Фон страницы игры'" :multiple="false"
      @close="choosing = false" @files="(f) => setPicture(choosing as 'cover' | 'background', { file: f[0] })"
      @pick="(id) => setPicture(choosing as 'cover' | 'background', { imageId: id })" @url="() => toast.info('Загрузите файл или выберите картинку из галереи')" />
    <ImageCropModal v-if="framing" :image-id="framing === 'cover' ? campaign.coverImageId : campaign.backgroundImageId"
      :src="framing === 'cover' ? campaign.cover : null" :initial="framing === 'cover' ? campaign.coverCrop ?? null : campaign.backgroundCrop ?? null"
      :kind="framing" :title="framing === 'cover' ? 'Кадр обложки игры' : 'Кадр фона страницы'"
      @save="(crop) => saveFrame(framing as 'cover' | 'background', crop)" @close="framing = false" />
  </div>
</template>

<style scoped>
.danger-zone { border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
.pic-row { display: flex; gap: 14px; align-items: flex-start; }
.pic-row + .pic-row { border-top: 1px solid var(--border); padding-top: 12px; }
.pic-prev { width: 160px; height: 90px; border-radius: 10px; flex: none; overflow: hidden; }
.old-cover { color: var(--text); display: flex; gap: 6px; align-items: flex-start; }
.old-cover > .icon { color: var(--warning); flex: none; margin-top: 2px; }
.pic-bg { background: var(--surface-3); display: flex; align-items: center; justify-content: center; color: var(--text-faint); }
.pic-bg :deep(img) { width: 100%; height: 100%; object-fit: cover; }
@media (max-width: 520px) { .pic-row { flex-direction: column; } }
</style>
