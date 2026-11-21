"""End-to-end test of the platform level against the LOCAL EMULATORS (never the live project):
portrait in the top bar, campaigns (world binding, journal, invite with world access), music rooms (sync between two
listeners, pause/seek, extra layer, chat, listener without control), service admin (lists, ban, config, foreign world).

Run:
  firebase emulators:start --only firestore,auth --project demo-dezremon      (Java 21+)
  MSYS_NO_PATHCONV=1 BASE_PATH=/ npx vite build --mode emulator && npx vite preview --port 4174
  python tests/e2e_platform.py <screens_dir>      (E2E_URL defaults to http://localhost:4174/)
"""
import os, sys, json, time, random, atexit, urllib.request
from playwright.sync_api import sync_playwright, expect

sys.stdout.reconfigure(encoding='utf-8')
BASE = os.environ.get('E2E_URL', 'http://localhost:4174/')
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)
AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-dezremon'
FS = 'http://127.0.0.1:8080/v1/projects/demo-dezremon/databases/(default)/documents'
ADMIN_UID = 'TRLvfuNmFtR9TByopvMl8yIG1jG2'
RUN = str(random.randint(1000, 9999))
VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
VIDEO2 = 'https://youtu.be/9bZkp7q19f0'
errors, fails = [], []
PROMPTS = []   # answers for the next prompt() dialogs
atexit.register(lambda: print('CONSOLE ERRORS (atexit):', *list(dict.fromkeys(errors))[:40], sep=chr(10) + '  '))


