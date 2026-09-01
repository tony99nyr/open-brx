# Verify together — the things I cannot settle from code

Each item says **what to do**, **what would prove it**, and **what would disprove it**. They are
ordered so an early result does not depend on a later one. Ten minutes covers the lot.

Everything here is either a fix that is shipped but unconfirmed on hardware, or a report I could not
reproduce. Nothing in this file is "probably fine" — if it were, it would not be here.

**Before you start:** note **how long the guns have been powered**. That is the one variable we keep
failing to record, and it is the leading suspect in V1.

---

## V1 · Why did point-blank on the dome fail, when the domes were working? 🔴
**Shipped:** nothing — this is a diagnosis.

**The timeline says the domes were never dead.** In the session where they were reported broken
(`session-8bbf96ab`, 35 min, 170 hits) the **first dome hit landed 17 s in**, and the opening five
minutes ran at **6 dome / 50 body ≈ 11%** — which is Callsign's own native rate (3 of 23 ≈ 13%).
The dome-dominated block at 30–40 min (75 dome / 17 body) is the deliberate nozzle test once it
started working. Guns had been powered **minutes**, so a stale-gun state is out too, along with
`outdoorMode` and daylight.

So the question is not "do the domes register" — they do, from the first minute. It is **why
point-blank on the dome failed at that moment and worked later**.

**Do:** hold the nozzle on the dome and fire 5 shots. Then move ~1 m back, aim at the dome, 5 more.
Repeat on the other headset and the back dome. Watch MC's live rows (`sensor` is reported now).
**Proves it was aim:** point-blank works every time and the misses were at range/angle.
**Proves a real fault:** point-blank gives sensor 4 (or nothing) repeatedly — then **do not change
anything**, Share log from that phone immediately, and note gun uptime and whether the headset had
been re-seated. The frame ring is the only thing that can show what the gun reported at that instant.
**Worth knowing:** point-blank IR floods; `gotchas.md` warns that a close-range shot can be
mis-attributed across sensors. A dome test at 30–50 cm may be more honest than one at 0 cm.

**Also unexplained:** sensors **2** and **3** appear in the data (6 and 17 hits). The protocol
documents only 0 = headset front, 1 = headset back, 4 = gun body. Nobody knows what 2 and 3 are.

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
