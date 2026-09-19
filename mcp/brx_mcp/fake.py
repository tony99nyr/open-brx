"""FakeTagger — an in-memory BRX emulator for hardware-free testing.

Models a gun's state and its wire behaviour (config frames, `$SPAWN`/`$LIFE`,
`$WEAP`/`$AMMO` magazine accounting, `$VERSION`/`$VOLTS`, and — the point — producing
`$HIR`+`$HP` when it's "shot"). `FakeConnectionManager` presents the same surface
`run_live`/the game loop uses (scan/connect/send/sessions/get_events/disconnect) plus
`inject_hit`/`inject_kill` to simulate shooting. Together they let the ENTIRE live path
(`run_live`, the driver, scoring, respawn, teardown) run in CI with no Bluetooth and no bench.

No bleak import — built on `protocol.BufferedEvent`/`parse_event`, so it loads
anywhere (WSL/CI included).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from .protocol import BufferedEvent, parse_event

# F259/S42 (bench 2026-09-17): a $WEAP/$AMMO write does not land on the gun instantly -- the
# bench measured 30-90 ms. Modelled at the midpoint the node's own tests use for the same
# number (app/test/engine.test.mjs WRITE_MS). The old fake answered on the spot and silently,
# which is the fiction that let three magazine defects reach a hardware bench on 2026-09-18.
_ALCD_WRITE_DELAY_S = 0.04

# F78: the `$SIR` FUNCTION classes the fake applies, all bench-measured (protocol/brx-protocol.md §5,
# magnitude 20 / baseline 45/70/0, 2026-08-27 + 2026-09-02). A word whose <proto, subtype> cell has NO row
# emits NOTHING (no `$HIR`, no `$HP`, no pool change) -- the F11/F40/F60 silent-discard shape. A function
# not listed here still REGISTERS (`$HIR`, pools untouched) unless it is in `_SIR_FN_NONE`.
_SIR_FN_DAMAGE = {1, 3, 4, 5, 7, 29, 30, 33, 38}   # -magnitude, shields -> armour -> HP
_SIR_FN_AP = {2, 6}                                 # armour-piercing: HP only, armour + shield untouched
_SIR_FN_X125 = {36}                                 # floor(magnitude * 1.25)
_SIR_FN_X2 = {37}                                   # magnitude * 2
_SIR_FN_HEAL = {10, 17}                             # add HP, clamp at the $PSET max (fn 10 = "respawn + add HP")
_SIR_FN_SHIELD = {11, 18}                           # add shield, saturating at $PSET t5
_SIR_FN_ARMOR = {13, 15, 20, 22}                    # add armour (the measured overflow-to-shield is not modelled)
_SIR_FN_NONE = {0, 39, 40, 41, 42, 43, 44, 45}      # no registration at all
_SIR_FN_ALLY = _SIR_FN_HEAL | _SIR_FN_SHIELD | _SIR_FN_ARMOR   # polarity: support lands from the OWN team only

# What a gun boots with. protocol/brx-protocol.md (panic sequence): a gun left with no table "cannot be hit
# until it is re-armed or POWER-CYCLED", so a fresh boot has a working table; its exact rows are not
# measured and the stock Callsign table is the only candidate. Imported, not copied: `gameconfig._SIR_TABLE`
# is the one place the wire table lives.
def _boot_sir_table() -> tuple[str, ...]:
    from .gameconfig import _SIR_TABLE
    return tuple(_SIR_TABLE)


def _toks(frame: str) -> list[str]:
    return frame.strip().lstrip("$").rstrip("*").rstrip(",").split(",")


def _int(tok: str | None):
    if tok is None:
        return None
    t = tok.strip()
    return int(t) if t.lstrip("-").isdigit() else None


class FakeTagger:
    """One emulated gun. Feed it frames with `write`; shoot it with `receive_ir`."""

    def __init__(self, address: str, name: str | None = None, hp: int = 45,
                 armor: int = 70, team: int = 0, damage: int = 25,
                 friendly_fire: bool = False, clock: Callable[[], float] | None = None):
        self.address = address
        self.name = name or f"FAKE-{address[-4:]}"
        self.cfg_hp, self.cfg_armor, self.cfg_shield = hp, armor, 0
        self.hp, self.armor, self.shield = hp, armor, 0
        self.team = team
        self.alive = True
        self.damage = damage
        self.friendly_fire = friendly_fire  # set from $GSET token1 when a game configs it
        self._tap = False                   # $PHONE opens the event tap (models the ritual)
        self._out: list[str] = []          # queued rx frames (tagger→host), delivered at once
        # F259/S42: one magazine + reserve per weapon slot, keyed by the `$WEAP`/`$AMMO` slot
        # token. Unknown until a `$WEAP` or `$AMMO` write seeds it -- `.get(slot, 0)` reads a
        # slot nobody has armed yet as empty, which is the honest answer, not a guess.
        self.mag: dict[int, int] = {}
        self.reserve: dict[int, int] = {}
        # `clock` lets a test drive time deterministically (no real sleep, so nothing races
        # under load); a live caller (the stage, `run_live`) takes the real wall clock.
        self._clock: Callable[[], float] = clock or time.monotonic
        self._pending: list[tuple[float, str]] = []   # (ready_at, frame) -- delayed $ALCD replies
        # F78: the `$SIR` table, keyed <proto, subtype> -> function. Boots with the stock table (see
        # `_boot_sir_table`), `$CLEAR` WIPES it (F11), each `$SIR` row written re-arms one cell. `$SPAWN`
        # does not touch it -- only a `$SIR` write or a "power cycle" (a new FakeTagger) brings it back.
        self.sir: dict[tuple[int, int], int] = {}
        for row in _boot_sir_table():
            self._sir_row(row)
        # F121 rebuild (levers §23, bench 2026-09-18): `$TMP` t8 is the incoming-damage percentage modifier,
        # written ABSOLUTE. -100 = hits register (`$HIR`, `$HP`) and take nothing. `$SPAWN` zeroes it (and every
        # other `$TMP` token); a `$TMP` sent before the spawn is therefore wiped. The other tokens are not modelled.
        self.tmp_t8 = 0
        # F46/F62/F68: a magnitude-0 word is a MISS -- the player feels it (haptic + the $PSET missShotHit
        # clip, natively) and the host sees NOTHING. Counted here so a test can assert that shape.
        self.misses = 0
        self.discarded: list[tuple[int, int]] = []   # cells that arrived with no row (the silent-discard log)
        # Q18: a gun that has connected but is not yet LISTENING -- every write is dropped on the floor,
        # no reply, no state change. The reconnect probe exists to tell this apart from a live gun.
        self.listening = True
        # F264 (bench 2026-09-18, docs/FOLLOWUPS.md F264): DEAD-BUT-CHATTY -- the fault a player was dead
        # on the gun and alive on the HUD for 94 s. See `go_dead_chatty()`.
        # F264 v3 (bench 2026-09-19, two taggers v4.32): which reading of the dead-gun $LIFE,0,0,0,* probe
        # this fake gives -- see the `LIFE` command's own comment in `write()`. True (the default) is the
        # MEASURED reading: a dead gun answers $LIFE,0,0,0,* IMMEDIATELY with $HP,0,0,0, same as a live
        # gun answers immediately with its unchanged pools. protocol/brx-protocol.md's $LIFE row and
        # docs/bench-firmware-levers-2026-09-19.md §22 both still say the OPPOSITE (silence) and want
        # correcting; `dead_gun_answers_life = False` keeps that reading selectable for a test.
        self.dead_gun_answers_life = True

    def go_dead_chatty(self) -> None:
        """F264 (bench 2026-09-18, docs/FOLLOWUPS.md F264): simulate the fault -- the gun dies on its own
        and the killing `$HP`/`$LCD` never reaches the host. Unlike `receive_ir`'s ordinary death (which
        DOES emit `$HP,0,...`), this only flips the internal state: `self.alive` and `self.hp` read as
        dead from here on, but nothing is queued for `drain()` -- the host never sees it die.

        MEASURED (the bench log): `$VOLTS` kept arriving on its ~60 s cadence right through both proven
        stalls; `$BUT,0,1` kept arriving on every pull; `$ALCD`/`$LCD`/`$HP` stopped entirely; a `$SIR`
        resync did NOT restart the gun and a `$SPAWN` did, in the next breath. Neither `$VOLTS` nor `$BUT`
        is something this fake generates on its own (both are always test-injected), so there is nothing
        to gate for them here -- the fault leaves them alone by construction, matching the bench.

        A trigger pull still gets no `$ALCD` (`fire()` below, gated on `self.alive` like `receive_ir`
        already was), and a `$QUERY` still answers -- with health 0, because it reads `self.hp` -- which
        is one of the two doors the F264 v2 cure walks through. ASSUMED, not measured: that a real
        dead-chatty gun's `$QUERY` behaves this way; the bench never tried `$QUERY` against the live
        fault, only against the eventual fix. The OTHER door, `$LIFE,0,0,0,*`, has its own documented-vs-
        alternate split -- see `dead_gun_answers_life` and the `LIFE` command's comment in `write()`.
        `$SPAWN` is the cure (see `write`'s SPAWN branch)."""
        self.alive = False
        self.hp = 0

    # -- host → tagger ------------------------------------------------------- #
    def _sir_row(self, frame: str) -> None:
        """`$SIR,<proto>,<sub>,<snd>,<fn>,...` -> one cell of the table (an empty token reads as 0, as
        `compile._sir_index` reads it)."""
        t = _toks(frame)
        if len(t) < 5:
            return
        proto, sub, fn = _int(t[1] or "0"), _int(t[2] or "0"), _int(t[4] or "0")
        if proto is None or sub is None or fn is None:
            return
        self.sir[(proto, sub)] = fn

    def write(self, frame: str) -> None:
        if not self.listening:
            return                                  # Q18: connected, not listening -- the write is lost
        t = _toks(frame)
        cmd = t[0] if t else ""
        if cmd == "CLEAR":
            self.sir.clear()                        # F11: `$CLEAR` wipes the table; nothing lands until `$SIR` rows do
        elif cmd == "SIR":
            self._sir_row(frame)
        elif cmd == "TMP":
            v = _int(t[8]) if len(t) > 8 else None   # an empty t8 leaves the modifier as it is
            if v is not None:
                self.tmp_t8 = max(-100, v)
        elif cmd == "VERSION":
            if self._tap:                           # cold $VERSION gets no reply (exp-log 8-24)
                self._out.append("$VERSION,v4.32,?,4,,devhost.03,*")
        elif cmd == "PHONE":
            self._tap = True                        # open the event tap → VERSION/VOLTS answer
            self._out.append("$BUT,3,0,*")
            self._out.append("$VOLTS,7500,3900,55,70,*")
        elif cmd == "PING":
            pass                            # real firmware doesn't $PONG — match it
        elif cmd == "TID":
            v = _int(t[1]) if len(t) > 1 else None
            if v is not None:
                self.team = v
        elif cmd == "GSET":                 # GSET,friendlyFire,outdoor,... (token1)
            self.friendly_fire = len(t) > 1 and t[1] == "1"
        elif cmd == "PSET":                 # PSET,0,0,hp,armor,shield,...
            for idx, attr in ((3, "cfg_hp"), (4, "cfg_armor"), (5, "cfg_shield")):
                v = _int(t[idx]) if idx < len(t) else None
                if v is not None:
                    setattr(self, attr, v)
        elif cmd == "SPAWN":
            # F264: this is what clears `go_dead_chatty()` -- bench-proven the ONE write that restarts a
            # dead-chatty gun (a $SIR resync did not): it sets `alive` back to True and the pools off 0,
            # same as an ordinary spawn.
            self.alive = True
            self.tmp_t8 = 0                         # levers §23 step 5: the spawn zeroes every $TMP token
            # F41 / P16: a REAL gun reports shield 0 on every `$HP` after a spawn no matter what `$PSET`
            # token 5 said -- the shield pool is IR-only (fn 11) and not BLE-writable. The fake used to
            # apply the token here, so the first `$HP` of a life read as a 70-point GAIN that netted out the
            # first hit's damage and produced a false bug report. The `$PSET` value is kept (`cfg_shield`)
            # as the CEILING an IR grant fills toward, never as a starting pool.
            self.hp, self.armor, self.shield = self.cfg_hp, self.cfg_armor, 0
            self._out.append(f"$LCD,{self.hp},{self.armor},0,0,0,0,*")
        elif cmd == "LIFE":
            # F264 v3: the dead-gun PROBE is `$LIFE,0,0,0,*` (`PROBE_LIFE` in stage.py/engine.js) -- a
            # zero add to an ALREADY-DEAD gun, asking it to speak without healing or harming anything.
            # BENCH-MEASURED 2026-09-19 (two taggers, v4.32): a dead gun answers IMMEDIATELY with
            # `$HP,0,0,0`; a live gun answers immediately with its unchanged pools. Positive evidence
            # either way, and the default here (`dead_gun_answers_life = True`). The repo's OWN docs still
            # say the opposite and want correcting: protocol/brx-protocol.md's $LIFE row (disasm) reads "a
            # dead gun ignores $LIFE when token 1 is 0" (silence), and
            # docs/bench-firmware-levers-2026-09-19.md §22 read the same V4_31 trace the same way before
            # this bench session settled it. `dead_gun_answers_life = False` keeps that superseded reading
            # selectable, so a test can still exercise it. Only a genuine zero-effect probe on an
            # ALREADY-dead gun takes this branch: a live gun's own `$LIFE,0,0,0,*` (nobody sends one) falls
            # through to the ordinary clamp-and-emit below, unchanged.
            if not self.alive:
                hp_d = _int(t[1] if len(t) > 1 else None) or 0
                arm_d = _int(t[2] if len(t) > 2 else None) or 0
                sh_d = _int(t[3] if len(t) > 3 else None) or 0
                if hp_d == 0 and arm_d == 0 and sh_d == 0:
                    if self.dead_gun_answers_life:
                        self._out.append("$HP,0,0,0,*")
                    return   # the superseded reading: silence -- nothing queued
            # Bench-measured 2026-09-09 (protocol/brx-protocol.md $LIFE). Three behaviours the old
            # three-liner did not model, all of which a damage-over-time feature (S16) would be built
            # on -- and a fake that models a command wrongly lets the real bug pass the suite:
            #   1. NEGATIVES DRAIN. `$LIFE,0,-5,0,*` took armour 66 -> 61 on hardware.
            #   2. Per pool, floored at 0, NO SPILL: -100 on armour left armour 0 and HP untouched.
            #      The old `min(cfg, hp + v)` had no lower bound and would go NEGATIVE on a drain.
            #   3. It SELF-EMITS `$HP` -- except when the write is lethal, where the frame shape
            #      SWAPS to `$LCD` and no `$HP` is sent at all (F64).
            #   4. TOKEN 3 IS THE SHIELD, and it lands like the other two (bench 2026-09-17 step 7: grants of
            #      10, 20, 25 and 30 all took, and 30 onto a 55 pool clamped at the `$PSET` ceiling of 70).
            #      The fake used to parse hp and armour, drop the shield token on the floor, and then self-emit
            #      an `$HP` carrying its unchanged `self.shield` -- so a node granting shield was told, on the
            #      wire, that nothing happened. S29's recharge cannot be rehearsed against a gun like that,
            #      which is the failure mode this handler's own comment warns about.
            clamp = lambda cur, cap, d: max(0, min(cap, cur + d))
            self.hp = clamp(self.hp, self.cfg_hp, _int(t[1] if len(t) > 1 else None) or 0)
            self.armor = clamp(self.armor, self.cfg_armor, _int(t[2] if len(t) > 2 else None) or 0)
            self.shield = clamp(self.shield, self.cfg_shield, _int(t[3] if len(t) > 3 else None) or 0)
            if self.hp > 0:
                self.alive = True
                self._out.append(f"$HP,{self.hp},{self.armor},{self.shield},*")
            else:
                self.alive = False
                # $LIFE's own frame shape carries no ammo tokens at all (protocol §5), so there is
                # nothing to read here; the magazine is untouched by a lethal write.
                self._out.append("$LCD,0,0,0,0,0,0,*")
        elif cmd == "WEAP":
            # F259/S42 (bench 2026-09-17): a $WEAP write RESETS the slot's magazine to the frame's
            # baked-in clip -- t16/t39, index 17 (`frames.py._WEAP_MAG`; t39 == t16 on every stock
            # frame, protocol §6) -- and its reserve to t40, index 41 (`_WEAP_RESERVE_ECHO`; F207:
            # the gun's own $ALCD mirrors t40, not t17). A short/stub frame carries neither and the
            # fake leaves whatever the slot already holds, same as a real gun would.
            slot = _int(t[1]) if len(t) > 1 else None
            if slot is not None:
                clip = _int(t[17]) if len(t) > 17 else None
                if clip is not None:
                    self.mag[slot] = clip
                rsv = _int(t[41]) if len(t) > 41 else None
                if rsv is None:
                    full = _int(t[18]) if len(t) > 18 else None   # t17 ammoReserv, the fallback ceiling
                    rsv = None if full is None else full // 2
                if rsv is not None:
                    self.reserve[slot] = rsv
                self._queue_alcd(slot)
        elif cmd == "AMMO":
            # `$AMMO,<slot>,<mag>,<reserve>,…` SETS the magazine and reserve outright -- the
            # accuracy writer's own restore (S42) and the loadout spawn ammo both use this shape.
            slot = _int(t[1]) if len(t) > 1 else None
            if slot is not None:
                mag = _int(t[2]) if len(t) > 2 else None
                rsv = _int(t[3]) if len(t) > 3 else None
                if mag is not None:
                    self.mag[slot] = mag
                if rsv is not None:
                    self.reserve[slot] = rsv
                self._queue_alcd(slot)
        elif cmd == "QUERY":
            # F264: `$QUERY,*` -- protocol/brx-protocol.md's `$QUERY` row: "First seven fields: <playerId>,
            # <team>,<hpMax>,<armourMax>,<shieldMax>,<one $PSET sound id (t11)>,<gyro ok 0/1>", THEN one
            # `$LCD` carrying the gun's CURRENT pools and slot-0 magazine (the array is the pool MAXIMA and
            # is useless for the cure -- the $LCD behind it is the whole point). `player_id` is not modelled
            # on the fake (no per-gun identity token elsewhere either -- `$HIR`'s shooter id is pinned at 0
            # for the same reason), so it is pinned at 0 too; nothing downstream reads it.
            # This answers exactly the same whether or not `go_dead_chatty()` has run: it just reads
            # `self.hp`/`self.armor`/the slot-0 magazine, which dead-chatty already reads as dead -- so a
            # dead-chatty gun's $LCD reply carries health 0, which is the one door the F264 cure walks through.
            self._out.append(f"$QUERY,0,{self.team},{self.cfg_hp},{self.cfg_armor},{self.cfg_shield},,1,*")
            self._out.append(f"$LCD,{self.hp},{self.armor},0,0,{self.mag.get(0, 0)},{self.reserve.get(0, 0)},*")
        # all other config frames (START/GSET/BMAP/VOL/PLAY…) accepted

    # -- IR hit → events ----------------------------------------------------- #
    def receive_ir(self, shooter_team: int, shooter_id: int = 1,
                   proto: int = 0, mag: Optional[int] = None, sub: int = 0) -> None:
        """Take an IR word from `shooter_team`: look the `<proto, sub>` cell up in the `$SIR` table the
        gun HOLDS and apply that row's function; emit `$HIR` then `$HP` (0 = died).

        F78 -- THE TABLE GATE. A cell with no row emits NOTHING: no `$HIR`, no `$HP`, no pool change,
        no headset flash. That is the F11 shape (`$CLEAR` with no `$SIR` after it: a gun that reports
        alive and healthy and can never be hit), the F40 shape (a re-keyed cell the victim's table
        lacks) and the F60 shape (a station word on a protocol the table has no row for). The cell is
        logged in `self.discarded` so a test can prove the discard happened rather than infer it from
        silence. The row's FUNCTION decides the pool effect (`_SIR_FN_*` above): fn 1 and its class
        damage, 36/37 multiply, 2/6 pierce armour, 10 heals, 11 grants shield, 13 grants armour, and
        the status functions (8, 23-28, 35...) register with no pool change -- which is how an EMP
        (F15, proto 8 -> fn 24) and a hill beacon (proto 15 -> fn 28) reach the host.

        Polarity (bench, protocol §5): damage lands only from an ENEMY team and support (heal / shield /
        armour) only from the OWN team while `$GSET` t1 = 0; a rejected word emits no `$HIR`. With
        friendly fire ON everything lands from anyone -- the host engine then declines the kill credit.

        F46/F62 -- `mag=0` IS A MISS (bench 2026-09-09): the gun vibrates and plays `missShotHit`
        natively and emits NO `$HIR` and NO `$HP`. Modelled as `self.misses += 1` and nothing on the
        wire, so a test can assert F68's shape (a miss reaches the player and not the software).
        ⚠ Assumed, not measured: the table lookup happens BEFORE the miss check here, so a mag-0 word
        on a cell with no row is a silent discard, not a miss. The bench measured misses on a stock
        table only.

        `sub` defaults to 0 -- the plain-damage row `<0,0>`. ⚠ Real captures carry `3` in `$HIR`
        token 7 for an ordinary rifle round (`$HIR,4,0,19,2,9,0,3`) while dealing plain magnitude, and
        the stock row `<0,3>` is fn 37 (x2) -- so token 7 is evidently NOT the same thing as the
        `$SIR` subtype key, or the AR would double. The fake keys the table on `sub` and echoes it in
        token 7 because nothing downstream reads that token; do not read the emitted value as a
        measurement.

        `proto`/`mag`/`sub` exist so the sim can model words that are NOT an ordinary rifle round.
        A grenade hill's ambient damage word is `proto=0, mag=8, shooter_id=0` -- an environmental
        shooter, not a player. For a protocol-15 station BEACON use `beacon()`.

        ⚠ `mag` drives the damage actually applied. It used to be hardcoded to 9 in the frame while
        `self.damage` (25 by default) was subtracted from the pools, so the fake emitted a magnitude
        that contradicted the damage it had just dealt.
        """
        if not self.alive:
            return                                  # dead guns accept no IR (protocol §5)
        cell = (int(proto), int(sub))
        fn = self.sir.get(cell)
        if fn is None or fn in _SIR_FN_NONE:
            self.discarded.append(cell)             # F11/F40/F60: silently ignored -- NOTHING on the wire
            return
        m = self.damage if mag is None else int(mag)
        if m == 0:
            self.misses += 1                        # F46/F62: felt by the player, invisible over BLE
            return
        same_team = shooter_team == self.team
        if not self.friendly_fire:
            if fn in _SIR_FN_ALLY and not same_team:
                return                              # support from an enemy: rejected, no $HIR
            if fn not in _SIR_FN_ALLY and same_team:
                return                              # damage from a teammate: rejected, no $HIR
        if fn in _SIR_FN_DAMAGE or fn in _SIR_FN_X125 or fn in _SIR_FN_X2:
            d = m if fn in _SIR_FN_DAMAGE else (m * 5 // 4 if fn in _SIR_FN_X125 else m * 2)
            self._drain_pools(d * (100 + self.tmp_t8) // 100)   # F121: t8 = -100 registers the hit, takes nothing
        elif fn in _SIR_FN_AP:
            self.hp = max(0, self.hp - m * (100 + self.tmp_t8) // 100)
        elif fn in _SIR_FN_HEAL:
            self.hp = min(self.cfg_hp, self.hp + m)
        elif fn in _SIR_FN_SHIELD:
            self.shield = min(self.cfg_shield, self.shield + m)
        elif fn in _SIR_FN_ARMOR:
            self.armor = min(self.cfg_armor, self.armor + m)
        # else: a status function (8, 23-28, 35, ...) -- registers, pools unchanged
        # token 3 = shooter PLAYER id. It was hardcoded 0, which is why no sim
        # scenario could ever exercise per-gun kill attribution (Q17) — and, because 0 is
        # A5.1's "no identity", why the F69 hill-scoring bug stayed invisible to the suite.
        self._out.append(f"$HIR,0,{proto},{shooter_id},{shooter_team},{m},0,{sub},*")
        if self.hp <= 0:
            self.hp = 0
            self.alive = False
            self._out.append(f"$HP,0,{self.armor},{self.shield},*")
        else:
            self._out.append(f"$HP,{self.hp},{self.armor},{self.shield},*")

    def _alcd_frame(self, slot: int) -> str:
        """`$ALCD,<mag>,<accuracy>,<slot>,<reserve>,<heat>,*` for `slot`'s CURRENT counts.

        Accuracy and heat are not modelled here (nothing downstream of `frames.alcd_ammo` reads
        them), so they are pinned at 100/0 -- a stand-in, not a measurement.
        """
        return f"$ALCD,{self.mag.get(slot, 0)},100,{slot},{self.reserve.get(slot, 0)},0,*"

    def _queue_alcd(self, slot: int) -> None:
        """Queue `slot`'s `$ALCD` echo `_ALCD_WRITE_DELAY_S` from now -- a `$WEAP`/`$AMMO` write is
        a BLE round trip, not an instant local call, so `drain()` must not hand it back early."""
        self._pending.append((self._clock() + _ALCD_WRITE_DELAY_S, self._alcd_frame(slot)))

    def fire(self, slot: int = 0) -> None:
        """One round leaves `slot`: decrements the magazine and reports it AT ONCE -- this is the
        gun's own action, not a BLE write, so it is not held behind `_ALCD_WRITE_DELAY_S`.

        An empty magazine has no round to report and is left alone; dry-fire is not modelled.

        F264: gated on `self.alive`, the same rule `receive_ir` already applies to incoming IR -- a dead
        gun's trigger produces no `$ALCD` (bench: "a dead gun's trigger gives $BUT with no $ALCD decrement",
        protocol/brx-protocol.md's `$BUT` row). `$BUT` itself is not modelled here (always test-injected),
        so this is the one place a dead-but-chatty gun (`go_dead_chatty`) visibly refuses to fire.
        """
        if not self.alive:
            return
        mag = self.mag.get(slot, 0)
        if mag <= 0:
            return
        self.mag[slot] = mag - 1
        self._out.append(self._alcd_frame(slot))

    def _drain_pools(self, d: int) -> None:
        """Damage drains shield -> armour -> HP, 1:1, overflow spilling inward (protocol §5)."""
        if self.shield >= d:
            self.shield -= d
            return
        d -= self.shield
        self.shield = 0
        if self.armor >= d:
            self.armor -= d
        else:
            d -= self.armor
            self.armor = 0
            self.hp -= d

    def beacon(self, owner_team: int, mag: int = 8, proto: int = 15) -> None:
        """A station/grenade BEACON: `$HIR` with NO pool change and NO `$HP` (bench 2026-09-10).

        Magnitude is the station MODE, not damage: **8 = hill, 6 = respawn**. The owner's team
        rides in the team field, and a neutral hill reads team 2. Beacons are the half of the
        grenade our compiled table discards in silence for want of a protocol-15 row (F60/F70),
        so a sim that cannot emit one cannot exercise the fix.

        A beacon lands whether or not the gun is alive — it is a broadcast, not a shot.

        F78: it is still a `$SIR` lookup. Without a `<15,0>` row (the `_OBJECTIVE_SIR_ROW` an objective
        mode ships) the beacon is discarded in silence, exactly like a hit -- that is F60/F70.
        """
        cell = (int(proto), 0)
        if cell not in self.sir or self.sir[cell] in _SIR_FN_NONE:
            self.discarded.append(cell)
            return
        self._out.append(f"$HIR,0,{proto},0,{owner_team},{mag},0,0,*")

    def drain(self) -> list[str]:
        """Everything ready to hand the host: every instant frame, plus any delayed `$ALCD` whose
        `_ALCD_WRITE_DELAY_S` has elapsed on `self._clock()`. A write made moments ago stays queued
        -- draining right after `write()` must see nothing, exactly like the real BLE round trip."""
        now = self._clock()
        ready = [frame for (ready_at, frame) in self._pending if ready_at <= now]
        self._pending = [(ready_at, frame) for (ready_at, frame) in self._pending if ready_at > now]
        out, self._out = self._out + ready, []
        return out


@dataclass
class _FakeSession:
    alias: str
    address: str
    seq: int = 0
    buffer: list = field(default_factory=list)

    def record(self, direction: str, raw: str) -> BufferedEvent:
        self.seq += 1
        ev = BufferedEvent(seq=self.seq, t_ms=0, direction=direction, raw=raw,
                           parsed=parse_event(raw) if direction == "rx" else {})
        self.buffer.append(ev)
        return ev


class FakeConnectionManager:
    """Drop-in for `ConnectionManager` over the game path — pass to `run_live(...,
    manager=mgr)`. Backed by `FakeTagger`s; `inject_hit`/`inject_kill` simulate shots."""

    def __init__(self, taggers: list[FakeTagger]):
        self.taggers = {t.address: t for t in taggers}
        self.sessions: dict[str, _FakeSession] = {}
        self.dropped: set[str] = set()          # aliases whose BLE link has "dropped"
        self.fail_connect: set[str] = set()     # addresses whose connect() will fail

    async def scan(self, duration_s: int = 8) -> list[dict]:
        return [{"name": t.name, "address": a, "rssi": -50, "has_uart_service": True}
                for a, t in self.taggers.items()]

    async def connect(self, address: str, alias: str, **_) -> dict:
        if alias in self.sessions:                  # mirror the real manager (catches a
            raise ValueError(f"alias '{alias}' already connected")  # missing disconnect)
        if address in self.fail_connect:            # simulate a gun that won't come up
            raise ConnectionError(f"could not connect to {address}")
        self.dropped.discard(alias)                 # a (re)connect heals a recoverable drop
        self.sessions[alias] = _FakeSession(alias=alias, address=address)
        return {"alias": alias, "address": address, "connected": True}

    def is_connected(self, alias: str) -> bool:
        return alias in self.sessions and alias not in self.dropped

    async def wait_for(self, alias: str, prefix: str, timeout_s: int = 0) -> dict:
        """Scan the session buffer for an rx frame starting with `prefix`. The fake
        delivers replies synchronously on send(), so the frame is already buffered —
        return the latest match (or unmatched). Mirrors ConnectionManager.wait_for's
        result shape for the shared diagnostics flow."""
        s = self.sessions.get(alias)
        if s is not None:
            for e in reversed(s.buffer):
                if e.direction == "rx" and e.raw.startswith(prefix):
                    return {"matched": True, "event": e.to_dict()}
        return {"matched": False}

    async def send(self, alias: str, command: str, reply_window_ms: int = 0) -> dict:
        if alias in self.dropped:            # writing to a dropped link fails (real BLE raises)
            raise ConnectionError(f"link dropped: {alias}")
        s = self.sessions[alias]
        s.record("tx", command)
        tagger = self.taggers[s.address]
        tagger.write(command)
        replies = [s.record("rx", r).to_dict() for r in tagger.drain()]
        return {"sent": command, "replies_within_window": replies}   # the real manager's shape (ble.py send)

    def get_events(self, alias: str, since_seq: int = 0, max_events: int = 200) -> dict:
        if alias in self.dropped:            # a dropped link goes silent (no new events)
            return {"events": []}
        s = self.sessions[alias]
        evs = [e.to_dict() for e in s.buffer if e.seq > since_seq][:max_events]
        return {"events": evs}

    def drop(self, alias: str) -> None:
        """Simulate a mid-game BLE drop: writes to this alias raise, reads go silent,
        and it can't be shot any more. Use to test that a game survives a lost link."""
        self.dropped.add(alias)

    async def disconnect(self, alias: str) -> dict:
        self.sessions.pop(alias, None)
        return {"alias": alias, "disconnected": True}

    async def diagnose(self, address: str, volts_wait_s: int = 34) -> dict:
        from .diagnostics import run_diagnose      # same flow the real manager uses
        return await run_diagnose(self, address, volts_wait_s)

    # -- simulate shooting --------------------------------------------------- #
    def inject_hit(self, victim_alias: str, shooter_team: int) -> None:
        if victim_alias in self.dropped:     # a dropped gun can't report a hit
            return
        s = self.sessions[victim_alias]
        tagger = self.taggers[s.address]
        tagger.receive_ir(shooter_team)
        for r in tagger.drain():
            s.record("rx", r)

    def inject_kill(self, victim_alias: str, shooter_team: int, max_hits: int = 30) -> None:
        """Shoot until the victim is down (one clean kill)."""
        tagger = self.taggers[self.sessions[victim_alias].address]
        n = 0
        while tagger.alive and n < max_hits:
            self.inject_hit(victim_alias, shooter_team)
            n += 1
