"""LED hardware invariants — the facts that cost bench sessions, pinned so a refactor cannot quietly undo them.

WHY THIS FILE EXISTS. Every rule below is bench-proven hardware behaviour, and every one of them
looks like something a tidy-minded refactor would "simplify". A comment only protects code until
someone deletes the comment; these assertions fail loudly instead. Sources for each rule:
`protocol/brx-protocol.md`, `docs/led-language.md`, `docs/experiment-log/2026-09.md`.
Pin list supplied by the LED lane (brx-led) 2026-09-07, deliberately EXCLUDING three claims that are
not properly measured yet: `$HLED,8` on a headset, any absolute brightness ratio, and whether
`$HLOOP` is brighter than the native out-blink. Do not add assertions for those without a metered A/B.

HOW IT WORKS. Rather than checking a handful of hand-picked frames, `harvest()` walks the WHOLE
emitted surface -- every LED frame `poolgauge` and `mc.presentation` can produce, across every
preset x team x night x ffa x leds_on combination -- and the rules run over all of it. That is what
makes this a refactor net: reshape the code however you like, but no reachable frame may break a rule.
"""
from brx_mcp import poolgauge as pg
from brx_mcp.gameconfig import RESPAWN_SEQUENCE
from brx_mcp.mc import presentation as P
from brx_mcp.mc.compile import Compiler, golden_bundle

# --- the emitted-frame surface ---------------------------------------------- #

TEAMS = (None, 0, 1, 2, 3, 4, 5, 6, 7)
NIGHTS = (False, True)


def _frames(obj, where, out):
    """Collect every `$GLED`/`$HLED`/`$HLOOP` string anywhere inside a nested structure."""
    if isinstance(obj, str):
        if obj.startswith(("$GLED", "$HLED", "$HLOOP")):
            out.append((where, obj))
    elif isinstance(obj, dict):
        for k, v in obj.items():
            _frames(v, f"{where}.{k}", out)
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            _frames(v, f"{where}[{i}]", out)
    return out


_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
          {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2}]


def _cfg(night: bool, led=None):
    c = {"config_id": "c1", "mode": "tdm", "environment": "indoor", "night": night,
         "time_limit_s": 600, "respawn": {"type": "auto", "delay_s": 15},
         "scoring": {"frag_limit": 0, "win_by": "kills"},
         "health": {"max_hp": 45, "max_armor": 70}, "teams": _TEAMS}
    if led is not None:
        c["led"] = led
    return c


def _player(team="blue"):
    return {"player_id": "p7", "player_num": 7, "display": "REAPER", "team_id": team,
            "node_id": None, "gun_id": None, "voice": "male", "ready": True,
            "loadout": {"weapons": [{"weapon_id": "assault_rifle"}, {"weapon_id": "shotgun"}]}}


def compiled_bundles():
    """[(tag, bundle), ...] — REAL FrameBundles, which is what actually reaches a gun.

    Added 2026-09-07 after a review found the hole: this file walked `poolgauge` and
    `mc.presentation` and never imported `mc.compile`, so the whole compiler-side LED surface
    (`_headset_colour`, `cues.hurt_led`, `gun_pregame` as spliced into `head`) sat OUTSIDE the net.
    A `$HLED,,6` emitted from the compiler would not have tripped the effect-6 rule below -- the
    highest-value pin in the file, with a hole exactly where bundles are assembled. Same failure
    shape as the bench-teardown guard that only scanned `finally:` blocks: a net trusted because it
    exists, with an assumption about where to look baked into it."""
    C = Compiler()
    out = [("golden", golden_bundle())]
    for night in NIGHTS:
        for team in ("blue", "yellow"):
            out.append((f"compiled/night={night}/team={team}", C.compile(_cfg(night), _player(team), _TEAMS)))
    return out


