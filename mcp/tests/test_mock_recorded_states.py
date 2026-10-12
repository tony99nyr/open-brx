"""Record complete Session states for the console mock contract.

BRX_GENERATE_MOCK_RECORDED=1 refreshes the fixture after an intentional MC change.
MC changes that move State require a fixture refresh and a reviewed gap update.
"""
from __future__ import annotations

import ast
import copy
import inspect
import ipaddress
import json
import os
import pathlib
import random
import re
import socket
import tempfile
import uuid
from unittest.mock import patch

from _session import T0_EPOCH_MS, echo_for
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory, fake_app_ver
from brx_mcp.mc.picks import GamePick
from brx_mcp.mc.pieces import PieceStore
from brx_mcp.mc.state import Session

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'webapp/mc/test/fixtures'
PATH = FIXTURES / 'mock-recorded.json'
REGEN_HELP = ('From repo root: cd mcp && BRX_GENERATE_MOCK_RECORDED=1 python3 run_tests.py mock_recorded_states; '
              'then cd ../webapp/mc && BRX_GENERATE_MOCK_RECORDED_GAPS=1 '
              'npx vitest run --configLoader runner test/mock-recorded.test.ts. Review both fixtures and the gap list.')
FIXTURE_LAN = {'mode': 'lan', 'ip': '192.0.2.10', 'port': 8765,
       'ssid': 'FIXTURE-SSID', 'ws_url': 'ws://192.0.2.10:8765/ws', 'qr': ''}
VERSIONS = {'field': {}, 'newest': None, 'release': '0.0.0-fixture', 'mc_major': '0'}
MOCK_IP = '192.168.8.10'  # the mock's checked-in demo address
MOCK_SSID = 'BRX-FIELD'
MOCK_SECRET = 'k7q2m9xz'
DEMO_PHONES = (
    ('REAPER', 'blue', 'GUN-A', '3D4F'), ('VIPER', 'yellow', 'GUN-B', '91C2'),
    ('NOMAD', 'blue', 'GUN-C', '7A10'), ('GHOST', 'yellow', 'GUN-E', '5D77'),
    ('HAVOC', 'blue', 'GUN-G', '4F19'), ('SABLE', 'yellow', 'GUN-F', 'A0B3'),
    ('ONYX', 'blue', 'GUN-H', 'C3E5'), ('DRIFT', 'yellow', 'GUN-D', '22E8'),
)
DEMO_TEAMS = [
    {'team_id': 'blue', 'name': 'BLUE TEAM', 'color': '#3a86ff', 'tid': 1},
    {'team_id': 'yellow', 'name': 'YELLOW TEAM', 'color': '#ffd23f', 'tid': 2},
]
PINNED_VERSIONS = {'0.0.0', '0.1.8', '0.1.9', '0.1.8+99ffee1', '0.1.9+ab12cd3',
                   '0.4', fake_app_ver(), 'v4.32'}

