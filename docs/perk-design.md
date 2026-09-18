# Perk design

Companion to [`weapon-design.md`](weapon-design.md). A weapon is what you carry. A perk is the third
slot of the kit ([`spec/loadout.md`](spec/loadout.md) §1.2), and it is the slot players argue about.

Written 2026-09-17 from the S50 balance pass, a research sweep over Call of Duty, Titanfall 2, Halo,
Apex, Valorant, Battlefield, Rainbow Six Siege, Counter-Strike, Team Fortress 2 and arcade laser tag,
and a lever survey of our own protocol, compiler and phone node. Tony's instruction: keep every solid
idea, ship a core set, and write the rest down for later. §4 is that long tail.

## 1. What a perk has to be here

Five rules, each one learned rather than assumed.

**Software only.** No firmware change, ever. A perk is `$WEAP`, `$PSET`, `$GSET`, `$SIR`, `$LIFE` or
`$AMMO`, or it is something the phone draws on its own screen.

**It must survive a Mission Control blackout.** MC is a setup, start and recap tool. Players walk out
of Wi-Fi range every match. A perk that stops working when the phone loses MC is a perk that stops
working, so the effect lives either in the compiled bundle (written before the match) or in the node
(the player's own phone, talking to the player's own gun). One carve-out is allowed, and it must be
written on the perk: a pick whose EXTRA needs MC, but whose absence changes nothing else, may ship if
we accept that it quietly does nothing out of coverage. Adrenaline Rush in §3 is the only one.

**The gun never learns that it hit someone.** A shooter's node knows its own shots, its own hits taken
and its own pools. It does not know that a shot landed, and it cannot see its own kills. Every "on
kill" and "on hit dealt" idea is therefore blocked, or degrades to a best-effort MC push.

**A cooldown runs on the match clock, not the life.** Tony, 2026-09-17: a once-per-life reward pays the
player for dying. A perk that recharges every 3 minutes of match time, and keeps its timer across a
death, rewards staying alive instead.

**Every perk pays for itself.** There are three ways to pay. A perk takes a cost on another lever. Or
it carries a condition narrow enough to be worth nothing in some fights. Or it buys information
instead of power, so it never makes the carrier hit harder or live longer. The S50 analysis measured the old set and found
Body Armor was a strict upgrade: +570 to +1500 ms of extra survival on every life, for free, while the
convenience perks paid nothing at all on a life with no reload and no swap. A perk that is always on
and never costs anything is not a choice.

Easy Reload is not in this document. It **moves** to the per-player accessibility block, which is a
decided but unshipped part of S50: today it still sits in the perk slot (`perks.json`). It exists
because Tony's daughter cannot work the reload lever, so it must never compete with a balance pick.

## 2. The core set

Seven picks. Each one buys on a lever its neighbour sells, so the set reads as a square rather than a
ladder, and every pick has a named enemy.

| perk | what the player gets | what it costs | beaten by |
|---|---|---|---|
| **Body Armor** | +25 armour, about 20% more pool | reloads take 25% longer | Armour Piercing, and anything that ticks |
| **Armour Piercing** | your primary ignores armour and shields, straight to health | heavier rounds: less damage AND a slower cycle, set per weapon (§7.7) | a bare-pool opponent, who takes the damage cut for free |
| **Quick Hands** | reload in half the time | magazine and reserve cut by 20% | Extended Mags, in a long fight |
| **Extended Mags** | double magazine and reserve | weapon swap 30% slower | Quick Switch, at close range |
| **Quick Switch** | draw your second weapon in half the time | 20 less armour | Body Armor, in a straight exchange |
| **Motion Tracker** | nearby enemies appear on your HUD as a list, with no bearing and no range | the slot itself: you carry information instead of power | anyone who accepts being seen and shoots first |
| **Second Wind** | once a life, the hit that would nearly finish you leaves you standing | the condition: it pays nothing in a fight you win, and nothing at all against a weapon that kills through it | a weapon that kills through it in one hit |

