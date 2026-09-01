# Verify together — the things I cannot settle from code

Each item says **what to do**, **what would prove it**, and **what would disprove it**. They are
ordered so an early result does not depend on a later one. Ten minutes covers the lot.

Everything here is either a fix that is shipped but unconfirmed on hardware, or a report I could not
reproduce. Nothing in this file is "probably fine" — if it were, it would not be here.

**Before you start:** note **how long the guns have been powered**. That is the one variable we keep
failing to record, and it is the leading suspect in V1.

---

## V1 · Why did point-blank on the headset fail, when the headset was catching most hits? 🔴
**Shipped:** nothing — this is a diagnosis. The protocol doc has been corrected (below).

**The headset has FOUR sensors** (operator-confirmed 2026-09-01): `$HIR` tok1 **0, 1, 2 and 3 are all
headset**, `4` is the gun body. The doc previously listed only 0 = front, 1 = back, 4 = gun — so 2 and
3 read as unknown and every count that used "0 or 1" undercounted the headset by half.

Re-counted with all four, the session reported as "headsets not working" was:
**headset 108, gun 62 — the headset caught 64% of 170 hits**, the first one 17 s in.

So the headsets were working throughout, and the whole-session claim does not hold. Two things still
do not fit, and are what V1 tests:
- the **5–10 min window ran 0 headset / 11 gun**;
- the deliberate point-blank test **failed then and worked later** (30–40 min: 92 headset, 0 gun).

**Do:** nozzle on each of the four sensor positions, 5 shots each; then the same from ~1 m. Watch MC's
live rows — `sensor` is reported now, so you can see WHICH of the four caught each shot.
**Proves it was aim/position:** the sensors that fail point-blank are the two we have never mapped
(2 and 3), or specific spots on the shell.
**Proves a real fault:** a sensor that reported hits earlier in the session stops reporting entirely —
then **change nothing**, Share log from that phone at once, and note gun uptime.
**Bonus:** this also maps 2 and 3 to physical positions, which nobody has done.
**Worth knowing:** point-blank IR floods and `gotchas.md` warns it gets mis-attributed across sensors,
so 30–50 cm may be the more honest test.

## V2 · Does the low-health alert fire, and is it bright enough? 🟠
**Shipped:** `$PLAY,VA8B` + `$HLED,7,4,90,90,**100**,15` once per life when armour hits 0 and HP
starts dropping. Brightness raised from Callsign's 10.
**Do:** take a player's armour to 0 and keep hitting them.
**Proves working:** their headset lights, and the HUD log shows `low-health alert: armour 0, hp NN`.
**Proves broken:** log line present but no light → the frame is wrong or brightness 100 is rejected;
**drop the constant toward 10 and bisect** (`HEADSET_ALERT_BRIGHTNESS` in `compile.py`). No log line
at all → the trigger never fired, and the alert is ours to fix.
**Why:** it did not fire last session and we could not tell whether it had even been attempted.

## V3 · Does the pre-game headset team colour show? 🟠
**Shipped:** `$HLED,<tid>,0,,,10` at the end of the game head.
**Do:** look at both headsets after KIT and before the countdown, in a **TDM** game so the two teams
send different values.
**Proves working:** two different colours, matching the teams.
**Partly:** colour appears but only at death (what happened last time) → our frame is in the wrong
place. Callsign sends it in the **lobby**, paired with a `$GLED` ~200 ms earlier; we send it mid-head.
**Why:** no capture has ever sent a tid above 1 to a headset, so yellow's `$HLED,2` is new ground.

## V4 · Do the personas sound different? 🟠
**Shipped:** 15 voice packs; `$PSET`'s six voice slots now follow the player.
**Do:** set one player to **HEAVY** (the control — the pack we always shipped, decoded by ear) and the
other to **MEDIC** or **RAIDER**. Get each killed.
**Proves working:** audibly different death screams and kill lines.
**Proves broken:** silence on a non-Heavy persona → that family's ids are wrong despite being real
bank entries, and the layout inference in `VOICE_PACKS` fails. A *wrong but real* sound is expected
and fine; silence is not.

## V5 · Does a gun powered on mid-setup reconnect by itself? 🟠
**Shipped:** reconnect now retries forever in every phase (it used to stop after ~25 s), and the
GUN LINK LOST pill is a tap-to-reconnect button.
**Do:** with a phone kitted, switch its gun **off**, wait a full minute, switch it back on. Do not
touch the phone.
**Proves working:** it relinks on its own within ~10 s and the MC row clears.
**Proves broken:** still down after a minute → tap the pill; if that works, the retry loop is dying.

## V6 · Does END MATCH EARLY reach the HUDs? 🟠
**Shipped:** MC now reports `END REACHED n OF m NODE(S)` — red when 0 — and the HUD logs
`control end ignored — phase is X` instead of dropping it silently.
**Do:** mid-match, press END MATCH EARLY.
**Proves working:** reach count equals your node count and both HUDs show the result screen.
**Diagnostic:** reach 0 → it never left MC. Reach 2 but no HUD change → check each HUD's log for the
`ignored` line; **the phones were in `kitted` last time, where end is a no-op.**

## V7 · Do the perk controls read now? 🟢
**Shipped:** the WEAPONS | PERKS | NONE controls went from 34 px chips to 46 px, and they are the
only route to perks.
**Do:** on the phone, open the loadout browser, go to the **secondary** slot.
**Proves working:** you can find and hit PERKS without being told where it is.

## V8 · Does the empty-mag prompt appear? 🟠
**Shipped:** nothing — gun and engine are both proven correct, so this is the phone's render path.
**Do:** empty a magazine on full auto and watch the HUD.
**Proves working:** RELOAD appears and the counter reads 00.
**Proves broken:** then **Share log immediately** — the frame ring will show whether the `$ALCD,0`
even arrived. Do not close the app first.

---

## Not on this list, and why
**A game whose rules fix the weapon/perk did not apply them** (F2-7). I have no repro and no evidence
— the config id was not captured. Next time it happens, note the **game name and config id** from the
GAMES screen before changing anything, and I can replay the exact push.
