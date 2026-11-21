<script setup lang="ts">
// Sidebar section: campaigns played in this world (only those the user takes part in).
import { onBeforeUnmount, ref, watch } from 'vue'
import { useWorld } from '@/stores/world'
import { watchWorldCampaigns, STATUS_LABELS } from '@/data/campaigns'
import Icon from '@/components/common/Icon.vue'
import type { Campaign } from '@/model/types'

const world = useWorld()
const rows = ref<Campaign[]>([])
let stop: (() => void) | null = null
watch(() => [world.wid, world.uid] as const, ([w, u]) => {
  stop?.(); stop = null; rows.value = []
  if (w && u) stop = watchWorldCampaigns(w, u, (r) => { rows.value = r })
}, { immediate: true })
onBeforeUnmount(() => stop?.())
</script>

<template>
  <nav v-if="rows.length || (world.isMaster && !world.adminView)" class="sb-section">
    <div class="sb-section-title">Кампейны
      <RouterLink v-if="world.isMaster && !world.adminView" class="icon-btn" style="width: 22px; height: 22px" title="Новый кампейн в этом мире" :to="{ name: 'campaigns', query: { new: '1', world: world.wid ?? '' } }"><Icon name="plus" :size="14" /></RouterLink>
    </div>
    <RouterLink v-for="c in rows" :key="c.id" class="sb-link" :to="{ name: 'campaign', params: { cid: c.id } }" :title="STATUS_LABELS[c.status]">
      <Icon name="swords" :size="17" /> <span class="ellipsis">{{ c.name }}</span>
    </RouterLink>
    <div v-if="!rows.length" class="faint small" style="padding: 2px 10px 4px">Кампейнов в этом мире пока нет.</div>
  </nav>
</template>