HAPPY = [
    {'name': 'initial', 'action': 'snapshot'},
    {'name': 'remove REAPER', 'action': 'remove', 'display': 'REAPER'},
    {'name': 'remove VIPER', 'action': 'remove', 'display': 'VIPER'},
    {'name': 'add yellow', 'action': 'add', 'display': 'ALPHA', 'team_id': 'yellow', 'gun_id': 'GUN-A'},
    {'name': 'add blue', 'action': 'add', 'display': 'BRAVO', 'team_id': 'blue', 'gun_id': 'GUN-B'},
    {'name': 'pick TDM', 'action': 'pick', 'mode': 'tdm', 'time_limit_s': 120},
    {'name': 'load game', 'action': 'load'},
    {'name': 'continue to kit', 'action': 'phase', 'phase': 'kit'},
    {'name': 'demo ready', 'action': 'ready_demo'},
    {'name': 'set frag limit', 'action': 'config', 'scoring': {'win_by': 'kills', 'frag_limit': 10}},
    {'name': 'yellow ready', 'action': 'ready', 'display': 'ALPHA'},
    {'name': 'blue ready', 'action': 'ready', 'display': 'BRAVO'},
    {'name': 'lobby', 'action': 'phase', 'phase': 'lobby', 'force': True},
    {'name': 'push to kit', 'action': 'push', 'force': True},
    {'name': 'repush', 'action': 'push', 'force': True},
    {'name': 'start', 'action': 'start', 'runway_s': 10, 'force': True},
    {'name': 'go live', 'action': 'advance', 'ms': 11_000},
    {'name': 'end', 'action': 'control', 'cmd': 'end'},
    {'name': 'next match', 'action': 'next'},
]
PREFIX = [HAPPY[i] for i in (1, 2, 3, 4, 6, 7, 8, 10, 11, 12, 13)]
SCRIPTS = {
    'happy': HAPPY,
    'abort': PREFIX + [HAPPY[15], {'name': 'abort', 'action': 'abort'}],
    'recall': PREFIX + [HAPPY[15], HAPPY[16], {'name': 'recall', 'action': 'control', 'cmd': 'recall'}],
    'panic': PREFIX + [HAPPY[15], HAPPY[16], {'name': 'panic', 'action': 'control', 'cmd': 'panic'}],
    'force': [HAPPY[i] for i in (1, 2, 3, 4)] + [{'name': 'force lobby', 'action': 'phase', 'phase': 'lobby', 'force': True}],
    'fresh': [HAPPY[i] for i in (1, 2, 3)] + [{'name': 'fresh session', 'action': 'new', 'keep_roster': False}],
    'config': [{'name': 'muster config', 'action': 'config', 'scoring': {'win_by': 'kills', 'frag_limit': 5}}],
}


def _pointer(parts):
    return ''.join('/' + str(part).replace('~', '~0').replace('/', '~1') for part in parts)


def _patch(before, after, parts=()):
    """Return ordered JSON Pointer set/delete operations for one State change."""
    if json.dumps(before, sort_keys=True, separators=(',', ':')) == json.dumps(after, sort_keys=True, separators=(',', ':')):
        return []
    if isinstance(before, dict) and isinstance(after, dict):
        ops = ([['delete', _pointer((*parts, key))] for key in sorted(before.keys() - after.keys())]
               + [['set', _pointer((*parts, key)), after[key]] for key in sorted(after.keys() - before.keys())])
        for key in sorted(before.keys() & after.keys()):
            ops.extend(_patch(before[key], after[key], (*parts, key)))
    elif isinstance(before, list) and isinstance(after, list):
        if len(before) == len(after):
            ops = [op for i, (old, new) in enumerate(zip(before, after))
                   for op in _patch(old, new, (*parts, i))]
        elif len(before) == len(after) + 1 and any(
                before[:i] + before[i + 1:] == after for i in range(len(before))):
            i = next(i for i in range(len(before)) if before[:i] + before[i + 1:] == after)
            ops = [['delete', _pointer((*parts, i))]]
        elif len(after) >= len(before) and after[:len(before)] == before:
            ops = [['set', _pointer((*parts, i)), after[i]] for i in range(len(before), len(after))]
        else:
            ops = [['set', _pointer(parts), after]]
    else:
        return [['set', _pointer(parts), after]]
    replacement = ['set', _pointer(parts), after]
    if parts and len(json.dumps(ops, separators=(',', ':'))) >= len(json.dumps(replacement, separators=(',', ':'))):
        return [replacement]
    return ops


def _apply_patch(state, ops):
    state = copy.deepcopy(state)
    for op in ops:
        kind, pointer, *values = op
        assert pointer.startswith('/'), f'invalid State pointer: {pointer}'
        parts = [part.replace('~1', '/').replace('~0', '~') for part in pointer[1:].split('/')]
        target = state
        for part in parts[:-1]:
            target = target[int(part)] if isinstance(target, list) else target[part]
        key = int(parts[-1]) if isinstance(target, list) else parts[-1]
        if kind == 'delete' and not values:
            del target[key]
        elif kind == 'set' and len(values) == 1:
            if isinstance(target, list) and key == len(target):
                target.append(values[0])
            else:
                target[key] = values[0]
        else:
            raise AssertionError(f'invalid State patch operation: {op}')
    return state


