# Gotchas — the field lore

**Everything that will waste an hour if you don't know it.** Organised **by symptom**, because when one
of these bites you, you search for *what you're seeing* — not for what you should have known.

Each entry: **what it looks like → what it actually is → what to do.** Nearly all of these were learned
by losing a session to them.

---

## Before you start

**"Only 2 of 3 guns joined the game."**
A gun whose **headset is off, unpaired or flat silently refuses to join** — no error, no voice line.
This is the single most common cause of a wasted muster. **A headset slow-blinks RAINBOW when
disconnected** — eyeball every headset before arming (`field-process.md` §Muster step 0). Note a settled
headset shows team colour **pre-game only** and goes **dark during play** — dark in a game is normal.

**"The gun advertises but won't connect" / "connects then immediately drops."**
A **"screamer"** — the documented failure of a tagger left powered all day. **POWER-REST the guns
between sessions.** Never bench-marathon a match-day fleet. Also: BC firmware won't re-pair below a
battery threshold, so keep them charged.

**"The gun is called Tactix2 again."**
**Opening the Callsign app wipes an enrolled gun's `$NAME`.** Never open it on our guns. Re-stamp with
`python -m brx_mcp rename`.

---

## Connecting

**"Connection failed."**
Establishing a BLE link succeeds roughly **1 attempt in 3** — the official app behaves the same. `ble.py`
retries 5×, and that retry *is* the fix. **This is not a broken stack**; hours were once lost to that
theory.

**"Reconnect right after a disconnect comes up dead (NUS TX char missing)."**
After a **gun-initiated** `$DISCONNECT`, back off **≥5 s** before reconnecting.

**"The board vanished from the bus entirely."**
A **charge-only USB-C cable**. The board powers up and looks alive while being invisible to the PC. Use
a cable you have *seen* enumerate.

**"The port is there but nothing answers."**
You're on the ESP32-S3's **native USB** port (`VID_303A`), which enumerates from ROM whether or not the
sketch uses it — so it looks healthy while `Serial` is actually bound to UART0. **Use the UART port**
(`CH343`, `VID_1A86`), or set *USB CDC On Boot → Enabled*.

**`PermissionError(13, 'Access is denied.')` on a COM port.**
Windows serial ports are **exclusive**. **Close the Arduino Serial Monitor.**

**`UnicodeEncodeError: 'charmap' codec can't encode ...` from a bench script.**
The **Windows console is cp1252**. Any non-ASCII character in a `print()` — a prime, an arrow, an
em-dash, a box-drawing glyph — **kills the script mid-run**, usually after it has already reconfigured a
gun. **Keep bench-script output ASCII-only.** (`mcp/tools/weapon_range.py` says so in its docstring;
the lesson does not travel unless you look.)

**"That IR function does nothing" / "my emitter fired but the victim never reacted."**
**Check the SHOOTER TEAM in the IR word before believing any negative result.** The receiver gates IR
by the function's polarity and **discards the frame outright when the team is wrong — emitting no
`$HIR` at all**. A wrongly-teamed shot is therefore *indistinguishable* from a dead emitter, a
misaimed LED, or a function that genuinely does nothing.

| testing | fire from |
|---|---|
| damage, armour-pierce | an **enemy** team |
| heal, shield, armour, respawn, any grant | the victim's **own** team |
| an unknown function | **both**, and compare — that is how you learn its polarity |

This voided several previously "confirmed" negatives (fn 24-27, and the whole stun hunt across
fn 3/8/23-28/35), all of which had been fired from an enemy team only. **Every IR experiment must state its shooter team, its firing range, the `$HIR` tok1 sensor, and
whether the victim's pools had headroom** — a grant into a full pool clamps and looks inert, and a
drain against an empty one does too. **Carry a known-good control at both ends** — without a control you cannot
tell "rejected" from "broken".

**`git filter-repo --replace-text` reports success but silently SKIPS binary blobs.**
A scrub that greps clean afterwards in text and commit messages can still leave the value inside
`.btsnoop` captures, images or any other binary — `--replace-text` does not touch them. Reaching those
needs a **`--blob-callback`** doing raw byte replacement. Verified 2026-08-27: after a clean-looking
pass, both `protocol/captures/raw/2026-08-25-*.btsnoop` still carried the gun's advertised BLE name.
Two further traps in the same area: **commit messages** need `--replace-message` (a blob filter never
sees them), and any replacement inside a **btsnoop** must be **byte-length-neutral** — the format
stores per-packet length fields, so a longer string desynchronises every following packet and the
capture stops parsing.

**"`$QUERY` says the config changed" — check the reply LENGTH before believing it.**
`$QUERY,*` replies are **variable-length across reads for identical state**: long replies span several
BLE notification chunks and a fixed capture window does not always catch them all. Observed 15 / 29 /
33 tokens for the same unchanged gun. **Never diff `$QUERY` as a raw string** — parse fields, and
require two identical consecutive reads before treating a sample as valid. A raw-string diff
manufactures false positives and will happily "detect" an effect that is not there.

**"I covered the emitter in black plastic and it still fires."**
**Most black plastic is IR-TRANSPARENT at 980 nm.** Black ABS, PLA and many black caps block visible
light and pass near-IR almost unchanged, so a 3D-printed shroud or a black cover can look like it is
working and do nothing at all. **Test any material by firing through it at the receiver before
trusting it.** The same applies in reverse when building a snoot: the inside must be genuinely
non-reflective (flocking, matte black paint, felt) or the tube becomes a light pipe and widens the
very skirt you were trying to kill. And note the **headset has its own front IR emitter** (melee
swings, respawn-station requests), so a muzzle attachment never covers the whole system.

