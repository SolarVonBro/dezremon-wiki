<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Pf2eItemIndex, Pf2eLang, Pf2eMeta } from '@/model/pf2e'
import { ensureItemDescriptions, getItemDesc } from '@/data/pf2eCatalog'
import { ITEM_TYPE_LABEL, RARITY_LABEL, renderPf2eHtml } from '@/data/pf2eFormat'
import { formatPriceCp, formatUnitBulk } from '@/data/pf2eBulk'
import { PF2E_ATTRIBUTES } from '@/data/pf2eSpellcasting'
import Icon from '@/components/common/Icon.vue'

const props = defineProps<{
  item: Pf2eItemIndex
  meta: Pf2eMeta | null
  lang: Pf2eLang
}>()

const cardLang = ref<Pf2eLang>(props.lang)
watch(() => props.lang, (l) => { cardLang.value = l })

const descHtml = ref('')
const loadingDesc = ref(false)

async function loadDesc() {
  loadingDesc.value = true
  try {
    await ensureItemDescriptions(cardLang.value)
    const raw = getItemDesc(props.item.id, cardLang.value)
    descHtml.value = renderPf2eHtml(raw, cardLang.value, props.meta)
  } finally {
    loadingDesc.value = false
  }
}

watch([() => props.item.id, cardLang], () => { void loadDesc() }, { immediate: true })

const title = computed(() => (cardLang.value === 'ru' ? props.item.ru : props.item.en))
const subTitle = computed(() => (cardLang.value === 'ru' ? props.item.en : props.item.ru))
const typeLabel = computed(() => ITEM_TYPE_LABEL[props.item.type]?.[cardLang.value] ?? props.item.type)
const priceLabel = computed(() => {
  const base = formatPriceCp(props.item.priceCp, cardLang.value)
  if (props.item.pricePer > 1 && props.item.priceCp > 0) {
    return `${base} ${cardLang.value === 'ru' ? `за ${props.item.pricePer}` : `per ${props.item.pricePer}`}`
  }
  return base
})
const bulkLabel = computed(() => {
  const w = formatUnitBulk(props.item.bulk, cardLang.value)
  const h = formatUnitBulk(props.item.bulkHeld, cardLang.value)
  const per = props.item.bulkPer > 1 ? (cardLang.value === 'ru' ? ` (за ${props.item.bulkPer} шт.)` : ` (per ${props.item.bulkPer})`) : ''
  if (props.item.bulk !== props.item.bulkHeld) {
    return cardLang.value === 'ru' ? `надето: ${w} / в руках: ${h}${per}` : `worn: ${w} / held: ${h}${per}`
  }
  return `${w}${per}`
})
const usageLabel = computed(() => (props.item.usage ? (props.meta?.usages?.[props.item.usage]?.[cardLang.value] ?? props.item.usage) : ''))

const WEAPON_CAT: Record<string, { ru: string; en: string }> = {
  unarmed: { ru: 'Безоружное', en: 'Unarmed' },
  simple: { ru: 'Простое', en: 'Simple' },
  martial: { ru: 'Воинское', en: 'Martial' },
  advanced: { ru: 'Продвинутое', en: 'Advanced' },
}
const ARMOR_CAT: Record<string, { ru: string; en: string }> = {
  unarmored: { ru: 'Без доспеха', en: 'Unarmored' },
  light: { ru: 'Лёгкий', en: 'Light' },
  medium: { ru: 'Средний', en: 'Medium' },
  heavy: { ru: 'Тяжёлый', en: 'Heavy' },
  'light-barding': { ru: 'Лёгкий доспех скакуна', en: 'Light Barding' },
  'heavy-barding': { ru: 'Тяжёлый доспех скакуна', en: 'Heavy Barding' },
}
const GRADE_LBL: Record<string, { ru: string; en: string }> = {
  low: { ru: 'Низкого качества', en: 'Low-Grade' },
  standard: { ru: 'Стандартного качества', en: 'Standard-Grade' },
  high: { ru: 'Высокого качества', en: 'High-Grade' },
}