def _encode_snapshots(rows):
    previous = {}
    seen = {}
    result = []
    for row in rows:
        script, state = row['script'], row['state']
        encoded = {'script': script, 'step': row['step']}
        if script in previous:
            encoded['patch'] = _patch(previous[script], state)
        else:
            key = json.dumps(state, sort_keys=True, separators=(',', ':'))
            if key in seen:
                encoded['copy'] = seen[key]
            else:
                encoded['state'] = state
        result.append(encoded)
        previous[script] = state
        seen.setdefault(json.dumps(state, sort_keys=True, separators=(',', ':')), [script, row['step']])
    return result


def _decode_snapshots(rows):
    previous = {}
    seen = {}
    result = []
    for row in rows:
        script = row['script']
        if script in previous:
            assert set(row) == {'script', 'step', 'patch'}, f'invalid delta row: {script}/{row["step"]}'
            state = _apply_patch(previous[script], row['patch'])
        else:
            assert set(row) in ({'script', 'step', 'state'}, {'script', 'step', 'copy'}), f'invalid first row: {script}/{row["step"]}'
            state = row['state'] if 'state' in row else copy.deepcopy(seen[tuple(row['copy'])])
        result.append({'script': script, 'step': row['step'], 'state': state})
        previous[script] = state
        seen[(script, row['step'])] = state
    return result


def _fixture_text(fixture):
    """Keep each patch operation on one line for small, useful text diffs."""
    compact = lambda value: json.dumps(value, separators=(',', ':'))
    lines = ['{', f' "_comment":{compact(fixture["_comment"])},',
             f' "scripts":{compact(fixture["scripts"])},', ' "snapshots":[']
    rows = fixture['snapshots']
    for index, row in enumerate(rows):
        end = ',' if index + 1 < len(rows) else ''
        header = f'  {{"script":{compact(row["script"])},"step":{compact(row["step"])},'
        if 'state' in row:
            lines.append(f'{header}"state":{compact(row["state"])}}}{end}')
        elif 'copy' in row:
            lines.append(f'{header}"copy":{compact(row["copy"])}}}{end}')
        else:
            lines.append(f'{header}"patch":[')
            lines.extend(f'   {compact(op)}{"," if i + 1 < len(row["patch"]) else ""}'
                         for i, op in enumerate(row['patch']))
            lines.append(f'  ]}}{end}')
    lines.extend([' ]', '}'])
    return '\n'.join(lines) + '\n'


class FixedIds:
    def __init__(self):
        self.next = 0

    def __call__(self):
        self.next += 1
        return uuid.UUID(hex=f'{self.next:08x}' + '0' * 24)


def phase_sites():
    source = pathlib.Path(inspect.getsourcefile(Session))
    tree = ast.parse(source.read_text(encoding='utf-8'))
    return {(str(source), n.lineno) for n in ast.walk(tree) if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Attribute) and n.func.attr == '_set_phase'}


def config_phase_site():
    source = pathlib.Path(inspect.getsourcefile(Session))
    tree = ast.parse(source.read_text(encoding='utf-8'))
    method = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'set_config')
    return next((str(source), n.lineno) for n in ast.walk(method) if isinstance(n, ast.Call)
                and isinstance(n.func, ast.Attribute) and n.func.attr == '_set_phase')


