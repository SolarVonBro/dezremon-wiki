"""Map editing on desktop and on a phone, against the LOCAL EMULATORS (creates its own user there).
Regression for: choosing any tool in edit mode made the map image disappear (Vue's :class on the Leaflet container
wiped Leaflet's own classes), and tapping an existing pin in placing mode did nothing.
Checks every tool keeps the map visible; places a marker, a label, a circle, an area (clicks through the hint),
a marker on a pin / in a circle / in an area; opens the layers and groups dialogs.
Run: firebase emulators:start --only firestore,auth --project demo-dezremon
     MSYS_NO_PATHCONV=1 BASE_PATH=/ npx vite build --mode emulator && npx vite preview --port 4174
     python tests/e2e_map_edit.py <screens_dir>"""
import sys, os, json, random, urllib.request
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:4174/'
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
RUN = str(random.randint(1000, 9999))
ALL_FAILS = []
EMAIL = f'map{RUN}@example.com'
req = urllib.request.Request('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-dezremon/accounts', method='POST',
                             data=json.dumps({'email': EMAIL, 'password': 'secret123', 'displayName': 'Картограф'}).encode(),
                             headers={'Authorization': 'Bearer owner', 'Content-Type': 'application/json'})
urllib.request.urlopen(req).read()

SETUP = r"""async () => {
  const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia
  const world = pinia._s.get('world'), gallery = pinia._s.get('gallery')
  const c = document.createElement('canvas'); c.width = 1200; c.height = 800
  const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 1200, 800); g.addColorStop(0, '#3f6b3a'); g.addColorStop(1, '#a8c08a')
  x.fillStyle = g; x.fillRect(0, 0, 1200, 800); x.fillStyle = '#fff'; x.font = 'bold 90px sans-serif'; x.fillText('Карта', 400, 420)
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85))
  const [m] = await gallery.upload([new File([blob], 'map.jpg', { type: 'image/jpeg' })], { folder: 'maps' })
  const id = await world.createEntity('map', 'Карта побережья', { fields: { mapImageId: m.id } })
  for (let i = 0; i < 50 && world.pendingWrites > 0; i++) await new Promise((r) => setTimeout(r, 200))
  return id
}"""

