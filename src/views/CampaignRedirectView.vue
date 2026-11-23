<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useSession } from '@/stores/session'
import Icon from '@/components/common/Icon.vue'

// #/c/{cid} — campaign pages moved into their worlds (#/w/{wid}/campaigns/{cid}); older links land here.
const route = useRoute()
const router = useRouter()
const session = useSession()
const state = ref<'loading' | 'missing'>('loading')

onMounted(async () => {
  await session.whenReady
  if (!session.user) { void router.replace({ name: 'login', query: { next: route.fullPath } }); return }
  const s = await getDoc(doc(db, 'campaigns', route.params.cid as string)).catch(() => null)
  const wid = s?.exists() ? (s.data().worldId as string | null) : null
  if (wid) void router.replace({ name: 'wcampaign', params: { wid, cid: route.params.cid as string, tab: (route.params.tab as string) || undefined } })
  else state.value = 'missing'
})
</script>

<template>
  <div class="page" style="max-width: 560px; margin: 40px auto; padding: 0 16px">
    <div v-if="state === 'loading'" class="empty"><Icon name="refresh-cw" class="spin" :size="26" /></div>
    <div v-else class="card empty">
      <Icon name="lock" :size="34" />
      <h2>Игра недоступна</h2>
      <p class="muted">Её удалили, или вы в ней не участвуете. Попросите мастера добавить вас в игру.</p>
      <RouterLink class="btn" :to="{ name: 'campaigns' }">Мои игры</RouterLink>
    </div>
  </div>
</template>
