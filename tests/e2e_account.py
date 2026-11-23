"""The personal cabinet is the user's own page (#/u/{uid}): overview, profile, sign-in and appearance tabs; #/account and
   the account menu lead there. The own picture: uploaded, framed like article pictures, framed again, removed; it is
   published on the public card and copied into member records of the user's worlds and participant records of games.
   EMULATORS ONLY:
   firebase emulators:start --only firestore,auth --project demo-dezremon
   MSYS_NO_PATHCONV=1 BASE_PATH=/ npx vite build --mode emulator && npx vite preview --port 4174
   python tests/e2e_account.py <screenshots dir>"""
import sys, os, json, random, time, urllib.request, urllib.error, zlib, struct
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_URL', 'http://localhost:4174/')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'e2e-account'
os.makedirs(OUT, exist_ok=True)
RUN = str(random.randint(1000, 9999))
ME, OTHER = f'me{RUN}@example.com', f'ot{RUN}@example.com'
FS = 'http://127.0.0.1:8080/v1/projects/demo-dezremon/databases/(default)/documents'


def rest(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer owner', 'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req).read() or b'{}')


def enc(v):
    if v is None: return {'nullValue': None}
    if isinstance(v, bool): return {'booleanValue': v}
    if isinstance(v, int): return {'integerValue': str(v)}
    if isinstance(v, str): return {'stringValue': v}
    if isinstance(v, list): return {'arrayValue': {'values': [enc(x) for x in v]}}
    if isinstance(v, dict): return {'mapValue': {'fields': {k: enc(x) for k, x in v.items()}}}
    raise TypeError(v)


def dec(v):
    if 'stringValue' in v: return v['stringValue']
    if 'integerValue' in v: return int(v['integerValue'])
    if 'doubleValue' in v: return float(v['doubleValue'])
    if 'booleanValue' in v: return v['booleanValue']
    if 'nullValue' in v: return None
    if 'arrayValue' in v: return [dec(x) for x in v['arrayValue'].get('values', [])]
    if 'mapValue' in v: return {k: dec(x) for k, x in v['mapValue'].get('fields', {}).items()}
    return v


def put(path, data): rest('PATCH', f'{FS}/{path}', {'fields': {k: enc(x) for k, x in data.items()}})


def get(path):
    try:
        return {k: dec(x) for k, x in rest('GET', f'{FS}/{path}')['fields'].items()}
    except urllib.error.HTTPError:
        return None


def account(email, name):
    return rest('POST', 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-dezremon/accounts',
                {'email': email, 'password': 'secret123', 'displayName': name})['localId']


def png(path, w, h):
    rows = b''.join(b'\x00' + b''.join(bytes((min(255, 40 + x), 90, min(255, 60 + y * 2))) for x in range(w)) for y in range(h))
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))
    return path


FACE = png(os.path.join(OUT, 'face.png'), 200, 120)
ME_UID, OT_UID = account(ME, 'Лана Кабинетная'), account(OTHER, 'Олег')
FAILS = []


def check(cond, what):
    print('ok  ' if cond else 'FAIL', what, flush=True)
    if not cond: FAILS.append(what)


def wait_for(fn, timeout=12):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if fn(): return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


T0 = int(time.time() * 1000) - 3600_000
W = 'acc' + RUN
put(f'worlds/{W}', {'name': 'Мир кабинета ' + RUN, 'description': '', 'ownerId': OT_UID, 'isPublic': False, 'imageId': None, 'headerImageId': None, 'aclVersion': 0,
                    'createdAt': T0, 'updatedAt': T0, 'settings': {'disabledTypes': [], 'customTypes': [], 'playerCreateTypes': ['journal'], 'playersCanPost': True,
                    'defaultVisibility': 'members', 'dashboardPins': [], 'mainCalendarId': None, 'accent': None}})
put(f'worlds/{W}/members/{OT_UID}', {'uid': OT_UID, 'role': 'owner', 'displayName': 'Олег', 'email': OTHER, 'photoURL': None, 'joinedAt': T0})
put(f'worlds/{W}/members/{ME_UID}', {'uid': ME_UID, 'role': 'player', 'displayName': 'Лана Кабинетная', 'email': ME, 'photoURL': None, 'joinedAt': T0})
put('campaigns/g' + RUN, {'name': 'Игра кабинета', 'description': '', 'cover': None, 'worldId': W, 'worldName': 'Мир кабинета ' + RUN, 'ownerId': OT_UID,
                          'gmUids': [OT_UID], 'memberUids': [OT_UID, ME_UID], 'status': 'active', 'schedule': '', 'nextSessionAt': None, 'createdAt': T0, 'updatedAt': T0})
