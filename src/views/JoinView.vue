<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { acceptInvite, readInvite } from '@/stores/world'
import Icon from '@/components/common/Icon.vue'
import type { Invite } from '@/model/types'

const route = useRoute()
const router = useRouter()
const session = useSession()
const wid = route.params.wid as string
const code = route.params.code as string
const invite = ref<Invite | null>(null)
const worldName = ref<string | null>(null)
const state = ref<'loading' | 'ready' | 'missing' | 'error'>('loading')
const error = ref('')
const busy = ref(false)

onMounted(async () => {
  await session.whenReady
  if (!session.user) { state.value = 'ready'; return }
  const r = await readInvite(wid, code)
  invite.value = r.invite
  worldName.value = r.worldName
  state.value = r.invite ? 'ready' : 'missing'
})

async function accept() {
  if (!session.user) return
  busy.value = true
  try {
    await acceptInvite(wid, code, session.me!)
    void router.replace({ name: 'dashboard', params: { wid } })
  } catch (e: any) { error.value = e?.message ?? String(e); state.value = 'error' } finally { busy.value = false }
}
</script>

<template>
  <div class="landing">
    <div class="card auth-card stack center">
      <Icon name="mail" :size="40" style="margin: 0 auto; color: var(--accent)" />
      <h2>Приглашение в мир</h2>
      <template v-if="!session.user">
        <p class="muted">Войдите или зарегистрируйтесь, чтобы принять приглашение.</p>
        <RouterLink class="btn btn-primary" :to="{ name: 'login', query: { next: route.fullPath } }">Войти</RouterLink>
      </template>
      <template v-else-if="state === 'loading'"><Icon name="refresh-cw" class="spin" /></template>
      <template v-else-if="state === 'missing'"><p class="muted">Приглашение не найдено, отозвано или истекло. Попросите мастера прислать новую ссылку.</p></template>
      <template v-else-if="state === 'error'"><p class="danger">{{ error }}</p></template>
      <template v-else>
        <p>Вас приглашают в мир <b>{{ worldName || 'без названия' }}</b> как <b>{{ invite?.role === 'master' ? 'мастера' : 'игрока' }}</b>.</p>
        <button class="btn btn-primary btn-lg" :disabled="busy" @click="accept">Принять приглашение</button>
      </template>
    </div>
  </div>
</template>
