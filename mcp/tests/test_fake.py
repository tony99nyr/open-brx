"""`FakeTagger` fidelity: where the double must match the real gun.

A fake that models a command differently from the hardware lets the real bug pass the
suite. Everything asserted here is bench-measured -- see `protocol/brx-protocol.md`
`$LIFE` and the 2026-09-09 experiment-log entry.
"""

def test_life_drains_floors_and_swaps_frame_shape_on_a_lethal_write():
    """`$LIFE` on the fake must match the 2026-09-09 bench, or a damage-over-time feature (S16)
    would be built against a double that behaves differently from the gun.

    Written because the first version of this fake's drain had NO lower bound (it would go
    negative) and referenced two attributes that do not exist -- and the suite could not see
    either, because nothing had ever fired a lethal `$LIFE` at it."""
    from brx_mcp.fake import FakeTagger

    t = FakeTagger("AA:BB:CC:DD:EE:FF", hp=45, armor=70)
    t.write("$SPAWN,,*"); t.drain()

    # a NEGATIVE drains, and the write self-emits $HP
    t.write("$LIFE,0,-9,0,*")
    assert t.armor == 61, t.armor
    assert any(f.startswith("$HP,45,61") for f in t.drain()), "a non-lethal $LIFE must self-emit $HP"

    # per pool, floored at 0, and NO spill into the neighbouring pool
    t.write("$LIFE,0,-100,0,*")
    assert (t.armor, t.hp) == (0, 45), (t.armor, t.hp)
    t.drain()

    # a lethal write kills, and the frame shape SWAPS to $LCD with no $HP at all (F64)
    t.write("$LIFE,-45,0,0,*")
    out = t.drain()
    assert t.hp == 0 and not t.alive
    assert any(f.startswith("$LCD,0,0") for f in out), out
    assert not any(f.startswith("$HP,") for f in out), "a lethal $LIFE must NOT emit $HP"


# ---- F78: the $SIR table gate + the magnitude-0 miss ----------------------- #
def _fresh(**kw):
    from brx_mcp.fake import FakeTagger
    t = FakeTagger("AA:BB:CC:DD:EE:FF", team=2, **kw)
    t.write("$SPAWN,,*"); t.drain()
    return t


def test_f11_sequence_leaves_the_fake_unhittable_and_a_fresh_sir_row_rearms_it():
    """The exact panic/F11 shape: `$CLEAR` then `$SP,99` leaves the gun with NO `$SIR` table, and a
    gun with no rows discards every hit IN SILENCE -- no `$HIR`, no `$HP`, pools untouched, still
    reporting alive (protocol/brx-protocol.md `$CLEAR`, deterministic 5/5 on 2026-09-02). Until
    now the fake registered every hit whatever it had been sent, so F11/F40/F60 were invisible to
    the suite by construction."""
    t = _fresh()
    # CONTROL first: a fresh (booted) gun holds the stock table and a plain round lands.
    t.receive_ir(shooter_team=1, mag=9)
    out = t.drain()
    assert any(f.startswith("$HIR,") for f in out) and any(f.startswith("$HP,45,61") for f in out), out

    # F11: `$CLEAR` wipes the table; `$SP,99` after it is the panic tail (no table restored)
    t.write("$CLEAR,*"); t.write("$SP,99,*"); t.drain()
    assert t.sir == {}, "no $SIR rows after $CLEAR"
    t.receive_ir(shooter_team=1, mag=9)
    assert t.drain() == [], "an unmatched cell emits NOTHING -- no $HIR, no $HP"
    assert (t.hp, t.armor, t.alive) == (45, 61, True), "pools untouched, still alive: the F11 shape"
    assert t.discarded[-1] == (0, 0), "the discard is logged, not merely silent"

    # a fresh `$SIR` row re-arms exactly that cell
    t.write("$SIR,0,0,,1,0,0,1,,*")
    t.receive_ir(shooter_team=1, mag=9)
    out = t.drain()
    assert any(f.startswith("$HP,45,52") for f in out), out
    # ...and ONLY that cell: a proto-10 rocket word still has no row
    t.receive_ir(shooter_team=1, proto=10, mag=100)
    assert t.drain() == [] and t.hp == 45