put(f'campaigns/g{RUN}/participants/{ME_UID}', {'uid': ME_UID, 'role': 'player', 'displayName': 'Лана Кабинетная', 'photoURL': None, 'characterId': None, 'characterName': '', 'joinedAt': T0})

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    errs = []

    def page():
        pg = b.new_context(viewport={'width': 1280, 'height': 900}).new_page()
        pg.on('console', lambda m: errs.append(f'{m.type}: {m.text[:300]}') if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:400]))
        return pg

    def login(pg, email):
        pg.goto(BASE + '#/login')
        pg.locator('input[type=email]').fill(email); pg.locator('input[type=password]').fill('secret123')
        pg.get_by_role('button', name='Войти', exact=True).click()
        pg.wait_for_url('**/#/worlds**', timeout=20000)

    me = page()
    login(me, ME)

    print('== one cabinet')
    me.locator('.app-bar .user-btn').click()
    items = [t.strip() for t in me.locator('.menu .menu-item').all_inner_texts()]
    check('Личный кабинет' in items and 'Моя страница' not in items, f'the menu has one cabinet ({items})')
    me.locator('.menu .menu-item', has_text='Личный кабинет').click()
    check(wait_for(lambda: me.evaluate('location.hash').endswith(f'/u/{ME_UID}')), 'it is the own page')
    me.wait_for_selector('.u-head', timeout=15000)
    tabs = [t.strip() for t in me.locator('.tabs .tab').all_inner_texts()]
    check(tabs == ['Обзор', 'Профиль', 'Вход и безопасность', 'Оформление'], f'tabs ({tabs})')
    check('это вы' in me.locator('.u-head').inner_text() and ME in me.locator('.u-head').inner_text(), 'header: «это вы» and the e-mail')
    check(wait_for(lambda: 'Мир кабинета' in me.locator('.user-page').inner_text()), 'overview: worlds')
    me.locator('.app-bar .user-btn').click(); me.locator('.menu .menu-item', has_text='Вход и безопасность').click()
    check(wait_for(lambda: me.locator('.tab.on', has_text='Вход и безопасность').count() == 1 and 'Способы входа' in me.locator('.user-page').inner_text()), 'the menu opens the sign-in tab')
    me.goto(BASE + '#/account?tab=appearance')
    check(wait_for(lambda: f'/u/{ME_UID}' in me.evaluate('location.hash') and me.locator('.tab.on', has_text='Оформление').count() == 1), 'an old #/account link lands on the same tab')
    me.goto(BASE + '#/account')
    check(wait_for(lambda: me.locator('.tab.on', has_text='Профиль').count() == 1), '#/account opens the profile')

    print('== the own picture')
    me.locator('.av-ed input[type=file]').set_input_files(FACE)
    me.wait_for_selector('.modal-head:has-text("Кадр фото")', timeout=10000)
    me.wait_for_selector('.crop-img img', timeout=10000)
    check(me.locator('.crop-frame.round').count() >= 2, 'round previews like an avatar')
    box = me.locator('.crop-img img').bounding_box()
    me.mouse.click(box['x'] + box['width'] * 0.2, box['y'] + box['height'] * 0.5)
    me.screenshot(path=os.path.join(OUT, 'a-1-frame.png'))
    me.get_by_role('button', name='Сохранить кадр').click()
    check(wait_for(lambda: (get(f'users/{ME_UID}') or {}).get('avatar', '').startswith('data:image')), 'saved in the user\'s record')
    u = get(f'users/{ME_UID}')
    check(u.get('avatarSource', '').startswith('data:image') and abs((u.get('avatarCrop') or {}).get('x', 0) - 20) < 3, f'with its source and frame ({u.get("avatarCrop")})')
    av = u['avatar']
    size = me.evaluate("src => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = src })", av)
    check(size == [192, 192], f'a small framed square ({size})')
    check(wait_for(lambda: (get(f'profiles/{ME_UID}') or {}).get('photoURL') == av), 'published on the public card')
    check(wait_for(lambda: get(f'worlds/{W}/members/{ME_UID}').get('photoURL') == av), 'copied into the world\'s member record')
    check(wait_for(lambda: get(f'campaigns/g{RUN}/participants/{ME_UID}').get('photoURL') == av), 'and into the game\'s participant record')
    check(me.locator('.app-bar .user-btn img').get_attribute('src') == av, 'the account button shows it')
    check(me.locator('.u-head .u-ava img').get_attribute('src') == av, 'the cabinet header shows it')

    me.get_by_role('button', name='Кадр').click()
    me.wait_for_selector('.crop-img img', timeout=10000)
    box = me.locator('.crop-img img').bounding_box()
    me.mouse.click(box['x'] + box['width'] * 0.8, box['y'] + box['height'] * 0.5)
    me.get_by_role('button', name='Сохранить кадр').click()
    check(wait_for(lambda: get(f'users/{ME_UID}').get('avatar') != av and abs((get(f'users/{ME_UID}').get('avatarCrop') or {}).get('x', 0) - 80) < 3), 'framing again changes the picture')
    av2 = get(f'users/{ME_UID}')['avatar']
    check(me.evaluate(f"localStorage.getItem('dw.avatar.{ME_UID}')") == av2, 'this browser remembers the picture')
    me.reload(); me.wait_for_selector('.u-head .u-ava', timeout=15000)
    check(me.locator('.u-head .u-ava img').get_attribute('src') == av2 and me.locator('.app-bar .user-btn img').get_attribute('src') == av2,
          'after a reload the own picture is there at once (not the old one)')

    print('== another member sees it; no cabinet tabs there')
    ot = page()
    login(ot, OTHER)
    ot.goto(BASE + f'#/u/{ME_UID}'); ot.wait_for_selector('.u-head', timeout=15000)
    check(wait_for(lambda: ot.locator('.u-head .u-ava img').get_attribute('src') == av2), 'the public page shows the picture')
    check(ot.locator('.tabs').count() == 0 and ot.locator('.u-ava-btn').count() == 0, 'somebody else\'s page has no cabinet tabs')
    ot.goto(BASE + f'#/w/{W}/settings/members'); ot.wait_for_selector('tr', timeout=15000)
    check(ot.locator('tr', has_text='Лана').locator('img').first.get_attribute('src') == av2, 'the world\'s member list shows it')

    print('== removing it')
    me.get_by_role('button', name='Убрать фото').click()
    check(wait_for(lambda: 'avatar' not in get(f'users/{ME_UID}')), 'removed from the record')
    check(wait_for(lambda: get(f'worlds/{W}/members/{ME_UID}').get('photoURL') is None and (get(f'profiles/{ME_UID}') or {}).get('photoURL') is None), 'and from everywhere (no Google photo to return to)')
    check(wait_for(lambda: me.locator('.u-head .u-ava img').count() == 0), 'the header has no picture')

    print('== the camera button and the name')
    me.locator('.tabs .tab', has_text='Обзор').click(); me.wait_for_timeout(300)
    me.locator('.u-ava-btn').click()
    check(wait_for(lambda: me.locator('.tab.on', has_text='Профиль').count() == 1), 'the camera on the avatar opens the profile')
    me.locator('label.field', has_text='Имя').locator('input').fill('Лана Новая')
    me.locator('label.field', has_text='Имя').get_by_role('button', name='Сохранить').click()
    check(wait_for(lambda: get(f'worlds/{W}/members/{ME_UID}').get('displayName') == 'Лана Новая'), 'the name still changes everywhere')
    check(wait_for(lambda: 'Лана Новая' in me.locator('.u-name').inner_text()), 'and in the header')
    check(wait_for(lambda: get(f'campaigns/g{RUN}/participants/{ME_UID}').get('displayName') == 'Лана Новая'), 'and in the game\'s participant record')
    ot.goto(BASE + f'#/w/{W}/campaigns/g{RUN}'); ot.wait_for_selector('.ov-people', timeout=15000)
    check(wait_for(lambda: 'Лана Новая' in ot.locator('.ov-people').inner_text()), 'the game page shows the new name')
    ot.locator('.tabs .tab', has_text='Игроки').click(); ot.wait_for_selector('.person', timeout=10000)
    check('Лана Новая' in ot.locator('.person', has_text='Лана').inner_text(), 'and its «Игроки» tab')
    me.screenshot(path=os.path.join(OUT, 'a-2-profile.png'))

    print('== phone width')
    me.set_viewport_size({'width': 390, 'height': 844})
    for t in ['', '?tab=profile', '?tab=security']:
        me.goto(BASE + f'#/u/{ME_UID}{t}'); me.wait_for_timeout(1500)
        check(me.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), f'cabinet {t or "overview"}: no sideways scroll')
    me.screenshot(path=os.path.join(OUT, 'a-3-phone.png'))

    real = [x for x in errs if 'favicon' not in x]
    check(not real, f'no console errors ({real[:5]})')
    b.close()

print('\nFAILED:' if FAILS else '\nALL OK', *FAILS, sep='\n  ')
sys.exit(1 if FAILS else 0)
