"""Character types PC / NPC and the PC / NPC tags. Every world gets the tags on a master's visit (a tag already named
   «NPC» becomes that tag); characters made before get tags by their type (or a type by their single tag). Choosing
   the type on creation or on the page, or putting / taking a tag, keeps type and tags in agreement. «Персонаж игрока»
   on creation gives the character to a member (a player — to themselves) and shows it only to them and the masters.
   EMULATORS ONLY:
   firebase emulators:start --only firestore,auth --project demo-dezremon
   MSYS_NO_PATHCONV=1 BASE_PATH=/ npx vite build --mode emulator && npx vite preview --port 4174
   python tests/e2e_char_types.py <screenshots dir>"""
import sys, os, json, random, time, urllib.request
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_URL', 'http://localhost:4174/')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'e2e-char-types'
os.makedirs(OUT, exist_ok=True)
RUN = str(random.randint(1000, 9999))
GM, PL = f'gm{RUN}@example.com', f'pl{RUN}@example.com'
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
    if 'booleanValue' in v: return v['booleanValue']
    if 'nullValue' in v: return None
    if 'arrayValue' in v: return [dec(x) for x in v['arrayValue'].get('values', [])]
    if 'mapValue' in v: return {k: dec(x) for k, x in v['mapValue'].get('fields', {}).items()}
    return v


def put(path, data):
    rest('PATCH', f'{FS}/{path}', {'fields': {k: enc(x) for k, x in data.items()}})


def get(path):
    try:
        return {k: dec(x) for k, x in rest('GET', f'{FS}/{path}')['fields'].items()}
    except urllib.error.HTTPError:
        return None


def account(email, name):
    return rest('POST', 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-dezremon/accounts',
                {'email': email, 'password': 'secret123', 'displayName': name})['localId']


GM_UID = account(GM, 'Мастер Игры')
PL_UID = account(PL, 'Игрок Анна')
FAILS = []


def check(cond, what):
    print('ok  ' if cond else 'FAIL', what, flush=True)
    if not cond: FAILS.append(what)


def wait_for(fn, timeout=10):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if fn(): return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


T0 = int(time.time() * 1000)


def char(wid, eid, name, kind, tags, **extra):
    put(f'worlds/{wid}/entities/{eid}', {
        'id': eid, 'type': 'character', 'name': name, 'kind': kind, 'tagIds': tags, 'visibility': 'members', 'allowedUids': [],
        'createdBy': GM_UID, 'updatedBy': GM_UID, 'createdAt': T0, 'updatedAt': T0, 'deleted': False, 'bodyRev': 0, **extra})


# A world made before this change: an «npc» tag of its own, characters typed in different ways, no PC tag yet.
W2 = 'chartypes' + RUN
put(f'worlds/{W2}', {'name': 'Старый мир ' + RUN, 'description': '', 'ownerId': GM_UID, 'isPublic': False, 'imageId': None,
                     'headerImageId': None, 'aclVersion': 0, 'createdAt': T0, 'updatedAt': T0,
                     'settings': {'disabledTypes': [], 'customTypes': [], 'playerCreateTypes': ['journal', 'note', 'character'],
                                  'playersCanPost': True, 'defaultVisibility': 'members', 'dashboardPins': [], 'mainCalendarId': None, 'accent': None}})
put(f'worlds/{W2}/members/{GM_UID}', {'uid': GM_UID, 'role': 'owner', 'displayName': 'Мастер Игры', 'email': GM, 'photoURL': None, 'joinedAt': T0})
put(f'worlds/{W2}/members/{PL_UID}', {'uid': PL_UID, 'role': 'player', 'displayName': 'Игрок Анна', 'email': PL, 'photoURL': None, 'joinedAt': T0})
put(f'worlds/{W2}/entities/oldnpc', {'id': 'oldnpc', 'type': 'tag', 'name': 'npc', 'kind': '', 'tagIds': [], 'fields': {'colour': '#336699'},
                                    'visibility': 'members', 'allowedUids': [], 'createdBy': GM_UID, 'updatedBy': GM_UID,
                                    'createdAt': T0, 'updatedAt': T0, 'deleted': False, 'bodyRev': 0})
