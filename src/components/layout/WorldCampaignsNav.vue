<script setup lang="ts">
// Sidebar section: campaigns of this world (all of them for its masters, one's own for players).
import { STATUS_LABELS } from '@/data/campaigns'
import { worldCampaigns } from '@/data/worldCampaigns'
import { useWorld } from '@/stores/world'
import Icon from '@/components/common/Icon.vue'

const world = useWorld()
</script>

<template>
  <nav v-if="worldCampaigns.length || (world.isMaster && world.member)" class="sb-section">
    <div class="sb-section-title"><RouterLink class="sb-title-link" :to="{ name: 'wcampaigns', params: { wid: world.wid ?? '' } }">Кампейны</RouterLink>
      <RouterLink v-if="world.isMaster && world.member" class="icon-btn" style="width: 22px; height: 22px" title="Новый кампейн в этом мире" :to="{ name: 'wcampaigns', params: { wid: world.wid ?? '' }, query: { new: '1' } }"><Icon name="plus" :size="14" /></RouterLink>
    </div>
    <RouterLink v-for="c in worldCampaigns" :key="c.id" class="sb-link" :to="{ name: 'wcampaign', params: { wid: world.wid ?? '', cid: c.id } }" :title="STATUS_LABELS[c.status]">
      <Icon name="swords" :size="17" /> <span class="ellipsis">{{ c.name }}</span>
    </RouterLink>
    <div v-if="!worldCampaigns.length" class="faint small" style="padding: 2px 10px 4px">Кампейнов в этом мире пока нет.</div>
  </nav>
</template>

<style scoped>
.sb-title-link { color: inherit; text-decoration: none; }
.sb-title-link:hover { color: var(--accent); }
</style>