def replay():
    reached = set()
    original = Session._set_phase

    def traced(self, new):
        caller = inspect.currentframe().f_back
        reached.add((caller.f_code.co_filename, caller.f_lineno))
        return original(self, new)

    rows = []
    with patch('secrets.token_urlsafe', return_value='FIXTURE-JOIN-CODE'):
        for script, steps in SCRIPTS.items():
            with patch('uuid.uuid4', side_effect=FixedIds()):
                clock = {'t': T0_EPOCH_MS}
                net = FakeNet()
                armory = demo_armory()
                tails = {gun_id: tail for _, _, gun_id, tail in DEMO_PHONES}
                for record in armory:
                    record['ble']['tail'] = tails[record['gun_id']]
                session = Session(Compiler(), net, FakeArmory(armory),
                                  now_ms=lambda: clock['t'], voice_rng=random.Random(0))
                if script != 'config':
                    session.set_config({'mode': 'tdm', 'time_limit_s': 60, 'teams': DEMO_TEAMS})
                else:
                    # Keep the demo roster while preserving MUSTER for the compared config step.
                    session.config['teams'] = DEMO_TEAMS
                    session.teams = list(DEMO_TEAMS)
                for display, team_id, gun_id, tail in DEMO_PHONES:
                    session.add_player(display, team_id=team_id, gun_id=gun_id)
                for display in ('REAPER', 'VIPER', 'NOMAD', 'GHOST', 'HAVOC', 'ONYX'):
                    player = next(p for p in session.players.values() if p['display'] == display)
                    session.set_ready(player['player_id'], True, host_override=True)
                # Snapshot arrays retain the mock's GUN-A through GUN-H order.
                for display, team_id, gun_id, tail in sorted(DEMO_PHONES, key=lambda row: row[2]):
                    app_ver = '0.1.8+99ffee1' if gun_id in ('GUN-C', 'GUN-H') else '0.1.9+ab12cd3'
                    net.simulate_hello(f'node_{tail}', f'{gun_id}-{tail}', app_ver=app_ver,
                                       platform='ios' if gun_id == 'GUN-A' else 'android')
                net.simulate_utility_hello('util-a1b2c3')
                net.simulate_utility_hello('util-d4e5f6')
                session.lan = dict(FIXTURE_LAN)
                session._render_join()
                session.versions = lambda: dict(VERSIONS)
                session.attach_pieces(PieceStore(None, now_ms=lambda: clock['t']))
                game = GamePick(session)
                if script == 'config':
                    assert session.phase == 'muster', 'config script must start in MUSTER'
                # Setup is outside the trace: reachability counts only compared steps.
                with patch.object(Session, '_set_phase', traced):
                    for step in steps:
                        _apply_step(session, game, clock, step, script, rows)
    return rows, reached


def _apply_step(session, game, clock, step, script, rows):
    action = step['action']
    if action == 'remove':
        player = next(p for p in session.players.values() if p['display'] == step['display'])
        session.remove_player(player['player_id'])
    elif action == 'add':
        session.add_player(step['display'], team_id=step['team_id'], gun_id=step['gun_id'])
    elif action == 'pick':
        response = game.pick({'mode': f"builtin:mode:{step['mode']}"}, {'time_limit_s': step['time_limit_s']})
        assert response['ok'], (script, step['name'], response)
    elif action == 'load':
        session.load_game()
    elif action == 'phase':
        session.set_phase(step['phase'], force=step.get('force', False))
    elif action == 'config':
        response = session.set_config({'scoring': step['scoring']})
        assert response['ok'], (script, step['name'], response)
    elif action == 'ready':
        player = next(p for p in session.players.values() if p['display'] == step['display'])
        session.set_ready(player['player_id'], True, host_override=True)
    elif action == 'ready_demo':
        for display, *_ in DEMO_PHONES:
            player = next((p for p in session.players.values() if p['display'] == display), None)
            if player:
                session.set_ready(player['player_id'], True, host_override=True)
    elif action == 'push':
        response = session.push_config(force=step['force'])
        assert response['ok'], (script, step['name'], response)
        # The demo keeps the replacement players' phones unbound. Its six remaining
        # rostered phones include DRIFT, whose red gun cannot answer a push.
        for display, _, _, tail in DEMO_PHONES:
            if display == 'DRIFT':
                continue
            player = next((p for p in session.players.values() if p['display'] == display), None)
            if player is None:
                continue
            session.net.simulate_node_message(
                f'node_{tail}', 'ack_config',
                {'config_id': session.config['config_id'], 'ok': True,
                 'gun_echo': echo_for(session, player['player_id'])}, clock['t'])
            session.net.simulate_status(
                f'node_{tail}', {'player_id': player['player_id'], 'arm_state': 'lobby',
                                 'config_id': session.config['config_id'], 'synced': True}, clock['t'])
    elif action == 'start':
        # The mock's 0.1.x demo apps are below the real MC's start floor.
        for _, _, gun_id, tail in DEMO_PHONES:
            session.net.simulate_hello(f'node_{tail}', f'{gun_id}-{tail}',
                                       app_ver=fake_app_ver())
        response = session.start(runway_s=step['runway_s'], force=step['force'])
        assert response['match_id'], (script, step['name'], response)
        for display, _, _, tail in DEMO_PHONES:
            if display == 'DRIFT':  # The demo's DRIFT phone reports no armed state.
                continue
            player = next((p for p in session.players.values() if p['display'] == display), None)
            if player is None:
                continue
            session.net.simulate_status(
                f'node_{tail}', {'player_id': player['player_id'], 'arm_state': 'armed',
                                 'match_id': response['match_id'],
                                 'config_id': session.config['config_id'],
                                 't_minus_ms': step['runway_s'] * 1000,
                                 'synced': True, 'alive': True}, clock['t'])
    elif action == 'advance':
        clock['t'] += step['ms']
        session.tick()
    elif action == 'control':
        session.control(step['cmd'], confirm=step['cmd'] == 'panic')
    elif action == 'abort':
        session.abort_start()
    elif action == 'new':
        session.new_session(keep_roster=step['keep_roster'])
    elif action == 'next':
        session.next_match()
    state = json.loads(json.dumps(session.snapshot()))  # the JSONResponse boundary
    if script == 'config':
        assert state['phase'] == 'build', 'config must move MUSTER to BUILD'
    rows.append({'script': script, 'step': step['name'], 'state': state})