def harvest():
    """[(origin, frame), ...] for every LED frame the presentation layer AND the compiler can emit."""
    out: list[tuple[str, str]] = []
    for tag, b in compiled_bundles():
        _frames(b, f"bundle[{tag}]", out)
    for night in NIGHTS:
        for team in TEAMS:
            for ffa in (False, True):
                _frames(pg.team_frame(team, night, ffa), f"pg.team_frame({team},{night},{ffa})", out)
                _frames(pg.headset_team_frame(team, ffa), f"pg.headset_team_frame({team},{ffa})", out)
                for ev in pg.EVENT_PAINTS:
                    _frames(pg.event_burst(ev, team, night), f"pg.event_burst({ev},{team},{night})", out)
            for pool in ("shield", "armor", "health"):
                _frames(pg.readout_bands(pool, night), f"pg.readout_bands({pool},{night})", out)
                for lvl in (0, 1, 33, 50, 67, 100):
                    _frames(pg.gauge_frame(pool, lvl, 100, night), f"pg.gauge_frame({pool},{lvl},{night})", out)
                    _frames(pg.pool_paint_frame(pool, lvl, 100, night), f"pg.pool_paint_frame({pool},{lvl},{night})", out)

    team_colours = {t: pg.display_colour(t) for t in pg.TEAM_TIDS}
    for name in sorted(P.PRESETS):
        prof = P.profile_from_preset(name)
        for night in NIGHTS:
            for leds_on in (True, False):
                for team in TEAMS:
                    for ffa in (False, True):
                        tag = f"{name}/night={night}/leds={leds_on}/team={team}/ffa={ffa}"
                        _frames(P.gun_frames(prof, team, night, leds_on, ffa), f"gun_frames[{tag}]", out)
                        _frames(P.gun_pregame(prof, team, night, leds_on, ffa), f"gun_pregame[{tag}]", out)
                        _frames(P.gun_spawn_tail(prof, team, night, leds_on), f"gun_spawn_tail[{tag}]", out)
                        _frames(P.led_table(prof, team, night, leds_on, ffa), f"led_table[{tag}]", out)
                        _frames(P.headset_frames(prof, team, leds_on, team_colours, ffa, night),
                                f"headset_frames[{tag}]", out)
    return out


def toks(frame: str) -> list[str]:
    """'$GLED,1,1,1,0,10,,*' -> ['1','1','1','0','10',''] (command and trailing '*' dropped)."""
    parts = frame.split(",")
    assert parts[-1] == "*", f"frame does not end in a '*' terminator: {frame!r}"
    return parts[1:-1]


def test_the_harvest_actually_reaches_the_led_surface():
    """A net that catches nothing passes every rule below. Pin the floor so an import-shape change
    that silently empties `harvest()` fails HERE rather than turning the whole file into a no-op."""
    got = harvest()
    gled = [f for _, f in got if f.startswith("$GLED")]
    hled = [f for _, f in got if f.startswith("$HLED")]
    hloop = [f for _, f in got if f.startswith("$HLOOP")]
    assert len(got) > 500, f"harvest collected only {len(got)} frames — the surface walk is broken"
    assert gled and hled and hloop, f"missing a command family: {len(gled)} GLED, {len(hled)} HLED, {len(hloop)} HLOOP"


# --- 1. the blank is mandatory, and it comes BEFORE the paint ---------------- #

def test_a_gun_paint_is_always_preceded_by_the_blank():
    """A paint sent to a spawned gun with no prior `$GLED,,,,5,,,*` does not hold: the firmware keeps
    breathing and the paint does nothing. After the blank it holds. So every compiled gun table must
    both CARRY the blank and put it before the first paint of a life (`gun.take`)."""
    for name in sorted(P.PRESETS):
        prof = P.profile_from_preset(name)
        for night in NIGHTS:
            for team in TEAMS:
                g = P.gun_frames(prof, team, night, True)
                if not g:
                    continue        # in_play "native": nothing is sent, the firmware breathes
                tag = f"{name}/night={night}/team={team}"
                assert g["blank"] == P.GUN_BLANK, f"{tag}: gun.blank is {g['blank']!r}, not the bench blank"
                take = g["take"]
                assert take[0] == P.GUN_BLANK, f"{tag}: gun.take starts with {take[0]!r}, not the blank"
                assert take[1] == g["rest"], f"{tag}: gun.take does not paint the rest frame after the blank"


def test_the_blank_is_a_bare_apply_gate_5_and_carries_no_colour():
    """`$GLED,,,,5,,,*`. It is a MODE change, not a paint: giving it colour tokens makes it a gate-5
    paint, which reads dark on hardware (see the next rule)."""
    assert P.GUN_BLANK == "$GLED,,,,5,,,*"
    t = toks(P.GUN_BLANK)
    assert t[3] == "5", f"the blank's apply-gate token is {t[3]!r}, not '5'"
    assert t[0] == t[1] == t[2] == "", f"the blank carries colour tokens {t[:3]} — it must not"


# --- 2. apply-gate 5 is OFF, not a dimmer ----------------------------------- #

