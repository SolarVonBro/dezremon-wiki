"""Cabinet + world admin + preview + mobile login + ban + world deletion, on the live site."""
import os, sys, random, re
from playwright.sync_api import sync_playwright

BASE = os.environ.get('E2E_URL', 'http://localhost:5173/')
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
RUN = str(random.randint(10000, 99999))
errors, fails = [], []
state = {}
PAGES = {}


def step(name, fn):
    print('->', name, flush=True)
    try:
        fn()
    except Exception as e:
        msg = (str(e) or repr(e)).splitlines()[0]
        fails.append(f'{name}: {msg[:240]}')
        print('   FAILED:', msg[:200], flush=True)
        for nm, pg_ in list(PAGES.items()):
            try:
                pg_.screenshot(path=os.path.join(OUT, f'FAIL-{len(fails)}-{nm}.png'))
                print('     ', nm, 'url:', pg_.url)
            except Exception:
                pass


def shot(pg, name, full=False):
    pg.screenshot(path=os.path.join(OUT, name + '.png'), full_page=full)


def register(pg, nick, email):
    pg.goto(BASE + '#/login')
    pg.get_by_text('Регистрация', exact=True).last.click()
    pg.locator('input[autocomplete=nickname]').fill(nick)
    pg.locator('input[type=email]').fill(email)
    pg.locator('input[type=password]').fill('secret123')
    pg.get_by_role('button', name='Зарегистрироваться').click()