def test_mock_recorded_states():
    actual, _ = replay()
    if os.environ.get('BRX_GENERATE_MOCK_RECORDED') == '1':
        fixture = {
            '_comment': 'A script starts with a full state or a copy of an earlier script/step pair. Later rows have ordered patch operations: ["set", JSON Pointer, value] or ["delete", JSON Pointer]. A set at an array length appends; a delete at an array index removes it.',
            'scripts': SCRIPTS, 'snapshots': _encode_snapshots(actual),
        }
        assert _decode_snapshots(fixture['snapshots']) == actual
        PATH.write_text(_fixture_text(fixture), encoding='utf-8')
    recorded = json.loads(PATH.read_text(encoding='utf-8'))
    assert recorded['scripts'] == SCRIPTS, f'recorded operator scripts changed. {REGEN_HELP}'
    assert actual == _decode_snapshots(recorded['snapshots']), f'stale server snapshot. {REGEN_HELP}'


def test_each_phase_site_is_reached():
    _, reached = replay()
    assert reached == phase_sites(), f'unreached _set_phase call sites: {sorted(phase_sites() - reached)}; unexpected: {sorted(reached - phase_sites())}'
    assert config_phase_site() in reached, 'config script must reach set_config MUSTER transition'


def unsafe_recorded_text(value, path='$', prose=False):
    """Return paths with host details or credentials in the public recordings."""
    bad = []
    if isinstance(value, dict):
        if {'path', 'server', 'mock'} <= value.keys():
            for side in ('server', 'mock'):
                if 'kind' in value:
                    if not isinstance(value[side], str) or not re.fullmatch(r'[0-9a-f]{12}', value[side]):
                        bad.append(f"{value['path']}.{side}")
                else:
                    bad.extend(unsafe_recorded_text(value[side], value['path']))
            for key, child in value.items():
                if key not in ('server', 'mock'):
                    bad.extend(unsafe_recorded_text(child, f'{path}.{key}'))
            return bad
        for key, child in value.items():
            child_path = f'{path}.{key}'
            if re.search(r'password|token|credential|api_key|private_key', key, re.I):
                bad.append(child_path)
            bad.extend(unsafe_recorded_text(child, child_path))
    elif isinstance(value, list):
        for i, child in enumerate(value):
            bad.extend(unsafe_recorded_text(child, f'{path}[{i}]'))
    elif isinstance(value, str):
        host = socket.gethostname()
        if (re.search(r'(?i)(?:/home/|/Users/|/mnt/[a-z]/|[a-z]:\\Users\\)', value)
                or re.search(r'(?i)(?:[a-z0-9-]+\.)+(?:local|lan)\b', value)
                or (host and host.lower() in value.lower())):
            bad.append(path)
        for match in re.findall(r'(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])', value):
            try:
                ip = ipaddress.ip_address(match)
            except ValueError:
                bad.append(path)
                continue
            if match not in (FIXTURE_LAN['ip'], MOCK_IP):
                bad.append(path)
        for match in re.findall(r'(?i)(?<![\w:])\[?(?:[0-9a-f]{0,4}:){2,}[0-9a-f:.%]*\]?', value):
            try:
                ipaddress.ip_address(match.strip('[]').split('%', 1)[0])
            except ValueError:
                continue
            bad.append(path)
        if path.endswith('.ssid') and value not in (FIXTURE_LAN['ssid'], MOCK_SSID):
            bad.append(path)
        if path.endswith(('.release', '.newest')) and value != VERSIONS['release']:
            bad.append(path)
        if path.endswith('.join_secret') and value not in ('FIXTURE-JOIN-CODE', MOCK_SECRET):
            bad.append(path)
        if path.endswith('.qr') and value not in (
                f"{FIXTURE_LAN['ws_url']}?s=FIXTURE-JOIN-CODE",
                f'ws://{MOCK_IP}:8765/ws?s={MOCK_SECRET}'):
            bad.append(path)
        version_text = re.sub(r'(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])', '', value)
        if not prose:
            for version in re.findall(r'(?<![A-Za-z0-9])v?\d+\.\d+(?:\.\d+)?(?:\+[A-Za-z0-9]+)?', version_text):
                if version not in PINNED_VERSIONS:
                    bad.append(path)
        if re.search(r'-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}', value):
            bad.append(path)
        for token in re.findall(r'(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])', value):
            if not prose or not token.isupper():
                bad.append(path)
        if re.search(r'(?i)(?:secret|access[_-]?code|password)[=:][^\s&,}]{8,}', value) and 'FIXTURE-JOIN-CODE' not in value and MOCK_SECRET not in value:
            bad.append(path)
    return bad