def test_no_emitted_gled_ever_pairs_colour_tokens_with_apply_gate_5():
    """RETRACTED 2026-09-07: gate 5 was long believed to be "~1/3 brightness". It is OFF. A frame that
    carries colours AND gate 5 therefore paints nothing, and reads on the bench as a mysterious dark
    gun. The real dimmer is token 5 (next rule)."""
    for where, frame in harvest():
        if not frame.startswith("$GLED"):
            continue
        t = toks(frame)
        if t[3] == "5":
            assert t[0] == t[1] == t[2] == "", (
                f"{where}: {frame!r} carries colour tokens with apply-gate 5. Gate 5 is OFF, not a "
                f"dimmer — this frame paints nothing on hardware. Dim with token 5 instead.")


# --- 3. token 5 is the brightness / night dimmer ---------------------------- #

def test_night_dims_the_gun_strip_with_token_5_and_never_with_the_apply_gate():
    """led-language.md §3.4. Night must express itself as gate 0 + token5=1; day is token5=10.
    Expressing "dimmer" as gate 5 would switch the strip OFF instead (rule 2)."""
    assert (pg.BRIGHT_FULL, pg.BRIGHT_DIM) == (10, 1)
    for night in NIGHTS:
        want = str(pg.BRIGHT_DIM if night else pg.BRIGHT_FULL)
        for where, frame in harvest_gled_paints(night):
            t = toks(frame)
            assert t[3] == "0", f"{where}: paint {frame!r} uses apply-gate {t[3]!r}; a paint gates on 0"
            assert t[4] == want, (
                f"{where}: paint {frame!r} has brightness token {t[4]!r}, expected {want!r} "
                f"for night={night}")


def harvest_gled_paints(night: bool):
    """Every `$GLED` that actually PAINTS (has colour tokens), compiled at one night setting."""
    out: list[tuple[str, str]] = []
    for name in sorted(P.PRESETS):
        prof = P.profile_from_preset(name)
        for team in TEAMS:
            tag = f"{name}/team={team}/night={night}"
            _frames(P.gun_frames(prof, team, night, True), f"gun_frames[{tag}]", out)
            _frames(P.gun_pregame(prof, team, night, True), f"gun_pregame[{tag}]", out)
            _frames(P.led_table(prof, team, night, True), f"led_table[{tag}]", out)
            _frames(pg.team_frame(team, night), f"pg.team_frame[{tag}]", out)
    return [(w, f) for w, f in out if f.startswith("$GLED") and toks(f)[0] != ""]


# --- 4. $HLED effect 6 is never emitted in play ----------------------------- #

def test_effect_6_never_appears_in_any_in_play_headset_frame():
    """THE HIGH-VALUE ONE. `$HLED,,6` disables the firmware's own death-flash loop for the REST OF
    THAT LIFE. On the bench it looks identical to a dark paint and behaves completely differently —
    it broke hosted games for three days before anyone saw it, because the symptom is an ABSENCE.
    In-play dark is `$HLED,9,0,,,10,,*` (dark by COLOUR). Only the teardown path may use effect 6."""
    for where, frame in harvest():
        if not frame.startswith("$HLED"):
            continue
        t = toks(frame)
        effect = t[1] if len(t) > 1 else ""
        assert effect != "6", (
            f"{where}: {frame!r} uses $HLED effect 6 in play. That kills the firmware's death flash "
            f"for the rest of the life. Use HEADSET_DARK ({P.HEADSET_DARK!r}) for in-play dark.")


def test_in_play_dark_is_dark_by_colour_and_the_teardown_blank_is_the_only_effect_6():
    assert P.HEADSET_DARK == "$HLED,9,0,,,10,,*"
    assert toks(P.HEADSET_DARK)[0] == str(pg.DARK), "in-play dark must be dark by COLOUR (token 1 = DARK)"
    assert toks(P.HEADSET_DARK)[1] == "0", "in-play dark must use the static effect 0, never 6"
    assert P.HEADSET_BLANK == "$HLED,,6,,,,,*", "the teardown blank is the one legitimate effect-6 frame"


# --- 5. $TID is 0-3; the paint palette is 0-7 ------------------------------- #

def test_wire_team_ids_stop_at_3_but_the_paint_palette_runs_to_7():
    """F35: `$TID` above 3 breaks combat — teammates damage each other and a gun can kill itself.
    The PAINT palette has no such limit. Two tables, deliberately."""
    assert pg.TEAM_TIDS == (0, 1, 2, 3), f"wire team ids must be 0-3 (F35), got {pg.TEAM_TIDS}"
    assert sorted(pg.TEAM_COLOURS) == [0, 1, 2, 3], f"TEAM_COLOURS keys must be 0-3, got {sorted(pg.TEAM_COLOURS)}"
    assert pg.HEADSET_TIDS == tuple(range(8)), f"the paint palette is 0-7, got {pg.HEADSET_TIDS}"