def watch(pg, label):
    pg.on('console', lambda m: errors.append(f'[{label}] {m.text[:300]}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append(f'[{label}] pageerror {str(e)[:300]}'))
    pg.on('dialog', lambda d: d.accept())


with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    oc = b.new_context(viewport={'width': 1440, 'height': 950})
    own = oc.new_page(); watch(own, 'owner')
    pc = b.new_context(viewport={'width': 1440, 'height': 950})
    pl = pc.new_page(); watch(pl, 'player')
    PAGES.update(owner=own, player=pl)

    def owner_setup():
        register(own, 'Владелец Тест', f'e2e-own-{RUN}@example.com')
        own.wait_for_selector('text=Мои миры', timeout=20000)  # lands in the cabinet
        shot(own, 'a1-cabinet-empty')
        own.get_by_role('button', name='Новый мир').click()
        own.locator('.modal input.input').first.fill('E2E админка ' + RUN)
        own.get_by_role('button', name='Создать мир').click()
        own.wait_for_selector('.dash-hero h1', timeout=20000)
        state['world'] = own.url.rstrip('/')
        print('   WORLD', state['world'].split('/w/')[1])
        for typ, name, vis in [('Персонаж', 'Герой игрока', None), ('Заметка', 'Тайна мастера', 'master')]:
            own.locator('.sidebar').get_by_role('button', name='Создать').click()
            own.locator('.type-tile', has_text=typ).click()
            own.locator('.modal input.input').first.fill(name)
            if vis == 'master':
                own.locator('.modal .vis-opt', has_text='Только мастерам').click()
            own.get_by_role('button', name='Создать и редактировать').click()
            own.wait_for_selector('.hero-name-input', timeout=20000)
            own.get_by_role('button', name='Готово').click()
            own.wait_for_timeout(800)

    def invite():
        own.goto(state['world'] + '/settings/members')
        own.wait_for_selector('text=Создать ссылку', timeout=20000)
        own.get_by_role('button', name='Создать ссылку').click()
        own.wait_for_selector('.invite-url', timeout=10000)
        state['invite'] = own.locator('.invite-url').first.input_value()

    def player_join():
        register(pl, 'Игрок Тест', f'e2e-pl-{RUN}@example.com')
        pl.wait_for_selector('text=Мои миры', timeout=20000)
        pl.goto(state['invite'])
        pl.get_by_role('button', name='Принять приглашение').click()
        pl.wait_for_selector('.dash-hero h1', timeout=20000)
        pl.goto(BASE + '#/worlds')
        pl.wait_for_selector('text=Миры, где я участвую', timeout=20000)
        pl.wait_for_selector('.wcard-name', timeout=15000)
        assert 'E2E админка' in pl.locator('.world-grid').last.inner_text(), 'world not in "participating"'
        shot(pl, 'a2-player-cabinet')

    def admin_rights():
        own.goto(state['world'] + '/settings/members')
        own.wait_for_selector('text=Игрок Тест', timeout=20000)
        shot(own, 'a3-members-admin')
        own.locator('tr', has_text='Игрок Тест').get_by_role('button', name='Права').click()
        own.wait_for_selector('.mm', timeout=10000)
        sec = own.locator('.mm .card', has_text='Персонажи (')
        sec.locator('.picker-btn').click(); own.locator('.picker-menu input').fill('Герой')
        own.locator('.picker-menu .menu-item', has_text='Герой игрока').click(); own.wait_for_timeout(1200)
        sec2 = own.locator('.mm .card', has_text='Может создавать')
        sec2.locator('.ms-btn').click(); own.locator('.ms-menu .ms-item', has_text='Персонажи').click()
        own.locator('.modal-head h3').click(); own.wait_for_timeout(1200)
        sec3 = own.locator('.mm .card', has_text='Доступ к закрытым статьям')
        sec3.locator('.picker-btn').click(); own.locator('.picker-menu input').fill('Тайна')
        own.locator('.picker-menu .menu-item', has_text='Тайна мастера').click(); own.wait_for_timeout(1500)
        shot(own, 'a4-member-modal')
        assert own.locator('.mm .card', has_text='Доступ к закрытым статьям').locator('.rel-row').count() == 1

    def player_sees():
        pl.goto(state['world']); pl.wait_for_selector('.dash-hero h1', timeout=20000); pl.wait_for_timeout(2500)
        assert pl.locator('.dbv-chars', has_text='Герой игрока').count() == 1, 'no «Мои персонажи» block'
        assert pl.locator('.sidebar .sb-chars .sb-link', has_text='Герой игрока').count() == 1
        pl.goto(state['world'] + '/t/note'); pl.wait_for_timeout(2500)
        assert pl.locator('.ecard', has_text='Тайна мастера').count() == 1, 'shared note not visible'
        pl.locator('.sidebar').get_by_role('button', name='Создать').click()
        assert pl.locator('.type-tile', has_text='Персонаж').count() == 1, 'cannot create character'
        pl.keyboard.press('Escape')
        shot(pl, 'a5-player-dashboard')

    def preview():
        own.goto(state['world']); own.wait_for_selector('.dash-hero h1', timeout=20000)
        own.get_by_role('button', name=re.compile('Глазами игрока')).click()
        own.locator('.menu-item', has_text='Любой игрок').click(); own.wait_for_timeout(1500)
        assert own.locator('.preview-banner').count() == 1
        own.goto(state['world'] + '/t/note'); own.wait_for_timeout(2000)
        any_count = own.locator('.ecard', has_text='Тайна мастера').count()
        own.get_by_role('button', name='Выйти из просмотра').click(); own.wait_for_timeout(800)
        own.get_by_role('button', name=re.compile('Глазами игрока')).click()
        own.locator('.menu-item', has_text='Игрок Тест').click(); own.wait_for_timeout(1500)
        own.goto(state['world'] + '/t/note'); own.wait_for_timeout(2000)
        player_count = own.locator('.ecard', has_text='Тайна мастера').count()
        shot(own, 'a6-preview')
        own.get_by_role('button', name='Выйти из просмотра').click()
        print('   preview: any player sees secret note =', any_count, '| this player =', player_count)
        assert any_count == 0 and player_count == 1

    def mobile():
        mc = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mp = mc.new_page(); watch(mp, 'mobile')
        # logged-in player on a phone: avatar menu in the topbar
        mp.goto(BASE + '#/login'); mp.locator('input[type=email]').fill(f'e2e-pl-{RUN}@example.com'); mp.locator('input[type=password]').fill('secret123')
        mp.get_by_role('button', name='Войти', exact=True).click(); mp.wait_for_selector('text=Мои миры', timeout=20000)
        mp.goto(state['world']); mp.wait_for_selector('.dash-hero h1', timeout=20000); mp.wait_for_timeout(1500)
        assert mp.locator('.topbar .user-btn .avatar').is_visible(), 'no account button on phone'
        shot(mp, 'a7-mobile-member')
        mc.close()
        # make the world public and visit as a guest on a phone
        own.goto(state['world'] + '/settings/general'); own.wait_for_selector('text=Открытый мир', timeout=15000)
        own.locator('label.check', has_text='Открытый мир').locator('input').check(); own.wait_for_timeout(1500)
        gc = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        gp = gc.new_page(); watch(gp, 'guest')
        gp.goto(state['world']); gp.wait_for_selector('.topbar', timeout=20000); gp.wait_for_timeout(2500)
        assert gp.locator('.topbar a', has_text='Войти').is_visible(), 'no login button for guest on phone'
        shot(gp, 'a8-mobile-guest')
        gc.close()

    def ban():
        own.goto(state['world'] + '/settings/members'); own.wait_for_selector('text=Игрок Тест', timeout=20000)
        own.locator('tr', has_text='Игрок Тест').get_by_role('button', name='Права').click()
        own.wait_for_selector('.mm', timeout=10000)
        own.get_by_role('button', name='Заблокировать').click(); own.wait_for_timeout(2500)
        assert own.locator('.card', has_text='Заблокированные').count() == 1
        pl.goto(state['invite']); pl.wait_for_timeout(1500)
        btn = pl.get_by_role('button', name='Принять приглашение')
        if btn.count(): btn.click(); pl.wait_for_timeout(2500)
        body = pl.locator('body').inner_text()
        print('   banned player sees:', 'error' if ('Missing or insufficient' in body or 'permission' in body.lower() or 'прав' in body) else body[:120].replace('\n', ' '))
        pl.goto(state['world'] + '/t/character'); pl.wait_for_timeout(3500)
        # the world was made public in the mobile step: a banned player is just a guest there
        role_line = pl.locator('.sb-world-role').inner_text() if pl.locator('.sb-world-role').count() else 'no sidebar'
        print('   banned player role line:', role_line, '| toasts:', pl.locator('.toast.error').count())
        assert pl.locator('text=Нет доступа к миру').count() == 1 or 'Гость' in role_line, 'banned player still a member'
        assert pl.locator('.ecard', has_text='Герой игрока').count() == 0, 'banned player still sees members-only article'
        assert pl.locator('.toast.error').count() == 0, 'error toast shown'

    def delete_world():
        own.goto(state['world'] + '/settings/general'); own.wait_for_selector('text=Опасная зона', timeout=15000)
        own.get_by_role('button', name='Удалить мир…').click()
        own.locator('.modal input.input').fill('E2E админка ' + RUN)
        own.get_by_role('button', name='Удалить навсегда').click()
        own.wait_for_selector('text=Мои миры', timeout=60000)
        own.wait_for_timeout(2000)
        assert 'E2E админка' not in own.locator('body').inner_text(), 'world still listed'
        shot(own, 'a9-after-delete')

    step('owner: cabinet, world, articles', owner_setup)
    step('owner: invite', invite)
    step('player: join, cabinet shows world', player_join)
    step('owner: member rights', admin_rights)
    step('player: sees character, shared note, may create characters', player_sees)
    step('owner: preview as player', preview)
    step('mobile: account menu and guest login button', mobile)
    step('owner: ban player', ban)
    step('owner: delete world', delete_world)
    b.close()

print('\nFAILS:' if fails else '\nno step failures')
for f in fails: print('  ', f)
u = list(dict.fromkeys(errors))
print('console errors:' if u else 'no console errors')
for e in u[:20]: print('  ', e)
