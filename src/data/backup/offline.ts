// Human-readable offline copy of a world, stored in the backup ZIP under html/.
// Opens from disk without the app: html/index.html lists every article, each article is
// html/<type>/<slug>-<id>.html, images are taken from ../../images/<id>.<ext>.
import { sanitize } from '@/data/html'
import { escapeHtml, slugify } from '@/data/util'
import { BUILTIN_TYPES, customTypeDef, type EntityTypeDef } from '@/model/entityTypes'
import type {
  Attribute, CustomType, Entity, EntityAbility, InventoryRow, MapMarker, OrgMembership, Post, QuestElement, Relation,
  Reminder, TimelineElement, TimelineEra, Visibility,
} from '@/model/types'

export interface OfflineInput {
  worldName: string
  worldDescription?: string
  exportedAt: number
  customTypes: CustomType[]
  entities: Entity[]
  /** entityId → article HTML (readable copy, or the master's full text when includeSecrets). */
  texts: Map<string, string>
  privateAttrs: Map<string, Attribute[]>
  rows: {
    posts: Post[]
    relations: Relation[]
    orgMembers: OrgMembership[]
    inventory: InventoryRow[]
    entityAbilities: EntityAbility[]
    questElements: QuestElement[]
    reminders: Reminder[]
    timelineEras: TimelineEra[]
    timelineElements: TimelineElement[]
    mapMarkers: MapMarker[]
  }
  /** imageId → path inside the ZIP (images/<id>.<ext>). */
  imageFiles: Map<string, string>
  includeSecrets: boolean
}

const VIS_LABEL: Record<Visibility, string> = { public: 'Публично', members: 'Участники', custom: 'Выбранные игроки', master: 'Только мастер' }
const STATUS_LABEL: Record<string, string> = { active: 'активен', inactive: 'неактивен', unknown: 'неизвестно' }
const REMINDER_LABEL: Record<string, string> = { event: 'событие', birth: 'рождение', death: 'смерть', other: 'дата' }

