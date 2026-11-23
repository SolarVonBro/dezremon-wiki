"""Campaigns inside worlds. The owner's visit turns a tag in quotes into a campaign (with the players of the tagged
   characters) and gives an older campaign its tag «⚔ name»; masters create campaigns from the world (the tag
   appears), add world members in the campaign's settings or in the member's card; players pick their current
   characters; characters can be listed by campaign (PCs, then NPCs; picture and text first); a campaign tag can go
   on every new article (switch above the lists, select in the creation window); the tags page shows colour plaques
   and marks campaign tags; the global «Кампейны» page lists campaigns and leads into the world; old links redirect.
   EMULATORS ONLY:
   firebase emulators:start --only firestore,auth --project demo-dezremon
   MSYS_NO_PATHCONV=1 BASE_PATH=/ npx vite build --mode emulator && npx vite preview --port 4174
   python tests/e2e_campaigns.py <screenshots dir>"""
import sys, os, json, random, time, urllib.request, urllib.error
sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_URL', 'http://localhost:4174/')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'e2e-campaigns'
os.makedirs(OUT, exist_ok=True)
RUN = str(random.randint(1000, 9999))
GM, AN, BO = f'gm{RUN}@example.com', f'an{RUN}@example.com', f'bo{RUN}@example.com'
FS = 'http://127.0.0.1:8080/v1/projects/demo-dezremon/databases/(default)/documents'
PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='


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


def put(path, data): rest('PATCH', f'{FS}/{path}', {'fields': {k: enc(x) for k, x in data.items()}})


def get(path):
    try:
        return {k: dec(x) for k, x in rest('GET', f'{FS}/{path}')['fields'].items()}
    except urllib.error.HTTPError:
        return None


def query(coll, field, value, parent=''):
    res = rest('POST', f'{FS}{parent}:runQuery', {'structuredQuery': {'from': [{'collectionId': coll}], 'where': {
        'fieldFilter': {'field': {'fieldPath': field}, 'op': 'EQUAL', 'value': enc(value)}}}})
    return [{**{k: dec(x) for k, x in r['document']['fields'].items()}, '_id': r['document']['name'].split('/')[-1]} for r in res if 'document' in r]


def account(email, name):
    return rest('POST', 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-dezremon/accounts',
                {'email': email, 'password': 'secret123', 'displayName': name})['localId']


GM_UID, AN_UID, BO_UID = account(GM, 'Мастер Игры'), account(AN, 'Анна'), account(BO, 'Борис')
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
W = 'camps' + RUN
WORLD = 'Мир кампаний ' + RUN
QC = f'{W}_qtag'
put(f'worlds/{W}', {'name': WORLD, 'description': '', 'ownerId': GM_UID, 'isPublic': False, 'imageId': None, 'headerImageId': None, 'aclVersion': 0,
                    'createdAt': T0, 'updatedAt': T0, 'settings': {'disabledTypes': [], 'customTypes': [], 'playerCreateTypes': ['journal', 'note'],
                    'playersCanPost': True, 'defaultVisibility': 'members', 'dashboardPins': [], 'mainCalendarId': None, 'accent': None}})
for uid, role, name, email, chars in [(GM_UID, 'owner', 'Мастер Игры', GM, []), (AN_UID, 'player', 'Анна', AN, ['anvar']), (BO_UID, 'player', 'Борис', BO, ['lira'])]:
    put(f'worlds/{W}/members/{uid}', {'uid': uid, 'role': role, 'displayName': name, 'email': email, 'photoURL': None, 'joinedAt': T0, 'characterIds': chars})


def ent(eid, typ, name, **extra):
    put(f'worlds/{W}/entities/{eid}', {'id': eid, 'type': typ, 'name': name, 'kind': '', 'tagIds': [], 'visibility': 'members', 'allowedUids': [], 'excerpt': '',
                                       'createdBy': GM_UID, 'updatedBy': GM_UID, 'createdAt': T0, 'updatedAt': T0, 'deleted': False, 'bodyRev': 0, **extra})