def test_sir_functions_decide_the_pool_effect():
    """The row's FUNCTION, not the word, decides what a hit does (protocol §5 function map)."""
    t = _fresh()
    t.write("$CLEAR,*")
    t.write("$SIR,0,0,,1,0,0,1,,*")        # plain damage
    t.write("$SIR,0,1,,36,0,0,1,,*")       # x1.25 floor
    t.write("$SIR,0,3,,37,0,0,1,,*")       # x2
    t.write("$SIR,8,0,,24,0,0,1,,*")       # EMP: status, no pool change (F15)
    t.write("$SIR,15,0,,28,0,0,1,,*")      # beacon: registers with nothing (F73)
    t.write("$SIR,1,0,H29,10,0,0,1,,*")    # heal, clamp
    t.write("$SIR,2,1,VA8C,11,0,0,1,,*")   # shield grant, saturating at $PSET t5
    t.write("$PSET,0,0,45,70,30,50,*")     # shield CEILING 30
    t.drain()

    t.receive_ir(1, mag=20, sub=1); assert t.armor == 45, t.armor          # floor(20 * 1.25) = 25
    t.receive_ir(1, mag=20, sub=3); assert t.armor == 5, t.armor           # 40
    t.receive_ir(1, proto=8, mag=15)
    out = t.drain()
    assert any(f.startswith("$HIR,0,8,") for f in out) and any(f.startswith("$HP,45,5,") for f in out), out
    assert t.armor == 5 and t.hp == 45, "fn 24 registers with NO pool change"
    t.receive_ir(1, proto=15, mag=8); assert t.hp == 45 and t.armor == 5   # fn 28 likewise
    t.drain()

    # support has the OPPOSITE polarity: an ENEMY heal is rejected in silence, an ALLY heal lands
    t.receive_ir(1, mag=20, sub=0); t.drain(); assert t.hp == 30, t.hp     # 5 armour, then 15 into HP
    t.receive_ir(1, proto=1, mag=50); assert t.drain() == [] and t.hp == 30, "enemy heal: no $HIR"
    t.receive_ir(2, proto=1, mag=50); assert t.drain() and t.hp == 45, "ally heal clamps at max"
    t.receive_ir(2, proto=2, sub=1, mag=50); t.drain(); assert t.shield == 30, "shield saturates at $PSET t5"
    # CONTROL: a plain round from an ally is still rejected while friendly fire is off
    t.receive_ir(2, mag=20); assert t.drain() == [] and t.hp == 45


def test_a_magnitude_zero_word_is_a_miss_felt_by_the_player_and_invisible_over_ble():
    """F46/F62 (bench 2026-09-09): three magnitude-0 words gave ZERO events while the gun vibrated and
    played `missShotHit`. The fake counts the miss and puts nothing on the wire -- F68's shape."""
    t = _fresh()
    t.receive_ir(shooter_team=1, mag=0)
    assert t.drain() == [], "a miss emits no $HIR and no $HP"
    assert t.misses == 1 and (t.hp, t.armor) == (45, 70)
    # CONTROL: the same aim at magnitude 9 lands (the bench's same-aim control)
    t.receive_ir(shooter_team=1, mag=9)
    assert any(f.startswith("$HP,45,61") for f in t.drain()) and t.misses == 1


def test_a_beacon_needs_a_proto_15_row_too():
    """F60/F70: the stock table has no `<15,0>` row, so a grenade/station beacon is discarded in
    silence unless the head ships `_OBJECTIVE_SIR_ROW`."""
    t = _fresh()
    t.beacon(owner_team=1)
    assert t.drain() == [] and t.discarded[-1] == (15, 0)
    t.write("$SIR,15,0,,28,0,0,1,,*")
    t.beacon(owner_team=1)
    assert any(f.startswith("$HIR,0,15,0,1,8,") for f in t.drain())


def test_a_gun_that_is_not_listening_drops_every_write():
    """Q18: connected is not listening. A write to a deaf gun changes nothing and answers nothing."""
    from brx_mcp.fake import FakeTagger
    t = FakeTagger("AA:BB:CC:DD:EE:FF")
    t.listening = False
    t.write("$PHONE,*"); t.write("$TID,3,*")
    assert t.drain() == [] and t.team == 0 and t._tap is False
    t.listening = True
    t.write("$PHONE,*")
    assert any(f.startswith("$BUT,3,0") for f in t.drain()), "the same write answers once it listens"
