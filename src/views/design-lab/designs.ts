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
]

/** Fonts of all six designs (loaded only on the lab page). */
export const LAB_FONTS = 'https://fonts.googleapis.com/css2?' + [
  'Unbounded:wght@400;500;600;700', 'Manrope:wght@400;500;600;700',
  'Forum', 'Alegreya:ital,wght@0,400;0,500;0,700;1,400', 'Alegreya+Sans:wght@400;500;700',
  'Oswald:wght@400;500;600', 'IBM+Plex+Sans:wght@400;500;600', 'IBM+Plex+Serif:ital,wght@0,400;0,600;1,400',
  'Kurale', 'Nunito:wght@400;600;700', 'Vollkorn:ital,wght@0,400;0,600;1,400',
  'Tenor+Sans', 'Ysabeau+Office:wght@400;500;600;700', 'Spectral:ital,wght@0,300;0,400;0,600;1,400',
  'Onest:wght@400;500;600;700', 'Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400',
].map((f) => 'family=' + f).join('&') + '&display=swap'
