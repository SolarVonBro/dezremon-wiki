// The six candidate designs shown in the design lab (#/design). Each is a dark theme: CSS variables plus component
// overrides in variants.css, scoped to `.dlab[data-design="<id>"]`. All fonts have Cyrillic.
export interface Design {
  id: string
  name: string
  mood: string
  about: string
  fonts: string
  swatch: string[]
}

export const DESIGNS: Design[] = [
  {
    id: 'obsidian', name: 'Обсидиан', mood: 'Тёмная магия: стекло и свечение',
    about: 'Почти чёрный фон с фиолетовой туманностью, полупрозрачные стеклянные панели, фиолетово-бирюзовые акценты со свечением, градиентные главные кнопки. Современная «магическая» эстетика.',
    fonts: 'Unbounded (заголовки) · Manrope (интерфейс и статьи)', swatch: ['#0b0a12', '#9d7bff', '#5ee7ff'],
  },
  {
    id: 'codex', name: 'Кодекс', mood: 'Иллюминированная рукопись',
    about: 'Чернильно-синий фон, золото тиснения, двойные рамки карточек, орнаментальные разделители, буквица в начале статьи. Классическое фэнтези — как старинная книга, но тёмная.',
    fonts: 'Forum (заголовки) · Alegreya (статьи) · Alegreya Sans (интерфейс)', swatch: ['#0d1220', '#d9b45a', '#efe6cf'],
  },
  {
    id: 'steel', name: 'Сталь', mood: 'Гримдарк: железо и кровь',
    about: 'Холодный графит, острые углы, жёсткие рамки без мягких теней, кроваво-красный акцент, заголовки и кнопки капслоком, едва заметная штриховка фона. Суровый военный стиль.',
    fonts: 'Oswald (заголовки) · IBM Plex Sans (интерфейс) · IBM Plex Serif (статьи)', swatch: ['#0e0f11', '#d7263d', '#8a94a6'],
  },
  {
    id: 'grove', name: 'Роща', mood: 'Друидский лес',
    about: 'Тёмная хвоя, нефритовый акцент и янтарные огоньки, мягкие скругления, кнопки-«таблетки», тёплый книжный шрифт статей. Спокойный, живой, природный.',
    fonts: 'Kurale (заголовки) · Nunito (интерфейс) · Vollkorn (статьи)', swatch: ['#0c1410', '#4fd1a1', '#f2c14e'],
  },
  {
    id: 'moonstone', name: 'Лунный камень', mood: 'Холодное серебро и иней',
    about: 'Ночное небо со звёздами, матовое стекло, тонкие линии, ледяной голубой и серебро, разреженные заголовки. Сдержанная «эльфийская» элегантность.',
    fonts: 'Tenor Sans (заголовки) · Ysabeau Office (интерфейс) · Spectral (статьи)', swatch: ['#0a0e14', '#8ecbff', '#c9d6e3'],
  },
  {
    id: 'graphite', name: 'Графит', mood: 'Современный рабочий инструмент',
    about: 'Нейтральный графит без оттенков, волосяные линии, плотная вёрстка, один электрический синий акцент — как профессиональный редактор. Максимально нейтральный фон для чужих картинок и текстов.',
    fonts: 'Onest (интерфейс и заголовки) · Literata (статьи)', swatch: ['#0a0a0b', '#4c8dff', '#ededef'],
  },
  // ---------- the second set: other directions entirely ----------
  {
    id: 'neon', name: 'Неон', mood: 'Киберпанк и синтвейв',
    about: 'Чёрный фон с неоновой сеткой, пурпурный и бирюзовый с свечением, срезанные углы у кнопок и карточек, моноширинные подписи. Для мира, где магия — это код.',
    fonts: 'Russo One (заголовки) · Exo 2 (интерфейс и статьи) · JetBrains Mono (подписи)', swatch: ['#07060d', '#ff2bd6', '#00f0ff'],
  },
  {
    id: 'abyss', name: 'Бездна', mood: 'Глубоководье и биолюминесценция',
    about: 'Глубокий сине-зелёный океан, светящийся бирюзовый и коралловые искры, мягкие «пузырьковые» формы, волнистые подчёркивания заголовков, свет сверху как сквозь толщу воды.',
    fonts: 'Philosopher (заголовки) · Rubik (интерфейс) · Source Serif 4 (статьи)', swatch: ['#031117', '#2ee6c5', '#ff7a8a'],
  },
  {
    id: 'brutal', name: 'Брутализм', mood: 'Необрутализм: грубо и честно',
    about: 'Плоские блоки с толстыми светлыми рамками и жёсткими тенями без размытия, кислотно-жёлтый акцент, тяжёлые заголовки капслоком, моноширинный интерфейс. Дерзко и очень читаемо.',
    fonts: 'Rubik Mono One (заголовки) · IBM Plex Mono (интерфейс) · Golos Text (статьи)', swatch: ['#232323', '#e9ff32', '#f2f2ea'],
  },
  {
    id: 'pixel', name: 'Пиксель', mood: 'Ретро-JRPG',
    about: 'Окна как в консольных ролевых играх: синие панели с белой рамкой, пиксельный шрифт заголовков, курсор ▶ у выбранного пункта, звёздное небо из пикселей. Ностальгия по 16 битам.',
    fonts: 'Press Start 2P (заголовки) · PT Mono (интерфейс) · PT Sans (статьи)', swatch: ['#0b0d1f', '#2b3cab', '#ffe066'],
  },
  {
    id: 'glass', name: 'Витраж', mood: 'Готический собор',
    about: 'Тёмный камень и цветной свет сквозь витражи: рубин, сапфир, изумруд, толстые «свинцовые» рамки, стрельчатая арка у шапки статьи, старославянский шрифт заголовков.',
    fonts: 'Ruslan Display (большие заголовки) · EB Garamond (статьи и подзаголовки) · Commissioner (интерфейс)', swatch: ['#0a0709', '#e0284f', '#2f6bff'],
  },
  {
    id: 'chalk', name: 'Мел', mood: 'Доска мастера',
    about: 'Сланцевая доска с меловой пылью, рамки «от руки», рукописные заголовки, цветные мелки — жёлтый, розовый, голубой. Как записи мастера между сессиями.',
    fonts: 'Caveat (заголовки) · Jost (интерфейс) · Alice (статьи)', swatch: ['#1c2823', '#ffe27a', '#ff9ec7'],
  },
]