const traitBadges = computed(() =>
  props.item.traits.map((t) => ({ slug: t, label: props.meta?.traits?.[t]?.[cardLang.value] ?? t })),
)
const apexLabel = computed(() => {
  if (!props.item.apex) return ''
  const a = PF2E_ATTRIBUTES.find((x) => x.id === props.item.apex)
  return a ? (cardLang.value === 'ru' ? a.ru : a.en) : props.item.apex
})
</script>

<template>
  <article class="pf-card">
    <header class="pfc-head">
      <div class="grow" style="min-width: 0">
        <h3 class="pfc-title">{{ title }}</h3>
        <div v-if="subTitle && subTitle !== title" class="faint small">{{ subTitle }}</div>
      </div>

      <div class="row gap-sm" style="flex-shrink: 0">
        <span class="rank-pill">{{ typeLabel }} · {{ cardLang === 'ru' ? `Ур. ${item.level}` : `Lvl ${item.level}` }}</span>
        <div class="lang-switch" role="group" aria-label="Язык карточки">
          <button type="button" :class="{ on: cardLang === 'ru' }" @click="cardLang = 'ru'">RU</button>
          <button type="button" :class="{ on: cardLang === 'en' }" @click="cardLang = 'en'">EN</button>
        </div>
      </div>
    </header>

    <div class="row gap-sm wrap pfc-traits">
      <span v-if="item.rarity !== 'common'" class="pf-trait" :class="'rar-' + item.rarity">
        {{ RARITY_LABEL[item.rarity]?.[cardLang] }}
      </span>
      <span v-for="tr in traitBadges" :key="tr.slug" class="pf-trait">{{ tr.label }}</span>
    </div>

    <dl class="pfc-meta">
      <dt>{{ cardLang === 'ru' ? 'Цена' : 'Price' }}</dt>
      <dd><b>{{ priceLabel }}</b></dd>

      <dt>{{ cardLang === 'ru' ? 'Масса' : 'Bulk' }}</dt>
      <dd>{{ bulkLabel }}</dd>

      <template v-if="usageLabel">
        <dt>{{ cardLang === 'ru' ? 'Использование' : 'Usage' }}</dt>
        <dd>{{ usageLabel }}</dd>
      </template>

      <!-- Container stats -->
      <template v-if="item.type === 'backpack' || item.capacity > 0">
        <dt>{{ cardLang === 'ru' ? 'Контейнер' : 'Container' }}</dt>
        <dd>
          <span class="badge">{{ cardLang === 'ru' ? 'Вместимость:' : 'Capacity:' }} {{ item.capacity }} {{ cardLang === 'ru' ? 'Б' : 'B' }}</span>
          <span v-if="item.ignored > 0" class="badge badge-public">
            {{ cardLang === 'ru' ? `Игнорирует до ${item.ignored} Б` : `Ignores up to ${item.ignored} B` }}
          </span>
          <span v-if="item.extradimensional" class="badge badge-secret">
            {{ cardLang === 'ru' ? 'Экстрапространственный' : 'Extradimensional' }}
          </span>
        </dd>
      </template>

      <!-- Weapon stats -->
      <template v-if="item.type === 'weapon'">
        <dt>{{ cardLang === 'ru' ? 'Оружие' : 'Weapon' }}</dt>
        <dd>
          <span v-if="item.category" class="badge">{{ WEAPON_CAT[item.category]?.[cardLang] ?? item.category }}</span>
          <span v-if="item.group" class="badge">{{ meta?.weaponGroups?.[item.group]?.[cardLang] ?? item.group }}</span>
          <span v-if="item.die" class="badge"><b>{{ item.diceNum || 1 }}{{ item.die }}</b> {{ meta?.damageTypes?.[item.dmgType]?.[cardLang] ?? item.dmgType }}</span>
          <span v-if="item.wRange" class="badge">{{ cardLang === 'ru' ? `Дист. ${item.wRange} фт.` : `Range ${item.wRange} ft` }}</span>
          <span v-if="item.reload && item.reload !== '-'" class="badge">{{ cardLang === 'ru' ? `Перезарядка ${item.reload}` : `Reload ${item.reload}` }}</span>
        </dd>
      </template>

      <!-- Armor stats -->
      <template v-if="item.type === 'armor'">
        <dt>{{ cardLang === 'ru' ? 'Доспех' : 'Armor' }}</dt>
        <dd>
          <span v-if="item.category" class="badge">{{ ARMOR_CAT[item.category]?.[cardLang] ?? item.category }}</span>
          <span v-if="item.group" class="badge">{{ meta?.armorGroups?.[item.group]?.[cardLang] ?? item.group }}</span>
          <span v-if="item.acBonus != null" class="badge">{{ cardLang === 'ru' ? `КБ +${item.acBonus}` : `AC +${item.acBonus}` }}</span>
          <span v-if="item.dexCap != null" class="badge">{{ cardLang === 'ru' ? `Макс. ЛОВ +${item.dexCap}` : `Dex Cap +${item.dexCap}` }}</span>
          <span v-if="item.strReq != null" class="badge">{{ cardLang === 'ru' ? `СИЛ +${item.strReq}` : `STR +${item.strReq}` }}</span>
          <span v-if="item.checkPenalty" class="badge">{{ cardLang === 'ru' ? `Штраф пров. ${item.checkPenalty}` : `Check ${item.checkPenalty}` }}</span>
          <span v-if="item.speedPenalty" class="badge">{{ cardLang === 'ru' ? `Скорость ${item.speedPenalty} фт.` : `Speed ${item.speedPenalty} ft` }}</span>
        </dd>
      </template>

      <!-- Shield stats -->
      <template v-if="item.type === 'shield'">
        <dt>{{ cardLang === 'ru' ? 'Щит' : 'Shield' }}</dt>
        <dd>
          <span v-if="item.acBonus != null" class="badge">{{ cardLang === 'ru' ? `КБ +${item.acBonus}` : `AC +${item.acBonus}` }}</span>
          <span v-if="item.hardness != null" class="badge">{{ cardLang === 'ru' ? `Твёрдость ${item.hardness}` : `Hardness ${item.hardness}` }}</span>
          <span v-if="item.hp != null" class="badge">{{ cardLang === 'ru' ? `ОЗ ${item.hp} (ПЛ ${Math.floor(item.hp / 2)})` : `HP ${item.hp} (BT ${Math.floor(item.hp / 2)})` }}</span>
          <span v-if="item.speedPenalty" class="badge">{{ cardLang === 'ru' ? `Скорость ${item.speedPenalty} фт.` : `Speed ${item.speedPenalty} ft` }}</span>
        </dd>
      </template>

      <!-- Consumable subtype -->
      <template v-if="item.type === 'consumable' && item.category">
        <dt>{{ cardLang === 'ru' ? 'Подтип' : 'Category' }}</dt>
        <dd>{{ meta?.consumableCats?.[item.category]?.[cardLang] ?? item.category }}</dd>
      </template>

      <!-- Material & grade -->
      <template v-if="item.material">
        <dt>{{ cardLang === 'ru' ? 'Материал' : 'Material' }}</dt>
        <dd>
          {{ meta?.materials?.[item.material]?.[cardLang] ?? item.material }}
          <template v-if="item.grade"> ({{ GRADE_LBL[item.grade]?.[cardLang] ?? item.grade }})</template>
        </dd>
      </template>

      <!-- Apex -->
      <template v-if="apexLabel">
        <dt>{{ cardLang === 'ru' ? 'Апекс' : 'Apex' }}</dt>
        <dd><span class="badge">{{ apexLabel }}</span></dd>
      </template>
    </dl>

    <div class="pfc-body">
      <div v-if="loadingDesc" class="empty" style="padding: 16px"><Icon name="refresh-cw" class="spin" :size="18" /></div>
      <div v-else-if="descHtml" class="pf-prose" v-html="descHtml" />
      <p v-else class="faint small" style="margin: 0">
        {{ cardLang === 'ru' ? 'Дополнительного текстового описания у предмета нет.' : 'No additional description.' }}
      </p>
    </div>

    <footer class="pfc-foot">
      <div class="row gap-sm wrap grow small faint">
        <span v-if="item.pub">{{ item.pub }}</span>
        <span v-if="item.remaster" class="badge badge-public">Remaster</span>
        <span v-else class="badge">Legacy</span>
      </div>
      <slot name="actions" />
    </footer>
  </article>
