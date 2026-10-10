"""mc.md #1 (review 2026-10-10): the step from an edit to the next config was written twice in Python (`set_config` and
`_compose_precheck`) and once in the console mock. The precheck must judge exactly the config `set_config` would commit,
or a PICK that "passed" lands as something else (api.py's M2 backstop exists because the copies were expected to drift)."""
from __future__ import annotations

from _session import mk_session

VENUE = {"environment": "indoor", "night": True, "volume": 85, "coverage": "full"}


def _judged_by_precheck(s, patch):
    """The config `_compose_precheck` runs `_validate` against."""
    seen = []
    real = s._validate
    def spy(roster=None):
        seen.append({k: v for k, v in s.config.items() if k != "config_id"})
        return real(roster)
    s._validate = spy
    try:
        s._compose_precheck(patch)
    finally:
        s._validate = real
    assert seen, "control: the precheck validated something"
    return seen[-1]


def test_a_mode_change_precheck_judges_the_config_set_config_commits():
    for patch in ({"mode": "ffa"}, {"mode": "koth"}, {"mode": "ffa", "night": False}, {"time_limit_s": 900}):
        s, _net, _clock, _ps = mk_session(2, cfg=VENUE)
        judged = _judged_by_precheck(s, patch)
        s.set_config(patch)
        committed = {k: v for k, v in s.config.items() if k != "config_id"}
        assert judged == committed, (patch, {k: (judged.get(k), committed.get(k)) for k in set(judged) | set(committed)
                                             if judged.get(k) != committed.get(k)})


def test_a_mode_change_keeps_every_venue_key_unless_the_patch_names_it():
    s, _net, _clock, _ps = mk_session(2, cfg=VENUE)
    s.set_config({"mode": "ffa"})
    for k, v in VENUE.items():
        assert s.config.get(k) == v, (k, s.config.get(k))
    s.set_config({"mode": "tdm", "night": False})
    assert s.config["night"] is False and s.config["volume"] == 85, s.config
