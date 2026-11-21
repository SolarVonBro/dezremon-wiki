<script setup lang="ts">
import { errorText } from '@/data/util'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import { acceptCampaignInvite, readCampaignInvite, ROLE_LABELS } from '@/data/campaigns'
import Icon from '@/components/common/Icon.vue'
import { toast } from '@/components/common/toast'
import type { CampaignInvite } from '@/model/types'

const route = useRoute()
const router = useRouter()
const session = useSession()
const cid = route.params.cid as string
const code = route.params.code as string
const invite = ref<CampaignInvite | null>(null)
const state = ref<'loading' | 'login' | 'ready' | 'missing' | 'error'>('loading')
const error = ref('')
const busy = ref(false)

onMounted(async () => {
  await session.whenReady
  if (!session.user) { state.value = 'login'; return }
  invite.value = await readCampaignInvite(cid, code)
  state.value = invite.value && (!invite.value.expiresAt || invite.value.expiresAt > Date.now()) ? 'ready' : 'missing'
})

async function accept() {
  if (!session.user) return
  busy.value = true
  try {
    const r = await acceptCampaignInvite(cid, code, session.user)
    if (r.worldError) toast.info('В кампейн вы вступили, но в мир войти не удалось: ' + r.worldError)
    void router.replace({ name: 'campaign', params: { cid } })
  } catch (e: any) { error.value = errorText(e); state.value = 'error' } finally { busy.value = false }
}
</script>

<template>
  <div class="join-page">
    <div class="card auth-card center stack">
      <Icon name="swords" :size="40" />
      <template v-if="state === 'loading'"><Icon name="refresh-cw" class="spin" :size="22" /></template>
      <template v-else-if="state === 'login'">
        <h2>Приглашение в кампейн</h2>
        <p class="muted">Войдите или зарегистрируйтесь, чтобы принять приглашение.</p>
        <RouterLink class="btn btn-primary" :to="{ name: 'login', query: { next: route.fullPath } }"><Icon name="log-in" :size="15" /> Войти</RouterLink>
      </template>
      <template v-else-if="state === 'ready' && invite">
        <h2>«{{ invite.campaignName }}»</h2>
        <p class="muted">Вас приглашают в кампейн {{ invite.role === 'gm' ? 'мастером' : 'игроком' }}<template v-if="invite.worldInviteCode"> — вместе с доступом к его миру</template>.</p>
        <button class="btn btn-primary btn-lg" :disabled="busy" @click="accept"><Icon name="check" :size="16" /> Вступить {{ ROLE_LABELS[invite.role].toLowerCase() === 'мастер' ? 'мастером' : 'игроком' }}</button>
      </template>
      <template v-else-if="state === 'missing'">
        <h2>Приглашение недействительно</h2>
        <p class="muted">Ссылку отозвали или срок её действия истёк. Попросите мастера прислать новую.</p>
        <RouterLink class="btn" :to="{ name: 'campaigns' }">Мои кампейны</RouterLink>
      </template>
      <template v-else>
        <h2>Не получилось</h2>
        <p class="muted">{{ error }}</p>
        <RouterLink class="btn" :to="{ name: 'campaigns' }">Мои кампейны</RouterLink>
      </template>
    </div>
  </div>
</template>

<style scoped>
.join-page { padding: 50px 16px; }
</style>
