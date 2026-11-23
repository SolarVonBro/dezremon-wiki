<script setup lang="ts">
import { ref } from 'vue'
import { useSession } from '@/stores/session'
import { fileToSource, renderAvatar } from '@/data/avatar'
import Icon from '@/components/common/Icon.vue'
import ImageCropModal from '@/components/entity/ImageCropModal.vue'
import { toast } from '@/components/common/toast'
import type { ImageCrop } from '@/data/crop'

// The user's own picture: upload, frame (the same focal point and zoom as article pictures), frame again, remove.
// It replaces the sign-in provider's photo in every world, game, comment and room.
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const session = useSession()
const fileInput = ref<HTMLInputElement | null>(null)
const framing = ref<{ source: string; crop: ImageCrop | null } | null>(null)
const busy = ref(false)

function pick() { fileInput.value?.click() }
defineExpose({ pick })

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  try { framing.value = { source: await fileToSource(f), crop: null } } catch (err: any) { toast.error(err?.message ?? String(err)) }
}
async function reframe() {
  busy.value = true
  try {
    const s = await session.avatarSource()
    if (s) framing.value = s
    else toast.info('Исходник фото не сохранился — загрузите его заново')
  } finally { busy.value = false }
}
async function save(crop: ImageCrop | null) {
  const f = framing.value
  if (!f) return
  busy.value = true
  try {
    await session.setAvatar({ image: await renderAvatar(f.source, crop), source: f.source, crop })
    toast.success('Фото обновлено во всех мирах и играх')
  } catch (err: any) { toast.error('Не удалось сохранить фото: ' + (err?.message ?? err)) } finally { busy.value = false }
}
async function remove() {
  busy.value = true
  try { await session.setAvatar(null); toast.success(session.user?.photoURL ? 'Вернулось фото из аккаунта Google' : 'Фото убрано') } finally { busy.value = false }
}
</script>

<template>
  <div class="av-ed" :class="{ compact: props.compact }">
    <span class="av-big"><img v-if="session.photo" :src="session.photo" alt="" referrerpolicy="no-referrer" /><Icon v-else name="user" :size="30" /></span>
    <div class="stack-sm grow">
      <div class="row gap-sm wrap">
        <button type="button" class="btn btn-sm" :disabled="busy" @click="pick"><Icon name="upload" :size="14" /> {{ session.avatar ? 'Загрузить другое' : 'Загрузить фото' }}</button>
        <button v-if="session.avatar" type="button" class="btn btn-sm" :disabled="busy" title="Центрирование и масштаб" @click="reframe"><Icon name="crosshair" :size="14" /> Кадр</button>
        <button v-if="session.avatar" type="button" class="btn btn-sm btn-ghost" :disabled="busy" @click="remove">{{ session.user?.photoURL ? 'Вернуть фото Google' : 'Убрать фото' }}</button>
      </div>
      <span class="faint small">{{ session.avatar ? 'Ваше фото видно в мирах, играх, комментариях и комнатах.' : session.user?.photoURL ? 'Сейчас стоит фото из аккаунта Google. Загрузите своё, и оно заменит его везде.' : 'Загрузите фото: оно появится в мирах, играх, комментариях и комнатах.' }}</span>
    </div>
    <input ref="fileInput" type="file" accept="image/*" hidden aria-label="Файл фото" @change="onFile" />
    <ImageCropModal v-if="framing" :src="framing.source" :initial="framing.crop" kind="avatar" title="Кадр фото" @save="save" @close="framing = null" />
  </div>
</template>

<style scoped>
.av-ed { display: flex; align-items: center; gap: 14px; }
.av-big { width: 72px; height: 72px; border-radius: 50%; overflow: hidden; flex: none; background: var(--surface-3); color: var(--text-faint); display: flex; align-items: center; justify-content: center; font: 700 26px var(--font-head); }
.av-big img { width: 100%; height: 100%; object-fit: cover; }
@media (max-width: 520px) { .av-ed { flex-direction: column; align-items: flex-start; } }
</style>
