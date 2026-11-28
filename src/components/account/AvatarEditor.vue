<script setup lang="ts">
import { ref } from 'vue'
import { useSession } from '@/stores/session'
import Icon from '@/components/common/Icon.vue'
import AvatarModal from './AvatarModal.vue'
import { openLightbox } from '@/components/viewer/lightbox'

// The user's own picture: preview opens full screen, one button opens the unified modal (upload, focus/zoom, remove).
// It replaces the sign-in provider's photo in every world, game, comment and room.
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const session = useSession()
const editing = ref(false)

function open() { editing.value = true }
defineExpose({ open })

async function viewPhoto() {
  if (!session.photo) { editing.value = true; return }
  const src = session.avatar ? ((await session.avatarSource())?.source ?? session.photo) : session.photo
  openLightbox([{ src, caption: session.displayName() }])
}
</script>

<template>
  <div class="av-ed" :class="{ compact: props.compact }">
    <button type="button" class="av-big" :class="{ zoomable: !!session.photo }" :title="session.photo ? 'Открыть фото' : 'Загрузить фото'" @click="viewPhoto">
      <img v-if="session.photo" :src="session.photo" alt="" referrerpolicy="no-referrer" />
      <Icon v-else name="user" :size="30" />
    </button>
    <div class="stack-sm grow">
      <div class="row gap-sm wrap">
        <button type="button" class="btn btn-sm" @click="editing = true">
          <Icon :name="session.avatar ? 'pencil' : 'upload'" :size="14" /> {{ session.avatar ? 'Настроить фото' : 'Загрузить фото' }}
        </button>
      </div>
      <span class="faint small">{{ session.avatar ? 'Ваше фото видно в мирах, играх, комментариях и комнатах.' : session.user?.photoURL ? 'Сейчас стоит фото из аккаунта Google. Загрузите своё, и оно заменит его везде.' : 'Загрузите фото: оно появится в мирах, играх, комментариях и комнатах.' }}</span>
    </div>
    <AvatarModal v-if="editing" @close="editing = false" />
  </div>
</template>

<style scoped>
.av-ed { display: flex; align-items: center; gap: 14px; }
.av-big { width: 72px; height: 72px; padding: 0; border: 0; border-radius: 50%; overflow: hidden; flex: none; background: var(--surface-3); color: var(--text-faint); display: flex; align-items: center; justify-content: center; font: 700 26px var(--font-head); cursor: pointer; }
.av-big.zoomable { cursor: zoom-in; }
.av-big img { width: 100%; height: 100%; object-fit: cover; }
@media (max-width: 520px) { .av-ed { flex-direction: column; align-items: flex-start; } }
</style>