put(f'worlds/{W}/images/img1', {'id': 'img1', 'name': 'p', 'mime': 'image/png', 'width': 1, 'height': 1, 'size': 70, 'chunkCount': 0, 'thumb': PNG, 'folder': '',
                                'visibility': 'members', 'allowedUids': [], 'createdBy': GM_UID, 'updatedBy': GM_UID, 'createdAt': T0, 'updatedAt': T0, 'deleted': False})
ent('qtag', 'tag', '"Вторая Лавина"', fields={'colour': '#336699'})
ent('plain', 'tag', 'Война', fields={'colour': '#aa3333'})
ent('tag-pc', 'tag', 'PC', fields={'charType': 'pc'})
ent('tag-npc', 'tag', 'NPC', fields={'charType': 'npc'})
ent('lira', 'character', 'Лира', kind='PC', tagIds=['qtag', 'tag-pc'])
ent('anvar', 'character', 'Сир Анвар', kind='PC', tagIds=['qtag', 'tag-pc'], excerpt='Рыцарь ордена.', imageId='img1')
ent('merchant', 'character', 'Торговец', kind='NPC', tagIds=['qtag', 'tag-npc'])
ent('guard', 'character', 'Страж ворот', kind='NPC', tagIds=['qtag', 'tag-npc'], excerpt='Стоит у ворот.', imageId='img1')
ent('loner', 'character', 'Отшельник', kind='NPC', tagIds=['tag-npc'])
put('campaigns/old1', {'name': 'Старая игра', 'description': '', 'cover': None, 'worldId': W, 'worldName': WORLD, 'ownerId': GM_UID, 'gmUids': [GM_UID],
                       'memberUids': [GM_UID], 'status': 'active', 'schedule': '', 'nextSessionAt': None, 'createdAt': T0, 'updatedAt': T0})