**A timed sweep + a human observer = data bound to the wrong cell.**
If an operator is calling out what they see while the script advances on a **timer**, their replies
arrive asynchronously and an observation gets logged against the *next* frame, not the one that caused
it. This produced two contradictory `$GLED` tables and four failed predictions on 2026-08-30, which
were then wrongly blamed on the LEDs "animating". **Never advance an operator-in-the-loop sweep on a
timer.** Send one frame, wait for the call, then send the next. If a timer is unavoidable, have the
script announce a cell id the operator repeats back.

**Never write a headset sticker id into the repo.**
The stickers on our headsets are the **headset serials/PINs**, not just friendly names. In committed
docs, code and logs use the PIN-free `Tactix-XXXX` (BLE name = last MAC bytes) or "gun 1/2"; the
sticker labels belong in conversation only. This leaked 42 times across 8 files before it was caught
in review, while `webapp/mc/README.md` simultaneously promised "real sticker ids never enter the
repo" -- grep for the pattern before publishing anything.

**Address formats.** macOS gives BLE **UUIDs**, Windows/BlueZ give **MACs**. **Never pattern-match on
address format** — a bug exactly like that shipped once.

---

## Sending commands

**"The gun went live with no ammunition."**
**`$AMMO` must follow `$SPAWN`.** A magazine loads into a *just-spawned* gun; there is nothing to load
into otherwise.

**"A weapon pickup silently gave the player a full load."**
A bare **`$WEAP` re-push RESETS mag/reserve to the frame's baked-in values.** Every pickup/powerup must
**re-send `$AMMO`** with the intended counts.

**"The trigger just chirps."**
**`$BMAP` is mandatory** — without it the firmware reports the trigger as *disabled*.

**"I set health and nothing happened."**
`$LIFE` and `$BUMP` are **additive grants clamped at max**, not absolute sets. And **writes don't
self-emit `$HP`** — the new value appears on the next hit or HUD refresh.

**"`$SPAWN` cleared the effect, so I'll use it as a reset."**
It also **restores health**. It is not a clean "clear one thing" tool.

---

## Capturing IR

**"The IR LED isn't lighting — I checked with my phone camera."**
**A phone camera cannot see a ~5 mA IR LED.** From 3V3 through 100 Ω with a 50% carrier the average is a
few mA; a TV remote runs 100–500 mA. **Both cameras showing nothing is consistent with a perfectly
working circuit.** Use the VS1838B to judge, never a camera.

**"Frames arrive as fragments — 16, 17, 20, 21 bits, all prefixes of the real word."**
The capture sketch's per-frame **`RAW` print takes ~15–20 ms at 115200**, long enough for the next frame
to start mid-print. **Send `r` to turn the RAW dump OFF for any capture that matters.** This silently
cost four captures before it was found. (`IDLE_GAP_US` is now 30 ms.)

**"The receiver drops out mid-burst at close range."**
**VS1838B AGC saturates point-blank.** For loopback work, **attenuate** — aim the emitter away, or add
distance. Counter-intuitive but firm: a gun at 1 m decodes cleanly where an LED at 5 cm does not.

**"My armor is draining and I keep dying while testing."**
**You are shooting yourself.** Firing toward a bench receiver reflects your own IR back onto your own
headset. It drains armor, kills you mid-window, and leaves the gun dead for the next round. **Never fire
toward the capture rig** — for audio/pool tests, fire away, or don't fire at all.

**"A TV remote decoded as a BRX frame."**
The `>1500 µs` sync gate is **not BRX-unique** — Sony SIRC's 2390 µs header passes it. BRX sync is
~1990 µs. For a station in a room with TVs, bound the sync and require 25 bits **plus** the parity rule.

---

## Reading results

**"Silence means nothing changed."**
No. **`$ALCD` only streams on ammo events** — if nobody fires, you learn nothing. A read-probe that
*forces* a frame may also **mutate what you're measuring** (`$AMMO` re-push resets the magazine).

**"Zero hits, so the effect didn't register."**
Check the gun is **alive first** — a **dead gun accepts NO IR at all** (448-word brute force). Silence
from a corpse is not evidence about your word.

**"Same word, but the player id doubled and so did the damage."**
A **one-bit misalignment**. If two decodes differ by exactly 2×, you are reading the same frame at two
offsets — usually from stitching fragments. Fix the capture, don't trust the decode.

---

## Interpreting — the discipline that actually mattered

**A control that is merely *present* is not a control.** It has to be **checked before the result is
read**. A run whose baseline was empty produced sixteen clean-looking negatives once, and a "verdict"
line that was pure fiction.

**One well-controlled-looking run is not a result.** Two separate findings survived a careful run each
and died on the second. Everything that has held was measured **3× with alternating conditions**, or
came from a human's senses.

**A host-visible field that correlates with a state is not evidence of that state.** `$ALCD` t2 hitting
0 looked exactly like a weapon disable, had a plausible source-derived mechanism, and was wrong. The
proxy was never tested against the behaviour it stood in for.

**Damage is a property of the (weapon, victim's `$SIR` table) PAIR — never of the weapon alone.**
`$HIR` tok5 is the **raw magnitude**; applied = magnitude × the row's function multiplier × (1 + `$GSET` t7/100) if crit (×1.5 only at the shipped t7=50; the row multipliers for fn 36/37 are currently DISPUTED).
Anything that validates a weapon in isolation is blind to a whole class of bug.

**Your filter can lie.** A `$HIR` filter matching `,42,` reported zero hits on a run that had actually
killed the player, because the sweep varied the player id.

---

## See also
`docs/unknowns.md` (what is still open) · `docs/bench-next-30.md` (next session) ·
`hardware/esp32-ir-bridge/README.md` (board identities and wiring) · `docs/field-process.md` (muster).
