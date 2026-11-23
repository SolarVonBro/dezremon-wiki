<script setup lang="ts">
import { computed } from 'vue'
import { useWorld } from '@/stores/world'
import { typeDef } from '@/model/entityTypes'
import { VISIBILITY_SHORT } from '@/data/access'
import { cropOf } from '@/data/crop'
import { isCampaignTag } from '@/data/campaignTags'
import { plural } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import type { Entity } from '@/model/types'

// A card of an article in a section list. Tags show their colour as a plaque and say whether they mark a campaign.
const props = defineProps<{ entity: Entity; uses?: number }>()
const world = useWorld()
const def = computed(() => typeDef(props.entity.type))
const isTag = computed(() => props.entity.type === 'tag')
const colour = computed(() => (props.entity.fields?.colour as string) || 'var(--accent)')
const campaign = computed(() => isTag.value && isCampaignTag(props.entity))
</script>

<template>
  <RouterLink class="ecard" :class="{ 'ecard-tag': isTag }" :to="{ name: 'entity', params: { wid: world.wid!, eid: entity.id } }" :style="isTag ? { '--tag-color': colour } : undefined">
    <div class="ecard-img">
      <Thumb :id="entity.imageId" :crop="cropOf(entity)"><Icon :name="campaign ? 'swords' : def.icon" :size="38" :style="{ color: isTag ? colour : def.color, opacity: 0.6 }" /></Thumb>
    </div>
    <div class="ecard-body">
      <div v-if="isTag" class="row gap-sm wrap">
        <span class="tag-chip ecard-plaque" :title="'Цвет тега: ' + (entity.fields?.colour || 'по умолчанию')">{{ entity.name }}</span>
        <span v-if="campaign" class="badge badge-campaign" title="Тег кампейна: им отмечают статьи кампейна"><Icon name="swords" :size="11" /> кампейн</span>
      </div>
      <div v-else class="ecard-name">{{ entity.name }}</div>
      <div class="ecard-sub">
        <template v-if="isTag">{{ uses ?? 0 }} {{ plural(uses ?? 0, 'статья', 'статьи', 'статей') }}</template>
        <template v-else>{{ entity.kind || def.label }}</template>
        <span v-if="entity.visibility !== 'members'" class="badge" :class="{ 'badge-secret': entity.visibility === 'master' || entity.visibility === 'custom', 'badge-public': entity.visibility === 'public' }" style="margin-left: 4px">{{ VISIBILITY_SHORT[entity.visibility] }}</span>
        <span v-if="entity.fields?.isDead" class="badge badge-dead" style="margin-left: 4px">†</span>
      </div>
      <div v-if="entity.tooltip || entity.excerpt" class="ecard-text">{{ entity.tooltip || entity.excerpt }}</div>
    </div>
  </RouterLink>
</template>

<style scoped>
.ecard-tag { border-top: 4px solid var(--tag-color); }
.ecard-tag .ecard-img { background: color-mix(in srgb, var(--tag-color) 14%, var(--surface-3)); aspect-ratio: 16 / 7; }
.ecard-plaque { font-size: 14px; font-weight: 600; padding: 3px 10px; max-width: 100%; }
.badge-campaign { display: inline-flex; align-items: center; gap: 3px; background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--text); }
</style>