char(W2, 'cA', 'Трактирщик', 'NPC', [])                       # typed, no tag → gets the NPC tag
char(W2, 'cB', 'Безымянный герой', '', ['tag-pc'])            # untyped, one tag → becomes PC
char(W2, 'cC', 'Старый бог', 'бог', [])                       # free-form type → untouched
char(W2, 'cD', 'Рыцарь', 'Игровой персонаж', ['oldnpc'])      # typed PC, wrong tag → PC tag instead, type text kept
char(W2, 'cE', 'Удалённый', 'NPC', [], deleted=True)          # in the trash → untouched

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    gm = b.new_context(viewport={'width': 1440, 'height': 960}).new_page()
    errs = []
    gm.on('console', lambda m: errs.append(f'gm {m.type}: {m.text[:300]}') if m.type == 'error' else None)
    gm.on('pageerror', lambda e: errs.append('gm pageerror: ' + str(e)[:400]))

    def login(pg, email):
        pg.goto(BASE + '#/login')
        pg.locator('input[type=email]').fill(email); pg.locator('input[type=password]').fill('secret123')
        pg.get_by_role('button', name='Войти', exact=True).click()
        pg.wait_for_url('**/#/worlds**', timeout=20000)

    print('== a new world gets the PC and NPC tags')
    login(gm, GM)
    gm.get_by_role('button', name='Новый мир').first.click()
    gm.locator('input[placeholder="Дезремон"]').fill('Новый мир ' + RUN)
    gm.get_by_role('button', name='Создать мир').click()
    gm.wait_for_selector('.db-grid', timeout=20000)
    W1 = gm.url.split('/w/')[1].split('/')[0].split('?')[0]
    check(wait_for(lambda: get(f'worlds/{W1}/entities/tag-pc') and get(f'worlds/{W1}/entities/tag-npc')), 'both tags were created')
    pc, npc = get(f'worlds/{W1}/entities/tag-pc'), get(f'worlds/{W1}/entities/tag-npc')
    check(pc and pc['name'] == 'PC' and pc['fields']['charType'] == 'pc' and pc['type'] == 'tag' and pc['visibility'] == 'members', f'tag PC ({pc and (pc["name"], pc["fields"], pc["visibility"])})')
    check(npc and npc['name'] == 'NPC' and npc['fields']['charType'] == 'npc', 'tag NPC')
    check(get(f'worlds/{W1}/bodies/tag-pc') is not None, 'the tag has its text')

    print('== «Мои персонажи» is always in the menu; its «+» opens the window with «Мой персонаж» checked')
    sec = gm.locator('.sidebar .sb-chars')
    check(sec.count() == 1 and 'персонажей пока нет' in sec.inner_text().lower(), f'empty section in a new world ({sec.inner_text()!r})')
    sec.locator('button[title="Создать своего персонажа"]').click(); gm.wait_for_selector('.modal .own-box', timeout=10000)
    check('персонаж' in gm.locator('.modal-head').inner_text().lower(), 'the window creates a character')
    check(gm.locator('.modal .own-box input[type=checkbox]').is_checked(), '«Персонаж игрока» is checked')
    check(gm.locator('.modal .ct-opt.on').inner_text().strip().startswith('PC'), 'type PC')
    check('Мастер Игры' in gm.locator('.modal .own-box .member-picker').inner_text(), 'for whoever creates it')
    gm.screenshot(path=os.path.join(OUT, 't-0-sidebar-plus.png'))
    gm.locator('.modal-head .icon-btn').first.click(); gm.wait_for_timeout(300)

    print('== an older world: its «npc» tag is adopted, characters are put in order')
    gm.goto(BASE + f'#/w/{W2}'); gm.wait_for_selector('.db-grid', timeout=20000)
    toast = gm.locator('.toast', has_text='Теги PC и NPC')
    toast.wait_for(timeout=10000)
    check('3 персонажа' in toast.inner_text(), f'a toast says how many characters were updated ({toast.inner_text()})')
    check(wait_for(lambda: (get(f'worlds/{W2}/entities/oldnpc') or {}).get('fields', {}).get('charType') == 'npc'), 'the «npc» tag became the NPC tag')
    check(get(f'worlds/{W2}/entities/tag-npc') is None, 'no second NPC tag')
    check(wait_for(lambda: get(f'worlds/{W2}/entities/tag-pc') is not None), 'the PC tag was created')
    check(wait_for(lambda: get(f'worlds/{W2}/entities/cA')['tagIds'] == ['oldnpc']), f'NPC-typed character got the tag ({get(f"worlds/{W2}/entities/cA")["tagIds"]})')
    check(wait_for(lambda: get(f'worlds/{W2}/entities/cB')['kind'] == 'PC'), 'untyped character with the PC tag became PC')
    cD = get(f'worlds/{W2}/entities/cD')
    check(cD['tagIds'] == ['tag-pc'] and cD['kind'] == 'Игровой персонаж', f'«Игровой персонаж»: PC tag instead of NPC, text kept ({cD["tagIds"]}, {cD["kind"]})')
    cC = get(f'worlds/{W2}/entities/cC')
    check(cC['kind'] == 'бог' and cC['tagIds'] == [] and cC['updatedAt'] == T0, 'free-form type left alone')
    check(get(f'worlds/{W2}/entities/cE')['updatedAt'] == T0, 'trash left alone')

    print('== creating a character: the type switch')
    gm.goto(BASE + f'#/w/{W2}/t/character'); gm.wait_for_selector('.page-head', timeout=15000)
    gm.get_by_role('button', name='Создать персонажа').click(); gm.wait_for_selector('.modal .ct-switch', timeout=10000)
    labels = [t.strip() for t in gm.locator('.modal .ct-opt').all_inner_texts()]
    check(len(labels) == 3 and labels[0].startswith('PC') and labels[1].startswith('NPC') and labels[2] == 'Без типа', f'PC / NPC / Без типа ({labels})')
    check(gm.locator('.modal .ct-opt.on').inner_text().strip() == 'Без типа', 'no type by default')
    gm.locator('.modal input[maxlength="200"]').fill('Стражник')
    gm.locator('.modal .ct-opt', has_text='NPC').click()
    gm.screenshot(path=os.path.join(OUT, 't-1-create-npc.png'))
    gm.get_by_role('button', name='Создать и редактировать').click()
    gm.wait_for_url('**/e/**', timeout=15000)
    eid = gm.url.split('/e/')[1].split('?')[0]
    check(wait_for(lambda: get(f'worlds/{W2}/entities/{eid}')['kind'] == 'NPC'), 'kind NPC')
    check(get(f'worlds/{W2}/entities/{eid}')['tagIds'] == ['oldnpc'], 'NPC tag put on creation')

    print('== the page: switch the type, put and take the tags')
    gm.wait_for_selector('.facts-edit .ct-switch', timeout=15000)
    gm.locator('.facts-edit .ct-opt', has_text='PC').first.click()
    check(wait_for(lambda: get(f'worlds/{W2}/entities/{eid}')['tagIds'] == ['tag-pc'] and get(f'worlds/{W2}/entities/{eid}')['kind'] == 'PC'), 'PC: the NPC tag swapped for PC')
    check(gm.locator('.facts-edit input[placeholder^="НПС"]').input_value() == 'PC', 'the «Тип» input follows')
    gm.screenshot(path=os.path.join(OUT, 't-2-page-pc.png'))
    gm.locator('.facts-edit .ct-opt', has_text='Без типа').click()
    check(wait_for(lambda: get(f'worlds/{W2}/entities/{eid}')['tagIds'] == [] and get(f'worlds/{W2}/entities/{eid}')['kind'] == ''), 'no type: both tags gone')
    tags = gm.locator('.facts-edit .field', has_text='Теги')
    tags.locator('.picker-btn').click(); gm.locator('.picker-menu input').fill('npc')
    gm.locator('.picker-menu .menu-item', has_text='npc').first.click()
    check(wait_for(lambda: get(f'worlds/{W2}/entities/{eid}')['kind'] == 'NPC'), 'putting the NPC tag by hand makes it NPC')
    check(wait_for(lambda: gm.locator('.facts-edit .ct-opt.on').inner_text().strip().startswith('NPC')), 'the switch follows the tag')
    tags.locator('.tag-chip', has_text='npc').locator('button').click()
    check(wait_for(lambda: get(f'worlds/{W2}/entities/{eid}')['kind'] == ''), 'taking the NPC tag off clears the type')
    gm.locator('.facts-edit input[placeholder^="НПС"]').fill('pc'); gm.locator('.facts-edit input[placeholder^="НПС"]').press('Tab')
    check(wait_for(lambda: get(f'worlds/{W2}/entities/{eid}')['tagIds'] == ['tag-pc']), 'typing «pc» into «Тип» puts the PC tag')

    print('== a master creates a character for a player')
    gm.goto(BASE + f'#/w/{W2}/t/character'); gm.wait_for_selector('.page-head', timeout=15000)
    gm.get_by_role('button', name='Создать персонажа').click(); gm.wait_for_selector('.modal .own-box', timeout=10000)
    gm.locator('.modal input[maxlength="200"]').fill('Лучница Мира')
    gm.locator('.modal .own-box input[type=checkbox]').check()
    check(gm.locator('.modal .ct-opt.on').inner_text().strip().startswith('PC'), 'checking «Персонаж игрока» makes it PC')
    trig = gm.locator('.modal .own-box .member-picker')
    check('Мастер Игры' in trig.inner_text() and 'вы' in trig.inner_text(), f'whoever creates it is preselected ({trig.inner_text()!r})')
    check(gm.locator('.modal .vis').count() == 0, 'the visibility choice is replaced by the note')
    check('только вы и мастера' in gm.locator('.modal .own-box').inner_text(), 'note: only you and the masters')
    trig.click(); gm.wait_for_selector('.member-picker-menu', timeout=5000)
    items = [t.strip() for t in gm.locator('.member-picker-menu .menu-item').all_inner_texts()]
    check(len(items) == 2 and items[0].startswith('Мастер Игры') and items[1].startswith('Игрок Анна'), f'the list: you first, then players ({items})')
    gm.locator('.member-picker-menu input').fill('zzz')
    check(gm.locator('.member-picker-menu .menu-item').count() == 0 and 'никого не найдено' in gm.locator('.member-picker-menu').inner_text().lower(), f'search: nobody ({gm.locator(".member-picker-menu").inner_text()!r})')
    gm.locator('.member-picker-menu input').fill('анн')
    check([t.strip() for t in gm.locator('.member-picker-menu .menu-item').all_inner_texts()] == ['Игрок Анна\nигрок'], 'search «анн»: only Anna')
    gm.screenshot(path=os.path.join(OUT, 't-3-member-search.png'))
    gm.locator('.member-picker-menu input').press('Enter')
    check(gm.locator('.member-picker-menu').count() == 0 and 'Игрок Анна' in trig.inner_text(), 'Enter picks the first one found')
    check('Игрок Анна и мастера' in gm.locator('.modal .own-box').inner_text(), 'note: only the player and masters see it')
    gm.screenshot(path=os.path.join(OUT, 't-3-create-for-player.png'))
    gm.get_by_role('button', name='Создать и редактировать').click()
    gm.wait_for_url('**/e/**', timeout=15000)
    e2 = gm.url.split('/e/')[1].split('?')[0]
    check(wait_for(lambda: PL_UID and e2 in (get(f'worlds/{W2}/members/{PL_UID}').get('characterIds') or [])), 'given to the player')
    d = get(f'worlds/{W2}/entities/{e2}')
    check(d['visibility'] == 'custom' and d['allowedUids'] == [PL_UID] and d['kind'] == 'PC' and d['tagIds'] == ['tag-pc'], f'custom for her, PC ({d["visibility"]}, {d["allowedUids"]}, {d["kind"]}, {d["tagIds"]})')
    gm.wait_for_selector('.char-player', timeout=10000)
    check(gm.locator('.char-player select').input_value() == PL_UID, 'block «Игрок» shows her')

    print('== a master keeps the default: the character is the master\'s')
    gm.goto(BASE + f'#/w/{W2}/t/character'); gm.wait_for_selector('.page-head', timeout=15000)
    gm.get_by_role('button', name='Создать персонажа').click(); gm.wait_for_selector('.modal .own-box', timeout=10000)
    gm.locator('.modal input[maxlength="200"]').fill('Наёмник мастера')
    gm.locator('.modal .own-box input[type=checkbox]').check()
    gm.get_by_role('button', name='Создать и редактировать').click()
    gm.wait_for_url('**/e/**', timeout=15000)
    e4 = gm.url.split('/e/')[1].split('?')[0]
    check(wait_for(lambda: e4 in (get(f'worlds/{W2}/members/{GM_UID}').get('characterIds') or [])), 'given to the master who made it')
    d = get(f'worlds/{W2}/entities/{e4}')
    check(d['visibility'] == 'custom' and d['allowedUids'] == [GM_UID], f'visible to the masters only ({d["visibility"]}, {d["allowedUids"]})')

    print('== a player creates her own character')
    pl = b.new_context(viewport={'width': 1440, 'height': 960}).new_page()
    pl.on('console', lambda m: errs.append(f'pl {m.type}: {m.text[:300]}') if m.type == 'error' else None)
    pl.on('pageerror', lambda e: errs.append('pl pageerror: ' + str(e)[:400]))
    login(pl, PL)
    pl.goto(BASE + f'#/w/{W2}/t/character'); pl.wait_for_selector('.page-head', timeout=20000)
    pl.get_by_role('button', name='Создать персонажа').click(); pl.wait_for_selector('.modal .own-box', timeout=10000)
    check('Мой персонаж — закрепить за мной' in pl.locator('.modal .own-box').inner_text() and pl.locator('.modal .own-box .member-picker').count() == 0, 'player: «Мой персонаж», no member choice')
    check(not pl.locator('.modal .own-box input[type=checkbox]').is_checked(), 'from the list it starts unchecked')
    pl.locator('.modal .own-box input[type=checkbox]').check()
    check(pl.locator('.modal .own-box .member-picker').count() == 0, 'still no member choice once checked')
    pl.locator('.modal-head .icon-btn').first.click(); pl.wait_for_timeout(300)
    psec = pl.locator('.sidebar .sb-chars')
    check('Лучница Мира' in psec.inner_text(), 'her section lists the character the master gave her')
    psec.locator('button[title="Создать своего персонажа"]').click(); pl.wait_for_selector('.modal .own-box', timeout=10000)
    check(pl.locator('.modal .own-box input[type=checkbox]').is_checked() and pl.locator('.modal .ct-opt.on').inner_text().strip().startswith('PC'), 'the sidebar «+»: «Мой персонаж» checked, PC')
    pl.locator('.modal input[maxlength="200"]').fill('Вор Тень')
    check('только вы и мастера' in pl.locator('.modal .own-box').inner_text(), 'note: only you and the masters')
    pl.screenshot(path=os.path.join(OUT, 't-4-player-create.png'))
    pl.get_by_role('button', name='Создать и редактировать').click()
    pl.wait_for_url('**/e/**', timeout=15000)
    e3 = pl.url.split('/e/')[1].split('?')[0]
    check(wait_for(lambda: e3 in (get(f'worlds/{W2}/members/{PL_UID}').get('characterIds') or [])), 'she owns it (her member doc)')
    d = get(f'worlds/{W2}/entities/{e3}')
    check(d['createdBy'] == PL_UID and d['visibility'] == 'custom' and d['allowedUids'] == [PL_UID] and d['kind'] == 'PC' and d['tagIds'] == ['tag-pc'],
          f'custom for her, PC tag ({d["visibility"]}, {d["allowedUids"]}, {d["kind"]}, {d["tagIds"]})')
    check(wait_for(lambda: 'Вор Тень' in pl.locator('.sidebar .sb-chars').inner_text()), 'her sidebar «Мои персонажи» lists it')
    pl.wait_for_selector('.facts-edit .ct-switch', timeout=10000)
    pl.locator('.facts-edit .ct-opt', has_text='NPC').click()
    check(wait_for(lambda: get(f'worlds/{W2}/entities/{e3}')['tagIds'] == ['oldnpc']), 'a player can switch the type of her own character')
    pl.screenshot(path=os.path.join(OUT, 't-5-player-page.png'))
    gm.goto(BASE + f'#/w/{W2}/e/{e3}'); gm.wait_for_selector('.char-player', timeout=15000)
    check('Вор Тень' in gm.locator('h1').first.inner_text(), 'the master sees it')

    real = [e for e in errs if 'favicon' not in e]
    check(not real, f'no console errors ({real[:5]})')
    b.close()

print('\nFAILED:' if FAILS else '\nALL OK', *FAILS, sep='\n  ')
sys.exit(1 if FAILS else 0)