**Why Armour Piercing is priced per weapon, not by a multiplier.** ⚠️ Corrected 2026-09-18 after
working it across the catalogue: **a multiplier cannot price this perk at all**, and the shipped 0.4
left it strictly better on 11 of 13 weapons. Bypassing armour takes a standard target from a 115 pool
to 45 health, and 45/115 is 0.39, so any multiplier near 0.4 leaves hits-to-kill unchanged and the perk
costs nothing. Damage alone cannot fix it either, because damage is an integer: at 8 damage the only
choices are 3, which is free, and 2, which is useless. **Dropping the cycle as well makes the trade
continuous**, so every plain-damage weapon can carry the perk, and it is what the perk should feel like:
heavier rounds, fewer of them, slower. `weapon-design.md` §7.7 has the pairs and the arithmetic.

**Why Body Armor drops from +50 to +25.** At +50 the AR needed six more hits, which is the single
largest swing in the arsenal and lands on the weapon most players pick anyway. At +25 it is about two
extra hits on a fast weapon and one on a slow one: still felt, no longer decisive. Tony, 2026-09-17:
"maybe 50 is too much armor and it should be 25".

**Body Armor must be preset-aware.** Under the Shields preset (45 HP + 105 shield + **no** armour), the
compiler adds `max_armor_add` on top of the preset's base armour and reintroduces a whole armour layer
the preset was designed not to have. Under Shields, Body Armor grants **shield**, not armour. That is a
branch in `armed_armor()`, and it is on the list below.

**Second Wind needs no new mechanism.** The node already tracks the player's pools from `$HIR` and
`$HP`, and a miss sends nothing at all, so there is no noise to filter. The grant is one `$LIFE` write
to the player's own gun, which the 2026-09-09 bench proved.

**Motion Tracker is information, not power,** which is exactly why it belongs in the set: it is the
only pick that changes how a player moves rather than how hard they hit. The phone already decodes
every nearby phone's `{id, team, alive}` into `Presence` (`app/src/beacon.js`), and every player's
phone already advertises that triple (`app/src/app.js:228`). Only the utility role reads it today.

**Know what the tracker can actually see.** `Presence` is RSSI and nothing else: no bearing, no
distance. The app builds it at a -74 dBm threshold with a 0.8 s dwell and a 4 s expiry
(`app/src/app.js:162`, tuned on hardware for stations in 2026-09-04). So a contact appears about a
second after someone comes inside the bubble and disappears about four seconds after they leave, and
the player learns "someone is near", never where. Two things follow. The bubble was tuned for walking
up to a station, not for a fight, so the threshold needs its own tuning pass before this ships. And if
the tuned bubble turns out to be small, this perk is a trap pick next to +25 armour, so measure it
before it goes in a player's kit.

## 3. The next wave, and what gates it

These are designed, not deferred for lack of interest. Each names the one thing it waits on.

