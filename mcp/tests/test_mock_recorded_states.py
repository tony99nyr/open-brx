"""Record complete Session states for the console mock contract.

BRX_GENERATE_MOCK_RECORDED=1 refreshes the fixture after an intentional MC change.
MC changes that move State require a fixture refresh and a reviewed gap update.
"""
from __future__ import annotations

import ast
import inspect
import ipaddress
import json
import os
import pathlib
import re
import socket
import uuid
from unittest.mock import patch

from _session import T0_EPOCH_MS, mk_session
from brx_mcp.mc.picks import GamePick
from brx_mcp.mc.pieces import PieceStore
from brx_mcp.mc.state import Session

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'webapp/mc/test/fixtures'
PATH = FIXTURES / 'mock-recorded.json'
FIXTURE_LAN = {'mode': 'lan', 'ip': '192.0.2.10', 'port': 8765,
       'ssid': 'FIXTURE-SSID', 'ws_url': 'ws://192.0.2.10:8765/ws', 'qr': ''}
VERSIONS = {'field': {}, 'newest': None, 'release': '0.0.0-fixture', 'mc_major': '0'}
MOCK_IP = '192.168.8.10'  # the mock's checked-in demo address
MOCK_SSID = 'BRX-FIELD'
MOCK_SECRET = 'k7q2m9xz'
PINNED_VERSIONS = {'0.0.0', '0.1.8', '0.1.9', '0.1.8+99ffee1', '0.1.9+ab12cd3', 'v4.32'}

HAPPY = [
    {'name': 'initial', 'action': 'snapshot'},
    {'name': 'add red', 'action': 'add', 'display': 'ALPHA', 'team_id': 'red', 'gun_id': 'GUN-A'},
    {'name': 'add blue', 'action': 'add', 'display': 'BRAVO', 'team_id': 'blue', 'gun_id': 'GUN-B'},
    {'name': 'pick TDM', 'action': 'pick', 'mode': 'tdm', 'time_limit_s': 120},
    {'name': 'load game', 'action': 'load'},
    {'name': 'continue to kit', 'action': 'phase', 'phase': 'kit'},
    {'name': 'set frag limit', 'action': 'config', 'scoring': {'win_by': 'kills', 'frag_limit': 10}},
    {'name': 'red ready', 'action': 'ready', 'display': 'ALPHA'},
    {'name': 'blue ready', 'action': 'ready', 'display': 'BRAVO'},
    {'name': 'lobby', 'action': 'phase', 'phase': 'lobby'},
    {'name': 'push to kit', 'action': 'push', 'force': True},
    {'name': 'repush', 'action': 'push', 'force': True},
    {'name': 'start', 'action': 'start', 'runway_s': 10, 'force': True},
    {'name': 'go live', 'action': 'advance', 'ms': 11_000},
    {'name': 'end', 'action': 'control', 'cmd': 'end'},
    {'name': 'next match', 'action': 'next'},
]
PREFIX = [HAPPY[1], HAPPY[2], HAPPY[4], HAPPY[5], HAPPY[7], HAPPY[8], HAPPY[9], HAPPY[10]]
SCRIPTS = {
    'happy': HAPPY,
    'abort': PREFIX + [HAPPY[12], {'name': 'abort', 'action': 'abort'}],
    'recall': PREFIX + [HAPPY[12], HAPPY[13], {'name': 'recall', 'action': 'control', 'cmd': 'recall'}],
    'panic': PREFIX + [HAPPY[12], HAPPY[13], {'name': 'panic', 'action': 'control', 'cmd': 'panic'}],
    'force': [HAPPY[1], HAPPY[2], {'name': 'force lobby', 'action': 'phase', 'phase': 'lobby', 'force': True}],
    'fresh': [HAPPY[1], {'name': 'fresh session', 'action': 'new', 'keep_roster': False}],
    'config': [{'name': 'muster config', 'action': 'config', 'scoring': {'win_by': 'kills', 'frag_limit': 5}}],
}


class FixedIds:
    def __init__(self):
        self.next = 0

    def __call__(self):
        self.next += 1
        return uuid.UUID(hex=f'{self.next:08x}' + '0' * 24)


