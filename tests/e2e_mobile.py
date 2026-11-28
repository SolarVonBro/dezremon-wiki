"""Mobile layout audit, step 2/3 (fixture: tests/e2e_mobile_setup.py).
Usage: E2E_URL=<site url> python tests/e2e_mobile.py <work_dir> <out_dir> [width=360] [only-substring]
For every screen: full-page screenshot + automatic checks (page horizontal scroll, elements crossing the right edge
without a clipping ancestor, text squeezed into a narrow column, content overflowing its box). Builds contact sheets."""
import os, sys, json, html
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_URL', 'https://solarvonbro.github.io/dezremon-wiki/')
WORK, OUT = sys.argv[1], sys.argv[2]
W = int(sys.argv[3]) if len(sys.argv) > 3 else 360
ONLY = sys.argv[4] if len(sys.argv) > 4 else ''
os.makedirs(OUT, exist_ok=True)
fx = json.load(open(os.path.join(WORK, 'fixture.json'), encoding='utf-8'))
WURL = BASE + '#/w/' + fx['wid']

CHECK_JS = r"""
() => {
  const vw = document.documentElement.clientWidth
  const out = []
  const docW = document.documentElement.scrollWidth
  if (docW > vw + 1) out.push({ k: 'PAGE-HSCROLL', msg: `${docW} > ${vw}` })
  const desc = (el) => {
    let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id
    if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
    const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    return s + (t ? ` "${t}"` : '')
  }
  const visible = (el, cs) => cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity !== 0
  const cross = [], squeezed = [], content = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue
    const cs = getComputedStyle(el)
    if (!visible(el, cs)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (r.right > vw + 2 && r.left < vw - 2) {
      let a = el.parentElement, clipped = false
      while (a && a !== document.documentElement) {
        const o = getComputedStyle(a).overflowX
        if (o !== 'visible' && a.getBoundingClientRect().right <= vw + 2) { clipped = true; break }
        a = a.parentElement
      }
      if (!clipped) cross.push(el)
    }
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
    if (own.length >= 4) {
      const fs = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight) || fs * 1.3
      if (r.width < fs * 3.2 && r.height > lh * 2.5) squeezed.push(el)
    }
    if (cs.overflowX === 'visible' && cs.display !== 'inline' && el.tagName.toLowerCase() !== 'svg' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 4) content.push(el)
  }
  const deepest = (list) => list.filter((e) => !list.some((o) => o !== e && e.contains(o)))
  for (const e of deepest(cross)) out.push({ k: 'CROSS-RIGHT', msg: `+${Math.round(e.getBoundingClientRect().right - vw)}px ${desc(e)}` })
  for (const e of squeezed) out.push({ k: 'SQUEEZED', msg: `${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)} ${desc(e)}` })
  for (const e of deepest(content)) out.push({ k: 'CONTENT-OVERFLOW', msg: `${e.scrollWidth}>${e.clientWidth} ${desc(e)}` })
  return out
}
"""

e = lambda k, q='': f"{WURL}/e/{fx[k]}{q}"
PAGES = [
    ('worlds', BASE + '#/worlds'),
    ('account', BASE + '#/account'),
    ('dashboard', WURL),
    ('list-character', WURL + '/t/character'),
    ('list-location', WURL + '/t/location'),
    ('hero', e('hero')),
    ('hero-edit', e('hero', '?edit=1')),
    ('hero-family', e('hero', '?tab=feature')),
    ('hero-relations', e('hero', '?tab=relations')),
    ('hero-attributes', e('hero', '?tab=attributes')),
    ('hero-inventory', e('hero', '?tab=inventory')),
    ('hero-abilities', e('hero', '?tab=abilities')),
    ('hero-dates', e('hero', '?tab=dates')),
    ('hero-links', e('hero', '?tab=links')),
    ('hero-history', e('hero', '?tab=history')),
    ('longword', e('longWord')),
    ('longword-edit', e('longWord', '?edit=1')),
    ('location-header', e('loc')),
    ('location-header-edit', e('loc', '?edit=1')),
    ('org-members', e('org', '?tab=feature')),
    ('quest-elements', e('quest', '?tab=feature')),
    ('calendar', e('cal')),
    ('timeline', e('tl')),
    ('map', e('map')),
    ('conversation', e('conv', '?tab=feature')),
    ('dice', e('dice', '?tab=feature')),
    ('tag-tagged', e('tag', '?tab=feature')),
    ('item', e('item')),
    ('search', WURL + '/search'),
    ('graph', WURL + '/graph'),
    ('gallery', WURL + '/gallery'),
    ('settings-general', WURL + '/settings/general'),
    ('settings-members', WURL + '/settings/members'),
    ('settings-modules', WURL + '/settings/modules'),
    ('settings-usage', WURL + '/settings/usage'),
    ('settings-backup', WURL + '/settings/backup'),
    ('settings-trash', WURL + '/settings/trash'),
]


