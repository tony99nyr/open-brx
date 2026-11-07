"""Domination scored from the phones (Tony 2026-11-07): `ownership.owned_ms` builds one owner timeline per hill from the
phones' `own_change` facts. brx1's rule: clock skew between phones must never make the FINAL owner wrong, and the
totals stay within about 1 s a flip."""
from __future__ import annotations

import random

from brx_mcp.mc.ownership import NEUTRAL_TID as N, owned_ms

RED, BLUE = 0, 1


def test_an_owned_hill_keeps_scoring_with_nobody_near_it():
    got = owned_ms([(10_000, N, RED)], 0, 100_000)
    assert got == {N: 10_000, RED: 90_000}, got


def test_two_phones_reporting_the_same_change_count_it_once():
    got = owned_ms([(10_000, N, RED), (10_400, N, RED), (10_000, N, RED)], 0, 60_000)
    assert got == {N: 10_000, RED: 50_000}, got


def test_brx1s_skew_case_ends_on_blue():
    """Red to neutral from phone A at 50 s; neutral to blue 0.5 s later from phone B, whose clock is 1 s behind (so it
    stamps 49.5 s). Ordered by time alone the timeline ends on neutral and blue loses the rest of the match."""
    got = owned_ms([(10_000, N, RED), (50_000, RED, N), (49_500, N, BLUE)], 0, 100_000)
    assert got.get(BLUE, 0) == 50_000 and got.get(RED, 0) == 40_000, got


def test_a_step_nobody_reported_still_applies_after_the_skew():
    """Neutral to blue arrives, but no phone reported red to neutral (nobody was near). Blue still takes it."""
    got = owned_ms([(10_000, N, RED), (50_000, N, BLUE)], 0, 100_000)
    assert got.get(BLUE, 0) == 50_000 and got.get(RED, 0) == 40_000, got


def test_a_late_report_slots_into_the_timeline_by_its_time():
    early = [(10_000, N, RED), (70_000, BLUE, N)]
    assert owned_ms(early, 0, 100_000).get(BLUE, 0) == 0, "CONTROL: without the late steps blue has nothing"
    late = early + [(40_000, RED, N), (42_000, N, BLUE)]   # from a phone that was out of Wi-Fi, arriving last
    got = owned_ms(late, 0, 100_000)
    assert got.get(RED) == 30_000 and got.get(BLUE) == 28_000, got


def test_a_re_assertion_corrects_a_missed_capture_and_a_stale_one_is_ignored():
    got = owned_ms([(10_000, N, RED), (40_000, BLUE, BLUE)], 0, 100_000)
    assert got.get(BLUE) == 60_000, ("a phone first hearing blue at 40 s", got)
    stale = owned_ms([(10_000, N, RED), (50_000, RED, BLUE), (51_000, RED, RED)], 0, 100_000)
    assert stale.get(BLUE) == 50_000, ("a slow phone's red, heard just before the capture", stale)


def test_the_whistle_bounds_the_timeline():
    got = owned_ms([(10_000, N, RED), (90_000, RED, BLUE)], 0, 60_000)
    assert got == {N: 10_000, RED: 50_000}, got


def _truth(flips, end):
    owned, cur, t0 = {}, N, 0
    for at, own in flips:
        owned[cur] = owned.get(cur, 0) + at - t0
        cur, t0 = own, at
    owned[cur] = owned.get(cur, 0) + end - t0
    return owned, cur


def _field(seed, end=600_000, skew=None):
    """A field of two phones, A 1 s fast and B 1 s slow. Each walks near the hill and away again. A phone near the hill
    hears every flip (0 to 0.5 s advert latency) and reports it from the owner IT last heard; it re-asserts what it hears
    on arrival and every 30 s while near. Flips come 0.3 s to 6 s apart, only while a phone is near (a capture needs a
    player), with a neutral step between owners as the Stick drains."""
    rng = random.Random(seed)
    skew = skew or {"A": 1000, "B": -1000}
    near = {}
    for ph in skew:
        t, windows = rng.randint(0, 20_000), []
        while t < end:
            stay = rng.randint(20_000, 120_000)
            windows.append((t, min(end, t + stay)))
            t += stay + rng.randint(5_000, 60_000)
        near[ph] = windows
    is_near = lambda ph, t: any(a <= t < b for a, b in near[ph])
    flips, t, cur = [], 0, N
    while True:
        t += rng.randint(300, 6000)
        if t >= end - 5000:
            break
        if any(is_near(ph, t) for ph in skew):
            cur = rng.choice([RED, BLUE]) if cur == N else N
            flips.append((t, cur))
    reports = []
    for ph, sk in skew.items():
        heard = None
        events = sorted([(a, "arrive") for a, _b in near[ph]] + [(f[0], "flip") for f in flips]
                        + [(x, "assert") for x in range(30_000, end, 30_000)])
        for at, kind in events:
            if not is_near(ph, at):
                continue
            owner = _truth([f for f in flips if f[0] <= at], at)[1]
            stamp = at + sk + rng.randint(0, 500)
            if kind == "flip" and heard is not None and heard != owner:
                reports.append((stamp, heard, owner, ph))
            elif kind in ("arrive", "assert") or heard is None:
                reports.append((stamp, owner, owner, ph))
            heard = owner
    rng.shuffle(reports)
    return flips, reports


def test_two_skewed_phones_with_quick_flips_keep_the_final_owner_and_totals():
    """brx1's required test (2026-11-07): the final owner is always right, and every total is within 1 s a flip."""
    for seed in range(500):
        end = 600_000
        flips, reports = _field(seed, end)
        want, final = _truth(flips, end)
        got = owned_ms(reports, 0, end)
        tol = 1000 * len(flips) + 1000
        for tid in (RED, BLUE, N):
            assert abs(got.get(tid, 0) - want.get(tid, 0)) <= tol, (seed, tid, got, want, len(flips))
        before = owned_ms(reports, 0, end - 1000)
        gained = {k: got.get(k, 0) - before.get(k, 0) for k in (RED, BLUE, N)}
        assert gained.get(final) == 1000, (seed, "the final owner", final, gained)


def test_four_phones_with_random_skews_keep_the_final_owner_and_totals():
    for seed in range(150):
        rng = random.Random(10_000 + seed)
        skew = {ph: rng.randint(-1500, 1500) for ph in "ABCD"}
        flips, reports = _field(seed, skew=skew)
        want, final = _truth(flips, 600_000)
        got = owned_ms(reports, 0, 600_000)
        for tid in (RED, BLUE, N):
            assert abs(got.get(tid, 0) - want.get(tid, 0)) <= 1000 * len(flips) + 1000, (seed, skew, tid, got, want)
        before = owned_ms(reports, 0, 599_000)
        assert got.get(final, 0) - before.get(final, 0) == 1000, (seed, skew, "the final owner", final)
