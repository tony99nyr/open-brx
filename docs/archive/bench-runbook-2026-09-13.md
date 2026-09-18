# Bench runbook — 2026-09-13 (DRAFT; lands in docs/ at session close once Tier 3 is in)

Written after the 2026-09-12 field night. Every block below exists because something failed in front of players.
Order matters: Block 0 proves the console you are running is the one we fixed, and Blocks 1-3 are the three things that
actually broke the night. Runs C/D/E are measurements, not fixes: they decide open design questions.

## Before anything
1. Run MC from `main`, then HARD-RELOAD the console (the JS filename is content-hashed; a soft reload serves the old app).
2. On the MacBook none of the WSL networking applies. On this WSL box the QR address is a NAT address phones cannot
   reach: pass `--public-url ws://<windows-lan-ip>:8766/ws` and keep the netsh portproxy (its target WSL IP changes on
   every restart). [Tier 3 may replace this step with a boot banner and an `--advertise` flag.]
3. Outdoors, hold ALT 3 s on EACH gun to set outdoor mode. It persists across power cycles. MC still cannot drive it.
4. Tell players: do not background the HUD app. Backgrounding for more than 6 s re-arms from the spawn magazine (F164,
   fair-play rule until S7.1 is fixed). A genuine BLE drop and relink does the same.

## When you end a match
The board now tells you whether every HUD actually heard the whistle. A phone that has not confirmed is named while the
match is ending, MC keeps re-telling it for about two minutes, and any phone that never confirmed is named on the recap.
That is a delivery fact and says nothing about the player's score. Ending never waits on a phone, so a player out of
range cannot hold up the whistle. Worth watching on the first game of the night: on 2026-09-12 a tagger stayed in-game
after the end twice, and this is the instrument that would have shown it.

## If a phone gets stuck in utility mode
Three ways out now, in the order to try them. Press and HOLD the exit on the phone's own screen, about a second. Or tap
the i icon seven times within three seconds, watching the counter that now appears, which opens the settings drawer and
its BACK TO HUD button. Or, from Mission Control, press RELEASE to HUD on that phone's ITEMS card, which needs no
physical access to the phone at all. On the night of 2026-09-12 none of these existed and the only cure was clearing the
app's storage, which is impossible on an iPhone without reinstalling.

## Block 0 — the console proves itself (5 min, no guns)
Open `?mock&faults=1`. You should see four fault states on LOBBY and a RE-PUSH CONFIG button that clears three of them.
The grey NOT ECHOED row must survive the cure. If any of that is missing you are on an old bundle: rebuild and hard-reload.

## Block 1 — deploy + TDM smoke (the night's headline failure)
Four guns, two teams, TDM. Watch for: LEDs correct on the guns AND the board showing 2/2 rather than 4/0 after the mode
switch; the mode tile now asks you to confirm and shows the split it will produce; PUSH then ARM; every gun ACKED.
Then shoot across teams. Last night no cross-team hit registered because every player had landed on one team and
friendly fire was off. Success = hits register both ways. If a gun shows ACKED AN OLDER CONFIG, press RE-PUSH CONFIG.

## Block 2 — friendly fire on (proves the `$GSET` t1 story)
Same roster, set FFA (which compiles friendly fire ON). Confirm same-team hits DO register. This separates "team logic
wrong" from "range wrong": if FFA hits land at distance and TDM's do not, the teams are the problem, not the optics.

## Block 3 — `$TID` readback
With the guns armed, read each gun's team id back over BLE and compare to the board. The field night's root cause was a
team drag that never reached the guns. The board now proves the ack, but the readback is the independent check.

## Block 4 — the outdoor range question, in the only order that settles it
2026-09-13: a target-mode test at ~200 ft outdoors (80 natural paces, measured, not the 100 ft first estimated) hit 100% of shots with precise aim, on both guns, in both toggle
states. That proves the emitters and the receiving headset are healthy at that distance, and it is the manual's own test
for a dead emitter. It does NOT test the game path: target mode does zero damage, has unlimited ammo, and the shooter's
headset does not even pair in it. Everything below is therefore still open, and the steps must be run in this order,
like for like, same spot and same light.