def settle(pg, ms=1800):
    pg.wait_for_timeout(ms)
    try:
        pg.wait_for_function("() => !document.querySelector('.content .spin, .empty .spin')", timeout=8000)
    except Exception:
        pass
    pg.wait_for_timeout(300)


report, shots = [], []


def check(pg, name, full=True):
    issues = pg.evaluate(CHECK_JS)
    path = os.path.join(OUT, f'{W}-{name}.png')
    pg.screenshot(path=path, full_page=full)
    shots.append((name, path))
    report.append((name, issues))
    print(f'[{name}]', 'OK' if not issues else '', flush=True)
    for i in issues[:25]:
        print('   ', i['k'], i['msg'], flush=True)


# interactions run on a page that is already open; each returns after opening something
def open_sidebar(pg):
    pg.goto(e('hero')); settle(pg); pg.locator('.topbar button[title="Меню"]').click(); pg.wait_for_timeout(500)
def hero_menu(pg):
    pg.goto(e('hero')); settle(pg); pg.locator('.entity-actions button[title="Ещё"]').click(); pg.wait_for_timeout(500)
def user_menu(pg):
    pg.goto(e('hero')); settle(pg); pg.locator('.topbar .mobile-only').last.locator('button').first.click(); pg.wait_for_timeout(500)
def eye_menu(pg):
    pg.goto(e('hero')); settle(pg); pg.locator('.topbar button[title^="Посмотреть мир"]').click(); pg.wait_for_timeout(500)
def preview_player(pg):
    eye_menu(pg); pg.get_by_role('button', name='Любой игрок').click(); settle(pg)
def create_modal(pg):
    pg.goto(e('hero')); settle(pg); pg.locator('.topbar button[title="Меню"]').click(); pg.wait_for_timeout(400)
    pg.locator('.sidebar').get_by_role('button', name='Создать', exact=True).click(); pg.wait_for_timeout(600)
def create_modal_type(pg):
    create_modal(pg); pg.locator('.type-tile', has_text='Персонаж').click(); pg.wait_for_timeout(600)
def settings_modal(pg):
    hero_menu(pg); pg.get_by_role('button', name='Доступ и настройки').click(); pg.wait_for_timeout(800)
def image_dialog(pg):
    hero_menu(pg); pg.locator('.menu-item', has_text='Изображение').first.click(); pg.wait_for_timeout(1200)
def crop_modal(pg):
    hero_menu(pg); pg.locator('.menu-item', has_text='Изображение').first.click(); pg.wait_for_timeout(1200)
def editor_slash(pg):
    pg.goto(e('hero', '?edit=1')); settle(pg, 2500)
    pg.locator('.wiki-editor').click(); pg.keyboard.press('Control+End'); pg.keyboard.press('Enter'); pg.keyboard.type('/'); pg.wait_for_timeout(700)
def editor_table(pg):
    pg.goto(e('hero', '?edit=1')); settle(pg, 2500)
    pg.locator('.wiki-editor td').first.click(); pg.wait_for_timeout(700)
def editor_selection(pg):
    pg.goto(e('hero', '?edit=1')); settle(pg, 2500)
    pg.locator('.wiki-editor p').first.dblclick(); pg.wait_for_timeout(700)
def quick_search(pg):
    pg.goto(e('hero')); settle(pg); pg.locator('.topbar button[title="Меню"]').click(); pg.wait_for_timeout(400)
    pg.locator('.sb-search input').fill('Гея'); pg.wait_for_timeout(900)
def list_filters(pg):
    pg.goto(WURL + '/t/character'); settle(pg)
    b = pg.locator('button', has_text='Фильтр')
    if b.count(): b.first.click(); pg.wait_for_timeout(600)
def list_table(pg):
    pg.goto(WURL + '/t/character'); settle(pg); pg.locator('button[title="Таблица"]').click(); pg.wait_for_timeout(700)
def lightbox(pg):
    pg.goto(e('hero')); settle(pg); pg.locator('.hero-avatar').click(); pg.wait_for_timeout(1500)