IMGW = """() => { const i = document.querySelector('.dw-canvas img.leaflet-image-layer'); return i ? Math.round(i.getBoundingClientRect().width) : -1 }"""
STATE = """() => { const el = document.querySelector('.dw-canvas'); const r = el?.getBoundingClientRect();
  return { canvas: r ? [Math.round(r.width), Math.round(r.height)] : null, tiles: document.querySelectorAll('.dw-canvas .leaflet-image-layer, .dw-canvas img.leaflet-image-layer').length,
    imgs: [...document.querySelectorAll('.dw-canvas img')].map((i) => i.naturalWidth + 'x' + i.naturalHeight + ':' + getComputedStyle(i).display).slice(0, 3),
    stage: document.querySelector('.dw-stage') ? document.querySelector('.dw-stage').getBoundingClientRect().height : null,
    empty: !!document.querySelector('.dw-empty'), hint: document.querySelector('.dw-hint')?.innerText ?? null } }"""

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    for label, ctx_opts in [('desktop', {'viewport': {'width': 1366, 'height': 900}}), ('phone', {'viewport': {'width': 390, 'height': 844}, 'is_mobile': True, 'has_touch': True, 'device_scale_factor': 2})]:
        pg = b.new_context(**ctx_opts).new_page()
        errs = []
        pg.on('console', lambda m: errs.append(f'{m.type}: {m.text[:300]}') if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:500]))
        pg.goto(BASE + '#/login')
        pg.locator('input[type=email]').fill(EMAIL); pg.locator('input[type=password]').fill('secret123')
        pg.get_by_role('button', name='Войти', exact=True).click(); pg.wait_for_url('**/#/worlds**', timeout=20000)
        if label == 'desktop':
            pg.get_by_role('button', name='Новый мир').first.click()
            pg.locator('input[placeholder="Дезремон"]').fill('Картографы ' + RUN)
            pg.get_by_role('button', name='Создать мир').click()
            pg.wait_for_selector('.dash-hero h1', timeout=20000)
            wid = pg.url.split('/w/')[1].split('/')[0]
            pg.goto(BASE + f'#/w/{wid}/gallery'); pg.wait_for_timeout(2500)
            eids = [pg.evaluate(SETUP), pg.evaluate(SETUP)]
        eid = eids[0] if label == 'desktop' else eids[1]
        pg.goto(BASE + f'#/w/{wid}/e/{eid}')
        pg.wait_for_selector('.dw-canvas', timeout=20000); pg.wait_for_timeout(3000)
        print(f'[{label}] before edit:', pg.evaluate(STATE))
        pg.screenshot(path=os.path.join(OUT, f'{label}-1-view.png'))
        pg.locator('.dw-edit-toggle').click(); pg.wait_for_timeout(1500)
        print(f'[{label}] edit on:   ', pg.evaluate(STATE))
        pg.screenshot(path=os.path.join(OUT, f'{label}-2-edit.png'))
        fails = []
        def ok(cond, what):
            print(f'[{label}]', 'ok  ' if cond else 'FAIL', what, flush=True)
            if not cond: fails.append(what)
        def canvas_point(fx, fy):
            r = pg.locator('.dw-canvas').bounding_box()
            return r['x'] + r['width'] * fx, r['y'] + r['height'] * fy
        def click_map(fx, fy):
            x, y = canvas_point(fx, fy)
            if label == 'phone':
                print('   tap', round(x), round(y), 'hits', pg.evaluate(f"() => {{ const e = document.elementFromPoint({x}, {y}); return e ? e.tagName + '.' + String(e.className).slice(0, 80) : null }}"), 'scrollY', pg.evaluate('scrollY'))
                pg.touchscreen.tap(x, y)
            else: pg.mouse.click(x, y)
            pg.wait_for_timeout(500)
        def save_editor(name):
            try:
                pg.wait_for_selector('.dw-side.wide', state='attached', timeout=10000)
            except Exception:
                pg.screenshot(path=os.path.join(OUT, f'{label}-FAIL-open.png'), full_page=True)
                print('   hint:', pg.locator('.dw-hint').count(), 'side:', pg.locator('.dw-side').get_attribute('class'))
                raise
            pg.locator('.dw-side.wide input.input-sm').first.fill(name)
            try:
                pg.locator('.dw-side').get_by_role('button', name='Сохранить').click(timeout=8000)
            except Exception:
                pg.screenshot(path=os.path.join(OUT, f'{label}-FAIL-save.png'))
                print('   buttons in side:', pg.evaluate("() => [...document.querySelectorAll('.dw-side button')].map(b => (b.innerText || b.title).trim() + (b.disabled ? '[disabled]' : '') + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height))"))
                raise
            pg.wait_for_function("() => !document.querySelector('.dw-side.wide')", timeout=10000)
        w0 = pg.evaluate(IMGW)
        for title in ['Поставить маркер', 'Добавить подпись', 'Нарисовать круг', 'Нарисовать область по точкам', 'Выбор и перемещение меток']:
            pg.locator(f'.dw-tool[title="{title}"]').click(); pg.wait_for_timeout(600)
            ok(pg.evaluate(IMGW) == w0 and w0 > 100, f'map image stays visible with tool «{title}» ({pg.evaluate(IMGW)} px)')
            ok('leaflet-container' in (pg.locator('.dw-canvas').get_attribute('class') or ''), 'Leaflet keeps its container classes')
        pg.screenshot(path=os.path.join(OUT, f'{label}-3-tools.png'))
        n0 = pg.locator('.dw-canvas .leaflet-marker-icon, .dw-canvas path.leaflet-interactive').count()
        pg.locator('.dw-tool[title="Поставить маркер"]').click(); click_map(0.3, 0.4); save_editor('Порт ' + label)
        pg.wait_for_timeout(800)
        pg.locator('.dw-tool[title="Поставить маркер"]').click()
        pin = pg.locator('.dw-canvas .leaflet-marker-icon').first.bounding_box()
        px, py = pin['x'] + pin['width'] / 2, pin['y'] + pin['height'] / 2
        if label == 'phone': pg.touchscreen.tap(px, py)
        else: pg.mouse.click(px, py)
        pg.wait_for_timeout(600)
        ok(pg.locator('.dw-side.wide').count() == 1, 'tapping right on an existing pin in marker mode places the new marker there')
        save_editor('Причал ' + label)
        pg.locator('.dw-tool[title="Добавить подпись"]').click(); click_map(0.6, 0.3); save_editor('Море ' + label)
        pg.locator('.dw-tool[title="Нарисовать круг"]').click(); click_map(0.5, 0.6); save_editor('Лес ' + label)
        pg.wait_for_timeout(800)
        pg.locator('.dw-tool[title="Поставить маркер"]').click(); click_map(0.5, 0.6)   # right in the middle of the circle
        ok(pg.locator('.dw-side.wide').count() == 1, 'a marker can be placed on top of an area/circle')
        save_editor('Хижина в лесу ' + label)
        pg.locator('.dw-tool[title="Нарисовать область по точкам"]').click()
        for fx, fy in [(0.12, 0.62), (0.3, 0.8), (0.12, 0.88)]: click_map(fx, fy)   # the last two under the hint: clicks pass through it
        click_map(0.12, 0.62)   # close on the first point
        save_editor('Болото ' + label)
        pg.wait_for_timeout(800)
        pg.locator('.dw-tool[title="Поставить маркер"]').click(); click_map(0.18, 0.76)   # inside the area
        ok(pg.locator('.dw-side.wide').count() == 1, 'a marker can be placed inside an area (polygon)')
        save_editor('Кочка ' + label)
        pg.wait_for_timeout(1000)
        n1 = pg.locator('.dw-canvas .leaflet-marker-icon, .dw-canvas path.leaflet-interactive').count()
        ok(n1 >= n0 + 7, f'all seven marks added ({n0} -> {n1})')
        ok(pg.locator('.dw-side', has_text='Болото ' + label).count() > 0 or pg.locator('text=Болото ' + label).count() > 0, 'new marks are listed')
        pg.locator('.dw-tool[title="Слои карты"]').click(); pg.wait_for_selector('.modal', timeout=8000)
        ok(pg.evaluate(IMGW) == w0, 'layers dialog opens, the map stays'); pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
        pg.locator('.dw-tool[title="Группы меток"]').click(); pg.wait_for_selector('.modal', timeout=8000)
        ok(True, 'groups dialog opens'); pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(OUT, f'{label}-4-marks.png'))
        print(f'[{label}] errors:', errs[:15])
        print(f'[{label}] FAILS:', fails)
        ALL_FAILS.extend(fails)
    b.close()
sys.exit(1 if ALL_FAILS else 0)