const css2 = (families: string[]) => 'https://fonts.googleapis.com/css2?' + families.map((f) => 'family=' + f).join('&') + '&display=swap'
/** Fonts of all the designs (loaded only on the lab page). */
export const LAB_FONTS = [
  css2([
    'Unbounded:wght@400;500;600;700', 'Manrope:wght@400;500;600;700',
    'Forum', 'Alegreya:ital,wght@0,400;0,500;0,700;1,400', 'Alegreya+Sans:wght@400;500;700',
    'Oswald:wght@400;500;600', 'IBM+Plex+Sans:wght@400;500;600', 'IBM+Plex+Serif:ital,wght@0,400;0,600;1,400',
    'Kurale', 'Nunito:wght@400;600;700', 'Vollkorn:ital,wght@0,400;0,600;1,400',
    'Tenor+Sans', 'Ysabeau+Office:wght@400;500;600;700', 'Spectral:ital,wght@0,300;0,400;0,600;1,400',
    'Onest:wght@400;500;600;700', 'Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400',
  ]),
  css2([
    'Russo+One', 'Exo+2:ital,wght@0,400;0,500;0,600;0,700;1,400',
    'Philosopher:ital,wght@0,400;0,700;1,400', 'Rubik:wght@400;500;600;700', 'Source+Serif+4:ital,wght@0,400;0,600;1,400',
    'Rubik+Mono+One', 'IBM+Plex+Mono:wght@400;500;600', 'Golos+Text:wght@400;500;600',
    'Press+Start+2P', 'PT+Mono', 'PT+Sans:ital,wght@0,400;0,700;1,400',
    'Ruslan+Display', 'EB+Garamond:ital,wght@0,400;0,500;0,600;1,400', 'Commissioner:wght@400;500;600;700',
    'Caveat:wght@500;700', 'Jost:wght@400;500;600', 'Alice',
  ]),
]