def relation_add(pg):
    pg.goto(e('hero', '?tab=relations')); settle(pg)
    b = pg.locator('button', has_text='Добавить')
    if b.count(): b.first.click(); pg.wait_for_timeout(700)
def timeline_add(pg):
    pg.goto(e('tl')); settle(pg)
    b = pg.locator('button', has_text='Событие')
    if b.count(): b.first.click(); pg.wait_for_timeout(700)
def calendar_add(pg):
    pg.goto(e('cal')); settle(pg)
    b = pg.locator('button', has_text='Напоминание')
    if b.count(): b.first.click(); pg.wait_for_timeout(700)
def member_invite(pg):
    pg.goto(WURL + '/settings/members'); settle(pg)
    b = pg.locator('button', has_text='Пригласить')
    if b.count(): b.first.click(); pg.wait_for_timeout(700)

ACTIONS = [
    ('sidebar-open', open_sidebar), ('hero-menu', hero_menu), ('user-menu', user_menu), ('eye-menu', eye_menu),
    ('create-modal', create_modal), ('create-modal-type', create_modal_type), ('settings-modal', settings_modal),
    ('image-dialog', image_dialog), ('crop-modal', crop_modal), ('editor-slash', editor_slash), ('editor-table', editor_table),
    ('editor-selection', editor_selection), ('quick-search', quick_search), ('list-filters', list_filters), ('list-table', list_table),
    ('lightbox', lightbox), ('relation-add', relation_add), ('timeline-add', timeline_add), ('calendar-add', calendar_add),
    ('member-invite', member_invite), ('preview-player', preview_player),
]

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(os.path.join(WORK, 'profile'), channel='chrome',
        viewport={'width': W, 'height': 780}, device_scale_factor=2, is_mobile=W < 700, has_touch=True)
    pg = ctx.pages[0] if ctx.pages else ctx.new_page()
    errs = []
    pg.on('pageerror', lambda x: errs.append('pageerror: ' + str(x)[:300]))
    pg.on('console', lambda m: errs.append(m.text[:300]) if m.type == 'error' else None)
    pg.on('dialog', lambda d: d.accept() if d.type == 'beforeunload' else d.dismiss())
    for name, url in PAGES:
        if ONLY and ONLY not in name: continue
        try:
            pg.goto(url); settle(pg)
            check(pg, name)
        except Exception as x:
            print(f'[{name}] FAILED', str(x)[:300], flush=True)
    for name, fn in ACTIONS:
        if ONLY and ONLY not in name: continue
        try:
            pg.goto('about:blank')
            fn(pg)
            check(pg, name, full=False)
            if pg.locator('.preview-banner button').count(): pg.locator('.preview-banner button').click(); pg.wait_for_timeout(300)
        except Exception as x:
            print(f'[{name}] FAILED', str(x)[:300], flush=True)
            try: pg.keyboard.press('Escape')
            except Exception: pass
    # make sure the preview mode does not stick
    try:
        pg.goto(e('hero')); settle(pg)
        if pg.locator('.preview-banner button').count(): pg.locator('.preview-banner button').click()
    except Exception: pass
    print('CONSOLE ERRORS:', *list(dict.fromkeys(errs))[:30], sep='\n  ')

    ctx.close()
    # contact sheets: 4 screens per sheet, each cropped to the first 1500 css px
    sb = p.chromium.launch(channel='chrome')
    per = 4
    for i in range(0, len(shots), per):
        group = shots[i:i + per]
        cells = ''.join(f'<figure><figcaption>{html.escape(n)}</figcaption><div class="c"><img src="file:///{pth.replace(os.sep, "/")}"></div></figure>' for n, pth in group)
        sheet = f'<html><body style="margin:0;background:#888;display:flex;gap:8px;padding:8px;font:14px sans-serif">{cells}</body><style>figure{{margin:0;width:{W}px}}figcaption{{background:#222;color:#fff;padding:2px 6px}}.c{{max-height:1500px;overflow:hidden;background:#fff}}img{{width:{W}px;display:block}}</style></html>'
        sp = os.path.join(OUT, f'sheet-{W}-{i // per:02d}.html')
        open(sp, 'w', encoding='utf-8').write(sheet)
        sg = sb.new_page(viewport={'width': per * (W + 8) + 8, 'height': 800}, device_scale_factor=1)
        sg.goto('file:///' + sp.replace(os.sep, '/')); sg.wait_for_timeout(300)
        sg.screenshot(path=sp.replace('.html', '.png'), full_page=True); sg.close()
    sb.close()
json.dump(report, open(os.path.join(OUT, f'report-{W}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
