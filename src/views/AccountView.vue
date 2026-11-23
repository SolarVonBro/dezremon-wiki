<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/stores/session'
import Icon from '@/components/common/Icon.vue'

// #/account — the personal cabinet is the user's own page now (#/u/{uid}); older links land on the same tab there.
const route = useRoute()
const router = useRouter()
const session = useSession()

onMounted(async () => {
  await session.whenReady
  if (!session.user) { void router.replace({ name: 'login', query: { next: route.fullPath } }); return }
  const t = route.query.tab
  const tab = t === 'security' || t === 'appearance' ? t : 'profile'
  void router.replace({ name: 'user', params: { uid: session.user.uid }, query: { tab } })
})
</script>

<template>
  <div class="empty" style="padding: 60px 16px"><Icon name="refresh-cw" class="spin" :size="24" /></div>
</template>
