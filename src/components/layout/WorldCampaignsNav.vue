<script setup lang="ts">
// Sidebar section «Мои игры»: games of this world the user runs or plays in, while they are running or being
// prepared. Paused and finished ones, and games of others (masters see all of them), are on the world's «Игры» page.
import { computed } from 'vue'
import { STATUS_LABELS } from '@/data/campaigns'
import { worldCampaigns } from '@/data/worldCampaigns'
import { useWorld } from '@/stores/world'
import Icon from '@/components/common/Icon.vue'

const world = useWorld()
const mine = computed(() => worldCampaigns.value.filter((c) => !!world.uid && c.memberUids.includes(world.uid)))
const current = computed(() => mine.value.filter((c) => c.status === 'active' || c.status === 'planning')
  .sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || a.name.localeCompare(b.name, 'ru')))
const others = computed(() => worldCampaigns.value.length - current.value.length)
const canCreate = computed(() => world.isMaster && !!world.member)
</script>

<template>
  <nav v-if="worldCampaigns.length || canCreate" class="sb-section">
    <div class="sb-section-title"><RouterLink class="sb-title-link" :to="{ name: 'wcampaigns', params: { wid: world.wid ?? '' } }" title="Все игры мира">Мои игры</RouterLink>
      <RouterLink v-if="canCreate" class="icon-btn" style="width: 22px; height: 22px" title="Новая игра в этом мире" :to="{ name: 'wcampaigns', params: { wid: world.wid ?? '' }, query: { new: '1' } }"><Icon name="plus" :size="14" /></RouterLink>
    </div>
    <RouterLink v-for="c in current" :key="c.id" class="sb-link" :to="{ name: 'wcampaign', params: { wid: world.wid ?? '', cid: c.id } }" :title="STATUS_LABELS[c.status]">
      <Icon name="swords" :size="17" /> <span class="ellipsis">{{ c.name }}</span>
      <span v-if="c.status === 'planning'" class="count" title="Готовится">готовится</span>
    </RouterLink>
    <div v-if="!worldCampaigns.length" class="faint small" style="padding: 2px 10px 4px">Игр в этом мире пока нет.</div>
    <div v-else-if="!current.length" class="faint small" style="padding: 2px 10px 4px">{{ mine.length ? 'Сейчас ваши игры не идут.' : 'Вы пока не играете в этом мире.' }}</div>
    <RouterLink v-if="others > 0" class="sb-link sb-more" :to="{ name: 'wcampaigns', params: { wid: world.wid ?? '' } }" :title="world.isMaster ? 'На паузе, завершённые и игры, где вас нет' : 'На паузе и завершённые'">
      <Icon name="archive" :size="15" /> <span class="ellipsis">Все игры мира: {{ worldCampaigns.length }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.sb-title-link { color: inherit; text-decoration: none; }
.sb-title-link:hover { color: var(--accent); }
.sb-more { color: var(--text-faint); font-size: 13px; }
</style>
