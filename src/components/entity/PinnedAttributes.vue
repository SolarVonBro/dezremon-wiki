<script setup lang="ts">
import { computed } from 'vue'
import { useWorld } from '@/stores/world'
import Icon from '@/components/common/Icon.vue'
import type { Attribute, Entity } from '@/model/types'

const props = defineProps<{ entity: Entity }>()
const world = useWorld()
const pinned = computed<Array<Attribute & { secret?: boolean }>>(() => {
  const pub = props.entity.attributes.filter((a) => a.isPinned && a.kind !== 'section')
  const priv = world.canReadSecrets ? (world.secretsState[props.entity.id]?.attributes ?? []).filter((a) => a.isPinned).map((a) => ({ ...a, secret: true })) : []
  return [...pub, ...priv]
})
function show(a: Attribute) {
  if (a.kind === 'checkbox') return a.value === 'true' ? '✓' : '—'
  return a.value
}
</script>

<template>
  <div v-if="pinned.length" class="card card-pad">
    <div class="section-title">Ключевое</div>
    <dl class="facts">
      <template v-for="a in pinned" :key="a.id">
        <dt><Icon v-if="a.secret" name="lock" :size="12" style="color: var(--secret)" /> {{ a.name }}</dt>
        <dd>
          <a v-if="a.kind === 'link' && a.value" :href="a.value" target="_blank" rel="noopener">{{ a.value }}</a>
          <template v-else>{{ show(a) }}</template>
        </dd>
      </template>
    </dl>
  </div>
</template>
