<script setup lang="ts">
// Shown everywhere when the service administrator blocked this account: creating worlds, campaigns and rooms
// and joining anything new is refused by the rules; existing content stays readable.
import { onBeforeUnmount, ref, watch } from 'vue'
import { useSession } from '@/stores/session'
import { watchMyServiceBan } from '@/data/admin'
import Icon from '@/components/common/Icon.vue'
import type { ServiceBan } from '@/model/types'

const session = useSession()
const ban = ref<ServiceBan | null>(null)
let stop: (() => void) | null = null
watch(() => session.user?.uid, (u) => {
  stop?.(); stop = null; ban.value = null
  if (u) stop = watchMyServiceBan(u, (b) => { ban.value = b })
}, { immediate: true })
onBeforeUnmount(() => stop?.())
</script>

<template>
  <div v-if="ban" class="ban-banner">
    <Icon name="ban" :size="16" />
    <span>Аккаунт заблокирован администратором сервиса{{ ban.reason ? ': ' + ban.reason : '' }}. Создавать миры, игры и комнаты и вступать в новые нельзя.</span>
  </div>
</template>

<style scoped>
.ban-banner { display: flex; align-items: center; gap: 10px; padding: 8px 20px; background: color-mix(in srgb, var(--danger) 14%, var(--surface)); border-bottom: 1px solid color-mix(in srgb, var(--danger) 40%, var(--border)); color: var(--text); font-size: 14px; }
.ban-banner .icon { color: var(--danger); }
</style>