put(f'campaigns/old1/participants/{GM_UID}', {'uid': GM_UID, 'role': 'gm', 'displayName': 'Мастер Игры', 'photoURL': None, 'characterId': None, 'characterName': '', 'joinedAt': T0})

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    errs = []

    def page():
        pg = b.new_context(viewport={'width': 1440, 'height': 960}).new_page()
        pg.on('console', lambda m: errs.append(f'{m.type}: {m.text[:300]}') if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:400]))
        pg.on('dialog', lambda d: d.accept())
        return pg

    def login(pg, email):
        pg.goto(BASE + '#/login')
        pg.locator('input[type=email]').fill(email); pg.locator('input[type=password]').fill('secret123')
        pg.get_by_role('button', name='Войти', exact=True).click()
        pg.wait_for_url('**/#/worlds**', timeout=20000)

    gm = page()
    login(gm, GM)

    print('== the owner\'s visit sorts out older data')
    gm.goto(BASE + f'#/w/{W}'); gm.wait_for_selector('.db-grid', timeout=20000)
    toast = gm.locator('.toast', has_text='Создано')
    check(wait_for(lambda: toast.count() > 0), 'a toast tells what was created')
    check(wait_for(lambda: get(f'campaigns/{QC}') is not None), 'the tag in quotes became a campaign')
    c = get(f'campaigns/{QC}')
    check(c['name'] == 'Вторая Лавина' and c['worldId'] == W and c['tagId'] == 'qtag', f'campaign «Вторая Лавина» bound to the world and the tag ({c["name"]}, {c.get("tagId")})')
    check(wait_for(lambda: sorted(get(f'campaigns/{QC}')['memberUids']) == sorted([GM_UID, AN_UID, BO_UID])), 'the players of the tagged characters are in it')
    c = get(f'campaigns/{QC}')
    check(c.get('characters', {}).get(AN_UID) == ['anvar'] and c.get('characters', {}).get(BO_UID) == ['lira'], f'with their characters as current ones ({c.get("characters")})')
    t = get(f'worlds/{W}/entities/qtag')
    check(t['name'] == '⚔ Вторая Лавина' and t['fields']['campaignId'] == QC and t['fields']['colour'] == '#336699', f'the tag is «⚔ Вторая Лавина», colour kept ({t["name"]})')
    check(wait_for(lambda: get('campaigns/old1').get('tagId')), 'the older campaign got a tag')
    ot = get(f'worlds/{W}/entities/{get("campaigns/old1")["tagId"]}')
    check(ot['name'] == '⚔ Старая игра' and ot['fields']['campaignId'] == 'old1', f'named «⚔ Старая игра» ({ot["name"]})')
    check(get(f'worlds/{W}/entities/plain')['name'] == 'Война', 'other tags untouched')
    check(wait_for(lambda: len(query('rooms', 'campaignId', QC)) == 1), 'the new campaign got a music room')
    r = query('rooms', 'campaignId', QC)[0]
    check(r['name'] == 'Вторая Лавина' and r['ownerId'] == GM_UID and r['access'] == 'campaign' and get(f'campaigns/{QC}').get('roomId') == r['_id'],
          f'named like the campaign, owned by its creator, open to its members ({r["name"]}, {r["access"]})')
    check(not query('rooms', 'campaignId', 'old1'), 'campaigns that existed before get no room')
    check(wait_for(lambda: gm.locator('.sidebar .sb-link', has_text='Вторая Лавина').count() == 1 and gm.locator('.sidebar .sb-link', has_text='Старая игра').count() == 1), 'both in the sidebar')

    print('== the global page lists campaigns and leads into the world')
    gm.locator('.app-bar .app-nav a', has_text='Игры').click(); gm.wait_for_selector('.camp-row', timeout=15000)
    check(gm.locator('h1', has_text='Игры').count() == 1 and gm.locator('.camp-row').count() == 2 and gm.get_by_role('button', name='Новая игра').count() == 0, '«Игры»: two rows, no creating there')
    check(WORLD in gm.locator('.camp-row', has_text='Вторая Лавина').inner_text(), 'a row names the world')
    gm.screenshot(path=os.path.join(OUT, 'k-1-global.png'))
    gm.locator('.camp-row', has_text='Вторая Лавина').click()
    gm.wait_for_url(f'**/w/{W}/campaigns/{QC}', timeout=15000); gm.wait_for_selector('.c-hero h1', timeout=15000)
    check(True, 'the row opens the campaign inside its world')
    ov = gm.locator('.ov-person', has_text='Анна')
    check(wait_for(lambda: 'Сир Анвар' in ov.inner_text()) and 'Лира' in gm.locator('.ov-person', has_text='Борис').inner_text(), 'overview: players with their characters')
    gm.screenshot(path=os.path.join(OUT, 'k-2-campaign.png'))

    print('== a master creates a campaign from the world; its tag appears')
    gm.goto(BASE + f'#/w/{W}/campaigns'); gm.wait_for_selector('.page-head', timeout=15000)
    gm.get_by_role('button', name='Новая игра').click()
    gm.locator('.modal input[placeholder="Тени над Вельмором"]').fill('Третья кампания')
    gm.locator('.modal select[aria-label="Формат игры"]').select_option('short')
    gm.locator('.modal input[aria-label="Жанр"]').fill('тёмное фэнтези')
    gm.locator('.modal input[aria-label="Система"]').fill('D&D 5e')
    gm.screenshot(path=os.path.join(OUT, 'k-0-new-game.png'))
    gm.locator('.modal').get_by_role('button', name='Создать игру').click()
    gm.wait_for_selector('.c-hero h1', timeout=20000)
    cid = gm.url.split('/campaigns/')[1].split('/')[0]
    check(wait_for(lambda: any(e['name'] == '⚔ Третья кампания' and e.get('fields', {}).get('campaignId') == cid for e in query('entities', 'type', 'tag', f'/worlds/{W}'))), 'tag «⚔ Третья кампания» in the world')
    check(get(f'campaigns/{cid}')['tagId'], 'the campaign knows its tag')
    g = get(f'campaigns/{cid}')
    check(g.get('format') == 'short' and g.get('intro') == [{'name': 'Жанр', 'value': 'тёмное фэнтези'}, {'name': 'Система', 'value': 'D&D 5e'}],
          f'format and intro saved, empty lines dropped ({g.get("format")}, {g.get("intro")})')
    check(wait_for(lambda: 'Короткий кампейн' in gm.locator('.c-hero').inner_text()), 'the format is shown on the page')
    check(wait_for(lambda: 'тёмное фэнтези' in gm.locator('.intro-card').inner_text() and 'D&D 5e' in gm.locator('.intro-card').inner_text()), 'the intro is shown on the page')
    check(wait_for(lambda: get(f'campaigns/{cid}').get('roomId')), 'and its music room')
    room = get(f'rooms/{get(f"campaigns/{cid}")["roomId"]}')
    check(room['name'] == 'Третья кампания' and room['ownerId'] == GM_UID and room['campaignId'] == cid and room['access'] == 'campaign', f'the room: same name, the creator owns it ({room["name"]})')
    check(wait_for(lambda: gm.locator('.c-room').count() == 1), 'the campaign page links to its room')

    print('== settings: add a member of the world; rename (the tag follows)')
    gm.locator('.tabs .tab', has_text='Настройки').click(); gm.wait_for_selector('.member-picker', timeout=10000)
    gm.locator('.member-picker').click(); gm.locator('.member-picker-menu input').fill('Анн'); gm.locator('.member-picker-menu input').press('Enter')
    check(wait_for(lambda: AN_UID in get(f'campaigns/{cid}')['memberUids']), 'Анна added')
    name = gm.locator('label.field', has_text='Название').locator('input')
    name.fill('Третья кампания 2')
    gm.locator('select[aria-label="Формат игры"]').select_option('oneshot')
    gm.locator('label.field', has_text='Статус').locator('select').select_option('planning')
    gm.locator('.intro-add', has_text='Игроков').click(); gm.locator('input[aria-label="Игроков"]').fill('4')
    gm.get_by_role('button', name='Сохранить').click()
    check(wait_for(lambda: get(f'campaigns/{cid}').get('format') == 'oneshot' and {'name': 'Игроков', 'value': '4'} in get(f'campaigns/{cid}').get('intro', [])), 'settings change the format and the intro')
    check(wait_for(lambda: get(f'worlds/{W}/entities/{get(f"campaigns/{cid}")["tagId"]}')['name'] == '⚔ Третья кампания 2'), 'renaming the campaign renames its tag')
    check(wait_for(lambda: get(f'rooms/{get(f"campaigns/{cid}")["roomId"]}')['name'] == 'Третья кампания 2'), 'and its room')
    check(wait_for(lambda: get(f'worlds/{W}/entities/{get(f"campaigns/{cid}")["tagId"]}')['fields'].get('campaignStatus') == 'planning'),
          'the tag keeps a copy of the status (for members who cannot read the game)')

    print('== the member card: campaigns of the world')
    gm.goto(BASE + f'#/w/{W}/settings/members'); gm.wait_for_selector('tr', timeout=15000)
    gm.locator('tr', has_text='Анна').get_by_role('button', name='Права').click(); gm.wait_for_selector('.mm-camps', timeout=10000)
    camps = gm.locator('.mm-camps')
    check(camps.locator('label', has_text='Вторая Лавина').locator('input').is_checked() and camps.locator('label', has_text='Третья кампания 2').locator('input').is_checked(), 'her campaigns are checked')
    camps.locator('label', has_text='Третья кампания 2').locator('input').uncheck()
    check(wait_for(lambda: AN_UID not in get(f'campaigns/{cid}')['memberUids']), 'unchecking takes her out')
    camps.locator('label', has_text='Старая игра').locator('input').check()
    check(wait_for(lambda: AN_UID in get('campaigns/old1')['memberUids']), 'checking adds her')
    gm.screenshot(path=os.path.join(OUT, 'k-3-member-card.png'))
    gm.locator('.modal-head .icon-btn').first.click(); gm.wait_for_timeout(300)

    print('== characters by game: the default view; running games, outside games, paused, being prepared, finished')
    T2 = int(time.time() * 1000)
    rest('PATCH', f'{FS}/campaigns/old1?updateMask.fieldPaths=status&updateMask.fieldPaths=characters&updateMask.fieldPaths=updatedAt',
         {'fields': {'status': enc('paused'), 'characters': enc({AN_UID: ['loner']}), 'updatedAt': enc(T2)}})
    for gid, gname, st, ch in [('plan1', 'Утро гильдии', 'planning', 'anvar'), ('done1', 'Былое', 'finished', 'lira')]:
        put(f'campaigns/{gid}', {'name': gname, 'description': '', 'cover': None, 'worldId': W, 'worldName': WORLD, 'ownerId': GM_UID, 'gmUids': [GM_UID],
                                 'memberUids': [GM_UID], 'status': st, 'schedule': '', 'nextSessionAt': None, 'characters': {AN_UID: [ch]}, 'createdAt': T2, 'updatedAt': T2})
    ent('stray', 'character', 'Бродяга', kind='NPC', tagIds=['tag-npc'], updatedAt=T2)
    ent('scout', 'character', 'Разведчица', kind='PC', tagIds=[get(f'campaigns/{cid}')['tagId'], 'tag-pc'], updatedAt=T2)
    gm.goto(BASE + f'#/w/{W}/t/character'); gm.wait_for_selector('.page-head', timeout=15000)
    check(wait_for(lambda: gm.locator('.camp-group').count() >= 2), 'characters open «По играм» without choosing it')
    check(gm.locator('button[title^="По играм"].on').count() == 1, 'and the switch shows it')
    want = ['⚔ Вторая Лавина', 'Вне игр', '⚔ Старая игра', '⚔ Третья кампания 2', '⚔ Утро гильдии', '⚔ Былое']
    check(wait_for(lambda: [x.strip() for x in gm.locator('.camp-group-head .camp-group-title').all_inner_texts()] == want),
          f'group order ({[x.strip() for x in gm.locator(".camp-group-head .camp-group-title").all_inner_texts()]})')
    notes = [gm.locator('.camp-group').nth(i).locator('.camp-group-note').all_inner_texts() for i in range(6)]
    check(notes == [[], [], ['на паузе'], ['готовится'], ['готовится'], ['завершена']], f'status marks ({notes})')
    bw = [gm.locator('.camp-group').nth(i).evaluate("e => getComputedStyle(e).borderTopWidth") for i in range(2)]
    check(bw[0] == '0px' and bw[1] == '1px', f'lines between the groups ({bw})')
    w = gm.locator('.card-grid .ecard').first.evaluate('e => e.getBoundingClientRect().width')
    check(w < 205, f'smaller tiles ({w:.0f}px)')
    g = gm.locator('.camp-group').first
    runs = [x.strip().lower() for x in g.locator('.camp-run').all_inner_texts()]
    check(runs == ['игровые персонажи · 2', 'npc · 2'], f'PCs first, then NPCs ({runs})')
    names = [x.strip() for x in g.locator('.ecard-name').all_inner_texts()]
    check(names == ['Сир Анвар', 'Лира', 'Страж ворот', 'Торговец'], f'picture and text first in each run ({names})')
    check([x.strip() for x in gm.locator('.camp-group').nth(1).locator('.ecard-name').all_inner_texts()] == ['Бродяга'], 'characters of no game: right after the running games')
    check([x.strip() for x in gm.locator('.camp-group').nth(2).locator('.ecard-name').all_inner_texts()] == ['Отшельник'], 'a current character of a paused game is in its group')
    gm.locator('button[title="Таблица"]').click(); gm.wait_for_selector('table', timeout=5000)
    gm.goto(BASE + f'#/w/{W}/t/location'); gm.wait_for_selector('.page-head', timeout=15000)
    gm.goto(BASE + f'#/w/{W}/t/character'); gm.wait_for_selector('table', timeout=15000)
    check(True, 'a chosen view is remembered for the section')
    gm.locator('button[title^="По играм"]').click(); gm.wait_for_selector('.camp-group', timeout=5000)
    gm.screenshot(path=os.path.join(OUT, 'k-4-by-campaign.png'))

    print('== the campaign tag on new articles')
    bar = gm.locator('.camp-bar')
    bar.locator('select').select_option(label='⚔ Вторая Лавина')
    bar.locator('input[type=checkbox]').check()
    check(wait_for(lambda: gm.locator('.sidebar .sb-autotag', has_text='Вторая Лавина').count() == 1), 'the sidebar shows the tag goes on new articles')
    gm.locator('.sidebar').get_by_role('button', name='Создать', exact=True).click()
    gm.locator('.modal .type-tile', has_text='Заметка').click()
    sel = gm.locator('.modal label.field', has_text='Игра').locator('select')
    check(sel.locator('option:checked').inner_text() == '⚔ Вторая Лавина', 'the creation window preselects it')
    gm.locator('.modal input[maxlength="200"]').fill('Слухи о лавине')
    gm.screenshot(path=os.path.join(OUT, 'k-5-create.png'))
    gm.get_by_role('button', name='Создать и редактировать').click(); gm.wait_for_url('**/e/**', timeout=15000)
    nid = gm.url.split('/e/')[1].split('?')[0]
    check(wait_for(lambda: 'qtag' in get(f'worlds/{W}/entities/{nid}')['tagIds']), 'the note carries the campaign tag')
    sid = gm.evaluate("""async () => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('world').createEntity('location', 'Перевал', {})""")
    tid = gm.evaluate("""async () => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('world').createEntity('tag', 'Новый тег', {})""")
    check(wait_for(lambda: 'qtag' in get(f'worlds/{W}/entities/{sid}')['tagIds']), 'any new article gets it (a location made elsewhere)')
    check(wait_for(lambda: get(f'worlds/{W}/entities/{tid}') is not None and 'qtag' not in get(f'worlds/{W}/entities/{tid}')['tagIds']), 'but not a new tag')
    gm.goto(BASE + f'#/w/{W}/t/note'); gm.wait_for_selector('.page-head', timeout=15000)
    gm.get_by_role('button', name='Создать заметку').click()
    gm.locator('.modal label.field', has_text='Игра').locator('select').select_option(label='— без игры —')
    gm.locator('.modal input[maxlength="200"]').fill('Без кампейна')
    gm.get_by_role('button', name='Создать и редактировать').click(); gm.wait_for_url('**/e/**', timeout=15000)
    n2 = gm.url.split('/e/')[1].split('?')[0]
    check(wait_for(lambda: get(f'worlds/{W}/entities/{n2}') is not None and 'qtag' not in get(f'worlds/{W}/entities/{n2}')['tagIds']), '«без кампейна» in the window wins over the switch')
    gm.goto(BASE + f'#/w/{W}/t/note'); gm.wait_for_selector('.camp-bar', timeout=15000)
    gm.locator('.camp-bar input[type=checkbox]').uncheck()
    check(wait_for(lambda: gm.locator('.sidebar .sb-autotag').count() == 0), 'switched off: the sidebar mark goes')

    print('== the tags page')
    gm.goto(BASE + f'#/w/{W}/t/tag'); gm.wait_for_selector('.page-head', timeout=15000)
    gm.locator('button[title="Карточки"]').click(); gm.wait_for_selector('.ecard-tag', timeout=10000)
    camp_card = gm.locator('.ecard-tag', has_text='Вторая Лавина')
    plain_card = gm.locator('.ecard-tag', has_text='Война')
    check(camp_card.locator('.ecard-plaque').count() == 1 and camp_card.locator('.badge-campaign').count() == 1, 'a campaign tag: plaque and the campaign mark')
    check(plain_card.locator('.ecard-plaque').count() == 1 and plain_card.locator('.badge-campaign').count() == 0, 'an ordinary tag: plaque, no mark')
    col = plain_card.locator('.ecard-plaque').evaluate("e => getComputedStyle(e).getPropertyValue('--tag-color').trim()")
    check(col == '#aa3333', f'the plaque has the tag colour ({col})')
    check('статей' in camp_card.inner_text() or 'статьи' in camp_card.inner_text(), 'how many articles carry it')
    gm.screenshot(path=os.path.join(OUT, 'k-6-tags.png'))
    gm.locator('button[title="Таблица"]').click(); gm.wait_for_selector('table', timeout=5000)
    check(gm.locator('th', has_text='Цвет').count() == 1 and gm.locator('tr', has_text='Вторая Лавина').locator('.badge', has_text='игра').count() == 1, 'table: colour column and the game mark')
    gm.locator('button[title="Карточки"]').click()

    print('== «Мои игры»: games I run or play in, running or being prepared')
    T1 = int(time.time() * 1000)
    put('campaigns/fin1', {'name': 'Законченная', 'description': '', 'cover': None, 'worldId': W, 'worldName': WORLD, 'ownerId': GM_UID, 'gmUids': [GM_UID],
                           'memberUids': [GM_UID], 'status': 'finished', 'schedule': '', 'nextSessionAt': None, 'createdAt': T1, 'updatedAt': T1})
    rest('PATCH', f'{FS}/campaigns/old1?updateMask.fieldPaths=memberUids&updateMask.fieldPaths=gmUids&updateMask.fieldPaths=updatedAt',
         {'fields': {'memberUids': enc([AN_UID]), 'gmUids': enc([]), 'updatedAt': enc(T1)}})
    rest('PATCH', f'{FS}/campaigns/{cid}?updateMask.fieldPaths=status&updateMask.fieldPaths=updatedAt', {'fields': {'status': enc('planning'), 'updatedAt': enc(T1)}})
    sb = gm.locator('.sidebar')
    check(wait_for(lambda: sb.locator('.sb-section-title', has_text='Мои игры').count() == 1 and sb.locator('.sb-link', has_text='Законченная').count() == 0), 'a finished game is not in «Мои игры»')
    check(wait_for(lambda: sb.locator('.sb-link', has_text='Старая игра').count() == 0), 'nor a game the master is not in')
    check(sb.locator('.sb-link', has_text='Вторая Лавина').count() == 1 and 'готовится' in sb.locator('.sb-link', has_text='Третья кампания 2').inner_text(), 'running and preparing ones are, the latter marked')
    names = [x.strip().splitlines()[0] for x in sb.locator('.sb-link[href*="/campaigns/"]').all_inner_texts()]
    check(names[:2] == ['Вторая Лавина', 'Третья кампания 2'], f'running first ({names})')
    more = sb.locator('.sb-more')
    check(more.count() == 1 and 'Все игры мира: 6' in more.inner_text(), f'a link to all games of the world ({more.inner_text() if more.count() else ""})')
    gm.screenshot(path=os.path.join(OUT, 'k-8-sidebar.png'), clip={'x': 0, 'y': 300, 'width': 280, 'height': 420})
    more.click(); gm.wait_for_url(f'**/w/{W}/campaigns', timeout=10000)
    check(gm.locator('.camp-card', has_text='Старая игра').count() == 1 and gm.locator('.camp-card', has_text='Законченная').count() == 1, 'the world\'s «Игры» page lists all of them')

    print('== a player')
    an = page()
    login(an, AN)
    an.locator('.app-bar .app-nav a', has_text='Игры').click(); an.wait_for_selector('.camp-row', timeout=15000)
    rows = [x for x in an.locator('.camp-row .camp-name').all_inner_texts()]
    check(sorted(rows) == ['Вторая Лавина', 'Старая игра'], f'her campaigns only ({rows})')
    an.goto(BASE + f'#/w/{W}/t/character'); an.wait_for_selector('.page-head', timeout=20000)
    heads_an = lambda: [x.strip() for x in an.locator('.camp-group-head .camp-group-title').all_inner_texts()]
    check(wait_for(lambda: heads_an() == ['⚔ Вторая Лавина', 'Вне игр', '⚔ Старая игра', '⚔ Третья кампания 2']),
          f'a player outside a game sees its group in its place by status ({heads_an()})')
    check(an.locator('.camp-group').nth(3).locator('.camp-group-note').inner_text() == 'готовится', 'with the status mark from the tag')
    an.goto(BASE + f'#/w/{W}'); an.wait_for_selector('.db-grid', timeout=20000)
    check(wait_for(lambda: an.locator('.sidebar .sb-link', has_text='Вторая Лавина').count() == 1) and an.locator('.sidebar .sb-link', has_text='Третья').count() == 0, 'world sidebar: hers, not the others')
    an.goto(BASE + f'#/w/{W}/campaigns/{QC}'); an.wait_for_selector('.c-room', timeout=15000)
    an.locator('.c-room').click()
    check(wait_for(lambda: an.locator('.room-head h1').count() == 1 and 'Вторая Лавина' in an.locator('.room-head h1').inner_text()), 'a player of the campaign enters its room')
    an.goto(BASE + f'#/w/{W}/campaigns/{QC}/people'); an.wait_for_selector('.person', timeout=15000)
    check(an.locator('.person', has_text='Борис').get_by_role('button', name='Персонажи').count() == 0, 'she cannot change Boris\'s characters')
    an.locator('.person', has_text='Анна').get_by_role('button', name='Персонажи').click()
    own = an.locator('.modal .own-char', has_text='Сир Анвар').locator('input')
    check(own.is_checked(), 'her character is offered and checked')
    own.uncheck(); an.get_by_role('button', name='Сохранить').click()
    check(wait_for(lambda: get(f'campaigns/{QC}').get('characters', {}).get(AN_UID) == []), 'she changes her current characters')
    an.goto(BASE + f'#/w/{W}/campaigns/{cid}'); an.wait_for_selector('.content', timeout=15000)
    check(wait_for(lambda: 'Игра недоступна' in an.locator('.content').inner_text()), 'a game she is not in is closed to her')
    an.goto(BASE + f'#/c/{QC}')
    # (the address is read from the page: Playwright's page.url can miss a replaceState right after a hash goto)
    check(wait_for(lambda: f'/w/{W}/campaigns/{QC}' in an.evaluate('location.hash')) and an.locator('.c-hero h1').inner_text() == 'Вторая Лавина',
          f'an old link #/c/… leads into the world ({an.evaluate("location.hash")})')

    print('== tags of games made before the status copy get it on the owner\'s visit')
    otag = get('campaigns/old1')['tagId']
    rest('PATCH', f'{FS}/worlds/{W}/entities/{otag}?updateMask.fieldPaths=fields.campaignStatus', {'fields': {}})
    check(get(f'worlds/{W}/entities/{otag}')['fields'].get('campaignStatus') is None, '(the copy is gone)')
    gm.reload(); gm.wait_for_selector('.sidebar', timeout=20000)
    check(wait_for(lambda: get(f'worlds/{W}/entities/{otag}')['fields'].get('campaignStatus') == 'paused', 15), 'the owner\'s visit writes the status onto the tag')

    print('== phone width')
    an.set_viewport_size({'width': 390, 'height': 844})
    for nm, url in [('global', '#/campaigns'), ('campaign', f'#/w/{W}/campaigns/{QC}'), ('characters', f'#/w/{W}/t/character')]:
        an.goto(BASE + url); an.wait_for_timeout(2500)
        check(an.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), f'{nm}: no sideways scroll on a phone')
        an.screenshot(path=os.path.join(OUT, f'k-7-phone-{nm}.png'))

    real = [x for x in errs if 'favicon' not in x]
    check(not real, f'no console errors ({real[:5]})')
    b.close()

print('\nFAILED:' if FAILS else '\nALL OK', *FAILS, sep='\n  ')
sys.exit(1 if FAILS else 0)