def rest(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer owner', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b'{}')


def mkuser(email, name, uid=None):
    body = {'email': email, 'password': 'secret123', 'displayName': name}
    if uid: body['localId'] = uid
    try: rest('POST', AUTH + '/accounts', body)
    except Exception as e: print('   (user exists?)', email, e)


def fs_docs(path):
    return rest('GET', f'{FS}/{path}').get('documents', [])


def step(s): print('->', s, flush=True)


def check(cond, what):
    print('   ' + ('ok  ' if cond else 'FAIL') + ' ' + what, flush=True)
    if not cond: fails.append(what)


def watch(pg, label):
    pg.on('console', lambda m: errors.append(f'[{label}] {m.text[:300]}') if m.type == 'error' and 'youtube' not in m.text.lower() and 'ERR_BLOCKED' not in m.text else None)
    pg.on('pageerror', lambda e: errors.append(f'[{label}] pageerror: {str(e)[:300]}'))
    pg.on('dialog', lambda d: d.accept(PROMPTS.pop(0) if d.type == 'prompt' and PROMPTS else '') if d.type == 'prompt' else d.accept())
    pg.on('requestfailed', lambda r: errors.append(f'[{label}] request failed: {r.url[:140]} {r.failure}') if 'youtube' not in r.url and 'google' not in r.url and 'ytimg' not in r.url and 'doubleclick' not in r.url else None)


def login(pg, email):
    pg.goto(BASE + '#/login')
    pg.locator('input[type=email]').fill(email)
    pg.locator('input[type=password]').fill('secret123')
    pg.get_by_role('button', name='Войти', exact=True).click()
    pg.wait_for_url('**/#/account**', timeout=20000)


def shot(pg, name, full=True): pg.screenshot(path=os.path.join(OUT, name + '.png'), full_page=full)


YT_TIME = """() => { const f = document.querySelector('.main-card iframe'); if (!f || !window.YT?.get) return null;
  const p = window.YT.get(f.id); return p && p.getCurrentTime ? { t: p.getCurrentTime(), s: p.getPlayerState(), r: p.getPlaybackRate(), id: f.id } : null }"""
LAYER_STATE = """() => { const f = document.querySelector('.layer iframe'); const p = f && window.YT?.get?.(f.id); return p && p.getPlayerState ? p.getPlayerState() : null }"""

GM, PL = f'gm{RUN}@example.com', f'pl{RUN}@example.com'
mkuser(GM, 'Мастер Игры')
mkuser(PL, 'Игрок Один')
mkuser('admin@example.com', 'Админ Сервиса', ADMIN_UID)

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', args=['--autoplay-policy=no-user-gesture-required'])
    gm = b.new_context(viewport={'width': 1366, 'height': 900}).new_page(); watch(gm, 'gm')
    pl = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2).new_page(); watch(pl, 'player')

    step('GM: sign in, portrait in the hub top bar')
    login(gm, GM)
    check(gm.locator('.hub-top .user-btn').count() == 1, 'portrait button in the hub top bar')
    check(gm.locator('.hub-nav a', has_text='Кампейны').count() == 1 and gm.locator('.hub-nav a', has_text='Комнаты').count() == 1, 'hub nav has Кампейны and Комнаты')
    check(gm.locator('.hub-nav a', has_text='Админка').count() == 0, 'no admin link for a normal user')

    step('GM: create a world with a character')
    gm.get_by_role('button', name='Новый мир').first.click()
    gm.locator('input[placeholder="Дезремон"]').fill('Мир ' + RUN)
    gm.get_by_role('button', name='Создать мир').click()
    gm.wait_for_selector('.dash-hero h1', timeout=20000)
    wid = gm.url.split('/w/')[1].split('/')[0]
    check(gm.locator('.topbar .user-btn').count() == 1, 'portrait button in the world top bar')
    check(gm.locator('.sb-foot .user-btn').count() == 0, 'portrait no longer in the sidebar footer')
    gm.evaluate("""() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('world').createEntity('character', 'Аэлин Тарн', {})""")
    gm.goto(BASE + f'#/w/{wid}/settings')
    gm.wait_for_selector('.tabs .tab')
    check(gm.locator('.tabs .tab', has_text='Ресурсы').count() == 0, 'world settings have no "Ресурсы" tab any more')

    step('GM: new campaign from the world sidebar')
    gm.goto(BASE + f'#/w/{wid}')
    gm.locator('.sb-section-title', has_text='Кампейны').locator('a').click()
    gm.wait_for_selector('.modal input[placeholder="Тени над Вельмором"]')
    gm.wait_for_selector(f'.modal select option[value="{wid}"]', state='attached', timeout=15000)
    check(gm.locator('.modal select').first.input_value() == wid, 'world preselected in the new campaign form')
    gm.locator('.modal input[placeholder="Тени над Вельмором"]').fill('Тени над Вельмором')
    gm.locator('.modal textarea').fill('Городская интрига.\nВторая строка.')
    gm.locator('.modal').get_by_role('button', name='Создать кампейн').click()
    gm.wait_for_selector('.c-hero h1', timeout=20000)
    cid = gm.url.split('/c/')[1].split('/')[0].split('?')[0]
    check(gm.locator('.c-hero h1').inner_text() == 'Тени над Вельмором', 'campaign page opens')
    check(gm.locator('.c-meta a', has_text='Мир ' + RUN).count() == 1, 'campaign links to its world')

    step('GM: journal entry')
    gm.locator('.tabs .tab', has_text='Сессии').click()
    gm.get_by_role('button', name='Записать сыгранную сессию').click()
    gm.locator('input[placeholder="Засада у старой мельницы"]').fill('Пролог')
    gm.wait_for_selector('.wiki-editor', timeout=20000)
    gm.locator('.wiki-editor').click()
    gm.keyboard.type('Герои встретились в таверне. ')
    gm.get_by_role('button', name='Сохранить').click()
    gm.wait_for_selector('.sess h3:has-text("Пролог")', timeout=10000)
    check(gm.locator('.sess-body', has_text='Герои встретились').count() == 1, 'session saved and rendered')

    step('GM: invite with world access')
    gm.locator('.tabs .tab', has_text='Участники').click()
    gm.wait_for_selector('text=Заодно пустить в мир', timeout=10000)
    gm.get_by_role('button', name='Создать ссылку').click()
    gm.wait_for_selector('.inv-row', timeout=10000)
    inv = fs_docs(f'campaigns/{cid}/invites')[0]['fields']
    code = inv['code']['stringValue']
    check('stringValue' in inv.get('worldInviteCode', {}), 'campaign invite carries a world invite')

    step('Player (phone): join by link → campaign + world')
    login(pl, PL)
    pl.goto(BASE + f'#/cjoin/{cid}/{code}')
    pl.get_by_role('button', name='Вступить игроком').click()
    pl.wait_for_selector('.c-hero h1', timeout=20000)
    pl.wait_for_selector('.c-meta a[href*="/w/"]', timeout=20000)
    check(True, 'player sees the campaign and has access to its world')
    pl.locator('.tabs .tab', has_text='Сессии').click()
    pl.wait_for_selector('.sess h3:has-text("Пролог")', timeout=10000)
    check(pl.locator('button', has_text='Записать сыгранную сессию').count() == 0, 'player cannot write the journal')
    shot(pl, 'm-campaign-sessions')
    pl.locator('.tabs .tab', has_text='Участники').click()
    pl.wait_for_selector('.person')
    pl.locator('.person', has_text='Игрок Один').locator('button[title="Персонаж"]').click()
    pl.wait_for_selector('.modal .field')
    pl.locator('.modal input[placeholder="Аэлин Тарн"]').fill('Аэлин')
    pl.get_by_role('button', name='Сохранить').click()
    pl.wait_for_selector('.person:has-text("Аэлин")', timeout=10000)
    check(True, 'player set his character name')
    shot(pl, 'm-campaign-people')

    step('GM: room bound to the campaign')
    gm.goto(BASE + f'#/c/{cid}/rooms')
    gm.get_by_role('link', name='Новая комната').click()
    gm.wait_for_selector('.modal input[placeholder^="Таверна"]')
    gm.locator('.modal input[placeholder^="Таверна"]').fill('Таверна ' + RUN)
    gm.locator('.modal').get_by_role('button', name='Создать', exact=True).click()
    gm.wait_for_selector('.room-head h1', timeout=20000)
    rid = gm.url.split('/r/')[1].split('?')[0]
    gm.get_by_role('button', name='Подключиться').click()
    gm.wait_for_selector('.pls .switcher:has-text("Основной")', timeout=15000)
    check(True, 'a new room has the default playlist «Основной» open in the side panel')
    gm.locator('.s-add input').fill(VIDEO)
    gm.locator('.s-add form button').click()
    gm.wait_for_selector('.now-title:not(.faint)', timeout=20000)
    check('Never Gonna Give You Up' in gm.locator('.now-title').inner_text(), 'title fetched through oEmbed')
    gm.wait_for_selector('.pl-item', timeout=10000)
    check(gm.locator('.queue-card .q-item').count() == 1 and gm.locator('.pl-item').count() == 1, 'one add field put the video into the queue AND the open playlist')

    step('Player: joins the room, playback is in sync')
    pl.goto(BASE + f'#/c/{cid}/rooms')
    pl.wait_for_selector('.room-row', timeout=15000)
    pl.locator('.room-row').first.click()
    pl.wait_for_selector('.room-head h1', timeout=20000)
    check(pl.locator('.play-btn').is_disabled(), 'listener without control cannot press play/pause')
    pl.get_by_role('button', name='Подключиться').click()
    t_end = time.time() + 40
    a = c = None
    while time.time() < t_end:
        a, c = gm.evaluate(YT_TIME), pl.evaluate(YT_TIME)
        if a and c and a['s'] == 1 and c['s'] == 1 and a['t'] > 3: break
        time.sleep(1)
    print('   gm', a, 'player', c)
    check(bool(a and c and a['s'] == 1 and c['s'] == 1), 'both are playing')
    if a and c:
        a, c = gm.evaluate(YT_TIME), pl.evaluate(YT_TIME)
        check(abs(a['t'] - c['t']) < 2.0, f'positions agree within 2 s (diff {abs(a["t"] - c["t"]):.2f})')
    shot(pl, 'm-room', full=False)

    step('GM: pause and seek reach the player')
    gm.locator('.play-btn').click()
    time.sleep(3)
    st = pl.evaluate(YT_TIME)
    check(bool(st and st['s'] == 2), 'player paused after GM pause')
    gm.evaluate("""() => { const r = document.querySelector('.seek input'); r.value = 60; r.dispatchEvent(new Event('change')) }""")
    t0 = time.time()
    while time.time() - t0 < 10:
        st = pl.evaluate(YT_TIME)
        if st and abs(st['t'] - 60) < 2: break
        time.sleep(0.5)
    check(bool(st and abs(st['t'] - 60) < 2), f'player moved to 60 s after GM seek ({st and round(st["t"], 1)}, {time.time() - t0:.1f} s)')
    gm.locator('.play-btn').click()

    step('GM: extra layer track')
    gm.get_by_role('button', name='Дорожка', exact=True).click()
    gm.wait_for_selector('.layer', timeout=10000)
    gm.locator('.layer input[placeholder^="Ссылка YouTube для этой дорожки"]').fill(VIDEO2)
    gm.locator('.layer form button').click()
    gm.wait_for_selector('.layer .small.ellipsis:not(:has-text("Добавьте"))', timeout=20000)
    pl.wait_for_selector('.layer', timeout=15000)
    time.sleep(4)
    check(pl.locator('.layer iframe').count() == 1, 'player got the layer with its own player')
    shot(gm, 'd-room', full=False)

    step('Chat')
    pl.locator('.chat input').fill('Привет из таверны')
    try:
        pl.locator('.chat form button').click(timeout=15000)
    except Exception:
        shot(pl, 'FAIL-chat', full=True)
        print('   layout:', pl.evaluate("""() => ['.s-player','.s-queue','.room-side','.s-layers','.s-chat'].map(s => { const r = document.querySelector(s)?.getBoundingClientRect(); return s + ' ' + (r ? Math.round(r.top + scrollY) + '+' + Math.round(r.height) : '-') })"""))
        raise
    gm.wait_for_selector('.msg-text:has-text("Привет из таверны")', timeout=10000)
    check(True, 'chat message delivered')
    check(gm.locator('.who', has_text='Игрок Один').count() == 1, 'GM sees the player among listeners')

    step('Saved playlists in the side panel: play one like a queue')
    def drag(page, rows_sel, src, dst):
        g = page.locator(rows_sel).nth(src).locator('[data-drag-handle]')
        page.locator(rows_sel).nth(dst).scroll_into_view_if_needed(); g.scroll_into_view_if_needed(); page.wait_for_timeout(200)
        box = g.bounding_box(); tb = page.locator(rows_sel).nth(dst).bounding_box()
        page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        page.mouse.down()
        page.mouse.move(box['x'] + box['width'] / 2, tb['y'] + tb['height'] * (0.25 if dst < src else 0.75), steps=12)
        page.mouse.up()
    titles = lambda page, sel: [t.strip() for t in page.locator(sel).all_inner_texts()]
    def set_targets(page, queue, playlist):
        for key, want in (('в очередь', queue), ('в плейлист', playlist)):
            chip = page.locator('.add-to .chip', has_text=key)
            if ('on' in (chip.get_attribute('class') or '').split()) != want: chip.click()
    def add_to(page, url, queue, playlist):
        set_targets(page, queue, playlist)
        page.locator('.s-add input').fill(url)
        page.locator('.s-add form button').click()
    check(gm.locator('.room-side .pls').count() == 1 and gm.locator('.room-side .chat').count() == 0, 'playlists are in the side panel, chat is not')
    check(gm.locator('.room-main .s-chat .chat').count() == 1, 'chat is in the main column')
    order_ok = gm.evaluate("""() => { const l = document.querySelector('.s-layers'), c = document.querySelector('.s-chat'); return !!(l && c && (l.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING)) }""")
    check(order_ok, 'chat comes after the extra tracks')
    check(gm.locator('.queue-card input').count() == 0 and gm.locator('.pls input').count() == 0, 'no separate add fields in the queue or the playlists')
    gm.locator('.pls .switcher').click()
    PROMPTS.append('Бой')
    gm.locator('.menu-item', has_text='Новый плейлист').click()
    gm.wait_for_selector('.pls .switcher:has-text("Бой")', timeout=10000)
    queue_before = titles(gm, '.queue-card .q-title')
    for url in (VIDEO2, VIDEO):
        n = gm.locator('.pl-item').count()
        add_to(gm, url, queue=False, playlist=True)
        gm.wait_for_function(f"() => document.querySelectorAll('.pl-item').length > {n}", timeout=15000)
    check(gm.locator('.pl-item').count() == 2 and titles(gm, '.queue-card .q-title') == queue_before, 'with "в очередь" off the songs went only into the open playlist «Бой»')
    gm.locator('.pl-item').first.click()
    pl.wait_for_function("() => /GANGNAM/i.test(document.querySelector('.now-title')?.innerText ?? '')", timeout=15000)
    check(True, 'click on a song plays the playlist from it for everybody')
    gm.wait_for_selector('.pl-banner:has-text("Бой")', timeout=10000)
    check(titles(gm, '.queue-card .q-title') == queue_before, 'the queue stays untouched while the playlist plays')
    gm.locator('.controls button[title="Дальше"]').click()
    pl.wait_for_function("() => /Rick Astley/i.test(document.querySelector('.now-title')?.innerText ?? '')", timeout=15000)
    check(gm.locator('.pl-banner').count() == 1, '"next" goes to the next song of the playlist (not the queue)')

    step('Drag and drop')
    before = titles(gm, '.pl-item-title')
    drag(gm, '.pl-item', 1, 0)
    gm.wait_for_function("(t) => document.querySelector('.pl-item-title')?.innerText.trim() === t", arg=before[1], timeout=10000)
    check(titles(gm, '.pl-item-title') == [before[1], before[0]], 'playlist reordered by dragging')
    add_to(gm, VIDEO2, queue=True, playlist=False)
    gm.wait_for_function("() => document.querySelectorAll('.queue-card .q-item').length === 2", timeout=15000)
    check(gm.locator('.pl-item').count() == 2, 'with "в плейлист" off the song went only into the queue')
    check(gm.locator('.pl-banner').count() == 1, 'adding to the queue does not interrupt the playlist')
    q = titles(gm, '.queue-card .q-title')
    drag(gm, '.queue-card .q-item', 1, 0)
    gm.wait_for_function("(t) => document.querySelector('.queue-card .q-title')?.innerText.trim() === t", arg=q[1], timeout=10000)
    check(titles(gm, '.queue-card .q-title') == [q[1], q[0]], 'queue reordered by dragging')
    check(gm.locator('.queue-card button[title="Выше"], .queue-card button[title="Ниже"]').count() == 0, 'no more up/down arrows')
    set_targets(gm, True, True)   # back to the default: both

    step('Back to the queue; listener sees playlists read-only; save queue')
    gm.locator('.pl-banner').get_by_role('button', name='Играть очередь').click()
    pl.wait_for_function("() => /GANGNAM/i.test(document.querySelector('.now-title')?.innerText ?? '')", timeout=15000)
    check(gm.locator('.pl-banner').count() == 0, '"Играть очередь" returns to the queue')
    pl.wait_for_selector('.room-side .pls .pl-item', timeout=10000)
    check(pl.locator('.s-add').count() == 0 and pl.locator('.pl-item.clickable').count() == 0 and pl.locator('.pls [data-drag-handle]').count() == 0, 'listener without control: no add field, playlists read-only')
    gm.locator('.pls .switcher').click()
    PROMPTS.append('Сохранённая очередь')
    gm.locator('.menu-item', has_text='Сохранить очередь как плейлист').click()
    gm.wait_for_selector('.pls .switcher:has-text("Сохранённая очередь")', timeout=10000)
    check(gm.locator('.pl-item').count() == 2, 'current queue saved as a playlist and opened')
    gm.locator('.pls .switcher').click()
    names = titles(gm, '.menu .menu-item .grow')
    gm.keyboard.press('Escape')
    check(names == ['Основной', 'Бой', 'Сохранённая очередь'], f'switcher lists every playlist ({names})')
    shot(gm, 'd-room-playlists', full=False)
    gm.set_viewport_size({'width': 1366, 'height': 1600}); shot(gm, 'd-room-full', full=True); gm.set_viewport_size({'width': 1366, 'height': 900})

    step('Click on the video toggles playback for everybody')
    gm.locator('.main-card .shield').click()
    pl.wait_for_function(YT_TIME.replace('return p &&', 'return p && p.getPlayerState() === 2 &&'), timeout=10000)
    check(True, 'click on the main video paused it for the listener')
    gm.locator('.main-card .shield').click()
    pl.wait_for_function(YT_TIME.replace('return p &&', 'return p && p.getPlayerState() === 1 &&'), timeout=15000)
    check(True, 'second click resumed it')
    check(pl.locator('.main-card .shield.clickable').count() == 0, 'for a listener without control the video is not clickable')
    before = pl.evaluate(LAYER_STATE)
    gm.locator('.layer .shield').click()
    t0 = time.time()
    while time.time() - t0 < 10 and pl.evaluate(LAYER_STATE) == before: time.sleep(0.5)
    check(pl.evaluate(LAYER_STATE) != before, f'click on the layer mini player toggled it ({before} -> {pl.evaluate(LAYER_STATE)})')

    step('Rename, interval and speed of a video')
    gm.locator('.controls button[title="Повтор очереди"]').click()   # repeat this one song, inside its interval
    gm.locator('.queue-card .q-item').first.locator('button[title^="Название"]').click()
    gm.wait_for_selector('.modal h3:has-text("Настройки трека")')
    gm.locator('.modal input').first.fill('Боевая тема')
    gm.locator('.modal input[placeholder="0:00"]').fill('0:20')
    gm.locator('.modal select').first.select_option('at')
    gm.locator('.modal input[placeholder="0:10"]').fill('0:26')
    gm.locator('.modal select').nth(1).select_option('1.5')
    gm.locator('.modal').get_by_role('button', name='Сохранить').click()
    pl.wait_for_function("() => document.querySelector('.now-title')?.innerText.includes('Боевая тема')", timeout=10000)
    check(True, 'renamed title reached the listener')
    check('0:20–0:26' in gm.locator('.queue-card .q-item').first.inner_text() and '×1.5' in gm.locator('.queue-card .q-item').first.inner_text(), 'queue row shows the interval and speed')
    samples = []
    t0 = time.time()
    while time.time() - t0 < 9:
        x = pl.evaluate(YT_TIME)
        if x and x['s'] == 1: samples.append((round(x['t'], 1), x['r']))
        time.sleep(0.4)
    ts = [a for a, _ in samples]
    print('   listener samples:', samples[:6], '...', samples[-4:])
    check(bool(ts) and min(ts) >= 19.3 and max(ts) <= 26.8, 'listener plays only inside 0:20–0:26')
    check(any(b < a - 2 for a, b in zip(ts, ts[1:])), 'the single item repeats from 0:20 at the end of the interval')
    check(bool(samples) and all(r == 1.5 for _, r in samples), 'listener plays at ×1.5')
    a, c = gm.evaluate(YT_TIME), pl.evaluate(YT_TIME)
    if a and c and abs(a['t'] - c['t']) < 4: check(abs(a['t'] - c['t']) < 2.0, f'GM and listener agree inside the interval (diff {abs(a["t"] - c["t"]):.2f})')

    step('Admin')
    ad = b.new_context(viewport={'width': 1366, 'height': 900}).new_page(); watch(ad, 'admin')
    login(ad, 'admin@example.com')
    check(ad.locator('.hub-nav a', has_text='Админка').count() == 1, 'admin link for the service admin')
    ad.goto(BASE + '#/admin')
    ad.wait_for_selector('.urow', timeout=20000)
    for t in ['Пользователи', 'Миры', 'Кампейны', 'Комнаты']:
        n = ad.locator('.stat-row').inner_text()
    check(ad.locator('.urow').count() >= 3, 'users listed')
    ad.locator('.tabs .tab', has_text='Миры').click(); ad.wait_for_selector('td:has-text("Мир ' + RUN + '")')
    ad.locator('.tabs .tab', has_text='Кампейны').click(); ad.wait_for_selector('td:has-text("Тени над Вельмором")')
    ad.locator('.tabs .tab', has_text='Комнаты').click(); ad.wait_for_selector('td:has-text("Таверна ' + RUN + '")')
    check(True, 'worlds, campaigns and rooms listed')
    ad.locator('.tabs .tab', has_text='Ресурсы').click(); ad.wait_for_selector('text=Место в базе — весь проект', timeout=15000)
    row = ad.locator('tr', has_text='Мир ' + RUN)
    row.locator('button').click()
    try:
        ad.wait_for_function("""(n) => [...document.querySelectorAll('tr')].some((tr) => tr.innerText.includes(n) && /\d\s*(Б|КБ|МБ)/.test(tr.innerText)) || document.querySelector('.toast.error')""", arg='Мир ' + RUN, timeout=60000)
    except Exception: pass
    shot(ad, 'd-admin-usage-row')
    toast = ad.locator('.toast.error').all_inner_texts()
    check(not toast and 'не посчитан' not in row.inner_text(), 'admin measured a foreign world ' + (str(toast) if toast else row.inner_text().replace(chr(10), ' | ')))
    shot(ad, 'd-admin-usage')
    ad.locator('.tabs .tab', has_text='Сервис').click()
    ad.locator('input[placeholder="AIza…"]').fill('test-key-' + RUN)
    ad.get_by_role('button', name='Сохранить').click()
    time.sleep(1)
    cfg = rest('GET', f'{FS}/service/config')
    check(cfg['fields']['youtubeApiKey']['stringValue'] == 'test-key-' + RUN, 'service config saved')
    rest('PATCH', f'{FS}/service/config?updateMask.fieldPaths=youtubeApiKey', {'fields': {'youtubeApiKey': {'stringValue': ''}}})

    step('Admin bans the player')
    ad.locator('.tabs .tab', has_text='Пользователи').click()
    ad.locator('.urow', has_text=PL).locator('button[title="Действия"]').click()
    ad.locator('.menu-item', has_text='Заблокировать').click()   # prompt() auto-accepted with ''
    ad.wait_for_selector(f'.urow.banned:has-text("{PL}")', timeout=10000)
    pl.goto(BASE + '#/rooms')
    pl.wait_for_selector('.ban-banner', timeout=15000)
    check(True, 'banned user sees the banner')
    pl.get_by_role('button', name='Новая комната').click()
    pl.locator('.modal input[placeholder^="Таверна"]').fill('Не выйдет')
    pl.locator('.modal').get_by_role('button', name='Создать', exact=True).click()
    pl.wait_for_selector('.toast.error', timeout=10000)
    check(True, 'banned user cannot create a room')
    pl.keyboard.press('Escape')
    ad.locator('.urow.banned button[title="Действия"]').click()
    ad.locator('.menu-item', has_text='Снять блокировку').click()
    ad.wait_for_function("() => !document.querySelector('.urow.banned')", timeout=10000)
    check(True, 'unbanned')

    step('Admin opens a foreign world as master')
    ad.goto(BASE + f'#/w/{wid}')
    ad.wait_for_selector('.admin-banner', timeout=20000)
    check('Администратор сервиса' in ad.locator('.sb-world-role').inner_text(), 'role shown as service admin')
    ad.goto(BASE + f'#/w/{wid}/t/character')
    ad.wait_for_selector('text=Аэлин Тарн', timeout=15000)
    check(True, 'admin reads the world content')

    step('Mobile layout of the new pages (360 px)')
    CHECK = """() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ? document.documentElement.scrollWidth : 0"""
    pl.set_viewport_size({'width': 360, 'height': 780})
    for name, url in [('campaigns', '#/campaigns'), ('campaign', f'#/c/{cid}'), ('campaign-rooms', f'#/c/{cid}/rooms'), ('rooms', '#/rooms'), ('room', f'#/r/{rid}'), ('account', '#/account')]:
        pl.goto(BASE + url); time.sleep(2.5)
        w = pl.evaluate(CHECK)
        check(w == 0, f'{name}: no horizontal scroll' + (f' (page {w}px)' if w else ''))
        shot(pl, 'm360-' + name)
    ad.set_viewport_size({'width': 360, 'height': 780})
    for name, url in [('admin', '#/admin'), ('admin-worlds', '#/admin/worlds'), ('admin-usage', '#/admin/usage')]:
        ad.goto(BASE + url); time.sleep(2.5)
        w = ad.evaluate(CHECK)
        check(w == 0, f'{name}: no horizontal scroll' + (f' (page {w}px)' if w else ''))
        shot(ad, 'm360-' + name)
    b.close()

print('\nCONSOLE ERRORS:', *list(dict.fromkeys(errors))[:40], sep='\n  ')
print(f'\n{len(fails)} failed:', *fails, sep='\n  ')
sys.exit(1 if fails else 0)
