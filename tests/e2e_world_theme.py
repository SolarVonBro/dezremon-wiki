"""World themes: the master picks one in the world settings; it shows on that world's pages only (for everyone who
   opens the world, over their own light/dark theme) and the reader's theme comes back outside the world.
   The old «Пергамент» user theme is gone (a saved one turns into «Светлая»). EMULATORS ONLY:
   firebase emulators:start --only firestore,auth --project demo-dezremon
   MSYS_NO_PATHCONV=1 BASE_PATH=/ npx vite build --mode emulator && npx vite preview --port 4174
   python tests/e2e_world_theme.py <screenshots dir> [theme ids to shoot on real pages, comma-separated]"""
import sys, os, json, random, urllib.request
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_URL', 'http://localhost:4174/')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'e2e-world-theme'
SHOOT = sys.argv[2].split(',') if len(sys.argv) > 2 else ['candle', 'chronicle', 'neon']
os.makedirs(OUT, exist_ok=True)
RUN = str(random.randint(1000, 9999))
EMAIL = f'theme{RUN}@example.com'
FS = 'http://127.0.0.1:8080/v1/projects/demo-dezremon/databases/(default)/documents'


def rest(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer owner', 'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req).read() or b'{}')


rest('POST', 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-dezremon/accounts',
     {'email': EMAIL, 'password': 'secret123', 'displayName': 'Мастер Тем'})

FAILS = []


def check(cond, what):
    print('ok  ' if cond else 'FAIL', what, flush=True)
    if not cond: FAILS.append(what)


SEED = r"""async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const world = pinia._s.get('world')
  const id = await world.createEntity('character', 'Арвен Тихая', { visibility: 'public' },
    '<p>Арвен родилась в деревне у кромки леса за год до начала войны.</p><h2>Юность</h2><p>В шестнадцать лет она ушла на юг.</p><blockquote><p>«Лес помнит тех, кто приходил с водой».</p></blockquote><hr><p>Подробнее — в журнале.</p>')
  await world.createEntity('location', 'Вельмор', { visibility: 'public' }, '<p>Город на семи холмах.</p>')
  for (let i = 0; i < 50 && world.pendingWrites > 0; i++) await new Promise((r) => setTimeout(r, 200))
  return id
}"""
ROOT = "() => ({ t: document.documentElement.getAttribute('data-theme'), w: document.documentElement.getAttribute('data-wtheme'), bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() })"