def test_the_wire_table_and_the_paint_table_stay_separate():
    """`TEAM_COLOURS` is IDENTITY (what the gun is told it is); `display_colour()` is what we PAINT.
    They agree for teams 0-2 and deliberately DISAGREE for team 3 — green on the wire, purple in
    paint. Merging them into one table reintroduces F35, so this asserts the disagreement."""
    assert pg.TEAM_COLOURS != pg.TEAM_DISPLAY_COLOURS, (
        "TEAM_COLOURS and TEAM_DISPLAY_COLOURS have become identical — they are the wire identity and "
        "the paint palette respectively and must stay separate (F35).")
    assert pg.TEAM_COLOURS[3] == pg.GREEN, "team 3's WIRE colour is green"
    assert pg.display_colour(3) == pg.PURPLE, "team 3 PAINTS purple, not its wire green (finding #11)"
    for t in (0, 1, 2):
        assert pg.display_colour(t) == pg.TEAM_COLOURS[t], f"team {t} paints its wire colour"


def test_an_unknown_team_paints_the_default_and_does_not_raise():
    """A 5th team, or a player with no team yet, is not itself a bug — it must paint something."""
    for t in (None, 4, 9, 99):
        assert pg.display_colour(t) == pg.DEFAULT_TEAM_COLOUR, f"team {t!r} should fall back to the default"


# --- 6. the photosensitivity ceiling ---------------------------------------- #

def onsets(seq, target):
    """[start_time, ...] for each visible light-up of `target` in a [(frame, hold_s), ...] sequence.

    Counts TRANSITIONS INTO the flash colour, not frames carrying it: returning to the rest colour is
    not a second flash, and a "flash" that paints the colour already on the strip is not a flash at
    all. The photosensitivity ceiling is about light-ups the eye sees, so that is what this measures.
    (The degenerate case is real — an event whose colour matches the rest colour, e.g. a white event
    on a white FFA rest, produces zero onsets.)"""
    out, t, prev = [], 0.0, None
    for frame, hold in seq:
        if frame == target and prev != target:
            out.append(t)
        prev = frame
        t += float(hold)
    return out


def test_no_event_burst_exceeds_three_flashes():
    """Not a style choice: three flashes in any one-second window is a photosensitivity limit."""
    assert pg.BURST_FLASHES == 3, f"BURST_FLASHES is {pg.BURST_FLASHES} — 3 is a safety ceiling, not a taste knob"
    for night in NIGHTS:
        for team in TEAMS:
            for ev in pg.EVENT_PAINTS:
                seq = pg.event_burst(ev, team, night)
                if not seq:
                    continue
                paint = pg.event_frame(ev, night)
                lights = sum(1 for f, _ in seq if f == paint and f != pg.team_frame(team, night))
                assert lights <= 3, f"event_burst({ev},{team},{night}) has {lights} flashes; the ceiling is 3"
                # and the burst must return to the rest colour rather than leaving the event colour up
                assert seq[-1][0] == pg.team_frame(team, night), (
                    f"event_burst({ev},{team},{night}) ends on {seq[-1][0]!r}, not the rest frame")


def test_no_compiled_burst_puts_more_than_three_flashes_in_a_one_second_window():
    """The ceiling is per SECOND, not per burst, so tightening the gaps must not sneak a fourth in."""
    for name in sorted(P.PRESETS):
        prof = P.profile_from_preset(name)
        for night in NIGHTS:
            for team in TEAMS:
                for ev, seq in P.led_table(prof, team, night, True).items():
                    gled = [(f, h) for f, h in seq if f.startswith("$GLED")]
                    if not gled:
                        continue
                    rest = gled[-1][0]                       # the burst ends on the resting frame
                    flashes = {f for f, _ in gled if f != rest}
                    starts = sorted(t for fl in flashes for t in onsets(gled, fl))
                    for s in starts:
                        n = sum(1 for o in starts if s <= o < s + 1.0)
                        assert n <= 3, (
                            f"{name}/{ev}/night={night}/team={team}: {n} flashes within one second "
                            f"starting at {s:.2f}s — the photosensitivity ceiling is 3.")


def test_two_bursts_for_the_same_player_are_spaced_at_least_a_second_apart():
    """Three flashes is the PER-SECOND ceiling, so back-to-back bursts would double it. Dropping a
    second paint is the correct trade."""
    assert pg.BURST_MIN_SPACING_S >= 1.0, (
        f"BURST_MIN_SPACING_S is {pg.BURST_MIN_SPACING_S}s; below 1.0s two bursts can exceed the "
        f"three-flashes-per-second ceiling.")
    assert pg.BURST_FLASHES * (pg.BURST_FLASH_S + pg.BURST_GAP_S) <= 1.0, (
        "one burst must fit inside its own one-second window")