</template>

<style scoped>
.pf-card { display: flex; flex-direction: column; gap: 12px; }
.pfc-head { display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap; border-bottom: 2px solid var(--accent); padding-bottom: 10px; }
.pfc-title { font-family: var(--font-head); font-size: 26px; font-weight: 700; margin: 0; line-height: 1.15; }
.rank-pill { padding: 3px 10px; border-radius: 6px; background: var(--accent-soft); color: var(--accent); font-weight: 700; font-size: 12.5px; white-space: nowrap; }

.lang-switch { display: inline-flex; border: 1px solid var(--border-strong); border-radius: 6px; overflow: hidden; }
.lang-switch button { border: 0; background: var(--surface-2); padding: 3px 8px; font-size: 12px; font-weight: 600; cursor: pointer; color: var(--text-muted); }
.lang-switch button.on { background: var(--accent); color: var(--accent-fg); }

.pfc-traits { gap: 5px; }
.pf-trait {
  display: inline-flex; padding: 2px 8px; border-radius: 4px; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  background: color-mix(in srgb, var(--accent) 18%, var(--surface-2)); color: var(--text); border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--border));
}
.pf-trait.rar-uncommon { background: color-mix(in srgb, #c2640c 22%, var(--surface-2)); border-color: #c2640c; }
.pf-trait.rar-rare { background: color-mix(in srgb, #1d5aa6 24%, var(--surface-2)); border-color: #2f6f95; }
.pf-trait.rar-unique { background: color-mix(in srgb, #7c3aed 22%, var(--surface-2)); border-color: var(--secret); }

.pfc-meta { display: grid; grid-template-columns: minmax(115px, auto) 1fr; gap: 5px 14px; margin: 0; font-size: 13.5px; padding: 10px 12px; background: var(--surface-2); border-radius: var(--radius-sm); border: 1px solid var(--border); }
.pfc-meta dt { color: var(--text-muted); font-weight: 600; }
.pfc-meta dd { margin: 0; display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }

.pfc-body { font-family: var(--font-text); font-size: 15px; line-height: 1.6; }
.pf-prose :deep(p) { margin: 0 0 10px; }
.pf-prose :deep(p:last-child) { margin-bottom: 0; }
.pf-prose :deep(hr) { border: 0; border-top: 1px solid var(--border); margin: 10px 0; }
.pf-prose :deep(ul), .pf-prose :deep(ol) { margin: 6px 0 10px; padding-left: 20px; }
.pf-prose :deep(table) { width: 100%; border-collapse: collapse; margin: 10px 0; font-family: var(--font-ui); font-size: 13px; }
.pf-prose :deep(th), .pf-prose :deep(td) { padding: 5px 8px; border: 1px solid var(--border); text-align: left; }
.pf-prose :deep(th) { background: var(--surface-2); }
.pf-prose :deep(.pf-act) { font-family: var(--font-ui); color: var(--accent); font-weight: 700; letter-spacing: -1px; padding: 0 2px; }
.pf-prose :deep(.pf-inline-dmg) { font-family: var(--font-ui); font-size: .88em; font-weight: 600; padding: 1px 5px; border-radius: 4px; background: color-mix(in srgb, var(--danger) 15%, transparent); border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent); }
.pf-prose :deep(.pf-inline-check) { font-family: var(--font-ui); font-size: .88em; font-weight: 600; padding: 1px 5px; border-radius: 4px; background: color-mix(in srgb, var(--info) 15%, transparent); border: 1px solid color-mix(in srgb, var(--info) 35%, transparent); }
.pf-prose :deep(.pf-inline-tpl) { font-family: var(--font-ui); font-size: .88em; font-weight: 600; padding: 1px 5px; border-radius: 4px; background: color-mix(in srgb, var(--warning) 15%, transparent); border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent); }
.pf-prose :deep(.pf-inline-ref) { font-family: var(--font-ui); font-size: .92em; font-weight: 600; color: var(--link); text-decoration: underline dotted; }
.pf-prose :deep(.pf-inline-trait) { font-family: var(--font-ui); font-size: .82em; font-weight: 700; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; background: var(--surface-3); }
.pf-prose :deep(.pf-inline-roll) { font-family: var(--font-mono); font-size: .88em; padding: 1px 5px; border-radius: 4px; background: var(--surface-2); border: 1px solid var(--border); }

.pfc-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 10px; border-top: 1px solid var(--border); }
</style>
