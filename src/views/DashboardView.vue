<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { useWorld } from '@/stores/world'
import { allTypes, typeDef } from '@/model/entityTypes'
import { relativeTime } from '@/data/util'
import Icon from '@/components/common/Icon.vue'
import Thumb from '@/components/common/Thumb.vue'
import EntityLink from '@/components/common/EntityLink.vue'
import EntityPicker from '@/components/common/EntityPicker.vue'
import { createRequest } from '@/components/layout/createRequest'
import { cropOf } from '@/data/crop'

const CalendarWidget = defineAsyncComponent(() => import('@/components/modules/CalendarWidget.vue'))
const world = useWorld()
const stats = computed(() => allTypes().filter((t) => world.enabledTypes(t.key) && (world.byType.get(t.key)?.length ?? 0) > 0).map((t) => ({ t, n: world.byType.get(t.key)!.length })))
const recent = computed(() => world.recent.slice(0, 14))
const pins = computed(() => world.settings.dashboardPins.map((id) => world.get(id)).filter(Boolean))
const randomSeed = ref(0)
const random = computed(() => { void randomSeed.value; const l = world.list.filter((e) => e.type !== 'tag'); return l.length ? l[Math.floor(Math.random() * l.length)] : null })
const unmentioned = computed(() => world.list.filter((e) => !world.backlinks.get(e.id)?.length && !['tag', 'calendar', 'attribute_template'].includes(e.type) && !e.excerpt).slice(0, 8))
const myCharacter = computed(() => world.get(world.viewMember?.characterId ?? null) ?? null)
const calendarId = computed(() => world.settings.mainCalendarId ?? world.byType.get('calendar')?.[0]?.id ?? null)
const pinPick = ref<string | null>(null)
function addPin(id: string | null) { if (id) void world.updateSettings({ dashboardPins: [...new Set([...world.settings.dashboardPins, id])] }); pinPick.value = null }
function unpin(id: string) { void world.updateSettings({ dashboardPins: world.settings.dashboardPins.filter((x) => x !== id) }) }
</script>