const CSS = `
:root{--bg:#f4f1ea;--surface:#fffdf8;--surface-2:#f1ece2;--text:#2a241c;--muted:#6f6556;--faint:#9b907f;--border:#ddd4c3;--accent:#8a5a14;--secret:#7c3aed;--danger:#b03a2e}
@media (prefers-color-scheme:dark){:root{--bg:#14120f;--surface:#1c1915;--surface-2:#24201b;--text:#ebe3d3;--muted:#a89d8a;--faint:#7a705f;--border:#3a332a;--accent:#e2bd62;--secret:#a78bfa;--danger:#e0685b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 'Lora','PT Serif',Georgia,serif}
a{color:var(--accent)}
header.top{position:sticky;top:0;z-index:5;background:var(--surface);border-bottom:1px solid var(--border);padding:10px 18px;font:14px/1.4 system-ui,sans-serif}
header.top a{text-decoration:none;font-weight:600}
main{max-width:920px;margin:0 auto;padding:24px 18px 64px}
h1,h2,h3,h4{font-family:'Cormorant Garamond','Lora',Georgia,serif;line-height:1.2;margin:1.2em 0 .45em}
h1{font-size:2.3em;margin:.1em 0 .2em}
.type{font:600 12px/1.4 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.hero{display:flex;gap:20px;align-items:flex-start;margin-bottom:12px}
.hero>img{width:170px;height:170px;object-fit:cover;border-radius:12px;border:1px solid var(--border);flex-shrink:0}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.badge{font:600 11.5px/1.6 system-ui,sans-serif;padding:1px 8px;border-radius:6px;background:var(--surface-2);color:var(--muted)}
.badge.secret{color:var(--secret)}.badge.dead{color:var(--danger)}
.facts{width:100%;border-collapse:collapse;margin:10px 0 18px;font:14px/1.5 system-ui,sans-serif;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.facts th{text-align:left;width:32%;color:var(--muted);font-weight:600;vertical-align:top}
.facts th,.facts td{padding:7px 12px;border-bottom:1px solid var(--border)}
.facts tr:last-child th,.facts tr:last-child td{border-bottom:0}
.facts tr.section th{background:var(--surface-2);color:var(--text);text-transform:uppercase;font-size:12px;letter-spacing:.06em}
.facts tr.private th{color:var(--secret)}
.swatch{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:middle;margin-right:6px;border:1px solid var(--border)}
dl.pairs{margin:0}dl.pairs dt{font-weight:600}dl.pairs dd{margin:0 0 4px 0}
.prose{overflow-wrap:break-word}.prose::after{content:'';display:block;clear:both}
.prose img{max-width:100%;height:auto;border-radius:6px}
.prose table{border-collapse:collapse;margin:1em 0}.prose td,.prose th{border:1px solid var(--border);padding:4px 8px}
.prose blockquote{border-left:3px solid var(--border);margin:1em 0;padding:.2em 1em;color:var(--muted)}
.prose pre{background:var(--surface-2);padding:10px;border-radius:8px;overflow:auto}
.wiki-img{display:inline-block;max-width:100%;vertical-align:bottom;line-height:1.3}
.wiki-img img{display:block;width:100%;height:auto}
.wiki-img:not([style*='width']) img{width:auto;max-width:100%;margin:0 auto}
.wiki-img[data-align='center']{display:block;margin:.8em auto;text-align:center}
.wiki-img[data-align='full']{display:block;width:100%!important;margin:.8em 0}
.wiki-img[data-align='left']{float:left;margin:.3em 1.2em .6em 0;max-width:60%}
.wiki-img[data-align='right']{float:right;margin:.3em 0 .6em 1.2em;max-width:60%}
.wiki-img-cap{display:block;font-size:.82em;color:var(--muted);font-style:italic;text-align:center;padding-top:.3em}
.img-missing{display:inline-block;padding:6px 10px;border:1px dashed var(--border);color:var(--faint);font:13px system-ui,sans-serif;border-radius:6px}
[data-callout]{border-left:4px solid var(--accent);background:var(--surface-2);padding:.5em 1em;border-radius:6px;margin:1em 0}
[data-columns]{display:grid;grid-template-columns:repeat(var(--cols,2),minmax(0,1fr));gap:1.4em;margin:1em 0}
[data-columns='3']{--cols:3}[data-columns='4']{--cols:4}
@media (max-width:720px){[data-columns]{grid-template-columns:1fr}.hero{flex-direction:column}}
.secret-block{border:1px dashed var(--secret);border-radius:8px;padding:.3em 1em;margin:1em 0}
.secret-block::before{content:'Секрет мастера';display:block;font:700 11px/2 system-ui,sans-serif;color:var(--secret);text-transform:uppercase;letter-spacing:.06em}
a.mention{text-decoration:none;border-bottom:1px solid currentColor}
.mention-missing{color:var(--muted);border-bottom:1px dotted var(--muted)}
.post{border:1px solid var(--border);border-radius:10px;padding:2px 18px 10px;margin:18px 0;background:var(--surface)}
.post>h3{margin-top:.7em}
.list{list-style:none;padding:0;margin:0 0 10px;font:14.5px/1.5 system-ui,sans-serif}
.list li{padding:5px 0;border-bottom:1px solid var(--border)}
.list .muted,.muted{color:var(--muted)}
.small{font-size:13px}
.index-type{margin:28px 0 8px}
.index-list{columns:2 260px;list-style:none;padding:0;margin:0;font:15px/1.6 system-ui,sans-serif}
.index-list li{break-inside:avoid;padding:2px 0}
.index-list .muted{font-size:12.5px}
#q{width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font:15px system-ui,sans-serif;margin:8px 0 6px}
footer{max-width:920px;margin:0 auto;padding:0 18px 30px;color:var(--faint);font:12.5px system-ui,sans-serif}
`

