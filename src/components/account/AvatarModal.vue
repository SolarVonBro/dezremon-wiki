<script setup lang="ts">
// Account avatar editor modal (upload / drag & drop / paste, focal point & zoom, remove / restore Google photo).
import { ref } from 'vue'
import { useSession } from '@/stores/session'
import { fileToSource, renderAvatar } from '@/data/avatar'
import ImageModal, { type ImageSavePayload } from '@/components/common/ImageModal.vue'
import { toast } from '@/components/common/toast'

const emit = defineEmits<{ close: [] }>()
const session = useSession()
const busy = ref(false)
let loadedSource: string | null = null

async function loadSrc() {
  const s = await session.avatarSource()
  loadedSource = s?.source ?? null
  return s ? { src: s.source, crop: s.crop } : null
}

async function onSave(payload: ImageSavePayload) {
  busy.value = true
  try {
    const source = payload.file ? await fileToSource(payload.file) : loadedSource
    if (!source) {
      toast.info('Исходник фото не сохранился — загрузите новое во вкладке «Загрузить новое»')
      return
    }
    const image = await renderAvatar(source, payload.crop)
    await session.setAvatar({ image, source, crop: payload.crop })
    toast.success('Фото обновлено во всех мирах и играх')
    emit('close')
  } catch (err: any) {
    toast.error('Не удалось сохранить фото: ' + (err?.message ?? err))
  } finally { busy.value = false }
}

async function onRemove() {
  busy.value = true
  try {
    await session.setAvatar(null)
    toast.success(session.user?.photoURL ? 'Вернулось фото из аккаунта Google' : 'Фото убрано')
    emit('close')
  } catch (err: any) {
    toast.error('Не удалось убрать фото: ' + (err?.message ?? err))
  } finally { busy.value = false }
}
</script>

<template>
  <ImageModal
    title="Фото профиля"
    kind="avatar"
    :has-image="!!session.avatar"
    :load-src="session.avatar ? loadSrc : null"
    :allow-gallery="false"
    :allow-url="false"
    :allow-delete="!!session.avatar"
    :remove-label="session.user?.photoURL ? 'Вернуть фото Google' : 'Убрать фото'"
    :busy="busy"
    @save="onSave"
    @remove="onRemove"
    @close="emit('close')"
  />
</template>
