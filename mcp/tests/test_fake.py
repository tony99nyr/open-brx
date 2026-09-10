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