<template>
  <Teleport defer to="#crumbs"><span style="color: var(--text)">Обзор</span></Teleport>
  <div class="content">
    <section class="dash-hero">
      <div v-if="world.world?.headerImageId" class="hero-img"><Thumb :id="world.world.headerImageId" variant="full" /></div>
      <div class="dash-hero-body">
        <h1>{{ world.world?.name }}</h1>
        <p v-if="world.world?.description" class="muted" style="max-width: 760px; font-size: 16px; margin: 6px 0 0">{{ world.world.description }}</p>
      </div>
    </section>

    <div class="stat-row" style="margin-bottom: 22px">
      <RouterLink v-for="s in stats" :key="s.t.key" class="stat" :to="{ name: 'list', params: { wid: world.wid!, type: s.t.key } }">
        <Icon :name="s.t.icon" :size="17" :style="{ color: s.t.color }" /> <b>{{ s.n }}</b> {{ s.t.plural.toLowerCase() }}
      </RouterLink>
      <div v-if="!stats.length" class="card card-pad grow">
        <template v-if="world.isMaster">
          <h3 style="margin-top: 0">Мир пока пуст</h3>
          <p class="muted">Начните с ключевых статей: регион, где начнётся игра, пара персонажей, главная фракция. Ссылки между статьями ставятся через «@» прямо в тексте.</p>
          <button class="btn btn-primary" @click="createRequest = { type: null }"><Icon name="plus" :size="16" /> Создать первую статью</button>
        </template>
        <template v-else>
          <h3 style="margin-top: 0">Здесь пока нет {{ world.isMember ? 'доступных вам' : 'открытых' }} статей</h3>
          <p class="muted">{{ world.isMember ? 'Мастер ещё не открыл статьи игрокам.' : 'Мастер ещё не опубликовал статьи для гостей. Если вы участник — войдите.' }}</p>
        </template>
      </div>
    </div>

    <div class="dash-grid">
      <section v-if="myCharacter" class="card card-pad my-char">
        <h3 class="panel-title"><Icon name="user" /> Мой персонаж</h3>
        <RouterLink class="row gap" style="align-items: flex-start; color: var(--text)" :to="{ name: 'entity', params: { wid: world.wid!, eid: myCharacter.id } }">
          <span class="avatar avatar-lg"><Thumb :id="myCharacter.imageId" :crop="cropOf(myCharacter)"><Icon name="user" /></Thumb></span>
          <span><b style="font-family: var(--font-head); font-size: 22px">{{ myCharacter.name }}</b><br /><span class="muted small">{{ myCharacter.fields?.title || myCharacter.kind }}</span><br /><span class="faint small">{{ myCharacter.tooltip || myCharacter.excerpt }}</span></span>
        </RouterLink>
      </section>
      <section v-if="pins.length || world.isMaster" class="card card-pad" style="grid-column: 1 / -1">
        <h3 class="panel-title"><Icon name="pin" /> Закреплено</h3>
        <div class="card-grid">
          <div v-for="e in pins" :key="e!.id" class="pin-wrap">
            <RouterLink class="ecard" :to="{ name: 'entity', params: { wid: world.wid!, eid: e!.id } }">
              <div class="ecard-img"><Thumb :id="e!.imageId" :crop="cropOf(e)"><Icon :name="typeDef(e!.type).icon" :size="34" /></Thumb></div>
              <div class="ecard-body"><div class="ecard-name">{{ e!.name }}</div><div class="ecard-sub">{{ e!.kind || typeDef(e!.type).label }}</div><div class="ecard-text">{{ e!.tooltip || e!.excerpt }}</div></div>
            </RouterLink>
            <button v-if="world.isMaster" class="icon-btn pin-x" title="Открепить" @click="unpin(e!.id)"><Icon name="x" :size="14" /></button>
          </div>
          <div v-if="world.isMaster" class="stack-sm" style="justify-content: center">
            <span class="muted small">Закрепите важные статьи для игроков:</span>
            <EntityPicker v-model="pinPick" placeholder="Закрепить статью…" @update:model-value="addPin" />
          </div>
        </div>
      </section>

      <section class="card card-pad">
        <h3 class="panel-title"><Icon name="clock" /> Последние изменения</h3>
        <div v-for="e in recent" :key="e.id" class="recent-row">
          <EntityLink :id="e.id" avatar />
          <span class="faint small grow" style="text-align: right">{{ relativeTime(e.updatedAt) }}</span>
        </div>
        <div v-if="!recent.length" class="empty">Пока ничего.</div>
      </section>

      <section v-if="calendarId" class="card card-pad"><CalendarWidget :calendar-id="calendarId" /></section>

      <section v-if="random" class="card card-pad">
        <h3 class="panel-title"><Icon name="shuffle" /> Случайная статья <button class="icon-btn" style="margin-left: auto" title="Другая" @click="randomSeed++"><Icon name="refresh-cw" :size="15" /></button></h3>
        <RouterLink class="row gap" style="align-items: flex-start; color: var(--text)" :to="{ name: 'entity', params: { wid: world.wid!, eid: random.id } }">
          <span class="avatar avatar-lg"><Thumb :id="random.imageId" :crop="cropOf(random)"><Icon :name="typeDef(random.type).icon" /></Thumb></span>
          <span><b style="font-family: var(--font-head); font-size: 20px">{{ random.name }}</b><br /><span class="muted small">{{ random.tooltip || random.excerpt || 'Без текста' }}</span></span>
        </RouterLink>
      </section>

      <section v-if="world.isMaster && unmentioned.length" class="card card-pad">
        <h3 class="panel-title"><Icon name="feather" /> Ждут текста</h3>
        <p class="faint small" style="margin-top: -6px">Статьи без текста и без упоминаний.</p>
        <div class="stack-sm"><EntityLink v-for="e in unmentioned" :key="e.id" :id="e.id" /></div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pin-wrap { position: relative; }
.pin-x { position: absolute; top: 6px; right: 6px; background: var(--surface); opacity: 0; }
.pin-wrap:hover .pin-x { opacity: 1; }
</style>