# --- 7. $HLOOP drives the small flash LED ----------------------------------- #

def test_hloop_stop_is_zero_zero_and_the_respawn_sequence_leads_with_it():
    """`$HLOOP,<1|2>,<ms>` runs the small flash LED; token 2 is a PERIOD in ms. `$HLOOP,0,0` stops it.
    `$SPAWN` clears it on its own, but the respawn sequence stops it explicitly first."""
    assert RESPAWN_SEQUENCE[0] == "$HLOOP,0,0,*", (
        f"the respawn sequence must stop the flash loop first, got {RESPAWN_SEQUENCE[0]!r}")
    assert any(f.startswith("$SPAWN") for f in RESPAWN_SEQUENCE), "the respawn sequence must contain $SPAWN"


def test_every_emitted_hloop_is_either_a_stop_or_a_positive_period():
    for where, frame in harvest():
        if not frame.startswith("$HLOOP"):
            continue
        t = toks(frame)
        mode, period = t[0], t[1]
        if mode == "0":
            assert period == "0", f"{where}: {frame!r} is a stop, so its period must be 0"
        else:
            assert mode in ("1", "2"), f"{where}: {frame!r} has flash mode {mode!r}; only 1 and 2 exist"
            assert int(period) > 0, f"{where}: {frame!r} runs the loop with a non-positive period"


def test_the_down_signal_survives_a_blackout_game():
    """led-language.md §3.2: `down` is present even when LEDs are off — it costs no light budget and
    it is the one signal other players must be able to read."""
    for name in sorted(P.PRESETS):
        prof = P.profile_from_preset(name)
        h = P.headset_frames(prof, 1, False)
        assert "down" in h, f"{name}: the down signal vanished when LEDs were off"
        assert h["down"]["stop"] == "$HLOOP,0,0,*"
        assert h["down"]["rearm"].startswith("$HLOOP,")


# --- 8. one bundle, one brightness per surface (D3) -------------------------- #

def _hled_of(frames) -> list[str]:
    return [f for f in frames if f.startswith("$HLED")]


def test_a_bundle_never_carries_two_brightnesses_for_the_same_surface():
    """The compiler and the presentation layer must agree within a single bundle.

    D3 (found 2026-09-07): a NIGHT bundle shipped a gun body dimmed to token 5 = 1 and, one line
    away in the same `head`, a headset at full brightness 10 -- because `compile._headset_colour()`
    hardcoded 10 and took no `night` argument at all, while `presentation._hled()` and
    `gun_pregame()` both dim. Same player, same moment, two answers.

    This asserts CONSISTENCY rather than a literal value, which is the invariant that was actually
    broken: whatever the right night brightness is, one bundle must not hold two of them. The ruling
    behind it (brx-led, 2026-09-07) is that night DIMS the headset and blackout OMITS it -- those are
    different answers to different questions, and `night=True` is not a substitute for omission."""
    for tag, b in compiled_bundles():
        head_hled = _hled_of(b.get("head", []))
        pregame = _hled_of((b.get("headset") or {}).get("pregame") or [])
        if not head_hled or not pregame:
            continue                     # LEDs off, or no team paint in this bundle
        assert head_hled[-1] == pregame[-1], (
            f"{tag}: the bundle's head paints the headset {head_hled[-1]!r} while its "
            f"headset.pregame paints {pregame[-1]!r} — the same surface at the same moment, two "
            f"brightnesses. compile._headset_colour() needs the same `night` that gun_pregame gets.")


def test_the_night_bundle_dims_every_surface_it_lights():
    """led-language.md §3.4 + the 2026-09-07 ruling: with LEDs ON at night, the gun body and the
    headset team paint both drop to token 5 = 1. (Blackout is the other case entirely — the caller
    omits the headset rather than dimming it — and is not what this asserts.)"""
    C = Compiler()
    b = C.compile(_cfg(night=True), _player(), _TEAMS)
    for f in b["head"]:
        if f.startswith(("$GLED", "$HLED")) and toks(f)[0] not in ("", str(pg.DARK)):
            bright = toks(f)[4] if f.startswith("$GLED") else toks(f)[4]
            assert bright == str(pg.BRIGHT_DIM), (
                f"night bundle lights {f!r} at brightness {bright!r}, expected "
                f"{pg.BRIGHT_DIM} — night dims every surface it lights")
