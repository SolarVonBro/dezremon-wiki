<script setup lang="ts">
// Music rooms bound to the campaign (visible to all its participants).
import { onBeforeUnmount, ref } from 'vue'
import { watchCampaignRooms } from '@/data/rooms'
import { relativeTime } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import type { Campaign, Room } from '@/model/types'

const props = defineProps<{ campaign: Campaign }>()
const rows = ref<Room[]>([])
const stop = watchCampaignRooms(props.campaign.id, (r) => { rows.value = r })
onBeforeUnmount(stop)
</script>

<template>
  <div class="stack" style="max-width: 900px">
    <div class="row gap wrap">
      <p class="muted grow" style="margin: 0">Комнаты для совместного прослушивания музыки на играх этого кампейна.</p>
      <RouterLink class="btn btn-primary" :to="{ name: 'rooms', query: { new: '1', campaign: campaign.id } }"><Icon name="plus" :size="15" /> Новая комната</RouterLink>
    </div>
    <div v-if="!rows.length" class="card empty"><Icon name="headphones" :size="30" /><p>К кампейну пока не привязано ни одной комнаты.</p></div>
    <RouterLink v-for="r in rows" :key="r.id" class="card card-pad room-row" :to="{ name: 'room', params: { rid: r.id } }">
      <Icon name="disc-3" :size="26" />
      <div class="grow" style="min-width: 0">
        <b>{{ r.name }}</b>
        <div class="faint small">{{ r.ownerName }} · {{ r.access === 'campaign' ? 'только участники кампейна' : 'вход по ссылке' }} · {{ relativeTime(r.lastActiveAt) }}</div>
      </div>
      <Icon name="arrow-right" :size="16" />
    </RouterLink>
  </div>
</template>

<style scoped>
.room-row { display: flex; align-items: center; gap: 12px; color: var(--text); text-decoration: none !important; }
.room-row:hover { border-color: var(--accent); }
.room-row > .icon:first-child { color: var(--accent); }
</style>
