<script setup lang="ts">
// Design lab (#/design, not linked anywhere): every kind of UI the site has, drawn statically with the site's own
// classes, under each world theme (src/themes). No real logic — a place to compare looks.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/common/Icon.vue'
import AppBar from '@/components/layout/AppBar.vue'
import { ALL_FONTS, DESIGNS } from '@/themes/designs'
import { castle, forest, landscape, mapArt, portrait } from './design-lab/art'
import './design-lab/lab.css'

const route = useRoute()
const router = useRouter()
const KEY = 'dw.designLab'
const start = String(route.query.d ?? '') || (() => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } })()
const current = ref(DESIGNS.some((d) => d.id === start) ? start : DESIGNS[0].id)
const cur = computed(() => DESIGNS.find((d) => d.id === current.value) ?? DESIGNS[0])
function pick(id: string) {
  current.value = id
  try { localStorage.setItem(KEY, id) } catch { /* private mode */ }
  void router.replace({ query: { ...route.query, d: id } })
}
// a link with another ?d= (or the browser's back button) switches the design too
watch(() => route.query.d, (d) => { if (typeof d === 'string' && DESIGNS.some((x) => x.id === d)) current.value = d })
function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement)?.closest('input, textarea, select')) return
  const i = DESIGNS.findIndex((d) => d.id === current.value)
  // 1–9 → designs 1–9, 0 → design 10; the arrows go through all of them
  const n = e.key === '0' ? 10 : /^[1-9]$/.test(e.key) ? Number(e.key) : 0
  if (n && DESIGNS[n - 1]) pick(DESIGNS[n - 1].id)
  else if (e.key === 'ArrowRight') pick(DESIGNS[(i + 1) % DESIGNS.length].id)
  else if (e.key === 'ArrowLeft') pick(DESIGNS[(i + DESIGNS.length - 1) % DESIGNS.length].id)
}
function go(id: string) { document.getElementById('dl-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
let fontLinks: HTMLLinkElement[] = []
onMounted(() => {
  document.addEventListener('keydown', onKey)
  fontLinks = ALL_FONTS.map((href) => {
    const l = document.createElement('link')
    l.rel = 'stylesheet'
    l.href = href
    document.head.appendChild(l)
    return l
  })
  document.title = 'Лаборатория дизайна'
})
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); fontLinks.forEach((l) => l.remove()) })

const SECTIONS = [
  ['app', 'Экран приложения'], ['controls', 'Кнопки и поля'], ['article', 'Статья'], ['lists', 'Списки'],
  ['dash', 'Обзор мира'], ['worlds', 'Миры и кампейны'], ['room', 'Музыкальная комната'], ['overlays', 'Окна и меню'], ['type', 'Типографика'],
] as const
const P = { arwen: portrait(28, true), boris: portrait(8), mira: portrait(280, true), kael: portrait(200), elder: portrait(45), ash: portrait(350, true) }
const CARDS = [
  { name: 'Вельмор', sub: 'Город · столица севера', text: 'Город на семи холмах, где колокола звонят по умершим магам. Сердце торговли Северного предела.', img: castle, icon: 'map-pin' },
  { name: 'Орден Пепла', sub: 'Организация · монашеский орден', text: 'Хранители знаний о Пепельной войне. Носят серые плащи и не произносят имён.', img: P.ash, icon: 'landmark' },
  { name: 'Арвен Тихая', sub: 'Персонаж · целительница', text: 'Странствующая целительница с севера. Говорят, она слышит голоса деревьев.', img: P.arwen, icon: 'user' },
  { name: 'Шепчущий лес', sub: 'Локация · лес', text: 'Древний лес, где тропы меняются каждую ночь. Друиды Круга охраняют его границы.', img: forest, icon: 'map-pin' },
  { name: 'Кайл Ворон', sub: 'Персонаж · наёмник', text: 'Бывший капитан стражи Вельмора, ныне — меч по найму.', img: P.kael, icon: 'user' },
  { name: 'Карта Северного предела', sub: 'Карта', text: 'Земли от Серых холмов до Ледяного моря.', img: mapArt, icon: 'map' },
]
const ROWS = [
  { name: 'Вельмор', type: 'Локация', kind: 'Город', when: '3 ч назад', img: castle, icon: 'map-pin', color: '#5fa86b' },
  { name: 'Арвен Тихая', type: 'Персонаж', kind: 'Целительница', when: '5 ч назад', img: P.arwen, icon: 'user', color: '#e0a35a' },
  { name: 'Орден Пепла', type: 'Организация', kind: 'Орден', when: 'вчера', img: P.ash, icon: 'landmark', color: '#7b8fd4' },
  { name: 'Пепельная война', type: 'Событие', kind: 'Война', when: '2 дня назад', img: landscape, icon: 'flame', color: '#e06b4a' },
  { name: 'Борис Гром', type: 'Персонаж', kind: 'Кузнец', when: 'неделю назад', img: P.boris, icon: 'user', color: '#e0a35a' },
]
const SIDEBAR = [
  ['user', 'Персонажи', 48, '#e0a35a'], ['map-pin', 'Локации', 31, '#5fa86b'], ['users', 'Семьи', 6, '#d26b5a'], ['landmark', 'Организации', 12, '#7b8fd4'],
  ['gem', 'Предметы', 19, '#b77ad6'], ['flame', 'События', 23, '#e06b4a'], ['calendar-days', 'Календари', 1, '#4fa3c7'], ['dna', 'Расы', 7, '#7bbf4a'],
  ['scroll', 'Квесты', 9, '#c9a24a'], ['book-open', 'Журналы', 14, '#6aa0d8'], ['map', 'Карты', 3, '#6bb3a4'], ['history', 'Хронологии', 2, '#a98bd6'],
] as const
const PLAYLIST = [
  { t: 'Тёмный лес — эмбиент для исследования', d: '1:02:14', img: forest, on: true },
  { t: 'Таверна «Пьяный грифон»', d: '48:20', img: castle },
  { t: 'Битва у Серых холмов', d: '12:07', img: landscape },
  { t: 'Колокола Вельмора', d: '6:41', img: P.elder },
]
</script>

