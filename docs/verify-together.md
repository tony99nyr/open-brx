# Verify together — the things I cannot settle from code

Each item says **what to do**, **what would prove it**, and **what would disprove it**. They are
ordered so an early result does not depend on a later one. Ten minutes covers the lot.

Everything here is either a fix that is shipped but unconfirmed on hardware, or a report I could not
reproduce. Nothing in this file is "probably fine" — if it were, it would not be here.

**Before you start:** note **how long the guns have been powered** and whether a headset was re-seated.
Not because either is a suspect — gun uptime is refuted (they were cycled before every game) — but because
they are the variables we keep failing to write down, which is why two theories died undecided.

---

## V1 · Why did point-blank on the headset fail, when the headset was catching most hits? 🔴
**Shipped:** nothing — this is a diagnosis. The protocol doc has been corrected (below).

**It may well be an anomaly.** n=1, and the aggregate does not support a broken headset. Do not spend
a session hunting it. The point of this entry is that **the next occurrence is now cheap to capture**,
so play normally and look only if it happens again.

**The headset has FOUR sensors** (operator-confirmed 2026-09-01): `$HIR` tok1 **0, 1, 2 and 3 are all
headset**, `4` is the gun body. The doc previously listed only 0 = front, 1 = back, 4 = gun — so 2 and
3 read as unknown and every count that used "0 or 1" undercounted the headset by half.

Re-counted with all four and **split by match** (a blended figure mixes two very different things):

| match | headset | gun | headset share |
|---|---|---|---|
| the one reported as broken | **13** | 62 | **17%** |
| the later deliberate nozzle test | 95 | 0 | 100% |

17% is above Callsign's own native rate (3 of 23 ≈ 13%), so the headset was not dead. But one thing
is genuinely odd and is what V1 tests: **sensor 1 — the back dome — recorded ZERO hits in the reported
match**, and 69 in the test match.

**Do:** nozzle on each of the four sensor positions, 5 shots each; then the same from ~1 m. Watch MC's
live rows — `sensor` is reported now, so you can see WHICH of the four caught each shot.
**Proves it was aim/position:** the sensors that fail point-blank are the two we have never mapped
(2 and 3), or specific spots on the shell.
**Proves a real fault:** a sensor that reported hits earlier in the session stops reporting entirely —
then **change nothing**, Share log from that phone at once, and note gun uptime.
**Bonus:** this also maps 2 and 3 to physical positions, which nobody has done.

**If it recurs, three things now record it without you doing anything:** `hit_taken` carries the
sensor (so the live board shows a dome going quiet as it happens), the full game config and the
compiled head are stored per match, and the recap no longer drifts from the facts. The only manual
step left is **Share log before closing the app**.
**Worth knowing:** point-blank IR floods and `gotchas.md` warns it gets mis-attributed across sensors,
so 30–50 cm may be the more honest test.

## V2 · Does the low-health alert fire, and is it bright enough? 🟠
**Shipped:** `$PLAY,VA8B` + `$HLED,7,4,90,90,10,15` once per life, byte-identical to Callsign.
Our trigger fires on the first HP-only frame; **Callsign's two observed alerts both came at `$HP,34,0,0`**,
two hits later, so an HP threshold fits its behaviour as well as "armour 0" does. n=2.
**Do:** take a player's armour to 0 and keep hitting them.
**Proves working:** their headset lights, and the HUD log shows `low-health alert: armour 0, hp NN`.
**Proves broken:** log line present but no light → the frame itself is wrong. No log line at all → our
trigger never fired, and that is ours to fix.
**On making it brighter — probably impossible, and worth knowing before anyone tries.** The Windows
lane measured `$GLED` token 5 by luminance on 2026-09-02: it is a brightness with exactly **two levels
above off** (1 ≈ 70%, anything ≥2 is full and identical up to 255), and **Callsign's 10 is already in
the saturated region**. If `$HLED` matches, we are already at maximum and no value will help — a dim
alert would be a hardware limit. That is still an inference across two different commands, but it is
far cheaper to check than to sweep: confirm the alert fires, then look at whether it is bright enough
at 10. Only if it is genuinely dim is a sweep worth running.
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