def test_recorded_files_have_no_host_or_secret_values():
    for path in FIXTURES.glob('mock-recorded*.json'):
        assert not (bad := unsafe_recorded_text(json.loads(path.read_text(encoding='utf-8')))), (path, bad[:20])
    path = FIXTURES / 'mock-gap-list.md'
    assert not (bad := unsafe_recorded_text(path.read_text(encoding='utf-8'), prose=True)), (path, bad[:20])


def test_guard_catches_planted_host_and_secret():
    for planted in ('/home/example/real-store', '/Users/tony/.brx-mcp/session.json',
                    r'C:\Users\Tony\x', '/mnt/c/Users/Tony/x', '192.168.1.23',
                    '8.8.8.8', 'fe80::1234', 'ws://[2001:db8::1]:8765/ws',
                    'ws://tonys-macbook.local/ws', 'https://fieldbox.lan:8765',
                    socket.gethostname(), 'sk_' + 'x' * 24):
        assert unsafe_recorded_text({'planted': planted})
        assert unsafe_recorded_text((FIXTURES / 'mock-gap-list.md').read_text(encoding='utf-8') + '\n' + planted,
                                    prose=True)
    assert unsafe_recorded_text({'path': '$.lan.ssid', 'server': FIXTURE_LAN['ssid'], 'mock': 'HomeWifi'})
    assert unsafe_recorded_text({'path': '$.versions', 'server': VERSIONS, 'mock': {'release': '9.9.9'}})


def test_guard_rejects_planted_markdown_host():
    with tempfile.TemporaryDirectory() as directory:
        pathlib.Path(directory, 'mock-gap-list.md').write_text(
            '# Planted example\n\nServer: `ws://fieldbox.lan/ws`\n', encoding='utf-8')
        with patch.dict(globals(), {'FIXTURES': pathlib.Path(directory)}):
            try:
                test_recorded_files_have_no_host_or_secret_values()
            except AssertionError as error:
                assert 'mock-gap-list.md' in str(error)
            else:
                raise AssertionError('the markdown host did not fail the recording guard')
