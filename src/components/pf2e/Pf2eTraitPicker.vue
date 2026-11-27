<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Pf2eLang } from '@/model/pf2e'
import Icon from '@/components/common/Icon.vue'

export interface PickerOption {
  value: string
  ru: string
  en: string
  count?: number
}

const props = withDefaults(defineProps<{
  options: PickerOption[]
  include: string[]
  exclude: string[]
  mode?: 'and' | 'or'
  showMode?: boolean
  lang: Pf2eLang
  placeholder?: string
}>(), {
  mode: 'and',
  showMode: true,
  placeholder: 'Поиск черт (RU / EN)…',
})

const emit = defineEmits<{
  'update:include': [v: string[]]
  'update:exclude': [v: string[]]
  'update:mode': [v: 'and' | 'or']
}>()

const q = ref('')
const open = ref(false)

const incSet = computed(() => new Set(props.include))
const excSet = computed(() => new Set(props.exclude))
const optMap = computed(() => new Map(props.options.map((o) => [o.value, o])))

const labelOf = (val: string) => {
  const o = optMap.value.get(val)
  if (!o) return val
  return props.lang === 'ru' ? o.ru : o.en
}

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase()
  const list = s
    ? props.options.filter((o) =>
        o.ru.toLowerCase().includes(s) || o.en.toLowerCase().includes(s) || o.value.toLowerCase().includes(s),
      )
    : props.options
  return list.slice(0, 80)
})

function addInclude(val: string) {
  if (incSet.value.has(val)) {
    emit('update:include', props.include.filter((x) => x !== val))
  } else {
    if (excSet.value.has(val)) emit('update:exclude', props.exclude.filter((x) => x !== val))
    emit('update:include', [...props.include, val])
  }
}

function addExclude(val: string) {
  if (excSet.value.has(val)) {
    emit('update:exclude', props.exclude.filter((x) => x !== val))
  } else {
    if (incSet.value.has(val)) emit('update:include', props.include.filter((x) => x !== val))
    emit('update:exclude', [...props.exclude, val])
  }
}

function clearAll() {
  emit('update:include', [])
  emit('update:exclude', [])
}
</script>

<template>
  <div class="tp">
    <div class="row gap-sm wrap" style="margin-bottom: 6px">
      <div class="tp-search grow">
        <Icon name="search" :size="14" class="tp-ic" />
        <input
          v-model="q"
          type="text"
          class="input input-sm tp-inp"
          :placeholder="placeholder"
          @focus="open = true"
        />
        <button v-if="q" type="button" class="icon-btn tp-clear" @click="q = ''"><Icon name="x" :size="13" /></button>
      </div>
      <div v-if="showMode && include.length > 1" class="tp-mode" title="Режим совпадения включённых черт">
        <button type="button" class="tp-mbtn" :class="{ on: mode === 'and' }" @click="emit('update:mode', 'and')">И (все)</button>
        <button type="button" class="tp-mbtn" :class="{ on: mode === 'or' }" @click="emit('update:mode', 'or')">ИЛИ</button>
      </div>
      <button type="button" class="btn btn-sm btn-ghost" @click="open = !open">
        <Icon :name="open ? 'chevron-up' : 'chevron-down'" :size="14" /> {{ open ? 'Свернуть' : 'Список' }}
      </button>
      <button v-if="include.length || exclude.length" type="button" class="btn btn-sm btn-ghost danger" @click="clearAll">
        <Icon name="x" :size="13" /> Сброс
      </button>
    </div>

    <div v-if="include.length || exclude.length" class="row gap-sm wrap" style="margin-bottom: 6px">
      <button
        v-for="v in include"
        :key="'inc-' + v"
        type="button"
        class="tp-pill inc"
        title="Нажмите, чтобы убрать"
        @click="addInclude(v)"
      >
        <span>+ {{ labelOf(v) }}</span><Icon name="x" :size="11" />
      </button>
      <button
        v-for="v in exclude"
        :key="'exc-' + v"
        type="button"
        class="tp-pill exc"
        title="Исключено — нажмите, чтобы убрать"
        @click="addExclude(v)"
      >
        <span>− {{ labelOf(v) }}</span><Icon name="x" :size="11" />
      </button>
    </div>

    <div v-if="open || q.trim()" class="tp-list">
      <div v-for="o in filtered" :key="o.value" class="tp-row">
        <button
          type="button"
          class="tp-main grow"
          :class="{ inc: incSet.has(o.value), exc: excSet.has(o.value) }"
          @click="addInclude(o.value)"
        >
          <span class="ellipsis">{{ lang === 'ru' ? o.ru : o.en }}</span>
          <span v-if="o.ru !== o.en" class="faint small ellipsis">{{ lang === 'ru' ? o.en : o.ru }}</span>
          <span v-if="o.count != null" class="faint small tp-cnt">{{ o.count }}</span>
        </button>
        <button
          type="button"
          class="tp-xbtn"
          :class="{ on: excSet.has(o.value) }"
          :title="excSet.has(o.value) ? 'Убрать исключение' : 'Исключить'"
          @click="addExclude(o.value)"
        >
          −
        </button>
      </div>
      <div v-if="!filtered.length" class="faint small" style="padding: 8px">Ничего не найдено</div>
    </div>
  </div>
</template>

<style scoped>
.tp-search { position: relative; min-width: 160px; }
.tp-ic { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: var(--text-faint); pointer-events: none; }
.tp-inp { padding-left: 28px; padding-right: 26px; }
.tp-clear { position: absolute; right: 2px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px; }
.tp-mode { display: inline-flex; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden; }
.tp-mbtn { border: 0; background: var(--surface); padding: 3px 8px; font-size: 12px; cursor: pointer; color: var(--text-muted); }
.tp-mbtn.on { background: var(--accent); color: var(--accent-fg); font-weight: 600; }

.tp-pill {
  display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px;
  font-size: 12px; font-weight: 600; border: 1px solid transparent; cursor: pointer;
}
.tp-pill.inc { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
.tp-pill.exc { background: color-mix(in srgb, var(--danger) 14%, transparent); border-color: var(--danger); color: var(--danger); }

.tp-list {
  max-height: 210px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface); padding: 4px; display: grid; grid-template-columns: repeat(auto-fill, minmax(195px, 1fr)); gap: 3px;
}
.tp-row { display: flex; align-items: center; gap: 2px; min-width: 0; }
.tp-main {
  display: flex; align-items: center; gap: 6px; padding: 4px 7px; border: 0; background: transparent;
  border-radius: 5px; cursor: pointer; text-align: left; font-size: 12.5px; min-width: 0;
}
.tp-main:hover { background: var(--surface-2); }
.tp-main.inc { background: var(--accent-soft); font-weight: 600; }
.tp-main.exc { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); text-decoration: line-through; }
.tp-cnt { margin-left: auto; flex-shrink: 0; }
.tp-xbtn {
  width: 22px; height: 24px; border: 1px solid transparent; border-radius: 5px; background: transparent;
  cursor: pointer; font-weight: 700; color: var(--text-faint); flex-shrink: 0;
}
.tp-xbtn:hover { border-color: var(--danger); color: var(--danger); }
.tp-xbtn.on { background: var(--danger); color: #fff; }
</style>