1. **Native, IN A GAME**, 100 ft. Then 30-40 ft. Record hit or no hit for each.
2. **Ours, MC config pushed, IN A GAME**, same two distances.
If 1 passes and 2 fails, the cause is in our compiled frames and Block 6's diff names it. If 1 fails too, the game path
itself is the limit, target mode was never representative, and the indoor/outdoor toggle comes back as a live suspect
for the game path specifically.
Note on aim: at 100 ft the beam demands precision. At 30-40 ft it does not, which is why the 2026-09-12 failure at that
distance cannot be explained by aiming.

## Block 4b — native untouched sweep (the original control)
This is the control we did NOT have on the night, which is why the outdoor diagnosis stalled. Do it BEFORE ours:
1. Two guns, NEVER touched by MC this session, in native mode, outdoors. Fire at 30-40 ft, then 100+ ft. Record hit/no-hit.
2. Then the same two guns after an MC push, same distances, same light. Record.
A difference between 1 and 2 is ours. No difference means the venue/optics, and the indoor/outdoor mode is the suspect.

## Block 5 — ALT toggle sweep
For each gun: power cycle, hold ALT 3 s, and capture what it emits on the wire (receiver-first: run the capture with no
gun connected over BLE first, then with). Two questions: does the gun announce its mode at all, and does the announcement
differ indoor vs outdoor. A yes turns the on-screen ALT reminder into a real per-gun readiness check (Run D).

## Block 6 — ours + capture diff
Push one of our configs and diff the frames we send against a native capture of the same intent. Any token we send that
native never sends is a candidate for the outdoor range regression.

## Runs C / D / E (written up in the experiment log)
- Run C: can MC drive indoor/outdoor over BLE at all. Candidates are `$GSET` t3 and an `$IRTX` probe; the driver is
  staged behind `DRIVE_IO_MODE` and ships OFF, so today the head is byte-identical to before.
- Run D: does the gun emit on ALT hold (Block 5 answers it).
- Run E: `$WEAP` t41=75 gunRangeIndoor — untested; does it change anything measurable outdoors.

## Measurements this software is waiting on (each decides a rule that is currently a guess)
| Question | What it decides |
|---|---|
| What does a v4.32 gun emit in the 1.5 s after a `$WEAP` head write: a full-magazine `$ALCD`, a reload burst, or nothing? | Whether the echo-mismatch START refusal can go back to force-proof. It is forceable today only because we do not know. |
| Does the gun clamp an fn 9-22 armour grant at the `$PSET` ceiling? | Whether armour above the ceiling is provable again (red) instead of an amber advisory. |
| Measure the pool settle window (2 s is reasoned, and the real store shows a body-armour pool landing at exactly +2.0 s) | Whether the pool proof judges too early. |
| F165: re-key the Energy Launcher's IR word | It deals zero damage on every shipped game's hit row; it is hidden from KIT and the DESIGNER until this is done. |

## Known gaps to say out loud before you start
- The pool RED cannot fire on a field phone until a new APK is cut: the phone reports where its pool came from, and no
  shipped build sends that yet. It is silent, never wrong.
- A mode switch re-teams by INDEX and only rebalances when a side would be EMPTY, so an uneven roster can legitimately
  land 7/1. The confirm now shows you the split before you commit.

## Bench-side list handed to Tony 2026-09-13 while he was sighting scopes (ranked, cheapest first)
1. FREE: which mode produced the latest reading, the real game or target mode. Decides what all of it proves.
2. TARGET MODE, while sighting, at the far spot (~200 ft): quantify the CONE. How far off-target can the dot sit before
   it stops registering, indoor vs outdoor? Any rough number is the first quantification of the mode difference (F171).
3. TARGET MODE, ~2 min, at 30-40 ft: fire at the headset STRAIGHT ON, then ~45 degrees, then from the SIDE. In a game
   nobody is square to you, and "all headsets seem to stop receiving hits" was on the 2026-09-12 list. **If headset
   coverage falls off with ANGLE, that explains a close-range failure that distance cannot** — and this axis has never
   been tested. NEW, and arguably the best idea on this list.
4. REAL GAME, native: the far spot, then 30-40 ft. Both, because 30-40 ft is where it actually failed (F170 step A).
5. REAL GAME, ours (MC config pushed): same two distances, same spot (F170 step B). 4 passes + 5 fails -> our frames.
Also: record each HEADSET's BATTERY LEVEL as he goes. Power was Tony's own hypothesis for the outdoor headset trouble
and it is free to write down while it can still be correlated.
