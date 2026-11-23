// The world themes (designs). Each is a dark theme: design tokens plus component overrides in themes*.css, scoped to
// `[data-wtheme="<id>"]` — on <html> on the pages of a world that picked it (src/themes/apply.ts), on a `.wtheme`
// element in the design lab (#/design) and in the theme previews of the world settings. All fonts have Cyrillic.
export interface Design {
  id: string
  name: string
  mood: string
  about: string
  fonts: string
  swatch: string[]
  /** Google Fonts css2 `family=` values the theme needs (loaded only while it is shown) */
  families: string[]
  /** set on the first design of a set: the name of the set (lists show it as a heading, the lab switcher as a divider) */
  startsSet?: string
}

export const DESIGNS: Design[] = [
  {
    id: 'obsidian', startsSet: 'Разные настроения', name: 'Обсидиан', mood: 'Тёмная магия: стекло и свечение',
    about: 'Почти чёрный фон с фиолетовой туманностью, полупрозрачные стеклянные панели, фиолетово-бирюзовые акценты со свечением, градиентные главные кнопки. Современная «магическая» эстетика.',
    fonts: 'Unbounded (заголовки) · Manrope (интерфейс и статьи)', swatch: ['#0b0a12', '#9d7bff', '#5ee7ff'],
    families: ['Unbounded:wght@400;500;600;700', 'Manrope:wght@400;500;600;700'],
  },
  {
    id: 'codex', name: 'Кодекс', mood: 'Иллюминированная рукопись',
    about: 'Чернильно-синий фон, золото тиснения, двойные рамки карточек, орнаментальные разделители, буквица в начале статьи. Классическое фэнтези — как старинная книга, но тёмная.',
    fonts: 'Forum (заголовки) · Alegreya (статьи) · Alegreya Sans (интерфейс)', swatch: ['#0d1220', '#d9b45a', '#efe6cf'],
    families: ['Forum', 'Alegreya:ital,wght@0,400;0,500;0,700;1,400', 'Alegreya+Sans:wght@400;500;700'],
  },
  {
    id: 'steel', name: 'Сталь', mood: 'Гримдарк: железо и кровь',
    about: 'Холодный графит, острые углы, жёсткие рамки без мягких теней, кроваво-красный акцент, заголовки и кнопки капслоком, едва заметная штриховка фона. Суровый военный стиль.',
    fonts: 'Oswald (заголовки) · IBM Plex Sans (интерфейс) · IBM Plex Serif (статьи)', swatch: ['#0e0f11', '#d7263d', '#8a94a6'],
    families: ['Oswald:wght@400;500;600', 'IBM+Plex+Sans:wght@400;500;600', 'IBM+Plex+Serif:ital,wght@0,400;0,600;1,400'],
  },
  {
    id: 'grove', name: 'Роща', mood: 'Друидский лес',
    about: 'Тёмная хвоя, нефритовый акцент и янтарные огоньки, мягкие скругления, кнопки-«таблетки», тёплый книжный шрифт статей. Спокойный, живой, природный.',
    fonts: 'Kurale (заголовки) · Nunito (интерфейс) · Vollkorn (статьи)', swatch: ['#0c1410', '#4fd1a1', '#f2c14e'],
    families: ['Kurale', 'Nunito:wght@400;600;700', 'Vollkorn:ital,wght@0,400;0,600;1,400'],
  },
  {
    id: 'moonstone', name: 'Лунный камень', mood: 'Холодное серебро и иней',
    about: 'Ночное небо со звёздами, матовое стекло, тонкие линии, ледяной голубой и серебро, разреженные заголовки. Сдержанная «эльфийская» элегантность.',
    fonts: 'Tenor Sans (заголовки) · Ysabeau Office (интерфейс) · Spectral (статьи)', swatch: ['#0a0e14', '#8ecbff', '#c9d6e3'],
    families: ['Tenor+Sans', 'Ysabeau+Office:wght@400;500;600;700', 'Spectral:ital,wght@0,300;0,400;0,600;1,400'],
  },
  {
    id: 'graphite', name: 'Графит', mood: 'Современный рабочий инструмент',
    about: 'Нейтральный графит без оттенков, волосяные линии, плотная вёрстка, один электрический синий акцент — как профессиональный редактор. Максимально нейтральный фон для чужих картинок и текстов.',
    fonts: 'Onest (интерфейс и заголовки) · Literata (статьи)', swatch: ['#0a0a0b', '#4c8dff', '#ededef'],
    families: ['Onest:wght@400;500;600;700', 'Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400'],
  },
  // ---------- the second set: other directions entirely ----------
  {
    id: 'neon', startsSet: 'Смелые и необычные', name: 'Неон', mood: 'Киберпанк и синтвейв',
    about: 'Чёрный фон с неоновой сеткой, пурпурный и бирюзовый с свечением, срезанные углы у кнопок и карточек, моноширинные подписи. Для мира, где магия — это код.',
    fonts: 'Russo One (заголовки) · Exo 2 (интерфейс и статьи) · JetBrains Mono (подписи)', swatch: ['#07060d', '#ff2bd6', '#00f0ff'],
    families: ['Russo+One', 'Exo+2:ital,wght@0,400;0,500;0,600;0,700;1,400'],
  },
  {
    id: 'abyss', name: 'Бездна', mood: 'Глубоководье и биолюминесценция',
    about: 'Глубокий сине-зелёный океан, светящийся бирюзовый и коралловые искры, мягкие «пузырьковые» формы, волнистые подчёркивания заголовков, свет сверху как сквозь толщу воды.',
    fonts: 'Philosopher (заголовки) · Rubik (интерфейс) · Source Serif 4 (статьи)', swatch: ['#031117', '#2ee6c5', '#ff7a8a'],
    families: ['Philosopher:ital,wght@0,400;0,700;1,400', 'Rubik:wght@400;500;600;700', 'Source+Serif+4:ital,wght@0,400;0,600;1,400'],
  },
  {
    id: 'brutal', name: 'Брутализм', mood: 'Необрутализм: грубо и честно',
    about: 'Плоские блоки с толстыми светлыми рамками и жёсткими тенями без размытия, кислотно-жёлтый акцент, тяжёлые заголовки капслоком, моноширинный интерфейс. Дерзко и очень читаемо.',
    fonts: 'Rubik Mono One (заголовки) · IBM Plex Mono (интерфейс) · Golos Text (статьи)', swatch: ['#232323', '#e9ff32', '#f2f2ea'],
    families: ['Rubik+Mono+One', 'IBM+Plex+Mono:wght@400;500;600', 'Golos+Text:wght@400;500;600'],
  },
  {
    id: 'pixel', name: 'Пиксель', mood: 'Ретро-JRPG',
    about: 'Окна как в консольных ролевых играх: синие панели с белой рамкой, пиксельный шрифт заголовков, курсор ▶ у выбранного пункта, звёздное небо из пикселей. Ностальгия по 16 битам.',
    fonts: 'Press Start 2P (заголовки) · PT Mono (интерфейс) · PT Sans (статьи)', swatch: ['#0b0d1f', '#2b3cab', '#ffe066'],
    families: ['Press+Start+2P', 'PT+Mono', 'PT+Sans:ital,wght@0,400;0,700;1,400'],
  },
  {
    id: 'glass', name: 'Витраж', mood: 'Готический собор',
    about: 'Тёмный камень и цветной свет сквозь витражи: рубин, сапфир, изумруд, толстые «свинцовые» рамки, стрельчатая арка у шапки статьи, старославянский шрифт заголовков.',
    fonts: 'Ruslan Display (большие заголовки) · EB Garamond (статьи и подзаголовки) · Commissioner (интерфейс)', swatch: ['#0a0709', '#e0284f', '#2f6bff'],
    families: ['Ruslan+Display', 'EB+Garamond:ital,wght@0,400;0,500;0,600;1,400', 'Commissioner:wght@400;500;600;700'],
  },
  {
    id: 'chalk', name: 'Мел', mood: 'Доска мастера',
    about: 'Сланцевая доска с меловой пылью, рамки «от руки», рукописные заголовки, цветные мелки — жёлтый, розовый, голубой. Как записи мастера между сессиями.',
    fonts: 'Caveat (заголовки) · Jost (интерфейс) · Alice (статьи)', swatch: ['#1c2823', '#ffe27a', '#ff9ec7'],
    families: ['Caveat:wght@500;700', 'Jost:wght@400;500;600', 'Alice'],
  },
  // ---------- the third set: muted colours, bookish serif type with a fantasy feel ----------
  {
    id: 'candle', startsSet: 'Приглушённые, книжные шрифты', name: 'Свеча', mood: 'Скрипторий при свечах',
    about: 'Тёплая умбра, приглушённая латунь, мягкий свет свечи в углу экрана. Заголовки — Cormorant, весь остальной текст, даже кнопки, — Lora, подписи разделов капителью. Буквица и флерон ❧ в статьях. Спокойный «книжный» вариант нынешнего вида сайта.',
    fonts: 'Cormorant Garamond (заголовки) · Lora (статьи и интерфейс) · Cormorant SC (подписи)', swatch: ['#14110d', '#b89a66', '#e6dac4'],
    families: ['Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500', 'Cormorant+SC:wght@500;600', 'Lora:ital,wght@0,400;0,500;0,600;0,700;1,400'],
  },
  {
    id: 'stone', name: 'Камень', mood: 'Северная крепость',
    about: 'Холодный серый камень с зернистой фактурой, патина вместо яркого акцента, будто выбитые в камне заголовки, фаски у карточек и кнопок, подписи капителью. Сурово, но не мрачно.',
    fonts: 'Merriweather (заголовки и статьи) · Spectral SC (подписи) · Source Sans 3 (интерфейс)', swatch: ['#101214', '#8aa59c', '#dde1e0'],
    families: ['Merriweather:ital,wght@0,400;0,700;1,400', 'Spectral+SC:wght@500;600', 'Source+Sans+3:wght@400;500;600;700'],
  },
  {
    id: 'heather', name: 'Вереск', mood: 'Пустошь в тумане',
    about: 'Сливово-серые сумерки, пыльный лиловый вереск и шалфей, туман у нижнего края, мягкие скругления, курсивные заголовки. Лирично и тихо.',
    fonts: 'Playfair Display (заголовки) · Piazzolla (статьи) · Raleway (интерфейс)', swatch: ['#141216', '#a98ba6', '#8fa08a'],
    families: ['Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500', 'Piazzolla:ital,wght@0,400;0,600;0,700;1,400', 'Raleway:wght@400;500;600;700'],
  },
  {
    id: 'velvet', name: 'Бархат', mood: 'Двор при свечах',
    about: 'Тёмное вино и старое золото: винные главные кнопки с золотой нитью, золотые волосяные линии, портрет в двойном кольце, статьи крупным Cormorant. Роскошно, но приглушённо.',
    fonts: 'Prata (заголовки) · Cormorant Garamond (статьи) · Arsenal (интерфейс)', swatch: ['#150e11', '#7a3b4b', '#c2a27b'],
    families: ['Prata', 'Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500', 'Arsenal:wght@400;700'],
  },
  {
    id: 'chronicle', name: 'Летопись', mood: 'Старинная хроника',
    about: 'Выцветшие чернила на тёмном, киноварь для первых букв и подзаголовков (как рубрики в летописях), двойные типографские рамки, красная линия поля в статье, заголовки по центру. Старая русская книжная школа.',
    fonts: 'Old Standard TT (заголовки и статьи) · PT Sans (интерфейс)', swatch: ['#121210', '#b0644f', '#e0d9c6'],
    families: ['Old+Standard+TT:ital,wght@0,400;0,700;1,400', 'PT+Sans:ital,wght@0,400;0,700;1,400'],
  },
  {
    id: 'dusk', name: 'Сумерки', mood: 'Последний свет над горизонтом',
    about: 'Индиго сверху и тёплое свечение у нижнего края экрана, пепельно-лавандовый акцент, тонкие контрастные заголовки, подчёркивания с переходом от заката к ночи. Элегантно и спокойно.',
    fonts: 'Noto Serif Display (заголовки) · Gentium Book Plus (статьи) · Mulish (интерфейс)', swatch: ['#101118', '#9ca2cd', '#c9b48a'],
    families: ['Noto+Serif+Display:ital,wght@0,300;0,400;0,500;1,400', 'Gentium+Book+Plus:ital,wght@0,400;0,700;1,400', 'Mulish:wght@400;600;700'],
  },
]

/** The Google Fonts stylesheet for these css2 families. */
export function fontsHref(families: string[]): string {
  return 'https://fonts.googleapis.com/css2?' + families.map((f) => 'family=' + f).join('&') + '&display=swap'
}
/** Fonts of all the themes (the design lab and the theme picker): a few stylesheets, six themes each. */
export const ALL_FONTS: string[] = (() => {
  const out: string[] = []
  for (let i = 0; i < DESIGNS.length; i += 6) out.push(fontsHref([...new Set(DESIGNS.slice(i, i + 6).flatMap((d) => d.families))]))
  return out
})()
export function designById(id: string | null | undefined): Design | undefined {
  return id ? DESIGNS.find((d) => d.id === id) : undefined
}