def theme_in_db(wid):
    d = rest('GET', f'{FS}/worlds/{wid}')
    v = d['fields']['settings']['mapValue']['fields'].get('theme', {})
    return v.get('stringValue')


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    ctx = b.new_context(viewport={'width': 1440, 'height': 960})
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: errs.append(f'{m.type}: {m.text[:300]}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:400]))

    print('== the old «Пергамент» theme turns into «Светлая»')
    pg.goto(BASE + '#/login')
    pg.evaluate("localStorage.setItem('dw.theme', 'parchment')")
    pg.reload(); pg.wait_for_selector('input[type=email]')
    check(pg.evaluate(ROOT)['t'] == 'light', f"saved parchment → light ({pg.evaluate(ROOT)})")
    pg.locator('input[type=email]').fill(EMAIL); pg.locator('input[type=password]').fill('secret123')
    pg.get_by_role('button', name='Войти', exact=True).click()
    pg.wait_for_url('**/#/worlds**', timeout=20000)
    pg.locator('.app-bar .user-btn').click()
    items = pg.locator('.menu .menu-item').all_inner_texts()
    check(not any('Пергамент' in t for t in items) and any('Светлая' in t for t in items), f'user menu: no «Пергамент» ({items})')
    pg.locator('.app-bar .user-btn').click(); pg.wait_for_timeout(200)

    print('== a new world has no theme: the reader\'s light theme')
    pg.get_by_role('button', name='Новый мир').first.click()
    pg.locator('input[placeholder="Дезремон"]').fill('Мир тем ' + RUN)
    pg.get_by_role('button', name='Создать мир').click()
    pg.wait_for_selector('.db-grid', timeout=20000)
    wid = pg.url.split('/w/')[1].split('/')[0].split('?')[0]
    r = pg.evaluate(ROOT)
    check(r['t'] == 'light' and r['w'] is None, f'world without a theme: light, no world theme ({r})')
    eid = pg.evaluate(SEED)

    print('== the master picks «Свеча» in the world settings')
    pg.goto(BASE + f'#/w/{wid}/settings/general'); pg.wait_for_selector('.wt-grid', timeout=15000)
    tiles = pg.locator('.wt-tile')
    check(tiles.count() == 19, f'19 tiles: no theme + 18 themes ({tiles.count()})')
    check(pg.locator('.wt-tile.on', has_text='Без темы мира').count() == 1, '«Без темы мира» is the current one')
    sets = pg.locator('.wt-set').all_inner_texts()
    check(len(sets) == 3, f'three sets with names ({sets})')
    prev_bg = pg.locator('.wt-prev[data-wtheme="chronicle"]').evaluate('(e) => getComputedStyle(e).backgroundColor')
    check(prev_bg == 'rgb(18, 18, 16)', f'a tile is painted by its own theme ({prev_bg})')
    pg.wait_for_timeout(1500)
    pg.screenshot(path=os.path.join(OUT, 't-1-picker-light.png'), full_page=True)
    pg.locator('.wt-tile:has(.wt-prev[data-wtheme="candle"])').click(); pg.wait_for_timeout(1200)
    r = pg.evaluate(ROOT)
    check(r['w'] == 'candle' and r['t'] == 'dark' and r['bg'] == '#14110d', f'applied at once: candle over dark ({r})')
    check(theme_in_db(wid) == 'candle', 'saved in the world settings')
    check(pg.locator('.wt-tile.on:has(.wt-prev[data-wtheme="candle"])').count() == 1, 'the tile is marked')
    fonts = pg.evaluate("() => [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href).filter((h) => h.includes('Cormorant+SC'))")
    check(len(fonts) >= 1, 'the theme\'s fonts are loaded')
    pg.screenshot(path=os.path.join(OUT, 't-2-picker-candle.png'), full_page=True)

    print('== on every page of the world')
    for name, url in [('overview', f'#/w/{wid}'), ('list', f'#/w/{wid}/t/character'), ('article', f'#/w/{wid}/e/{eid}'), ('gallery', f'#/w/{wid}/gallery')]:
        pg.goto(BASE + url); pg.wait_for_timeout(1200)
        r = pg.evaluate(ROOT)
        check(r['w'] == 'candle' and r['t'] == 'dark', f'{name}: candle ({r})')
    body_bg = pg.evaluate("getComputedStyle(document.body).backgroundColor")
    check(body_bg == 'rgba(0, 0, 0, 0)', f'the body lets the theme background through ({body_bg})')

    print('== the reader\'s text size still applies to articles')
    pg.goto(BASE + f'#/w/{wid}/e/{eid}'); pg.wait_for_selector('.prose', timeout=15000); pg.wait_for_timeout(800)
    fs17 = pg.locator('.article-card .prose').first.evaluate('(e) => getComputedStyle(e).fontSize')
    pg.evaluate("document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('session').textSize = 'xl'")
    pg.wait_for_timeout(300)
    fs21 = pg.locator('.article-card .prose').first.evaluate('(e) => getComputedStyle(e).fontSize')
    check(fs17 == '17px' and fs21 == '21px', f'article text follows the reader ({fs17} → {fs21})')
    pg.evaluate("document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('session').textSize = 'm'")

    print('== the user menu explains it; the reader\'s own choice does not break the world theme')
    pg.locator('.app-bar .user-btn').click()
    note = pg.locator('.menu .menu-note')
    check(note.count() == 1 and 'Свеча' in note.inner_text(), 'menu: «в этом мире действует тема мира «Свеча»»')
    pg.locator('.menu .menu-item', has_text='Тёмная').click(); pg.wait_for_timeout(300)
    r = pg.evaluate(ROOT)
    check(r['w'] == 'candle' and r['bg'] == '#14110d', f'reader switched to dark inside the world: still candle ({r})')
    pg.locator('.app-bar .user-btn').click()
    pg.locator('.menu .menu-item', has_text='Светлая').click(); pg.wait_for_timeout(300)
    check(pg.evaluate(ROOT)['w'] == 'candle', 'and back to light: still candle')

    print('== outside the world: the reader\'s light theme comes back')
    for name, url in [('worlds', '#/worlds'), ('account', '#/account'), ('campaigns', '#/campaigns')]:
        pg.goto(BASE + url); pg.wait_for_timeout(800)
        r = pg.evaluate(ROOT)
        check(r['w'] is None and r['t'] == 'light' and r['bg'] == '#f4f1ea', f'{name}: light, no world theme ({r})')
    pg.locator('.app-bar .user-btn').click()
    check(pg.locator('.menu .menu-note').count() == 0, 'menu outside the world: no note')
    pg.locator('.app-bar .user-btn').click(); pg.wait_for_timeout(200)
    pg.goto(BASE + f'#/w/{wid}'); pg.wait_for_timeout(1200)
    check(pg.evaluate(ROOT)['w'] == 'candle', 'back in the world: candle again')
    check(pg.evaluate(f"localStorage.getItem('dw.wtheme.{wid}')") == 'candle', 'remembered for the next visit')

    print('== a guest of the open world sees it too')
    pg.goto(BASE + f'#/w/{wid}/settings/general'); pg.wait_for_selector('.wt-grid', timeout=15000)
    pg.once('dialog', lambda d: d.accept())   # «Открыть мир для гостей?»
    pg.locator('label.check', has_text='Открытый мир').locator('input').check()
    pg.wait_for_timeout(1500)
    guest = b.new_context(viewport={'width': 1280, 'height': 900})
    gp = guest.new_page()
    gp.goto(BASE + f'#/w/{wid}/e/{eid}'); gp.wait_for_selector('.prose', timeout=20000); gp.wait_for_timeout(1000)
    r = gp.evaluate(ROOT)
    check(r['w'] == 'candle' and r['t'] == 'dark', f'guest: candle ({r})')
    gp.screenshot(path=os.path.join(OUT, 't-3-guest-candle.png'))
    guest.close()

    print('== real pages in a few themes')
    for t in SHOOT:
        pg.goto(BASE + f'#/w/{wid}/settings/general'); pg.wait_for_selector('.wt-grid', timeout=15000)
        pg.locator(f'.wt-tile:has(.wt-prev[data-wtheme="{t}"])').click(); pg.wait_for_timeout(900)
        check(pg.evaluate(ROOT)['w'] == t, f'switched to {t}')
        for name, url in [('article', f'#/w/{wid}/e/{eid}'), ('overview', f'#/w/{wid}')]:
            pg.goto(BASE + url); pg.wait_for_timeout(2200)
            pg.screenshot(path=os.path.join(OUT, f't-4-{t}-{name}.png'))

    print('== «Без темы мира» gives everyone their own theme back')
    pg.goto(BASE + f'#/w/{wid}/settings/general'); pg.wait_for_selector('.wt-grid', timeout=15000)
    pg.locator('.wt-tile', has_text='Без темы мира').click(); pg.wait_for_timeout(1000)
    r = pg.evaluate(ROOT)
    check(r['w'] is None and r['t'] == 'light', f'no world theme: light again ({r})')
    check(theme_in_db(wid) is None, 'cleared in the world settings')
    check(pg.evaluate(f"localStorage.getItem('dw.wtheme.{wid}')") is None, 'the remembered theme is forgotten')

    real = [e for e in errs if 'favicon' not in e]
    check(not real, f'no console errors ({real[:5]})')
    b.close()

print('\nFAILED:' if FAILS else '\nALL OK', *FAILS, sep='\n  ')
sys.exit(1 if FAILS else 0)