def phase_sites():
    source = pathlib.Path(inspect.getsourcefile(Session))
    tree = ast.parse(source.read_text(encoding='utf-8'))
    return {n.lineno for n in ast.walk(tree) if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Attribute) and n.func.attr == '_set_phase'}


def replay():
    reached = set()
    original = Session._set_phase

    def traced(self, new):
        reached.add(inspect.currentframe().f_back.f_lineno)
        return original(self, new)

    rows = []
    with patch('uuid.uuid4', side_effect=FixedIds()), patch('secrets.token_urlsafe', return_value='FIXTURE-JOIN-CODE'), patch.object(Session, '_set_phase', traced):
        for script, steps in SCRIPTS.items():
            session, _net, clock, _players = mk_session(0)
            clock['t'] = T0_EPOCH_MS
            session.lan = dict(FIXTURE_LAN)
            session._render_join()
            session.versions = lambda: dict(VERSIONS)
            session.attach_pieces(PieceStore(None))  # in-memory; no host store path
            game = GamePick(session)
            for step in steps:
                action = step['action']
                if action == 'add':
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
                elif action == 'push':
                    response = session.push_config(force=step['force'])
                    assert response['ok'], (script, step['name'], response)
                elif action == 'start':
                    response = session.start(runway_s=step['runway_s'], force=step['force'])
                    assert response['match_id'], (script, step['name'], response)
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
                rows.append({'script': script, 'step': step['name'], 'state': session.snapshot()})
    return rows, reached


def test_mock_recorded_states():
    actual, _ = replay()
    if os.environ.get('BRX_GENERATE_MOCK_RECORDED') == '1':
        PATH.write_text(json.dumps({'scripts': SCRIPTS, 'snapshots': actual}, separators=(',', ':')) + '\n', encoding='utf-8')
    recorded = json.loads(PATH.read_text(encoding='utf-8'))
    assert recorded['scripts'] == SCRIPTS, 'recorded operator scripts changed'
    assert actual == recorded['snapshots'], 'stale server snapshot; regenerate and review the exact diff'


def test_each_phase_site_is_reached():
    _, reached = replay()
    assert reached == phase_sites(), f'unreached _set_phase call sites: {sorted(phase_sites() - reached)}; unexpected: {sorted(reached - phase_sites())}'


def unsafe_recorded_text(value, path='$'):
    """Return paths with host details or credentials in the two public JSON fixtures."""
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
        if '/home/' in value or (host and host.lower() in value.lower()):
            bad.append(path)
        for match in re.findall(r'(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])', value):
            try:
                ip = ipaddress.ip_address(match)
            except ValueError:
                bad.append(path)
                continue
            if (ip.is_private or ip.is_loopback) and match not in (FIXTURE_LAN['ip'], MOCK_IP):
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
        for version in re.findall(r'(?<![A-Za-z0-9])v?\d+\.\d+(?:\.\d+)?(?:\+[A-Za-z0-9]+)?', version_text):
            if version not in PINNED_VERSIONS:
                bad.append(path)
        if re.search(r'-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}|(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])', value):
            bad.append(path)
        if re.search(r'(?i)(?:secret|access[_-]?code|password)[=:][^\s&,}]{8,}', value) and 'FIXTURE-JOIN-CODE' not in value and MOCK_SECRET not in value:
            bad.append(path)
    return bad


def test_recorded_files_have_no_host_or_secret_values():
    for path in FIXTURES.glob('mock-recorded*.json'):
        assert not (bad := unsafe_recorded_text(json.loads(path.read_text(encoding='utf-8')))), (path, bad[:20])


def test_guard_catches_planted_host_and_secret():
    for planted in ('/home/example/real-store', '192.168.1.23', socket.gethostname(), 'sk_' + 'x' * 24):
        assert unsafe_recorded_text({'planted': planted})
    assert unsafe_recorded_text({'path': '$.lan.ssid', 'server': FIXTURE_LAN['ssid'], 'mock': 'HomeWifi'})
    assert unsafe_recorded_text({'path': '$.versions', 'server': VERSIONS, 'mock': {'release': '9.9.9'}})