| perk | what it does | waiting on |
|---|---|---|
| **Stim Pack** | hold a button to patch yourself up over a few seconds, on a 3-minute match-clock cooldown | a bench pass on the unused button ids (3, 4 and 5 reach the node with no handler), and the write-during-reload question in [`bench-perks-2026-09-18.md`](bench-perks-2026-09-18.md) §5 |
| **Overclock** | hold a button to fire faster for a few seconds, then revert | the same button bench, plus the mid-life `$WEAP` write discipline in `spec/node.md` §3.15 (a `$WEAP` write resets the magazine, so the revert has to restore it) |
| **Medic Beam** | your primary heals a teammate and hurts an enemy, from one `$SIR` row | per-player `$SIR` keys, and a decision about whether a support weapon belongs in the perk slot or the weapon slot |
| **Bubble Shield** | a short personal shield you trigger yourself | the Shields preset shipping, then the same button bench |
| **Ghost** | your gun runs quiet and flashless (`$WEAP` t25 and t26, the Suppressor's pair) | one bench confirmation that the pair moves flash and loudness independently of the weapon it came from |
| **Threat Direction** | after you are hit, a short cue shows where it came from | F228: the sensor field read differently covered and uncovered at close range, so the direction is not trustworthy yet |
| **Overcharge Shield** | your shield returns faster | the Shields preset shipping |
| **Adrenaline Rush** | a kill speeds you up for a few seconds | it needs MC to tell the node about the kill, so it is the one pick that quietly does nothing out of coverage. Ship it only if we accept that |
| **EMP Resistance** | you recover from a stun faster than most | one new effect key and one new per-player bundle field, the same pattern the accessibility overrides already use |

**A charge must announce itself.** This is the one rule the research sweep agreed on across thirty
years of arena shooters. Quake's Quad Damage makes the holder glow and roar, Halo Infinite telegraphs
every piece of equipment mid-use, and Quake Champions went further and warns the whole server before
the Quad even spawns. The reason is the same every time: a timed advantage nobody can see reads as
unfairness, and a visible one becomes a decision for everyone else on the field. We have the means
already, on the player's own kit: `$HLED` and `$GLED` paint the headset and the gun, and the gun has
2477 sounds. So every activated perk in §3 lights the carrier for as long as it runs. It is a cost, it
is deliberate, and it is what makes the perk worth arguing about.

**A powerup that is only ever good is a camping game.** The same sweep's clearest failure mode: id cut
Quad Damage from x4 to x3, and Bungie reworked Armor Lock because invulnerability with no drain let a
player simply wait out a fight. Any charge we ship should drain, end, or cost something while it runs.

## 4. The long tail: every other idea, and why it is where it is

Kept deliberately, per Tony 2026-09-17: "there are some genuinely good ideas here, don't throw any
away". §6 keeps the full working tables with their evidence anchors; this section is the summary a
reader needs first.

**Buildable today, nobody has asked for it yet.** Overcharged Rounds (more damage per hit, fewer rounds
carried: a flat Stopping Power, distinct from Heavy Barrel because it does not touch the cycle time).
Heavy Barrel (harder hits, slower cycle: the sharpest mathematical counter to a big armour pool).
Silent Running (a timed node-side rewrite of the flash and loudness pair, the activated form of Ghost).
Disguise (the node repaints its own LEDs in another team's colours for a few seconds; hit resolution
runs on the real `$TID`, so it is deception only, and it fools your own team too).

**A damage-over-time perk is buildable, and the inventory was wrong to reject it.** `$LIFE` takes
negatives, so a poison or burn effect is a node tick clock, not a missing firmware feature. The design
is in [`weapon-design.md`](weapon-design.md) §6.3b and the open work is S16. It belongs to a weapon
first, the Toxin Rifle; a "your rounds burn" perk is the same mechanism in the third slot.

**Blocked on hardware or a fact we do not have.** Lucky Shot, a crit chance on your primary (`$WEAP`
t6 reads 0 on every stock weapon, and tomorrow's bench measures whether a tagger will roll it: F62).
Alt-Fire Mode (t7 to t11 are a dormant secondary-fire block on all 20 captured frames, never tested).
Emitter Selection (two source documents disagree about what t4 does). Regional Quiet Mode (`$GSET` t3,
decoded from the app, never exercised). Death Nova (the native Sentinel emits a real IR word from the
headset on death; we do not know whether any field controls it). Armour Cache and Ammo Depot (the
powerup station, K3, is designed and not built). Bomb-objective perks (the bomb site, K4, likewise).
Killstreaks and Vengeance (the node cannot see its own kills at all; with MC they degrade to
best-effort, which makes them a different, weaker idea).

**Rejected, with the reason, so nobody spends a session on them.** Movement and speed perks of every
kind, because no phone motion sensor is wired anywhere in the app. Shooting through cover, because IR
is line of sight and the wire has no penetration concept. Martyrdom and C4, because no host command
puts an IR word in the air: only a real trigger pull, a real melee swing and the native death nova do.
Defibrillators, ammo bags and any perk where one player writes another player's gun, because no such
wire command exists. Smoke, because software cannot fog a real room. Turrets, deployables and wall
breaching, because they need hardware or geometry we do not have. Flat damage resistance, because it
is Body Armor under another name. A headshot bonus, because the headset carries four of the five
sensors and is the intended aim point, which is why the multiplier ships at zero. Revealing enemy
stations, because station adverts are already broadcast openly to every phone.

## 5. Open decisions

1. **Does the slot hold more than one perk?** Four picks in one slot is a different game from one.
   Undecided; the set above is balanced as one pick.
2. **Kill credit for a tick** (S16), and for a lethal `$LIFE` write in general: a lethal tick emits no
   `$HP`, so the node books the death with no attribution.
3. **Pick rates.** Nothing aggregates perk choice across matches today. The store already logs each
   match's config, so the data exists; the query does not. Worth adding once real sessions run.
4. **`max_armor_add` going negative** (Quick Switch): `armed_armor()` caps at 255 and does not floor at
   0. One line, plus a bench check that `$PSET` accepts the result cleanly.
5. **How big is the Motion Tracker's bubble?** The RSSI threshold was tuned for walking up to a
   station, not for a fight. Measure it between two phones before the perk ships, and retune the
   threshold and the dwell for players. If the bubble is small, the perk is a trap pick.
6. **The preset-aware branch** §2 asks for: under the Shields preset, Body Armor must compile to shield
   rather than armour. `armed_armor()` is preset-blind today, so a Body Armor pick there takes the pool
   from 150 to 200 AND adds a drain step the preset was designed without. Tracked in S50, not built.
7. **The catalogue still ships the old numbers.** `perks.json` reads `max_armor_add: 50` and copy that
   promises "50 extra armor". Everything in §2 is decided and unbuilt, exactly like the Easy Reload
   move. Read the document as the target, and the file as what a gun gets today.

## 6. Appendix: the working inventory

The raw idea sweep, kept whole. Group A is compile-time only and works with zero Mission Control
coverage after arming. Group B is node-local: the phone writes to its own gun or its own screen. Group
C needs both, but a blackout removes only the extra. Group D is blocked, with the one thing that
unblocks it. Group E is rejected, with the reason.

Read the groups as a working sweep, not as a decision: **§2 and §3 are the decisions, and they win wherever
they differ.** The groups sort by what the hardware allows, so a row can be buildable today and still be
gated in §3 for a reason that has nothing to do with the hardware.

**About the anchors.** A cell naming a file, a `$WEAP` or `$SIR` token, or a FOLLOWUPS id points at
something you can open. A cell naming `report-NN` or `S50-perk-balance-report` points at the research
sweep of 2026-09-17, which ran in a session scratchpad and is **not in the repo**: treat those rows as
"someone read this and believed it", and anchor a row properly before you build from it.

⚠️ Four rows below were corrected on review and say so in place.

## A. Buildable today, compile-time only

| Idea | Player-facing line | Mechanism | Cost or trade-off | Evidence anchor |
|---|---|---|---|---|
| Body Armor (reworked) | Extra armour, at the cost of a slower reload. | CORRECTED: `max_armor_add: 25`, not the 50 this sweep proposed (see §2). Adds `reload_mult: 1.25` on the primary. | Reload takes 25% longer. | S50-perk-balance-report §4 |
| Extended Mags (reworked) | Bigger magazine and reserve, but a slower draw. | Keeps `ammo_mult: 2` (primary only). Adds `switch_mult: 1.3`. | Weapon swap is 30% slower. | S50-perk-balance-report §4 |
| Quick Hands (reworked) | Faster reloads, smaller magazine. | Keeps `reload_mult: 0.5`. Adds `ammo_mult: 0.8`. | Magazine and reserve cut by 20%. | S50-perk-balance-report §4 |
| Quick Switch (reworked) | Faster weapon draw, lighter armour. | Keeps `switch_mult: 0.5` (all slots, gun enforces the larger value). Adds `max_armor_add: -20`. | 20 less armour. Needs `armed_armor()` floored at 0 (one-line compiler fix). | S50-perk-balance-report §4 |
| Armour Piercing Rounds | Your primary ignores armour and shields. | Rekeys the primary's `$WEAP` t3/t4 to a new, permanently shipped `$SIR` cell keyed to fn 2 (armour piercing); `dmg_mult` cuts t5. | CORRECTED: about 60% less raw damage, not the 20% this sweep proposed. Bypassing armour already cuts the pool from 115 to 45 (see §2). direct counter to Body Armor and the Shields preset. | S50-perk-balance-report §5, report-11 (AP mechanism) §1-6 |
| Heavy Barrel | Hits harder, cycles slower. | `$WEAP` t5 +25%, t14 +20%, baked at arming. | Fewer, bigger hits; worse against fast weapons in close exchanges. | S50-perk-balance-report §5 |
| Overcharged Rounds | Every hit lands harder, but you carry fewer rounds. | `$WEAP` t5 up (flat damage buff, CoD Stopping Power pattern). `ammo_mult` on t16/t39 cut to compensate. | Smaller magazine; no cycle-time change (distinct from Heavy Barrel). | report-03 (Stopping Power) + report-07 (`ammo_mult`/`dmg` levers) |
| Ghost | Your gun runs quiet and flashless. | `$WEAP` t25=2, t26=50 (the Suppressor's pair) on the primary. | `reload_mult: 1.15`. Mechanism confidence: only one stock weapon example of t25/t26 exists. | S50-perk-balance-report §5, report-08 §1 (t25/t26) |
| Medic Beam | Your primary heals teammates and hurts enemies with the same shot. | Rekeys the primary's `$SIR` cell to a dual-polarity function (fn 16, 17, 20, 21 or 22): ally hit heals/grants, enemy hit takes armour-piercing damage. No host logic needed; the firmware's own team gate (with `$GSET` t1=0) does the split. | Lower raw damage than a standard weapon; friendly fire must stay off for the split to hold. | report-08 §4 (dual-polarity fn table), report-10 ("a per-player table is one line away") |
| EMP Resistance | You shrug off an EMP hit faster than most. | A per-player compiled `stun_mult` shortens `config.stun.duration_s` in this player's own bundle only, the same pattern `loadout.overrides` already uses for HP/armour. | Needs one new effect key plus one new bundle field; no new wire token. | report-10 (`config.stun.duration_s`, per-player bundle precedent) |

## B. Buildable today, node-local (phone) only

| Idea | Player-facing line | Mechanism | Cost or trade-off | Evidence anchor |
|---|---|---|---|---|
| Motion Tracker | See nearby enemies on your HUD. | `app.js` already decodes every nearby phone's `{id, team, alive}` into `Presence`; today only the utility role consumes it. Exposing `presence.players()` to the engine is roughly one line. | Filtering out a player running Ghost needs Ghost's status broadcast in the advert, which isn't wired today (unverified). Otherwise shows every nearby player regardless of perk. | report-10 §5 ("Half LIVE, half unwired"), S50-perk-balance-report §5 |
| Threat Direction | After you're hit, see where it came from. | Reads the shooter id already latched from `$HIR` plus the sensor field, shows a short directional HUD cue. Reactive only, no MC needed. | Needs one hit landed first; sensor precision at close range is still inconsistent (F228). | report-10 §1, S50-perk-balance-report §5 |
| Overcharge Shield | Your shield comes back faster. | Shields-preset only. The node halves its own shield regen delay or fires more frequent `$LIFE,0,0,<n>` grants to its own gun, both proven mid-match writes. | No effect outside the Shields preset, a real opportunity cost. | S50-perk-balance-report §5, report-08 §5 (`$LIFE` shield fill) |
| Second Wind | Once a life, a hit that would nearly kill you leaves you standing. | Node tracks HP locally from real hit events (misses send nothing, so no noise), grants one `$LIFE,0,+20,0` when tracked HP first drops under 20%. | One-shot per life; useless against a weapon that kills in one hit through it. | S50-perk-balance-report §5, report-10 §10 (`$LIFE` self-write) |
| Stim Pack | Hold a button to patch yourself up over a few seconds. | Player holds an unused button (ids 3, 4, 5 are wired to press/release with no handler). Node fires a short run of `$LIFE,0,+n,0` grants to its own gun on a cooldown that runs on the match clock. | Cooldown runs on the match clock (about 3 minutes), survives death; grant is small enough not to match a full heal station. | report-10 §4 ("this is an unused lever"), report-04 (Titanfall Stim, healed-over-time half) |
| Overclock | Hold a button to fire faster for a few seconds. | Node rewrites `$WEAP` t14 (fire interval) down for a duration, then reverts, following the mid-life write discipline in `spec/node.md` §3.15 (30-90 ms apply, ammo restore, never mid-reload, one write per event and never a stream). | Match-clock cooldown; the write briefly resets the magazine unless timed carefully. | report-10 §10 ("any other `$WEAP` token... reachable by the same route"), report-05/06 (arcade Rapid Fire power-up) |
| Silent Running | Hold a button to go quiet for a few seconds. | Node rewrites the loaded weapon's t25/t26 (or any captured token pair) mid-life for a duration, the same mid-life write (`spec/node.md` §3.15), then reverts. Generalises to swapping several tokens at once (a lightweight "field modification"), since the node, not MC, is doing a raw `$WEAP` write, not a destructive MC config push. | Match-clock cooldown; must dodge the reload/swap window. | report-10 §10, report-03 (Titanfall Cloak, CoD Dead Silence) |
| Bubble Shield | Trigger a short personal shield. | Shields preset only. The node grants a block of shield with `$LIFE,0,0,<n>`, starts a timer, and takes it back with a negative grant when it expires. The 2026-09-17 bench proved the grant, the clamp at the `$PSET` ceiling and the cue set. | A match-clock cooldown, and it does nothing outside the Shields preset. | S45 (shield bench 2026-09-17), §3 |
| Disguise | Briefly show a different team's colours. | Node repaints its own `$GLED`/`$HLED` with another team's palette index for a duration. Hit resolution still runs on the real `$TID`, which is untouched, so this is cosmetic only. | Pure deception; teammates may misread the wearer too. | report-08 §7 (LED palette independent of `$TID`), report-11 (TF2 Spy Disguise) |

## C. Buildable today, needs both, survives an MC blackout

| Idea | Player-facing line | Mechanism | Cost or trade-off | Evidence anchor |
|---|---|---|---|---|
| Adrenaline Rush | A kill speeds you up for a few seconds. | On MC's `feedback` (kill-confirm) push, the node fires a mid-life `$WEAP` write: cycle time down 10% for 4 seconds, then revert. Out of MC coverage, the buff just never fires; the match is unaffected. | Needs a bench pass on placing the write mid-reload; risk is pushing after a kill, not a mechanical cost. | S50-perk-balance-report §5, report-10 §8 (`feedback`, best-effort) |
| Callout / Marked Target | Your team is warned when you're hit. | On a `hit_taken` fact, MC (if it has coverage) pushes an `alert` to nearby teammates using the existing `role_alert_body()` channel. No coverage, no ping; nothing breaks. | Best-effort only; must not gate any scoring or win condition on it. | report-10 §8 (`alert` channel, held role states), S50-perk-balance-report note on MC not being live mid-match |

## D. Blocked, and the one thing that unblocks it

| Idea | Player-facing line | Mechanism | Blocker | What unblocks it | Evidence anchor |
|---|---|---|---|---|---|
| Personal EMP | Your primary's hits jam the enemy's gun for a few seconds. | A per-player `$SIR` cell keyed to the stun function the game-wide `config.stun` toggle already uses. | MOVED HERE ON REVIEW: it is not compile-time buildable. A `$SIR` table is game-wide, so keying one player's weapon to a stun function stuns for everyone who carries that key. | True per-player `$SIR` keys, the same blocker Medic Beam has. ⚠️ Read the fn 24 delayed-blast caution first. | report-07, report-08 §4 |
| Killstreak / Vengeance | A run of kills earns a reward, fully offline. | Would need the node to detect its own kills locally. | The gun never learns it hit someone; the node cannot see its own kills at all (ADR-0001). | Nothing short of a firmware change (disallowed), or accepting MC's best-effort `score`/`feedback` push, which moves the idea into Group C instead. | report-10 §13 (hard limit 1) |
| Lucky Shot | A rare shot crits for extra damage. | `$WEAP` t6 (`primaryCritChance`). | Untested: reads 0 on every stock weapon, and the `$HIR` crit bit read 0 on all 15 measured headset hits. No confirmed damage effect. | A bench run that sets t6 non-zero and checks whether the emitted crit bit, or applied damage, actually changes. | report-08 §1 (t6, F62) |
| Alt-Fire Mode | Your weapon carries a second, different attack. | `$WEAP` t7-t11 (secondary fire block: chance, damage type, power type, damage, crit chance). | Dormant and empty on all 20 captured stock frames; entirely untested. | A bench flip of t7-t11 on a live weapon to see if a secondary fire mode actually fires. | report-08 §1 (t7-t11) |
| Emitter Selection | Your weapon fires from the headset only, or from both emitters. | `$WEAP` t4, read either as IR subtype or as `primaryPowerType` (which emitter fires). | The two source documents contradict each other on what t4 does; neither reading is bench-flipped. | A bench test that isolates t4 from t3 and checks which reading holds. | report-08 §1 and §11 (t3/t4 contradiction) |
| Regional Quiet Mode | Your weapon runs on reduced power for indoor play. | `$GSET` t3 (`gunLaserRegion`), described as a legal power-region control. | APK-decoded only, never exercised on the bench. | A bench sweep of t3 values with a range ladder, the same method used to prove t2. | report-08 §3 (t3), report-09 (t3 "written, NOT RUN") |
| Death Nova | Your death damages anyone standing close. | The native Sentinel death-nova already emits real IR (proto 10, magnitude 125) from the headset at death. | We do not know whether this is a settable weapon trait or fixed to one gun model; it cannot be forced or assigned by MC or the node. | Bench research into what triggers the death-nova, and whether any `$WEAP`/`$PSET` field controls it. | report-08 §6 |
| Armor Cache / Ammo Depot | Walk up to a station to top off armour or ammo. | A powerup station grants `$LIFE` armour/HP, or a `$WEAP`+`$AMMO` swap, to whichever gun is present. | The powerup station (roadmap K3) is designed but not built. | K3 shipping. | report-10 §7 (Powerup station, SPEC) |
| Bomb Objective Perks | A perk built around planting or defusing. | Plant/defuse intent bits already exist in the player advert (unused), and a bomb site would broadcast blast damage over BLE. | The bomb site (roadmap K4) is designed but not built. | K4 shipping. | report-10 §7 (Bomb site, SPEC) |

## E. Rejected

(One row was struck on review: a damage-over-time trap was listed here as impossible. It is not.
`$LIFE` takes negatives and the tick clock runs on the node: `weapon-design.md` §6.3b, S16.)

| Idea | Reason | Evidence anchor |
|---|---|---|
| Juggernaut / Kevlar+Helmet (flat damage resistance) | Duplicates Body Armor exactly; same lever, same effect. | report-03, report-04 |
| Deep Impact (shoot through cover) | Impossible: IR is line-of-sight only, and the wire has no penetration concept. | report-08 §6 (IR word) |
| Marathon / Lightweight / double jump / rocket jump / grapple (movement or speed perks) | Impossible: the phone has no accelerometer, gyroscope or compass wired anywhere in `app/src`. | report-10 §4, §13 (hard limit 4) |
| Martyrdom (drop a live grenade on death) | Impossible: no host-driven command emits IR (`$IRTX`, `$HFIRE`, `$BHIT`, `$MELEE` all proven inert). Only a real trigger pull, a real melee swing, or the native Sentinel death-nova puts a word in the air. | report-08 §6, §9 |
| Defibrillator / Ammo Bag / Repair Tool / Doc's Stim Pistol (heal or resupply a teammate directly) | Impossible: no wire command lets one node write another node's gun. | report-10 §8 ("no wire command that lets one node write another node's gun") |
| C4 / remote detonation | Impossible: no host-driven IR emission exists to trigger anything remotely. | report-08 §9, §10 |
| Jäger's ADS (auto-intercept an incoming shot) | Impossible: no projectile object model and no defensive-emission mechanism exists. | report-04 |
| Engineer buildings (sentry, dispenser, teleporter) | Needs new hardware beyond the planned stations; out of scope for a software perk. | report-04 |
| Bandit / Mute (disable another player's equipment) | No player-carried equipment concept exists to disable. | report-04 |
| Ash's breaching rounds (destroy a wall) | No geometry or wall model exists on this platform. | report-04 |
| Smoke grenade (block enemy vision) | Impossible: software cannot affect real-world visibility or IR line of sight. | report-04 |
| Charged headshot / any headshot bonus | Rejected by design: the headset carries 4 of 5 hit sensors and is the intended aim point; the headset damage multiplier is shipped at t7=0 (no bonus) by deliberate choice. | S50-perk-balance-report §1, report-09 (t7=0, 2026-09-17) |
| Maestro's Evil Eye (remote turret) | Needs new hardware and a remote-fire mechanism that does not exist. | report-04 |
| Mine (area hazard that disables nearby players) | Impossible: no station-to-gun control channel exists; only a player's own phone can write to their own gun. | report-10 §8 |
| Overheal / true invulnerability (ÜberCharge as designed) | Architecturally blocked: the spawn-protection guards forbid disarming a player's `$SIR` table mid-life for any reason other than spawn or revive. | report-10 §"mc-levers" (spawn protection guards), report-07 |
| Hacker (reveal enemy stations) | Not a meaningful perk: station presence adverts are already broadcast openly and unauthenticated to every nearby phone regardless of team. | report-10 §5 (security posture) |
