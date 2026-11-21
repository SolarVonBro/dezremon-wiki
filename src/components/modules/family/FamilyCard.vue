<script setup lang="ts">
import { computed } from 'vue'
import { useWorld } from '@/stores/world'
import { typeDef } from '@/model/entityTypes'
import type { Entity } from '@/model/types'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import Dropdown from '@/components/common/Dropdown.vue'
import type { AddKind, KinLink } from './genealogy'

const props = defineProps<{
  entity: Entity
  focus?: boolean
  extern?: boolean
  editing?: boolean
  dim?: boolean
  hl?: boolean
  /** Genealogical links of this person (for "remove link"). */
  links?: KinLink[]
  /** Family mode: member can be removed from the family. */
  canLeaveFamily?: boolean
}>()
const emit = defineEmits<{ open: []; add: [kind: AddKind]; unlink: [link: KinLink]; leave: [] }>()
const world = useWorld()

const dead = computed(() => !!props.entity.fields?.isDead)
const subtitle = computed(() => {
  const f = props.entity.fields ?? {}
  return (typeof f.title === 'string' && f.title.trim()) || props.entity.kind || (props.entity.type !== 'character' ? typeDef(props.entity.type).label : '')
})
const LINK_LABEL: Record<KinLink['kind'], string> = { parent: 'родитель', child: 'ребёнок', spouse: 'супруг(а)', sibling: 'брат/сестра' }
function otherName(id: string) { return world.get(id)?.name ?? 'скрыто' }
</script>

<template>
  <div class="fc" :class="{ focus, extern, dead, dim, hl }" :title="entity.name + (subtitle ? ' — ' + subtitle : '')" @click="emit('open')">
    <span class="fc-avatar">
      <Thumb :id="entity.imageId" :alt="entity.name"><Icon :name="typeDef(entity.type).icon" :size="20" /></Thumb>
    </span>
    <div class="fc-text">
      <div class="fc-name">{{ entity.name }}</div>
      <div v-if="subtitle" class="fc-sub">{{ subtitle }}</div>
    </div>
    <span v-if="dead" class="fc-dead" title="Мёртв(а)">†</span>
    <span v-if="editing" class="fc-menu no-pan" @click.stop @pointerdown.stop>
      <Dropdown placement="bottom-end">
        <template #trigger>
          <button type="button" class="fc-menu-btn" title="Родственники"><Icon name="more-horizontal" :size="16" /></button>
        </template>
        <div class="menu">
          <div class="menu-label">Добавить</div>
          <button type="button" class="menu-item" @click="emit('add', 'parent')"><Icon name="arrow-up" :size="15" /> Родителя</button>
          <button type="button" class="menu-item" @click="emit('add', 'child')"><Icon name="arrow-down" :size="15" /> Ребёнка</button>
          <button type="button" class="menu-item" @click="emit('add', 'spouse')"><Icon name="heart" :size="15" /> Супруга / супругу</button>
          <button type="button" class="menu-item" @click="emit('add', 'sibling')"><Icon name="users" :size="15" /> Брата / сестру</button>
          <template v-if="links?.length">
            <div class="menu-sep" />
            <div class="menu-label">Убрать связь</div>
            <div class="menu-scroll fc-links">
              <button v-for="l in links" :key="l.relationId + l.kind" type="button" class="menu-item danger" @click="emit('unlink', l)">
                <Icon name="unlink" :size="15" />
                <span class="faint">{{ LINK_LABEL[l.kind] }}:</span>
                <span class="ellipsis">{{ otherName(l.otherId) }}</span>
              </button>
            </div>
          </template>
          <template v-if="canLeaveFamily">
            <div class="menu-sep" />
            <button type="button" class="menu-item danger" @click="emit('leave')"><Icon name="log-out" :size="15" /> Убрать из семьи</button>
          </template>
          <div class="menu-sep" />
          <button type="button" class="menu-item" @click="emit('open')"><Icon name="external-link" :size="15" /> Открыть статью</button>
        </div>
      </Dropdown>
    </span>
  </div>
</template>

<style scoped>
.fc {
  position: absolute; display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 8px; box-sizing: border-box;
  background: var(--surface); border: 1px solid var(--border-strong); border-radius: 12px; box-shadow: var(--shadow);
  cursor: pointer; user-select: none; transition: border-color .12s, box-shadow .12s, opacity .15s, transform .12s;
}
.fc:hover { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft), var(--shadow); }
.fc.focus { border: 2px solid var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
.fc.extern { border-style: dashed; background: var(--surface-2); }
.fc.dim { opacity: .45; }
.fc.hl { border-color: var(--accent); }
.fc-avatar {
  width: 46px; height: 46px; border-radius: 10px; overflow: hidden; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  background: var(--surface-3); color: var(--text-faint);
}
.fc-avatar :deep(img) { width: 100%; height: 100%; object-fit: cover; display: block; }
.fc-avatar :deep(.thumb-empty) { width: 100%; height: 100%; }
.fc.dead .fc-avatar { filter: grayscale(.9); opacity: .85; }
.fc-text { min-width: 0; flex: 1; }
.fc-name { font-weight: 600; font-size: 14px; line-height: 1.25; color: var(--text); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
.fc-sub { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fc-dead { position: absolute; top: 2px; right: 8px; font-size: 15px; font-weight: 700; color: var(--text-faint); line-height: 1; }
.fc-menu { position: absolute; right: 2px; bottom: 2px; }
.fc-menu-btn {
  width: 24px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 6px;
  background: transparent; color: var(--text-faint); cursor: pointer;
}
.fc-menu-btn:hover { background: var(--surface-3); color: var(--text); }
.fc-links { max-height: 220px; }
.fc-links .menu-item { max-width: 300px; }
</style>