<template>
  <div class="dlab wtheme" :data-wtheme="cur.id">
    <!-- ======================= switcher ======================= -->
    <header class="dl-switch">
      <div class="dl-switch-row">
        <span class="dl-title"><Icon name="palette" :size="18" /> Лаборатория дизайна</span>
        <div class="dl-designs" role="tablist">
          <template v-for="(d, i) in DESIGNS" :key="d.id">
            <span v-if="d.startsSet && i > 0" class="dl-sep" :title="d.startsSet" aria-hidden="true" />
            <button class="dl-design" :class="{ on: d.id === cur.id }" role="tab" :aria-selected="d.id === cur.id" :title="d.mood + (i < 10 ? ' (клавиша ' + ((i + 1) % 10) + ')' : '')" @click="pick(d.id)">
              <span class="dl-sw"><i v-for="c in d.swatch" :key="c" :style="{ background: c }" /></span>
              <span><b>{{ i + 1 }}</b> {{ d.name }}</span>
            </button>
          </template>
        </div>
      </div>
      <div class="dl-about">
        <b>{{ cur.name }}</b> — {{ cur.mood }}. {{ cur.about }} <span class="dl-fonts">Шрифты: {{ cur.fonts }}.</span>
        <span class="dl-keys">Переключение: клавиши 1–9 и 0 (десятый) или ← →.</span>
      </div>
      <nav class="dl-toc"><a v-for="s in SECTIONS" :key="s[0]" :href="'#dl-' + s[0]" @click.prevent="go(s[0])">{{ s[1] }}</a></nav>
    </header>

    <!-- ======================= the app screen ======================= -->
    <section id="dl-app" class="dl-section">
      <h2 class="dl-h">Экран приложения</h2>
      <p class="dl-sub">Верхний бар, меню мира и страница статьи — как это выглядит целиком.</p>
      <div class="dl-frame">
        <AppBar in-world>
          <template #context><div class="crumbs grow"><a href="#" @click.prevent>Персонажи</a><span class="faint">/</span><span style="color: var(--text)">Арвен Тихая</span></div></template>
          <template #actions>
            <span class="save-state"><Icon name="check" :size="14" /><span class="hide-md"> Сохранено</span></span>
            <button class="btn btn-ghost btn-sm"><Icon name="eye" :size="15" /><span class="hide-md"> Глазами игрока</span></button>
          </template>
        </AppBar>
        <div class="dl-shell">
          <aside class="sidebar">
            <a class="sb-world" href="#" @click.prevent>
              <span class="sb-world-img"><img :src="castle" alt="" /></span>
              <span class="grow"><div class="sb-world-name ellipsis">Дезремон</div><div class="sb-world-role">Владелец · открытый мир</div></span>
            </a>
            <div class="sb-search"><input class="input" placeholder="Найти статью… (Ctrl+K)" /></div>
            <div class="sb-section" style="padding-top: 0"><button class="btn btn-primary" style="width: 100%"><Icon name="plus" :size="16" /> Создать</button></div>
            <nav class="sb-section">
              <a class="sb-link" href="#" @click.prevent><Icon name="layout-dashboard" :size="17" /> Обзор</a>
              <a class="sb-link" href="#" @click.prevent><Icon name="text-search" :size="17" /> Поиск по текстам</a>
              <a class="sb-link" href="#" @click.prevent><Icon name="network" :size="17" /> Граф связей</a>
              <a class="sb-link" href="#" @click.prevent><Icon name="images" :size="17" /> Галерея</a>
            </nav>
            <nav class="sb-section">
              <div class="sb-section-title">Мои персонажи</div>
              <a class="sb-link" href="#" @click.prevent><span class="sb-char-ava"><img :src="P.arwen" alt="" /></span> Арвен Тихая</a>
              <a class="sb-link" href="#" @click.prevent><span class="sb-char-ava"><img :src="P.kael" alt="" /></span> Кайл Ворон</a>
            </nav>
            <nav class="sb-section">
              <div class="sb-section-title">Закладки <Icon name="plus" :size="14" /></div>
              <a class="sb-link" href="#" @click.prevent><Icon name="bookmark" :size="17" /> Пепельная война</a>
            </nav>
            <nav class="sb-section">
              <div class="sb-section-title">Разделы</div>
              <a v-for="(s, i) in SIDEBAR" :key="s[1]" class="sb-link" :class="{ active: i === 0 }" href="#" :style="{ '--sb-color': s[3] }" @click.prevent>
                <Icon :name="s[0]" :size="17" /> {{ s[1] }} <span class="count">{{ s[2] }}</span>
              </a>
            </nav>
            <nav class="sb-section">
              <a class="sb-link" href="#" @click.prevent><Icon name="settings" :size="17" /> Настройки мира <span class="sb-badge">2</span></a>
            </nav>
          </aside>
          <div class="dl-main">
            <div class="preview-banner"><Icon name="eye" :size="16" /><span class="grow">Вы смотрите на мир глазами: <b>Анна</b>. Секреты мастера не показываются.</span><button class="btn btn-sm"><Icon name="x" :size="14" /> Выйти из просмотра</button></div>
            <div class="content">
              <section class="entity-hero has-header">
                <div class="hero-img"><img :src="landscape" alt="" /></div>
                <div class="hero-body">
                  <div class="hero-avatar-wrap"><button class="hero-avatar"><img :src="P.arwen" alt="" /></button></div>
                  <div class="hero-text">
                    <div class="hero-type" style="color: #e0a35a">
                      <Icon name="user" :size="14" /> Персонаж<span class="muted">· целительница</span>
                      <span class="badge badge-public"><Icon name="globe" :size="11" /> всем</span>
                      <span class="badge badge-secret"><Icon name="eye-off" :size="11" /> секреты</span>
                    </div>
                    <h1 class="hero-name">Арвен Тихая</h1>
                    <div class="hero-sub">Странствующая целительница <span class="faint">· также: Сестра Пепла, Тихоня</span></div>
                    <div class="hero-tags">
                      <a class="tag-chip" style="--tag-color: #6fb0d8" href="#" @click.prevent>Север</a>
                      <a class="tag-chip" style="--tag-color: #b77ad6" href="#" @click.prevent>Магия жизни</a>
                      <a class="tag-chip" style="--tag-color: #e06b4a" href="#" @click.prevent>Пепельная война</a>
                    </div>
                  </div>
                  <div class="entity-actions">
                    <button class="btn"><Icon name="pencil" :size="16" /> Редактировать</button>
                    <button class="icon-btn on" title="В избранном"><Icon name="star" /></button>
                    <button class="icon-btn" title="Ещё"><Icon name="more-horizontal" /></button>
                  </div>
                </div>
              </section>
              <div class="entity-grid">
                <div class="entity-main">
                  <div class="card article-card">
                    <div class="prose">
                      <p>Арвен родилась в деревне у кромки <a class="mention" style="--mention-color: #5fa86b" href="#" @click.prevent>Шепчущего леса</a> за год до начала <a class="mention" style="--mention-color: #e06b4a" href="#" @click.prevent>Пепельной войны</a>. Её мать была травницей, отец — лесничим, погибшим при первом нашествии. Девочку приютили сёстры <a class="mention" style="--mention-color: #7b8fd4" href="#" @click.prevent>Ордена Пепла</a>, и там она впервые услышала голоса деревьев.</p>
                      <h2>Юность</h2>
                      <span class="wiki-img" data-align="right" style="width: 240px"><span class="wiki-img-inner"><img :src="forest" alt="" /></span><span class="wiki-img-cap">Шепчущий лес на рассвете</span></span>
                      <p>В шестнадцать лет Арвен сбежала из обители и ушла на юг, в <a class="mention" style="--mention-color: #5fa86b" href="#" @click.prevent>Вельмор</a>. Там она лечила раненых в портовых кварталах, не беря платы, — за что и получила прозвище «Тихая»: о её помощи никто не говорил вслух.</p>
                      <blockquote style="clear: both">«Лес не прощает тех, кто приходит с огнём. Но он помнит и тех, кто приходил с водой».</blockquote>
                      <div class="callout" data-callout="info"><p>Арвен может лечить не только людей, но и деревья — это редкий дар даже среди друидов.</p></div>
                      <h3>Способности</h3>
                      <ul><li>Исцеление ран и болезней прикосновением</li><li>Разговор с деревьями (только в старых лесах)</li><li>Знание трав Северного предела</li></ul>
                      <div class="secret-block"><p>На самом деле Арвен — дочь главы Ордена Пепла. Она пока не знает об этом.</p></div>
                      <table><thead><tr><th>Год</th><th>Событие</th><th>Где</th></tr></thead><tbody><tr><td>412</td><td>Рождение</td><td>Ольховка</td></tr><tr><td>418</td><td>Начало Пепельной войны</td><td>Север</td></tr><tr><td>428</td><td>Побег из обители</td><td>Вельмор</td></tr></tbody></table>
                      <hr />
                      <p>Подробнее — в статье о <a href="#" @click.prevent>магии жизни</a> и в журнале кампейна.</p>
                    </div>
                  </div>
                  <div class="card post-card">
                    <div class="post-head"><h3>Заметки мастера</h3><span class="badge badge-secret"><Icon name="lock" :size="11" /> мастер</span><button class="icon-btn"><Icon name="pencil" :size="16" /></button></div>
                    <p class="muted" style="margin: 0">Появится в 3-й сессии; встреча у старого дуба. Помнит Кайла по осаде Вельмора.</p>
                  </div>
                </div>
                <aside class="entity-side">
                  <div class="card card-pad">
                    <h3 class="panel-title"><Icon name="list-checks" /> Сведения</h3>
                    <dl class="facts">
                      <dt>Раса</dt><dd><a href="#" @click.prevent>Человек</a></dd>
                      <dt>Возраст</dt><dd>31 год</dd>
                      <dt>Место</dt><dd><a href="#" @click.prevent>Вельмор</a></dd>
                      <dt>Семья</dt><dd><a href="#" @click.prevent>Дом Ольховых</a></dd>
                      <dt>Статус</dt><dd><span class="badge badge-public">жива</span></dd>
                    </dl>
                  </div>
                  <div class="card card-pad">
                    <h3 class="panel-title"><Icon name="network" /> Связи</h3>
                    <div class="rel-row"><span class="attitude" style="background: var(--success)" /><span class="avatar" style="width: 26px; height: 26px"><img :src="P.kael" alt="" /></span><span class="grow"><a href="#" @click.prevent><b>Кайл Ворон</b></a></span><span class="faint small">друг</span></div>
                    <div class="rel-row"><span class="attitude" style="background: var(--danger)" /><span class="avatar" style="width: 26px; height: 26px"><img :src="P.ash" alt="" /></span><span class="grow"><a href="#" @click.prevent><b>Настоятельница Ирма</b></a></span><span class="faint small">враг</span></div>
                    <div class="rel-row"><span class="attitude" style="background: var(--warning)" /><span class="avatar" style="width: 26px; height: 26px"><img :src="P.elder" alt="" /></span><span class="grow"><a href="#" @click.prevent><b>Старейшина Мох</b></a></span><span class="faint small">наставник</span></div>
                  </div>
                  <div class="card card-pad toc">
                    <h3 class="panel-title"><Icon name="list" /> Содержание</h3>
                    <a href="#" style="--lvl: 2" @click.prevent>Юность</a><a href="#" style="--lvl: 3" @click.prevent>Способности</a><a href="#" style="--lvl: 2" @click.prevent>Хронология</a>
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ======================= controls ======================= -->
    <section id="dl-controls" class="dl-section">
      <h2 class="dl-h">Кнопки и поля</h2>
      <div class="dl-grid2">
        <div class="card card-pad stack">
          <div class="section-title">Кнопки</div>
          <div class="row gap wrap">
            <button class="btn btn-primary"><Icon name="plus" :size="16" /> Создать статью</button>
            <button class="btn"><Icon name="pencil" :size="16" /> Редактировать</button>
            <button class="btn btn-ghost"><Icon name="download" :size="16" /> Скачать</button>
            <button class="btn btn-danger"><Icon name="trash2" :size="16" /> Удалить</button>
            <button class="btn" disabled>Недоступно</button>
          </div>
          <div class="row gap wrap">
            <button class="btn btn-primary btn-lg">Войти в мир</button>
            <button class="btn btn-sm"><Icon name="filter" :size="14" /> Фильтры</button>
            <button class="btn btn-sm btn-ghost">Отмена</button>
            <button class="icon-btn" title="Настройки"><Icon name="settings" /></button>
            <button class="icon-btn on" title="Избранное"><Icon name="star" /></button>
            <button class="icon-btn" title="Ещё"><Icon name="more-horizontal" /></button>
          </div>
          <div class="section-title">Метки</div>
          <div class="row gap-sm wrap">
            <button class="chip on"><Icon name="check" :size="13" /> Персонажи</button>
            <button class="chip">Локации</button><button class="chip">Организации</button><button class="chip">События</button>
          </div>
          <div class="row gap-sm wrap">
            <a class="tag-chip" style="--tag-color: #6fb0d8" href="#" @click.prevent>Север</a>
            <a class="tag-chip" style="--tag-color: #b77ad6" href="#" @click.prevent>Магия</a>
            <a class="tag-chip" style="--tag-color: #e06b4a" href="#" @click.prevent>Война</a>
            <a class="tag-chip" style="--tag-color: #5fa86b" href="#" @click.prevent>Друиды</a>
            <span class="badge">черновик</span><span class="badge badge-public">всем</span><span class="badge badge-secret"><Icon name="lock" :size="11" /> мастеру</span><span class="badge badge-dead">мёртв</span>
            <span class="small muted">Поиск — <kbd>Ctrl</kbd> + <kbd>K</kbd></span>
          </div>
          <div class="tabs" style="margin-bottom: 0">
            <button class="tab on"><Icon name="globe" :size="16" /> Миры <span class="count">4</span></button>
            <button class="tab"><Icon name="mail" :size="16" /> Заявки <span class="count">2</span></button>
            <button class="tab"><Icon name="user" :size="16" /> Профиль</button>
            <button class="tab"><Icon name="palette" :size="16" /> Оформление</button>
          </div>
        </div>
        <div class="card card-pad stack">
          <div class="section-title">Поля</div>
          <label class="field"><span>Название</span><input class="input" value="Шепчущий лес" /></label>
          <label class="field"><span>В фокусе</span><input class="input dl-focus" value="Арвен Ти" /></label>
          <div class="row gap">
            <label class="field grow"><span>Тип</span><select class="input"><option>Локация</option><option>Персонаж</option></select></label>
            <label class="field grow"><span>Видимость</span><select class="input"><option>Участникам</option><option>Всем</option></select></label>
          </div>
          <label class="field"><span>Описание</span><textarea class="input" rows="2" placeholder="Древний лес, где тропы меняются каждую ночь…" /></label>
          <div class="row gap wrap">
            <label class="check"><input type="checkbox" checked /> Открытый мир</label>
            <label class="check"><input type="checkbox" /> Игроки могут писать посты</label>
            <label class="check"><input type="radio" name="dlr" checked /> Карточки</label>
            <label class="check"><input type="radio" name="dlr" /> Список</label>
          </div>
          <div class="row gap"><input class="input input-sm" placeholder="Маленькое поле" style="max-width: 200px" /><input type="range" value="60" class="dl-range" /></div>
        </div>
      </div>
    </section>

    <!-- ======================= article pieces ======================= -->
    <section id="dl-article" class="dl-section">
      <h2 class="dl-h">Статья: редактор и вставки</h2>
      <div class="dl-grid2">
        <div class="card" style="overflow: hidden">
          <div class="tb" style="position: static">
            <div class="tb-group"><button class="tb-btn"><Icon name="undo2" :size="16" /></button><button class="tb-btn"><Icon name="redo2" :size="16" /></button></div>
            <div class="tb-group"><select class="tb-select"><option>Обычный текст</option></select></div>
            <div class="tb-group"><button class="tb-btn on"><Icon name="bold" :size="16" /></button><button class="tb-btn"><Icon name="italic" :size="16" /></button><button class="tb-btn"><Icon name="underline" :size="16" /></button></div>
            <div class="tb-group"><button class="tb-btn"><Icon name="list" :size="16" /></button><button class="tb-btn"><Icon name="quote" :size="16" /></button><button class="tb-btn"><Icon name="image" :size="16" /></button><button class="tb-btn"><Icon name="table" :size="16" /></button></div>
            <div class="tb-group"><button class="tb-btn tb-secret"><Icon name="lock" :size="16" /> Секрет</button></div>
          </div>
          <div class="prose" style="padding: 18px 22px">
            <h2>Пепельная война</h2>
            <p>Война началась в 418 году, когда с <a class="mention" style="--mention-color: #6fb0d8" href="#" @click.prevent>Ледяного моря</a> пришли корабли без парусов.</p>
            <div class="callout" data-callout="warning"><p>Даты по Коллегианскому календарю.</p></div>
            <div class="callout" data-callout="parchment"><p>Из дневника летописца: «Небо было серым три года».</p></div>
          </div>
        </div>
        <div class="stack">
          <div class="card card-pad">
            <div class="section-title">Карточка при наведении на ссылку</div>
            <div class="preview-card dl-static">
              <div class="pc-head"><div class="pc-img"><img :src="castle" alt="" /></div><div><div class="pc-type" style="color: #5fa86b">Локация · город</div><div class="pc-name">Вельмор</div><div class="pc-sub">Столица Северного предела</div></div></div>
              <div class="pc-text">Город на семи холмах, где колокола звонят по умершим магам.</div>
            </div>
          </div>
          <div class="card card-pad">
            <h3 class="panel-title"><Icon name="sparkles" /> Атрибуты</h3>
            <div class="attr-grid">
              <div class="attr-section">Характеристики</div>
              <div class="attr-name">Сила</div><div>9</div>
              <div class="attr-name">Мудрость</div><div>17</div>
              <div class="attr-name">Харизма</div><div>14</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ======================= lists ======================= -->
    <section id="dl-lists" class="dl-section">
      <h2 class="dl-h">Списки статей</h2>
      <div class="page-head"><h1>Локации</h1><span class="faint">31</span><span class="grow" /><button class="btn btn-primary"><Icon name="plus" :size="16" /> Новая локация</button></div>
      <div class="list-toolbar">
        <input class="input" placeholder="Фильтр по названию…" style="max-width: 280px" />
        <button class="chip on">Все</button><button class="chip">Города</button><button class="chip">Леса</button><button class="chip">Руины</button>
        <span class="grow" />
        <button class="icon-btn on" title="Карточки"><Icon name="layout-grid" /></button><button class="icon-btn" title="Список"><Icon name="layout-list" /></button>
      </div>
      <div class="card-grid">
        <a v-for="c in CARDS" :key="c.name" class="ecard" href="#" @click.prevent>
          <div class="ecard-img"><img :src="c.img" alt="" /></div>
          <div class="ecard-body"><div class="ecard-name">{{ c.name }}</div><div class="ecard-sub">{{ c.sub }}</div><div class="ecard-text">{{ c.text }}</div></div>
        </a>
      </div>
      <div class="card" style="margin-top: 18px; overflow: hidden">
        <table class="table">
          <thead><tr><th>Название</th><th>Тип</th><th>Вид</th><th>Изменено</th></tr></thead>
          <tbody>
            <tr v-for="r in ROWS" :key="r.name">
              <td><span class="row gap-sm"><span class="avatar" style="width: 28px; height: 28px"><img :src="r.img" alt="" /></span><a href="#" @click.prevent><b>{{ r.name }}</b></a></span></td>
              <td><span class="row gap-sm" :style="{ color: r.color }"><Icon :name="r.icon" :size="15" /> {{ r.type }}</span></td>
              <td class="muted">{{ r.kind }}</td><td class="faint">{{ r.when }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ======================= dashboard ======================= -->
    <section id="dl-dash" class="dl-section">
      <h2 class="dl-h">Обзор мира</h2>
      <section class="dash-hero"><div class="hero-img"><img :src="castle" alt="" /></div><div class="dash-hero-body"><h1>Дезремон</h1><p class="muted" style="max-width: 760px; font-size: 16px; margin: 6px 0 0">Мир после Пепельной войны: магия возвращается, старые ордена делят север.</p></div></section>
      <div class="stat-row" style="margin-bottom: 18px">
        <a v-for="s in SIDEBAR.slice(0, 6)" :key="s[1]" class="stat" href="#" @click.prevent><Icon :name="s[0]" :size="17" :style="{ color: s[3] }" /> <b>{{ s[2] }}</b> {{ s[1].toLowerCase() }}</a>
      </div>
      <div class="dl-dash">
        <div class="card card-pad">
          <h3 class="panel-title"><Icon name="clock" /> Последние изменения</h3>
          <div v-for="r in ROWS" :key="r.name" class="recent-row">
            <a class="dl-elink" href="#" @click.prevent><span class="avatar" style="width: 26px; height: 26px"><img :src="r.img" alt="" /></span>{{ r.name }}</a>
            <span class="faint small grow" style="text-align: right">{{ r.when }}</span>
          </div>
        </div>
        <div class="stack">
          <div class="card card-pad">
            <h3 class="panel-title"><Icon name="shuffle" /> Случайная статья <button class="icon-btn" style="margin-left: auto"><Icon name="refresh-cw" :size="15" /></button></h3>
            <a class="row gap" style="align-items: flex-start; color: var(--text)" href="#" @click.prevent>
              <span class="avatar avatar-lg"><img :src="P.mira" alt="" /></span>
              <span><b class="dl-rand-name">Мира Звездочёт</b><br /><span class="muted small">Придворный астролог Вельмора, хранительница Коллегианского календаря.</span></span>
            </a>
          </div>
          <div class="card card-pad">
            <h3 class="panel-title"><Icon name="link" /> Быстрые ссылки</h3>
            <div class="stack-sm">
              <a class="dl-qlink" href="#" @click.prevent><Icon name="scroll" :size="17" style="color: #c9a24a" /><span class="grow"><b>Правила стола</b><span class="faint small">Заметка</span></span><Icon name="chevron-right" :size="15" class="faint" /></a>
              <a class="dl-qlink" href="#" @click.prevent><Icon name="external-link" :size="17" /><span class="grow"><b>Discord кампейна</b><span class="faint small">discord.gg</span></span></a>
            </div>
          </div>
        </div>
        <div class="card dl-cal">
          <a class="dl-cal-head" href="#" @click.prevent><Icon name="calendar-days" :size="16" /><span class="grow">Коллегианский календарь</span><Icon name="chevron-right" :size="15" class="faint" /></a>
          <div class="dl-cal-body"><div class="dl-cal-date">13 Галиена</div><div class="dl-cal-year">442 <span class="muted">· год Ворона</span></div>
            <div class="row gap-sm small" style="margin-top: 4px"><span class="muted">Калефдан</span><span class="dl-season">Оргинар</span></div>
            <div class="row gap-sm small" style="margin-top: 8px"><Icon name="moon" :size="16" /> <b>Селена</b> <span class="muted">растущая</span></div>
          </div>
          <div class="dl-cal-events"><div class="section-title">Ближайшие события</div>
            <div class="dl-event"><span class="dl-event-dot" style="background: #e06b4a" /><span class="grow">Праздник первого снега</span><span class="faint small">через 3 дня</span></div>
            <div class="dl-event"><span class="dl-event-dot" style="background: #7b8fd4" /><span class="grow">Совет Ордена</span><span class="faint small">16 Галиена</span></div>
          </div>
        </div>
        <div class="card card-pad dl-wide">
          <h3 class="panel-title"><Icon name="map" /> Карта Северного предела</h3>
          <div class="dl-map"><img :src="mapArt" alt="" /><span class="dl-map-ctrl"><button><Icon name="zoom-in" :size="17" /></button><button><Icon name="zoom-out" :size="17" /></button><button><Icon name="maximize2" :size="17" /></button></span></div>
        </div>
        <div class="card card-pad dl-edit-demo">
          <div class="dl-ebar"><span class="dl-grip"><Icon name="grip-vertical" :size="16" /></span><Icon name="feather" :size="14" class="faint" /><b class="grow ellipsis">Ждут текста</b><span class="badge"><Icon name="crown" :size="11" /> мастерам</span><button class="icon-btn"><Icon name="settings" :size="15" /></button><button class="icon-btn"><Icon name="x" :size="15" /></button></div>
          <h3 class="panel-title"><Icon name="feather" /> Ждут текста</h3>
          <p class="faint small" style="margin-top: -6px">Блок в режиме настройки обзора.</p>
          <div class="stack-sm"><a class="dl-elink" href="#" @click.prevent><Icon name="map-pin" :size="15" style="color: #5fa86b" /> Серые холмы</a><a class="dl-elink" href="#" @click.prevent><Icon name="landmark" :size="15" style="color: #7b8fd4" /> Гильдия картографов</a></div>
        </div>
      </div>
    </section>

    <!-- ======================= worlds & campaigns ======================= -->
    <section id="dl-worlds" class="dl-section">
      <h2 class="dl-h">Миры и кампейны</h2>
      <div class="dl-grid3">
        <article class="dl-wcard">
          <a class="dl-wcard-img" href="#" @click.prevent><img :src="castle" alt="" /></a>
          <div class="dl-wcard-body"><a class="dl-wcard-name" href="#" @click.prevent>Дезремон</a><p class="dl-wcard-desc">Мрачное фэнтези после Пепельной войны.</p>
            <div class="row gap-sm wrap"><span class="badge badge-public">Владелец</span><span class="badge">открытый</span><span class="faint small"><Icon name="users" :size="12" /> 6</span><span class="faint small">· сегодня</span></div></div>
          <div class="dl-wcard-actions"><button class="btn btn-sm">Открыть</button><button class="btn btn-sm btn-ghost"><Icon name="settings" :size="14" /> Управление</button></div>
        </article>
        <article class="dl-wcard">
          <a class="dl-wcard-img" href="#" @click.prevent><img :src="forest" alt="" /></a>
          <div class="dl-wcard-body"><a class="dl-wcard-name" href="#" @click.prevent>Тени Вельмора</a><p class="dl-wcard-desc">Кампейн в Дезремоне · по пятницам, 19:00</p>
            <div class="row gap-sm wrap"><span class="badge badge-public">идёт</span><span class="faint small"><Icon name="users" :size="12" /> 5 участников</span><span class="faint small"><Icon name="calendar-clock" :size="12" /> пт, 19:00</span></div></div>
          <div class="dl-wcard-actions"><button class="btn btn-sm btn-primary"><Icon name="headphones" :size="14" /> Комната</button><button class="btn btn-sm btn-ghost">Журнал</button></div>
        </article>
        <button class="dl-wcard dl-wcard-new"><Icon name="plus" :size="30" /><span>Создать мир</span></button>
      </div>
      <div class="card card-pad" style="margin-top: 18px">
        <div class="post-head"><h3>Сессия 12 — Колокола Вельмора</h3><span class="faint small">15 ноября · сыграна</span><button class="icon-btn"><Icon name="pencil" :size="16" /></button></div>
        <div class="prose" style="font-size: 16px"><p>Отряд добрался до колокольни и обнаружил, что колокола звонят сами. Кайл узнал в звонаре бывшего сослуживца…</p></div>
      </div>
    </section>

    <!-- ======================= music room ======================= -->
    <section id="dl-room" class="dl-section">
      <h2 class="dl-h">Музыкальная комната</h2>
      <div class="dl-room">
        <div class="stack">
          <div class="card card-pad stack-sm">
            <div class="row gap"><input class="input" placeholder="Ссылка YouTube или поиск…" /><button class="btn btn-primary"><Icon name="plus" :size="16" /> Добавить</button></div>
            <span class="faint small"><Icon name="list-video" :size="13" /> Добавится в плейлист <b>«Основной»</b></span>
          </div>
          <div class="card dl-player">
            <div class="dl-video"><img :src="forest" alt="" /><span class="dl-video-play"><Icon name="play" :size="34" /></span></div>
            <div class="dl-now"><div class="dl-now-title">Тёмный лес — эмбиент для исследования</div><div class="faint small">из плейлиста «Основной» · добавил(а) Мастер Игры</div></div>
            <div class="dl-controls">
              <button class="icon-btn"><Icon name="skip-back" /></button><button class="dl-play"><Icon name="pause" :size="20" /></button><button class="icon-btn"><Icon name="skip-forward" /></button>
              <span class="faint small">12:41</span><input type="range" value="20" class="dl-range grow" /><span class="faint small">1:02:14</span>
              <button class="icon-btn on" title="Повтор плейлиста"><Icon name="repeat" /></button><Icon name="volume-2" :size="17" class="faint" /><input type="range" value="70" class="dl-range" style="width: 90px" />
            </div>
          </div>
          <div class="card card-pad">
            <h3 class="panel-title"><Icon name="audio-lines" /> Дополнительные дорожки</h3>
            <div class="dl-layer"><Icon name="music" :size="16" /><span class="grow"><b>Дождь</b> <span class="faint small">· «Звуки природы»</span></span><input type="range" value="40" class="dl-range" style="width: 120px" /><button class="icon-btn"><Icon name="volume-x" :size="16" /></button></div>
            <div class="dl-layer"><Icon name="music" :size="16" /><span class="grow"><b>Костёр</b> <span class="faint small">· «Звуки природы»</span></span><input type="range" value="65" class="dl-range" style="width: 120px" /><button class="icon-btn"><Icon name="volume-2" :size="16" /></button></div>
          </div>
        </div>
        <div class="stack">
          <div class="card card-pad">
            <div class="section-title">Слушают · 4</div>
            <div class="row gap-sm wrap">
              <span v-for="(p, n) in [P.arwen, P.kael, P.boris, P.mira]" :key="n" class="avatar round" style="width: 34px; height: 34px"><img :src="p" alt="" /></span>
            </div>
          </div>
          <div class="card dl-pl">
            <div class="dl-pl-head"><button class="btn btn-sm"><Icon name="list-video" :size="14" /> Основной <Icon name="chevron-down" :size="14" /></button><span class="faint small grow">4 видео</span><button class="icon-btn"><Icon name="more-horizontal" :size="16" /></button></div>
            <div v-for="it in PLAYLIST" :key="it.t" class="dl-pl-item" :class="{ on: it.on }">
              <span class="dl-grip"><Icon name="grip-vertical" :size="15" /></span>
              <span class="dl-pl-thumb"><img :src="it.img" alt="" /><Icon v-if="it.on" name="audio-lines" :size="18" class="dl-pl-eq" /></span>
              <span class="grow"><span class="dl-pl-title">{{ it.t }}</span><span class="faint small">{{ it.d }}</span></span>
            </div>
          </div>
          <div class="card card-pad dl-chat">
            <div class="section-title">Чат</div>
            <div class="dl-msg"><b>Мастер Игры</b><span>Следующая сцена — таверна, включаю музыку 🍺</span></div>
            <div class="dl-msg mine"><b>Вы</b><span>Кайл заказывает эль!</span></div>
            <div class="row gap-sm"><input class="input input-sm" placeholder="Сообщение…" /><button class="icon-btn"><Icon name="send" :size="16" /></button></div>
          </div>
        </div>
      </div>
    </section>

    <!-- ======================= overlays ======================= -->
    <section id="dl-overlays" class="dl-section">
      <h2 class="dl-h">Окна, меню, уведомления</h2>
      <div class="dl-overlays">
        <div class="menu">
          <div class="menu-label">Арвен Тихая</div>
          <a class="menu-item" href="#" @click.prevent><Icon name="user" :size="15" /> Личный кабинет</a>
          <a class="menu-item on" href="#" @click.prevent><Icon name="moon" :size="15" /> Тёмная тема</a>
          <a class="menu-item" href="#" @click.prevent><Icon name="copy" :size="15" /> Копия статьи</a>
          <div class="menu-sep" />
          <a class="menu-item danger" href="#" @click.prevent><Icon name="trash2" :size="15" /> Удалить статью</a>
        </div>
        <div class="dl-backdrop">
          <div class="modal" style="max-width: 460px">
            <div class="modal-head"><h3>Новый кампейн</h3><button class="icon-btn"><Icon name="x" /></button></div>
            <div class="modal-body stack">
              <label class="field"><span>Название</span><input class="input" value="Тени Вельмора" /></label>
              <label class="field"><span>Мир, в котором идёт игра</span><select class="input"><option>Дезремон</option></select></label>
            </div>
            <div class="modal-foot"><button class="btn">Отмена</button><button class="btn btn-primary"><Icon name="plus" :size="15" /> Создать кампейн</button></div>
          </div>
        </div>
        <div class="stack">
          <div class="toast">Ссылка-приглашение скопирована</div>
          <div class="toast success">Статья сохранена</div>
          <div class="toast error">Не удалось загрузить картинку</div>
          <div class="dl-join"><Icon name="mail" :size="16" /><span class="grow">Это открытый мир. Хотите участвовать?</span><button class="btn btn-sm btn-primary">Попросить доступ</button></div>
          <div class="card empty"><Icon name="sticky-note" :size="30" /><p style="margin: 6px 0 10px">Заметок пока нет.</p><button class="btn btn-primary btn-sm"><Icon name="plus" :size="14" /> Создать заметку</button></div>
        </div>
      </div>
    </section>

    <!-- ======================= typography ======================= -->
    <section id="dl-type" class="dl-section" style="padding-bottom: 80px">
      <h2 class="dl-h">Типографика</h2>
      <div class="dl-grid2">
        <div class="card card-pad">
          <h1 style="margin-bottom: 6px">Заголовок первого уровня</h1>
          <h2>Заголовок второго уровня</h2>
          <h3>Заголовок третьего уровня</h3>
          <h4>Заголовок четвёртого уровня</h4>
          <p style="margin: 0">Интерфейсный текст: кнопки, подписи, меню. <span class="muted">Приглушённый.</span> <span class="faint">Совсем бледный.</span> <a href="#" @click.prevent>Ссылка</a>. <code>код</code></p>
        </div>
        <div class="card card-pad prose">
          <p>Текст статьи. Летопись хранит то, что забыли люди: имена королей, клятвы и тайные тропы через перевал. <em>Курсив для цитат и названий</em>, <strong>полужирный для важного</strong>.</p>
          <p style="margin: 0">Цифры 0123456789 · «Кавычки» — тире · Ёлки, щука, жёлудь.</p>
        </div>
      </div>
    </section>
  </div>
</template>
