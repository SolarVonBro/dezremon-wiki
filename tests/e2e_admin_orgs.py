"""E2E tests against Firebase emulators for:
1. Service admin world modes (read-only view, admin edit, and normal player mode even after joining as player).
2. Character card sidebar 'Организации' editor (master and player editing own/editable character), synced with OrgMembers.
"""
import json
import os
import re
import sys
import traceback
import urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_URL', 'http://127.0.0.1:4174/')
AUTH_EMU = os.environ.get('AUTH_EMU_URL', 'http://127.0.0.1:9099')
PROJECT_ID = os.environ.get('FIREBASE_PROJECT', 'demo-dezremon')
ADMIN_UID = 'TRLvfuNmFtR9TByopvMl8yIG1jG2'
ADMIN_EMAIL = 'service-admin@example.com'
ADMIN_PASS = 'secret123'

errors: list[str] = []
fails: list[str] = []
state: dict[str, str] = {}


def step(name, fn):
    print('->', name, flush=True)
    try:
        fn()
    except Exception as e:
        tb = traceback.format_exc()
        msg = (str(e) or repr(e)).splitlines()[0]
        fails.append(f'{name}: {msg[:260]}')
        print('   FAILED:', msg[:240], flush=True)
        print(tb, flush=True)


def create_emu_account(uid: str, email: str, password: str, display_name: str):
    url = f'{AUTH_EMU}/identitytoolkit.googleapis.com/v1/projects/{PROJECT_ID}/accounts'
    body = json.dumps({
        'localId': uid,
        'email': email,
        'password': password,
        'displayName': display_name,
    }).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=body,
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer owner'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        assert data.get('localId') == uid, f'unexpected localId: {data}'


def register(pg, nick, email):
    pg.goto(BASE + '#/login')
    pg.get_by_text('Регистрация', exact=True).last.click()
    pg.locator('input[autocomplete=nickname]').fill(nick)
    pg.locator('input[type=email]').fill(email)
    pg.locator('input[type=password]').fill('secret123')
    pg.get_by_role('button', name='Зарегистрироваться').click()


def login(pg, email, password):
    pg.goto(BASE + '#/login')
    pg.locator('input[type=email]').fill(email)
    pg.locator('input[type=password]').fill(password)
    pg.get_by_role('button', name='Войти', exact=True).click()


