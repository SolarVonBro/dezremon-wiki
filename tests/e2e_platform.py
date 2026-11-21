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
  const p = window.YT.get(f.id); return p && p.getCurrentTime ? { t: p.getCurrentTime(), s: p.getPlayerState(), id: f.id } : null }"""

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
    gm.locator('.queue-card input[placeholder^="Ссылка"]').fill(VIDEO)
    gm.locator('.queue-card form button').click()
    gm.wait_for_selector('.now-title:not(.faint)', timeout=20000)
    check('Never Gonna Give You Up' in gm.locator('.now-title').inner_text(), 'title fetched through oEmbed')

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
    pl.locator('.chat form button').click()
    gm.wait_for_selector('.msg-text:has-text("Привет из таверны")', timeout=10000)
    check(True, 'chat message delivered')
    check(gm.locator('.who', has_text='Игрок Один').count() == 1, 'GM sees the player among listeners')

    step('Saved playlists')
    gm.locator('.queue-card .tab', has_text='Плейлисты').click()
    gm.get_by_role('button', name='Новый плейлист').click()
    gm.locator('.pls input[placeholder^="Название"]').fill('Бой')
    gm.locator('.pls form').get_by_role('button', name='Создать').click()
    gm.wait_for_selector('.pl-title:has-text("Бой")', timeout=10000)
    gm.locator('.pls input[placeholder^="Ссылка"]').fill(VIDEO2)
    gm.locator('.pls form button').first.click()
    gm.wait_for_selector('.pl-item', timeout=15000)
    check('GANGNAM' in gm.locator('.pl-item-title').first.inner_text().upper(), 'video added to the playlist with its title')
    gm.locator('.pls').get_by_role('button', name='Включить').click()
    gm.wait_for_function("() => /GANGNAM/i.test(document.querySelector('.now-title')?.innerText ?? '')", timeout=15000)
    pl.wait_for_function("() => /GANGNAM/i.test(document.querySelector('.now-title')?.innerText ?? '')", timeout=15000)
    check(True, 'playlist replaced the queue for everybody')
    gm.locator('.queue-card .tab', has_text='Очередь').click()
    check('загружен плейлист «Бой»' in gm.locator('.queue-card').inner_text(), 'queue shows which playlist is loaded')
    pl.locator('.queue-card .tab', has_text='Плейлисты').click()
    pl.wait_for_selector('.pl-row:has-text("Бой")', timeout=10000)
    check(pl.get_by_role('button', name='Новый плейлист').count() == 0 and pl.locator('.pl-row button[title^="Включить"]').count() == 0, 'listener without control sees playlists read-only')
    gm.locator('.queue-card .tab', has_text='Плейлисты').click()
    gm.wait_for_selector('.pls', timeout=10000)
    if gm.locator('.pls button[title="Ко всем плейлистам"]').count(): gm.locator('.pls button[title="Ко всем плейлистам"]').click()
    PROMPTS.append('Сохранённая очередь')
    gm.get_by_role('button', name='Сохранить очередь').click()
    gm.wait_for_selector('.pl-row:has-text("Сохранённая очередь")', timeout=10000)
    check(gm.locator('.pl-row').count() == 2, 'current queue saved as a playlist')
    shot(gm, 'd-room-playlists', full=False)

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