const INDEX_JS = `
const q=document.getElementById('q');
q&&q.addEventListener('input',()=>{const v=q.value.trim().toLowerCase().replace(/ё/g,'е');
document.querySelectorAll('.index-list li').forEach(li=>{li.style.display=!v||li.dataset.n.includes(v)?'':'none'});
document.querySelectorAll('section.index-type').forEach(s=>{s.style.display=[...s.querySelectorAll('li')].some(li=>li.style.display!=='none')?'':'none'})});
`

const builtinDefs = new Map(BUILTIN_TYPES.map((t) => [t.key, t]))
const ORDER = BUILTIN_TYPES.map((t) => t.key)

function typeDirName(type: string): string {
  return type.replace(/[^a-zA-Z0-9_-]/g, '_') || 'other'
}

export function offlinePagePath(e: Pick<Entity, 'id' | 'type' | 'name'>): string {
  return `html/${typeDirName(e.type)}/${slugify(e.name)}-${e.id}.html`
}

function groupBy<T>(rows: T[], key: (r: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    if (!k) continue
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(r)
  }
  return m
}

const byOrder = (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0) || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ru')
const byName = (a: Entity, b: Entity) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base', numeric: true })

function page(title: string, worldName: string, homeHref: string, body: string, exportedAt: number, extraHead = ''): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${CSS}</style>${extraHead}</head>
<body><header class="top"><a href="${homeHref}">← ${escapeHtml(worldName)}</a></header>
<main>${body}</main>
<footer>Офлайн-копия Dezremon Wiki · экспортировано ${escapeHtml(new Date(exportedAt).toLocaleString('ru-RU'))}</footer>
</body></html>`
}

/** Builds every page of the offline copy: path inside the ZIP → HTML text. */
export function buildOfflineSite(input: OfflineInput): Map<string, string> {
  const out = new Map<string, string>()
  const customDefs = new Map(input.customTypes.map((c) => [c.key, customTypeDef(c)]))
  const defOf = (type: string): EntityTypeDef => builtinDefs.get(type) ?? customDefs.get(type) ?? {
    key: type, label: type, plural: type, acc: type, icon: '', color: '#888', kindPlaceholder: '', parentLabel: 'Родитель', fields: [], features: [],
  }
  const live = input.entities.filter((e) => !e.deleted)
  const byId = new Map(live.map((e) => [e.id, e]))
  const pagePath = new Map(live.map((e) => [e.id, offlinePagePath(e)]))
  const children = groupBy(live, (e) => e.parentId)
  const tagged = new Map<string, Entity[]>()
  const backlinks = new Map<string, Entity[]>()
  for (const e of live) {
    for (const t of e.tagIds ?? []) { if (!tagged.has(t)) tagged.set(t, []); tagged.get(t)!.push(e) }
    for (const m of e.mentions ?? []) { if (m === e.id) continue; if (!backlinks.has(m)) backlinks.set(m, []); backlinks.get(m)!.push(e) }
  }
  const r = input.rows
  const alive = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((x) => !x.deleted)
  const posts = groupBy(alive(r.posts), (x) => x.entityId)
  const relations = alive(r.relations)
  const relOut = groupBy(relations, (x) => x.sourceId)
  const relIn = groupBy(relations, (x) => x.targetId)
  const orgByOrg = groupBy(r.orgMembers, (x) => x.organisationId)
  const orgByChar = groupBy(r.orgMembers, (x) => x.characterId)
  const inventory = groupBy(r.inventory, (x) => x.ownerId)
  const abilities = groupBy(r.entityAbilities, (x) => x.entityId)
  const questEls = groupBy(r.questElements, (x) => x.questId)
  const remByEntity = groupBy(r.reminders, (x) => x.entityId)
  const remByCal = groupBy(r.reminders, (x) => x.calendarId)
  const eras = groupBy(r.timelineEras, (x) => x.timelineId)
  const tlEls = groupBy(r.timelineElements, (x) => x.timelineId)
  const markers = groupBy(r.mapMarkers, (x) => x.mapId)

  // From an article page every other page is ../<type>/<file>, images are ../../images/<file>.
  const linkFromPage = (id: string | null | undefined, label?: string): string => {
    if (!id) return ''
    const e = byId.get(id)
    if (!e) return label ? escapeHtml(label) : '<span class="mention-missing">[нет доступа]</span>'
    return `<a href="../${pagePath.get(id)!.slice('html/'.length)}">${escapeHtml(label || e.name)}</a>`
  }
  const imgFromPage = (id: string | null | undefined): string | null => {
    if (!id) return null
    const p = input.imageFiles.get(id)
    return p ? `../../${p}` : null
  }

  function rewrite(html: string): string {
    if (!html) return ''
    const doc = new DOMParser().parseFromString(`<body>${sanitize(html)}</body>`, 'text/html')
    doc.querySelectorAll('[data-secret]').forEach((n) => {
      if (input.includeSecrets) n.classList.add('secret-block')
      else n.remove()
    })
    doc.querySelectorAll('[data-entity-id]').forEach((n) => {
      const id = n.getAttribute('data-entity-id') ?? ''
      const e = byId.get(id)
      const text = n.textContent || e?.name || ''
      if (e) {
        const a = doc.createElement('a')
        a.className = 'mention'
        a.setAttribute('href', `../${pagePath.get(id)!.slice('html/'.length)}`)
        a.textContent = text
        n.replaceWith(a)
      } else {
        const s = doc.createElement('span')
        s.className = 'mention-missing'
        s.textContent = text || '[нет доступа]'
        n.replaceWith(s)
      }
    })
    doc.querySelectorAll('img[data-image-id]').forEach((img) => {
      const src = imgFromPage(img.getAttribute('data-image-id'))
      if (src) {
        img.setAttribute('src', src)
        img.setAttribute('loading', 'lazy')
      } else {
        const s = doc.createElement('span')
        s.className = 'img-missing'
        s.textContent = img.getAttribute('alt') || 'изображение недоступно'
        img.replaceWith(s)
      }
    })
    return doc.body.innerHTML
  }

  function fieldValue(kind: string, v: any): string {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return ''
    switch (kind) {
      case 'bool': return v ? 'Да' : ''
      case 'entity': return linkFromPage(String(v))
      case 'entities': return (Array.isArray(v) ? v : [v]).map((id) => linkFromPage(String(id))).filter(Boolean).join(', ')
      case 'pairs': {
        if (!Array.isArray(v)) return escapeHtml(String(v))
        const items = v.filter((p: any) => p && (p.name || p.value))
        if (!items.length) return ''
        return `<dl class="pairs">${items.map((p: any) => `<dt>${escapeHtml(String(p.name ?? ''))}</dt><dd>${escapeHtml(String(p.value ?? ''))}</dd>`).join('')}</dl>`
      }
      case 'color': return `<span class="swatch" style="background:${escapeHtml(String(v))}"></span>${escapeHtml(String(v))}`
      default: return typeof v === 'object' ? '' : escapeHtml(String(v))
    }
  }

  function calendarSummary(c: any): string {
    if (!c || typeof c !== 'object') return ''
    const months: any[] = Array.isArray(c.months) ? c.months : []
    const cur = c.current ?? {}
    const rows: string[] = []
    if (cur.year !== undefined) {
      const mName = months[(Number(cur.month) || 1) - 1]?.name ?? cur.month
      rows.push(`<tr><th>Текущая дата</th><td>${escapeHtml(`${cur.day ?? ''} ${mName ?? ''} ${cur.year}${c.suffix ? ' ' + c.suffix : ''}`)}</td></tr>`)
    }
    if (months.length) {
      rows.push(`<tr><th>Месяцы</th><td>${months.map((m) => escapeHtml(`${m.name} (${m.length}${m.intercalary ? ', вставной' : ''})`)).join(', ')}</td></tr>`)
    }
    if (Array.isArray(c.weekdays) && c.weekdays.length) rows.push(`<tr><th>Дни недели</th><td>${c.weekdays.map((w: string) => escapeHtml(String(w))).join(', ')}</td></tr>`)
    if (Array.isArray(c.moons) && c.moons.length) rows.push(`<tr><th>Луны</th><td>${c.moons.map((m: any) => escapeHtml(`${m.name} (${m.cycle} дн.)`)).join(', ')}</td></tr>`)
    if (Array.isArray(c.seasons) && c.seasons.length) rows.push(`<tr><th>Сезоны</th><td>${c.seasons.map((s: any) => escapeHtml(`${s.name} — ${s.day}.${s.month}`)).join(', ')}</td></tr>`)
    return rows.length ? `<h2>Календарь</h2><table class="facts">${rows.join('')}</table>` : ''
  }

  const visBadge = (v: Visibility | undefined) => (v && v !== 'members' && v !== 'public' ? ` <span class="badge secret">${VIS_LABEL[v]}</span>` : '')
  const list = (items: string[]) => (items.length ? `<ul class="list">${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : '')
  const section = (title: string, inner: string) => (inner ? `<h2>${escapeHtml(title)}</h2>${inner}` : '')

  function entityPage(e: Entity): string {
    const def = defOf(e.type)
    const parts: string[] = []
    const avatar = imgFromPage(e.imageId)
    const badges: string[] = [`<span class="badge">${escapeHtml(VIS_LABEL[e.visibility] ?? e.visibility)}</span>`]
    if (e.isTemplate) badges.push('<span class="badge">Шаблон</span>')
    if (e.fields?.isDead) badges.push('<span class="badge dead">Мёртв(а)</span>')
    if (e.fields?.isCompleted) badges.push('<span class="badge">Завершён</span>')
    parts.push(`<div class="hero">${avatar ? `<img src="${avatar}" alt="">` : ''}<div>
<div class="type">${escapeHtml(def.label)}${e.kind ? ' · ' + escapeHtml(e.kind) : ''}</div>
<h1>${escapeHtml(e.name)}</h1>
${e.aliases?.length ? `<div class="muted small">Также известен как: ${e.aliases.map((a) => escapeHtml(a)).join(', ')}</div>` : ''}
<div class="badges">${badges.join('')}</div></div></div>`)

    const facts: string[] = []
    if (e.parentId) facts.push(`<tr><th>${escapeHtml(def.parentLabel || 'Родитель')}</th><td>${linkFromPage(e.parentId)}</td></tr>`)
    for (const f of def.fields) {
      const v = fieldValue(f.kind, e.fields?.[f.key])
      if (v) facts.push(`<tr><th>${escapeHtml(f.label)}</th><td>${v}</td></tr>`)
    }
    if (e.tagIds?.length) facts.push(`<tr><th>Теги</th><td>${e.tagIds.map((t) => linkFromPage(t)).filter(Boolean).join(', ')}</td></tr>`)
    if (e.links?.length) facts.push(`<tr><th>Ссылки</th><td>${e.links.map((l) => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.name || l.url)}</a>`).join(', ')}</td></tr>`)
    if (facts.length) parts.push(`<table class="facts">${facts.join('')}</table>`)

    const attrs = [...(e.attributes ?? []), ...(input.privateAttrs.get(e.id) ?? []).map((a) => ({ ...a, isPrivate: true }))]
    if (attrs.length) {
      const rows = attrs.map((a) => a.kind === 'section'
        ? `<tr class="section"><th colspan="2">${escapeHtml(a.name)}</th></tr>`
        : `<tr${a.isPrivate ? ' class="private"' : ''}><th>${escapeHtml(a.name)}${a.isPrivate ? ' 🔒' : ''}</th><td>${a.kind === 'checkbox' ? (a.value && a.value !== '0' && a.value !== 'false' ? '✔' : '—') : escapeHtml(a.value ?? '').replace(/\n/g, '<br>')}</td></tr>`)
      parts.push(`<h2>Атрибуты</h2><table class="facts">${rows.join('')}</table>`)
    }

    const myPosts = (posts.get(e.id) ?? []).sort(byOrder)
    const postHtml = (p: Post) => `<section class="post"><h3>${escapeHtml(p.title || 'Без названия')}${visBadge(p.visibility)}</h3><div class="prose">${rewrite(p.html)}</div></section>`
    parts.push(...myPosts.filter((p) => p.position === 'before').map(postHtml))
    const text = rewrite(input.texts.get(e.id) ?? '')
    if (text) parts.push(`<article class="prose">${text}</article>`)
    parts.push(...myPosts.filter((p) => p.position !== 'before').map(postHtml))

    if (e.type === 'calendar') parts.push(calendarSummary(e.fields?.calendar))
    if (e.type === 'map') {
      const mapImg = imgFromPage(e.fields?.mapImageId ?? e.imageId)
      if (mapImg) parts.push(`<h2>Карта</h2><p><a href="${mapImg}"><img src="${mapImg}" alt="" style="max-width:100%;border-radius:8px"></a></p>`)
      parts.push(section('Метки', list((markers.get(e.id) ?? []).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .map((m) => `${m.entityId ? linkFromPage(m.entityId, m.name || undefined) : escapeHtml(m.name || 'Метка')}${visBadge(m.visibility)}`))))
    }
    if (e.type === 'timeline') {
      const myEras = (eras.get(e.id) ?? []).sort(byOrder)
      const els = (tlEls.get(e.id) ?? []).sort(byOrder)
      const elHtml = (x: TimelineElement) => `<b>${escapeHtml(x.date || (x.year != null ? String(x.year) : ''))}</b> ${x.entityId ? linkFromPage(x.entityId, x.name || undefined) : escapeHtml(x.name)}${visBadge(x.visibility)}${x.html ? `<div class="prose">${rewrite(x.html)}</div>` : ''}`
      const blocks: string[] = []
      for (const era of myEras) {
        const inEra = els.filter((x) => x.eraId === era.id)
        const range = [era.startYear, era.endYear].filter((y) => y != null).join(' — ')
        blocks.push(`<h3>${escapeHtml(era.name)}${era.abbreviation ? ` (${escapeHtml(era.abbreviation)})` : ''}${range ? ` <span class="muted small">${escapeHtml(range)}</span>` : ''}</h3>${era.html ? `<div class="prose">${rewrite(era.html)}</div>` : ''}${list(inEra.map(elHtml))}`)
      }
      const loose = els.filter((x) => !x.eraId || !myEras.some((er) => er.id === x.eraId))
      if (loose.length) blocks.push(list(loose.map(elHtml)))
      parts.push(section('Хронология', blocks.join('')))
    }
    parts.push(section('Участники', list((orgByOrg.get(e.id) ?? []).sort(byOrder)
      .map((m) => `${linkFromPage(m.characterId)}${m.role ? ` — ${escapeHtml(m.role)}` : ''} <span class="muted">${STATUS_LABEL[m.status] ?? ''}</span>`))))
    parts.push(section('Организации', list((orgByChar.get(e.id) ?? [])
      .map((m) => `${linkFromPage(m.organisationId)}${m.role ? ` — ${escapeHtml(m.role)}` : ''} <span class="muted">${STATUS_LABEL[m.status] ?? ''}</span>`))))
    parts.push(section('Квест: элементы', list((questEls.get(e.id) ?? []).sort(byOrder)
      .map((q) => `${q.entityId ? linkFromPage(q.entityId, q.name || undefined) : escapeHtml(q.name)}${q.role ? ` — ${escapeHtml(q.role)}` : ''}${visBadge(q.visibility)}${q.html ? `<div class="prose">${rewrite(q.html)}</div>` : ''}`))))
    parts.push(section('Инвентарь', list((inventory.get(e.id) ?? []).sort(byOrder)
      .map((i) => `${i.itemId ? linkFromPage(i.itemId, i.name || undefined) : escapeHtml(i.name)} × ${i.amount}${i.group ? ` <span class="muted">[${escapeHtml(i.group)}]</span>` : ''}${i.isEquipped ? ' <span class="badge">надето</span>' : ''}${i.description ? `<div class="muted small">${escapeHtml(i.description)}</div>` : ''}`))))
    parts.push(section('Способности', list((abilities.get(e.id) ?? []).sort(byOrder)
      .map((a) => `${linkFromPage(a.abilityId)}${a.charges ? ` <span class="muted">(${a.charges} зар.)</span>` : ''}${a.note ? `<div class="muted small">${escapeHtml(a.note)}</div>` : ''}`))))
    const calName = (id: string) => byId.get(id)?.name ?? ''
    const remText = (x: Reminder) => `${x.day}.${x.month}.${x.year}${x.isRecurring ? ' ↻' : ''} — ${REMINDER_LABEL[x.kind] ?? x.kind}`
    parts.push(section('Даты', list((remByEntity.get(e.id) ?? [])
      .map((x) => `${escapeHtml(remText(x))}${x.name ? ` «${escapeHtml(x.name)}»` : ''} ${calName(x.calendarId) ? `<span class="muted">(${linkFromPage(x.calendarId)})</span>` : ''}${x.comment ? `<div class="muted small">${escapeHtml(x.comment)}</div>` : ''}`))))
    if (e.type === 'calendar') {
      parts.push(section('События календаря', list((remByCal.get(e.id) ?? []).sort((a, b) => a.year - b.year || a.month - b.month || a.day - b.day)
        .map((x) => `${escapeHtml(remText(x))} ${x.entityId ? linkFromPage(x.entityId) : escapeHtml(x.name)}`))))
    }
    const rels = [
      ...(relOut.get(e.id) ?? []).map((x) => `${escapeHtml(x.label || 'связь')} → ${linkFromPage(x.targetId)}${visBadge(x.visibility)}`),
      ...(relIn.get(e.id) ?? []).map((x) => `${escapeHtml(x.reverseLabel || x.label || 'связь')} → ${linkFromPage(x.sourceId)}${visBadge(x.visibility)}`),
    ]
    parts.push(section('Связи', list(rels)))
    parts.push(section('Вложенные статьи', list((children.get(e.id) ?? []).sort(byName).map((c) => linkFromPage(c.id)))))
    if (e.type === 'tag') parts.push(section('Статьи с тегом', list((tagged.get(e.id) ?? []).sort(byName).map((c) => linkFromPage(c.id)))))
    parts.push(section('Упоминается в', list((backlinks.get(e.id) ?? []).sort(byName).map((c) => linkFromPage(c.id)))))
    return page(`${e.name} — ${input.worldName}`, input.worldName, '../index.html', parts.join('\n'), input.exportedAt)
  }

  for (const e of live) out.set(pagePath.get(e.id)!, entityPage(e))

  // index
  const types = [...new Set(live.map((e) => e.type))].sort((a, b) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b)
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b)
  })
  const sections = types.map((t) => {
    const items = live.filter((e) => e.type === t).sort(byName)
    const lis = items.map((e) => `<li data-n="${escapeHtml(`${e.name} ${(e.aliases ?? []).join(' ')} ${e.kind}`.toLowerCase().replace(/ё/g, 'е'))}"><a href="${pagePath.get(e.id)!.slice('html/'.length)}">${escapeHtml(e.name)}</a>${e.kind ? ` <span class="muted">${escapeHtml(e.kind)}</span>` : ''}</li>`)
    return `<section class="index-type"><h2>${escapeHtml(defOf(t).plural)} <span class="muted small">${items.length}</span></h2><ul class="index-list">${lis.join('')}</ul></section>`
  })
  const indexBody = `<div class="type">Мир</div><h1>${escapeHtml(input.worldName)}</h1>
${input.worldDescription ? `<p class="muted">${escapeHtml(input.worldDescription)}</p>` : ''}
<p class="muted small">Статей: ${live.length}. Эта копия открывается без интернета и без приложения; для восстановления данных используйте сам ZIP-архив.</p>
<input id="q" type="search" placeholder="Фильтр по названию…" autocomplete="off">
${sections.join('\n')}`
  out.set('html/index.html', page(input.worldName, input.worldName, 'index.html', indexBody, input.exportedAt).replace('</body></html>', `<script>${INDEX_JS}</script></body></html>`))
  return out
}
