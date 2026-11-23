<script setup lang="ts">
// Sidebar section: campaigns of this world that are running or being prepared (all of them for its masters, one's own
// for players); paused and finished ones are on the world's «Кампейны» page.
import { computed } from 'vue'
import { STATUS_LABELS } from '@/data/campaigns'
import { worldCampaigns } from '@/data/worldCampaigns'
import { useWorld } from '@/stores/world'
import Icon from '@/components/common/Icon.vue'

const world = useWorld()
const current = computed(() => worldCampaigns.value.filter((c) => c.status === 'active' || c.status === 'planning')
  .sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || a.name.localeCompare(b.name, 'ru')))
const hidden = computed(() => worldCampaigns.value.length - current.value.length)
</script>

<template>
  <nav v-if="worldCampaigns.length || (world.isMaster && world.member)" class="sb-section">
    <div class="sb-section-title"><RouterLink class="sb-title-link" :to="{ name: 'wcampaigns', params: { wid: world.wid ?? '' } }">Кампейны</RouterLink>
      <RouterLink v-if="world.isMaster && world.member" class="icon-btn" style="width: 22px; height: 22px" title="Новый кампейн в этом мире" :to="{ name: 'wcampaigns', params: { wid: world.wid ?? '' }, query: { new: '1' } }"><Icon name="plus" :size="14" /></RouterLink>
    </div>
    <RouterLink v-for="c in current" :key="c.id" class="sb-link" :to="{ name: 'wcampaign', params: { wid: world.wid ?? '', cid: c.id } }" :title="STATUS_LABELS[c.status]">
      <Icon name="swords" :size="17" /> <span class="ellipsis">{{ c.name }}</span>
      <span v-if="c.status === 'planning'" class="count" title="Готовится">готовится</span>
    </RouterLink>
    <div v-if="!worldCampaigns.length" class="faint small" style="padding: 2px 10px 4px">Кампейнов в этом мире пока нет.</div>
    <div v-else-if="!current.length" class="faint small" style="padding: 2px 10px 4px">Сейчас нет идущих кампейнов.</div>
    <RouterLink v-if="hidden" class="sb-link sb-more" :to="{ name: 'wcampaigns', params: { wid: world.wid ?? '' } }" title="На паузе и завершённые">
      <Icon name="archive" :size="15" /> <span class="ellipsis">Остальные: {{ hidden }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.sb-title-link { color: inherit; text-decoration: none; }
.sb-title-link:hover { color: var(--accent); }
.sb-more { color: var(--text-faint); font-size: 13px; }
</style>
