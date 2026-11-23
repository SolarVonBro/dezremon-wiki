<script setup lang="ts">
import { errorText } from '@/data/util'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { updateCampaign, FORMAT_HINTS, FORMAT_LABELS, STATUS_LABELS, cleanIntro } from '@/data/campaigns'
import { deleteWorldCampaign, renameCampaignTag } from '@/data/worldCampaigns'
import { useWorld } from '@/stores/world'
import { processImage } from '@/data/images'
import { toLocalInput, fromLocalInput } from './dates'
import Icon from '@/components/common/Icon.vue'
import CampaignCover from './CampaignCover.vue'
import CampaignIntroEditor from './CampaignIntroEditor.vue'
import { toast } from '@/components/common/toast'
import type { Campaign, CampaignFormat, CampaignStatus } from '@/model/types'

const props = defineProps<{ campaign: Campaign; isOwner: boolean }>()
const router = useRouter()
const world = useWorld()
const c = props.campaign
const form = ref({
  name: c.name, description: c.description, status: c.status as CampaignStatus, schedule: c.schedule,
  next: toLocalInput(c.nextSessionAt), cover: c.cover, format: (c.format ?? null) as CampaignFormat | null,
  intro: (c.intro?.length ? c.intro : [{ name: 'Жанр', value: '' }, { name: 'Система', value: '' }]).map((r) => ({ ...r })),
})
const busy = ref(false)

async function pickCover(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  try { form.value.cover = (await processImage(f)).thumb } catch { toast.error('Не удалось прочитать картинку') }
}
async function save() {
  if (!form.value.name.trim()) return
  busy.value = true
  try {
    const name = form.value.name.trim()
    // the live campaign may already carry the new name when the write returns: remember the old one first
    const before = { ...props.campaign }
    await updateCampaign(c.id, {
      name, description: form.value.description.trim(), status: form.value.status, schedule: form.value.schedule.trim(),
      nextSessionAt: fromLocalInput(form.value.next), cover: form.value.cover, format: form.value.format, intro: cleanIntro(form.value.intro),
    })
    if (name !== before.name) await renameCampaignTag(before, name)
    toast.success('Сохранено')
  } catch (e: any) { toast.error('Не удалось сохранить: ' + errorText(e)) } finally { busy.value = false }
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
        <label class="field grow"><span>Следующая игра</span><input v-model="form.next" type="datetime-local" class="input" /></label>
      </div>
      <div class="field"><span>Обложка</span>
        <div class="row gap wrap">
          <CampaignCover :campaign="{ name: form.name, cover: form.cover }" style="width: 160px; height: 90px; border-radius: 10px" />
          <label class="btn btn-sm"><Icon name="image" :size="14" /> {{ form.cover ? 'Заменить' : 'Выбрать картинку' }}<input type="file" accept="image/*" hidden @change="pickCover" /></label>
          <button v-if="form.cover" class="btn btn-sm btn-ghost" @click="form.cover = null">Убрать</button>
        </div>
      </div>
      <p class="faint small" style="margin: 0">Тег игры в мире и её музыкальная комната переименуются вместе с ней.</p>
      <div><button class="btn btn-primary" :disabled="busy || !form.name.trim()" @click="save"><Icon name="check" :size="15" /> Сохранить</button></div>
    </section>

    <section v-if="isOwner" class="card card-pad stack danger-zone">
      <h3 class="panel-title" style="margin: 0"><Icon name="triangle-alert" /> Удаление</h3>
      <p class="small muted" style="margin: 0">Удалится игра с журналом сессий, списком участников и приглашениями. Статьи мира не затрагиваются, тег игры останется обычным тегом. Чтобы подтвердить, введите название игры.</p>
      <div class="row gap wrap">
        <input v-model="confirmName" class="input" style="max-width: 320px" :placeholder="campaign.name" />
        <button class="btn btn-danger" :disabled="busy || confirmName.trim() !== campaign.name" @click="remove"><Icon name="trash2" :size="14" /> Удалить игру</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.danger-zone { border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
</style>