def watch(pg, label):
    pg.on('console', lambda m: errors.append(f'[{label}] {m.text[:300]}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'[{label}] pageerror {str(e)[:300]}'))
    pg.on('dialog', lambda d: d.accept())


def create_entity(pg, type_label: str, name: str, vis_label: str | None = None):
    pg.locator('.sidebar').get_by_role('button', name='Создать', exact=True).click()
    pg.locator('.type-tile', has_text=type_label).click()
    pg.locator('.modal input.input').first.fill(name)
    if vis_label:
        pg.locator('.modal .vis-opt', has_text=vis_label).click()
    pg.get_by_role('button', name='Создать и редактировать').click()
    pg.wait_for_selector('.hero-name-input', timeout=20000)


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    oc = b.new_context(viewport={'width': 1440, 'height': 950})
    own = oc.new_page()
    watch(own, 'owner')

    ac = b.new_context(viewport={'width': 1440, 'height': 950})
    adm = ac.new_page()
    watch(adm, 'admin')

    def owner_setup():
        register(own, 'Мастер Мира', 'owner-test@example.com')
        own.wait_for_selector('text=Мои миры', timeout=20000)
        own.get_by_role('button', name='Новый мир').click()
        own.locator('.modal input.input').first.fill('Мир проверки')
        own.get_by_role('button', name='Создать мир').click()
        own.wait_for_selector('.dash-hero h1', timeout=20000)
        state['world'] = own.url.split('?')[0].rstrip('/')
        state['wid'] = state['world'].split('/w/')[1].split('/')[0]

        # 1. Master-only note
        create_entity(own, 'Заметка', 'Секретная записка', 'Только мастерам')
        own.get_by_role('button', name='Готово').click()
        own.wait_for_timeout(400)

        # 2. Members-visible note with secret block + GM notes
        create_entity(own, 'Заметка', 'Заметка с тайной')
        ed = own.locator('.ProseMirror')
        ed.click()
        own.keyboard.type('Публичный текст статьи')
        own.keyboard.press('Enter')
        # Add secret block via toolbar button
        own.locator('button.tb-secret').click()
        own.keyboard.type('Секретный абзац мастера')
        gm = own.locator('#gm-notes')
        gm.fill('Секретная заметка мастера')
        gm.blur()
        own.wait_for_timeout(1200)
        own.get_by_role('button', name='Готово').click()
        own.wait_for_selector('.article-card', timeout=15000)
        state['secret_note_url'] = own.url.split('?')[0]

        # 3. Organisations
        create_entity(own, 'Организация', 'Гильдия Магов')
        own.get_by_role('button', name='Готово').click()
        own.wait_for_timeout(400)
        state['org1_url'] = own.url.split('?')[0]

        create_entity(own, 'Организация', 'Тайная Ложа')
        own.get_by_role('button', name='Готово').click()
        own.wait_for_timeout(400)
        state['org2_url'] = own.url.split('?')[0]

        # 4. Character
        create_entity(own, 'Персонаж', 'Герой Валиан')
        state['char_url'] = own.url.split('?')[0]

    def char_sidebar_orgs_master():
        # Currently editing 'Герой Валиан'
        org_field = own.locator('.facts-edit .field', has_text='Организации')
        org_field.wait_for(state='visible', timeout=10000)

        # Add Гильдия Магов
        org_field.locator('.picker-btn').click()
        own.locator('.picker-menu .menu-item', has_text='Гильдия Магов').click()
        row1 = org_field.locator('.org-edit-row', has_text='Гильдия Магов')
        row1.wait_for(state='visible', timeout=10000)
        row1.locator('input').fill('Архимаг')
        row1.locator('input').blur()
        own.wait_for_timeout(500)

        # Add Тайная Ложа as inactive
        org_field.locator('.picker-btn').click()
        own.locator('.picker-menu .menu-item', has_text='Тайная Ложа').click()
        row2 = org_field.locator('.org-edit-row', has_text='Тайная Ложа')
        row2.wait_for(state='visible', timeout=10000)
        row2.locator('input').fill('Шпион')
        row2.locator('input').blur()
        row2.locator('select').select_option('inactive')
        own.wait_for_timeout(600)

        # Exit edit mode and check view sidebar
        own.get_by_role('button', name='Готово').click()
        own.wait_for_selector('.facts', timeout=10000)
        facts_text = own.locator('.facts').inner_text()
        assert 'Организации' in facts_text, f'missing Организации in view: {facts_text}'
        assert 'Гильдия Магов' in facts_text and 'Архимаг' in facts_text, f'missing org1/role: {facts_text}'
        assert 'Тайная Ложа' in facts_text and 'Шпион' in facts_text and 'бывший' in facts_text, f'missing org2: {facts_text}'

        # Check synced in Гильдия Магов -> Участники
        own.goto(state['org1_url'] + '?tab=feature')
        own.wait_for_selector('table.table', timeout=15000)
        tbl = own.locator('table.table').inner_text()
        assert 'Герой Валиан' in tbl and 'Архимаг' in tbl, f'org1 members missing char: {tbl}'

        # Remove Тайная Ложа from character sidebar
        own.goto(state['char_url'] + '?edit=1')
        org_field = own.locator('.facts-edit .field', has_text='Организации')
        row2 = org_field.locator('.org-edit-row', has_text='Тайная Ложа')
        row2.wait_for(state='visible', timeout=10000)
        row2.locator('button[title="Убрать организацию"]').click()
        own.wait_for_timeout(600)
        own.get_by_role('button', name='Готово').click()
        own.wait_for_selector('.facts', timeout=10000)
        facts_text = own.locator('.facts').inner_text()
        assert 'Тайная Ложа' not in facts_text, f'org2 still present: {facts_text}'
        assert 'Гильдия Магов' in facts_text, f'org1 disappeared: {facts_text}'

        # Verify removed from Тайная Ложа -> Участники too
        own.goto(state['org2_url'] + '?tab=feature')
        own.wait_for_selector('text=Никого нет.', timeout=15000)

    def create_invite():
        own.goto(state['world'] + '/settings/members')
        own.wait_for_selector('text=Создать ссылку', timeout=15000)
        own.get_by_role('button', name='Создать ссылку').click()
        own.wait_for_selector('.invite-url', timeout=10000)
        state['invite'] = own.locator('.invite-url').first.input_value()

    def admin_non_member_modes():
        create_emu_account(ADMIN_UID, ADMIN_EMAIL, ADMIN_PASS, 'Сервис Админ')
        login(adm, ADMIN_EMAIL, ADMIN_PASS)
        adm.wait_for_selector('text=Мои миры', timeout=20000)

        # Open Admin panel -> Worlds
        adm.goto(BASE + '#/admin/worlds')
        row = adm.locator('tr', has_text='Мир проверки')
        row.wait_for(state='visible', timeout=20000)
        assert 'вы:' not in row.inner_text(), 'unexpected member badge for non-member admin'
        assert row.locator('a[title*="Просмотр как админ"]').count() == 1
        assert row.locator('a[title*="с редактированием"]').count() == 1
        assert row.locator('a[title*="Войти как участник"]').count() == 0

        # Enter read-only admin view
        row.locator('a[title*="Просмотр как админ"]').click()
        adm.wait_for_selector('.admin-banner', timeout=20000)
        assert 'только просмотр' in adm.locator('.admin-banner').inner_text()
        assert 'Админ · просмотр' in adm.locator('.sb-world-role').inner_text()
        assert adm.locator('.sidebar').get_by_role('button', name='Создать', exact=True).count() == 0, 'Create button visible in read-only admin'
        assert adm.locator('.sidebar a', has_text='Настройки мира').count() == 0, 'Settings link visible in read-only admin'

        # Sees master-only note
        adm.goto(state['world'] + '/t/note')
        adm.wait_for_selector('.ecard', timeout=15000)
        assert adm.locator('.ecard', has_text='Секретная записка').count() == 1, 'master-only note hidden in admin view'

        # Sees secret block & GM notes, but NO edit button
        adm.goto(state['secret_note_url'])
        adm.wait_for_selector('.article-card', timeout=15000)
        adm.wait_for_selector('.gm-notes', timeout=10000)
        assert 'Секретный абзац мастера' in adm.locator('.article-card').inner_text(), 'secret block missing in admin view'
        assert 'Секретная заметка мастера' in adm.locator('.gm-notes').inner_text(), 'GM note missing in admin view'
        assert adm.get_by_role('button', name='Редактировать').count() == 0, 'Edit button visible in admin read-only view'

        # Settings blocked in read-only view with helpful message
        adm.goto(state['world'] + '/settings/members')
        adm.wait_for_selector('text=Настройки доступны в режиме редактирования администратора.', timeout=10000)

        # Toggle to edit mode from banner
        adm.locator('.admin-banner').get_by_role('button', name='Редактирование').click()
        adm.wait_for_selector('text=Участники и права', timeout=15000)
        assert 'редактирование' in adm.locator('.admin-banner').inner_text()
        assert 'Админ · правка' in adm.locator('.sb-world-role').inner_text()
        assert adm.locator('.sidebar').get_by_role('button', name='Создать', exact=True).count() == 1
        assert adm.locator('.sidebar a', has_text='Настройки мира').count() == 1

        # Reload preserves edit mode
        adm.reload()
        adm.wait_for_selector('text=Участники и права', timeout=20000)
        assert 'редактирование' in adm.locator('.admin-banner').inner_text()

        # On note page edit button is present, then toggling back to view hides it
        adm.goto(state['secret_note_url'])
        adm.wait_for_selector('.article-card', timeout=15000)
        assert adm.get_by_role('button', name='Редактировать').count() == 1
        adm.locator('.admin-banner').get_by_role('button', name='Только просмотр').click()
        adm.wait_for_timeout(400)
        assert adm.get_by_role('button', name='Редактировать').count() == 0

    def admin_joins_as_player_and_switches():
        # Join the world as a player
        adm.goto(state['invite'])
        adm.get_by_role('button', name='Принять приглашение').click()
        adm.wait_for_selector('.dash-hero h1', timeout=20000)

        # Owner grants player edit rights on 'Герой Валиан'
        own.goto(state['world'] + '/settings/members')
        own.wait_for_selector('tr:has-text("Сервис Админ")', timeout=20000)
        own.locator('tr', has_text='Сервис Админ').get_by_role('button', name='Права').click()
        own.wait_for_selector('.mm', timeout=10000)
        sec = own.locator('.mm .card', has_text='Может редактировать')
        sec.locator('.picker-btn').click()
        own.locator('.picker-menu .menu-item', has_text='Герой Валиан').click()
        own.wait_for_timeout(800)

        # Re-open from 'Мои миры' -> must enter as normal player (no banner, no secrets)
        adm.goto(BASE + '#/worlds')
        adm.wait_for_selector('.wcard-name:has-text("Мир проверки")', timeout=20000)
        adm.locator('.wcard', has_text='Мир проверки').click()
        adm.wait_for_selector('.dash-hero h1', timeout=20000)
        assert 'Игрок' in adm.locator('.sb-world-role').inner_text(), f'expected player role, got {adm.locator(".sb-world-role").inner_text()}'
        assert adm.locator('.admin-banner').count() == 0, 'admin banner shown in player mode'

        adm.goto(state['world'] + '/t/note')
        adm.wait_for_selector('.ecard:has-text("Заметка с тайной")', timeout=15000)
        assert adm.locator('.ecard', has_text='Секретная записка').count() == 0, 'master-only note leaked in player mode'

        adm.goto(state['secret_note_url'])
        adm.wait_for_selector('.article-card:has-text("Публичный текст статьи")', timeout=15000)
        txt = adm.locator('.article-card').inner_text()
        assert 'Публичный текст статьи' in txt, f'public text missing: {txt}'
        assert 'Секретный абзац мастера' not in txt, 'secret block leaked in player mode'
        assert adm.locator('.gm-notes').count() == 0, 'GM notes leaked in player mode'

        # Player adds organisation on editable character card sidebar
        adm.goto(state['char_url'])
        adm.wait_for_selector('.facts', timeout=15000)
        adm.get_by_role('button', name='Редактировать').click()
        org_field = adm.locator('.facts-edit .field', has_text='Организации')
        org_field.wait_for(state='visible', timeout=10000)
        org_field.locator('.picker-btn').click()
        adm.locator('.picker-menu .menu-item', has_text='Тайная Ложа').click()
        row = org_field.locator('.org-edit-row', has_text='Тайная Ложа')
        row.wait_for(state='visible', timeout=10000)
        row.locator('input').fill('Агент')
        row.locator('input').blur()
        adm.wait_for_timeout(600)
        adm.get_by_role('button', name='Готово').click()
        adm.wait_for_selector('.facts', timeout=10000)
        assert 'Тайная Ложа' in adm.locator('.facts').inner_text() and 'Агент' in adm.locator('.facts').inner_text()
        assert adm.locator('.toast.error').count() == 0, 'error toast when player added org'

        # Switch from player mode to admin mode via UserMenu
        adm.goto(state['secret_note_url'])
        adm.wait_for_selector('.article-card', timeout=15000)
        adm.locator('.user-btn').click()
        adm.locator('.menu-item', has_text='Просмотр (админ)').click()
        adm.wait_for_selector('.admin-banner', timeout=15000)
        adm.wait_for_selector('.gm-notes', timeout=15000)
        assert 'Секретный абзац мастера' in adm.locator('.article-card').inner_text(), 'secret block did not load after UserMenu switch'
        assert adm.get_by_role('button', name='Редактировать').count() == 0

        # Switch back to player from banner -> secrets disappear immediately
        adm.locator('.admin-banner').get_by_role('button', name='Как игрок').click()
        adm.wait_for_selector('.article-card:has-text("Публичный текст статьи")', timeout=15000)
        adm.wait_for_timeout(500)
        assert adm.locator('.admin-banner').count() == 0, 'admin banner still present'
        assert 'Игрок' in adm.locator('.sb-world-role').inner_text(), f'role not player: {adm.locator(".sb-world-role").inner_text()}'
        assert adm.locator('.gm-notes').count() == 0, 'GM notes still present'
        assert 'Секретный абзац мастера' not in adm.locator('.article-card').inner_text(), 'secret block still visible after switching to player'

        # Now test all 4 buttons in AdminView -> Worlds when admin IS a player member
        adm.goto(BASE + '#/admin/worlds')
        row = adm.locator('tr', has_text='Мир проверки')
        row.wait_for(state='visible', timeout=20000)
        assert 'вы: игрок' in row.inner_text(), f'missing player badge: {row.inner_text()}'
        assert row.locator('a[title*="Войти как участник"]').count() == 1

        # 1) Click Settings icon -> must enter directly into Settings in admin edit mode!
        row.locator('a[title*="Настройки мира"]').click()
        adm.wait_for_selector('text=Участники и права', timeout=20000)
        assert 'редактирование' in adm.locator('.admin-banner').inner_text()

        # 2) Back to AdminView -> click Admin View (eye) -> read-only admin with 'Как игрок' button
        adm.goto(BASE + '#/admin/worlds')
        row = adm.locator('tr', has_text='Мир проверки')
        row.wait_for(state='visible', timeout=20000)
        row.locator('a[title*="Просмотр как админ"]').click()
        adm.wait_for_selector('.admin-banner', timeout=20000)
        assert 'только просмотр' in adm.locator('.admin-banner').inner_text()
        assert adm.locator('.admin-banner').get_by_role('button', name='Как игрок').count() == 1

        # 3) Back to AdminView -> click Admin Edit (pencil) -> edit admin
        adm.goto(BASE + '#/admin/worlds')
        row = adm.locator('tr', has_text='Мир проверки')
        row.wait_for(state='visible', timeout=20000)
        row.locator('a[title*="с редактированием"]').click()
        adm.wait_for_selector('.admin-banner', timeout=20000)
        assert 'редактирование' in adm.locator('.admin-banner').inner_text()
        assert adm.locator('.sidebar a', has_text='Настройки мира').count() == 1

        # 4) Back to AdminView -> click Enter as member (user) -> normal player
        adm.goto(BASE + '#/admin/worlds')
        row = adm.locator('tr', has_text='Мир проверки')
        row.wait_for(state='visible', timeout=20000)
        row.locator('a[title*="Войти как участник"]').click()
        adm.wait_for_selector('.dash-hero h1', timeout=20000)
        assert adm.locator('.admin-banner').count() == 0
        assert 'Игрок' in adm.locator('.sb-world-role').inner_text()

    step('owner setup world, secrets, orgs, character', owner_setup)
    step('character sidebar organisations (master)', char_sidebar_orgs_master)
    step('owner creates player invite', create_invite)
    step('service admin non-member: read-only view, edit toggle, reload', admin_non_member_modes)
    step('service admin joined as player: player mode, player sidebar orgs, UserMenu & AdminView switches', admin_joins_as_player_and_switches)

    b.close()

print('\nFAILS:' if fails else '\nALL STEPS PASSED')
for f in fails:
    print('  ', f)
u = list(dict.fromkeys(errors))
print('CONSOLE ERRORS:' if u else 'NO CONSOLE ERRORS')
for e in u[:20]:
    print('  ', e)
sys.exit(1 if fails or u else 0)
