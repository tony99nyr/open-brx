# The announcer queue

Design of record, 2026-09-24. The field report (Tony, app 0.4.11): "the hud alert for takes the lead and the kill
confirmation both played on top of each other. they should not overlap". The phone now has ONE announcer queue
(`app/src/announcer.js`, owned by the engine as `_ann`). Every announcer voice line passes through the queue, so two
never play at once. The HUD no longer waits for the queue: since 2026-09-24 it draws every alert in three lanes, at
the moment its event arrives (see *The three lanes* below). The tables below are single constants in that file; change
them there.

## What goes through it

| Kind | Source (`app/src/engine.js`) | Sound | HUD lane |
|---|---|---|---|
| `kill_confirmed` | MC `feedback{kind:"kill"}` (`feedback`), an S57 `DOWN_BY` naming me (`_irKillConfirmed`) | the kill pool, or the medal lines | HERO |
| `lead_taken`, `lead_lost` | MC `alert` (`_announceAlert`) | `VA6D`, `VA6E` | OBJECTIVE (lead badge) |
| `medal` | MC `feedback{kind:"kill"}` with medals, when the kill's IR word already said its kill line | the medal lines | HERO |
| `hill_captured`, `hill_lost` | the engine's hill transition (`_hillSay`) | `VB0N`, `VB0P` | OBJECTIVE (hill badge) |
| `powerup_swap` | a second weapon pickup (`_puGrantWeapon`) | none | FEED ("NEW", "REPLACES OLD") |
| `alert` | every other MC alert, the clock warnings, `victory` feedback, "Hill Contested" | the bundle's cue | FEED (if any) |
| `teammate_down`, `enemy_down` | an S57 word (`_onIrCallout`) | none, `VB8` | FEED |
| `powerup_spawn` | the spawn schedule (`_puTick`) | none | FEED ("ITEM AVAILABLE") |
| `status` | a pool rising (`_onHp`), the shield recharge starting (`_shieldTick`) | `shield_up`, `shield_charging` (only for a refill longer than 1 s, `SHIELD_CHARGING_MIN_MS`), `healed`, `armour_up` | none |

`shield_online` has no voice line (**Tony**, 2026-09-24): the shield coming back full keeps its LEDs and says nothing.

The infection flip's own `infected` line goes through `_announceAlert` too, with no banner.

A kill confirm plays only for MC `feedback{kind:"kill"}` or an S57 `DOWN_BY` naming this player. An MC alert
named `kill` is refused.

**Exempt, by design** (they answer the player's own body or trigger at once, or play before go-live when nothing
else is on air): the pain grunts (`pain_short`, `pain_long`, `pain_melee`; a grunt that would start more than 500 ms
after its hit, `PAIN_STALE_MS`, is dropped: behind the shield-break line of the same hit it would play 2.6 s late; while
the shield loop blocks the gun, every grunt is dropped), `hit_taken`, `died`, the low-health
loop (`hurt`), `shield_down` and its heartbeat (`shield_loop`), `stunned`, `stun_over`, `poisoned`, `poison_tick`,
`smoked`, `reload_nag`, the spawn line (`spawn`, `respawned`), `countdown`, `klaxon`, `runway_30/20/10`, the whistle's
`game_over` and `survivors_win` (written at match end, after the queue is cleared), and the gun's sight flash `$SFLASH`. The hill possession tick (`hill_tick`, 0.11 s) and the shield heartbeat (`shield_loop`)
are not items either, but they never start while the gun still holds a clip or while any item waits, and a heartbeat
beat that would still sound when the refill starts is not begun. The possession tick also waits while the item on air
still has audio due (`audioBusy`): the tick is a token-1 clip, the gun's interrupt slot, so in the 120 ms flash-to-line
gap of a kill or the gap between two medal lines it would cut the next line. Exempt means "not queued": every one of them is still
a clip in the gun's audio model below, so a must-hear line stops it.

## The gun's audio FIFO (`GunAudio`)

Bench 2026-09-24 (brx2, Tactix-FE30): the gun QUEUES clips first in, first out. `$PLAYX,0,*` stops only the clip
playing, so N stops flush N clips (with audible fragments). Tony's match heard lines 10 to 15 s late: the phone wrote
each on time, and the gun held them behind audio already queued.

The phone keeps ONE model of that FIFO (`GunAudio` in `app/src/announcer.js`, `_gun` in the engine), fed with lengths
from `CLIP_MS` (every sound id the golden bundle ships; a bundle's `cue_ms` wins):

- every `$PLAY` the phone writes (`_audioWrite`, inside `_write`), announcer lines and body sounds alike;
- every hit the gun registers (`$HIR`): the gun plays the sound on the matching `$SIR` row, which the phone knows
  because it wrote that row. A blank or unknown row sound counts 0 ms and is logged once;
- the gun's native death scream (`$PSET` t10) at a death.

Rules:

1. **At most one clip outstanding for anything not must-hear.** A non-must-hear item waits while the gun holds a clip,
   and past `ANNOUNCE_AUDIO_LATE_MS` it shows its card without its line. The pool lines' pre-emption waits for a silent
   gun too, so they no longer overlap.
2. **Must-hear flush** (`_sayMust`): my own kill line, its medal lines and a lead change send one `$PLAYX,0,*` per clip the model says
   the gun holds, in the same write, then the line, capped at 4 stops (`MUST_HEAR_MAX_STOPS`: the loop plus 3). No
   stop when nothing is outstanding. Every line of my kill is must-hear, and each medal line goes out after the one
   before it has ENDED, so its flush never cuts my own audio. The kill item's sound is the sum of its clips, and a
   must-hear item never starts while my kill still has a clip on the gun.
3. **The shield loop blocks the FIFO.** `$PSET` t23 `energyShieldLoop` (our arm sends `A10`) is a real loop that plays
   while the shield is above 0. With it running, a queued line never plays (60+ s at the bench). So while it runs,
   the phone writes NO `$PLAY` that is not must-hear (it would all play late, at once, when the loop stops), and a
   must-hear line sends one stop for the loop plus one per clip stuck behind it (within the cap). The **objective
   lines** (`OBJECTIVE`: hill captured, hill lost, "Target down") are the exception: while the loop blocks, the queue
   starts them with `flush`, and the engine says them like a must-hear line. Stopping the loop cuts nothing anyone
   wants to hear. They still wait for a silent gun when the loop is not running, and still go stale. The ambient
   lines (every other alert, the pool lines) are still muted while the loop blocks. While the loop
   blocks, the model keeps at most one pending clip per sound id, so twenty hits under a shield count as one hit
   sound, not twenty. **The loop resumes on its own after
   `$PLAYX,0` (bench 2026-09-24, shield still up)**, so every must-hear line in that state gets its own stop. Whether MC
   stops shipping the loop (t23 EMPTY, `audio-queue-scenarios.md` bench step 2) is open under F347; until then this
   is what keeps a kill confirm on time.
4. **The spawn fill starts the loop behind the spawn lines (X3).** F348's `$LIFE,0,0,<max>,*` goes LAST in the spawn and
   revive writes, after the spawn line and the klaxon. The model blocks at the fill, not at its echo, and lets the lines
   already queued play first (`setBlocked(…, queueFirst)`, an assumption for bench Block 10 step 4). `$SPAWN` in a write
   stops the loop, and the end teardown sets the shield to 0, so the whistle line is written (X1).
   A must-hear line in the first seconds of a Shields life flushes the spawn line and the klaxon too (F362 (e)).

**Not modelled** (assumed not to use the announcer FIFO, unconfirmed): the gun's own fire, reload, empty-click and
weapon-swap sounds, and whatever the native `$SPAWN` plays. If any of them do queue there, the flush count is low by
that many. **Bench check:** a shield that is up during the countdown (the loop blocking the runway lines and the
klaxon) has not been tried.

One more finding from the model: at go-live, the runway lines, the countdown, the klaxon and the spawn line can hold the
gun for many seconds (the golden bundle's runway cues are long clips). Nothing waits on that except non-must-hear
audio, which the model now defers or mutes.

## Priority (`ANNOUNCE_PRIORITY`)

Highest first: `kill_confirmed`, `lead_taken`, `lead_lost`, `medal`, `hill_captured`, `hill_lost`, `powerup_swap`,
`alert`, `teammate_down`, `enemy_down`, `powerup_spawn`, `status`. The player's own kill leads, then the lead change
(**Tony**), then the medal lines of a kill already confirmed, then what the player can act on, then match news, then
other players' deaths, then item spawns. Equal rank plays first in, first out.

## Silent during a kill streak (`STREAK_SILENT`)

**Tony**, 2026-09-24: "i think that is right. they go silent when kill streaks are showing." A lead change ("takes the
lead", "lost the lead") or a hill line ("Hill Captured", "Hill Lost") that is queued or starts while my kill or medal
item is on air or waiting is voice-silent. Its line is dropped, not held for later. Its OBJECTIVE badge still shows, at once (the lanes draw on arrival). The
log says `<kind> silent: kill streak on air`. An item that was muted stays muted if a kill displaces it. Outside a streak these lines play as usual: a lead change waits behind an ordinary line, and the
newest lead state wins.

"Hill Contested" (`hill_contested`, queued as an `alert`) is not in `STREAK_SILENT`, so it still speaks mid-streak,
after my kill and medal lines. **Tony**, 2026-09-25 (F370): keep it as shown.

`medal` is its own rank so that the banner of a lead change MC sends with a kill is not held behind that kill's medal
lines. It
applies once the kill line was said (the IR word said it): the medal lines left are a `medal` item. When MC names the
kill first, a medal replaces the plain kill line and IS the confirmation, so that item stays `kill_confirmed`. A
`medal` item is must-hear, holds its full slot like a kill, and no must-hear line flushes over it while it sounds.

## Timing

An item holds a **slot**: the longer of its clip plus 150 ms (`ANNOUNCE_GAP_MS`) and its banner's hold
(`ANNOUNCE_BANNER_MS`: kill 1.8 s plus 2 s for each extra medal, IR cards 2.0 s, alert, hill and swap 2.2 s, spawn
2.4 s). The clip length comes from the bundle's `cue_ms[kind]` when it has one, else `CLIP_MS` (checked against
`mcp/brx_mcp/data/sound_catalog.json` by `app/test/announcer.test.mjs`), else 2.5 s. The next item starts when the slot
ends. Two items on the SAME surface (`ANNOUNCE_SURFACE`: the callout card or the alert banner) replace each other in
place, so an item of equal or higher priority may start as soon as the current LINE has finished. A kill confirm's card
and a silent card always hold their full slot. The HUD holds a card or banner for at least
its slot less its fade (`st.announcer.ms`). The HERO lane uses the same slot: it stays while its kill's line is on
air. The hill possession tick waits while any announcer line sounds.

## The three lanes (HUD)

Design of record, 2026-09-24 (F351, F352). Tony picked it from the kill-card gallery: "I like the 3 lanes. The separate
alerts on the right." The engine writes each lane when its event ARRIVES (`state().lanes`, `_laneKill`, `_laneObj`,
`_laneFeed`). The HUD draws them in `app/src/hud/hud.js` `_lanes`. The voice still says one line at a time through the
queue, so the screen can show more than the voice says. The timings are in `app/src/lanes.js`.

| Lane | Where | What | How long |
|---|---|---|---|
| HERO | centre, over the HUD | my kill: KILL, the victim's name, my newest medal. A spree adds a ×N count and a ladder of the earlier medals, newest first, fading | 2.5 s after the last kill (`LANE_HERO_MS`), or longer while that kill's slot is on air |
| OBJECTIVE | right, under the K/D stats | one badge for the lead and one for the hill | until the next badge of the same key replaces it; it dims after 4 s |
| FEED | left, under the identity block | teammate down, enemy down, a powerup spawn or swap, every other MC alert (BOMB PLANTED, ONE MINUTE LEFT; no full-width banner, F371) | 4 s a row (`LANE_FEED_MS`), the newest three |

Rules:

- A kill, a lead change and a hill capture at the same moment are all on screen at once.
- An item has a small source line: `MC`, `IR` (the S57 word or a grenade hill) or `BLE` (a station, including a
  station hill and a powerup swap). A powerup spawn has none: it comes from the phone's own schedule. An MC confirm and the IR word
  for the same kill are one HERO row, with one flash and one buzz. Its tag names both in arrival order: `MC · IR` when MC
  confirmed first, `IR · MC` when the IR word came first.
- The HERO shows no weapon and no "+1 ELIMINATION" or K count.
- The medal labels and clips come from `contract.gen` `MEDALS` (`types.py`). BEAT DOWN (`melee_kill`, a melee kill)
  says VA7F "Fatality" (Tony's pick, A62). KILLJOY (`killjoy`, an enemy's spree ended) has no clip, so it is text and
  the green flash only (F361). `hud.js` `MEDAL_FALLBACK` keeps both labels only for an older MC that omits them.
- The lanes draw no medal icons. The icons (style B, `app/src/hud/medalicons.js`) are on the recap only.
- Nothing covers the ammo count, the powerup hint or held chip, the vitals, the clock, the identity block or the stats.
- A centre tell (STUNNED or DISARMED, SMOKED, RECOIL, overheat, TAKING FIRE, a hit's number) is never covered: while
  one is up the HERO is one row above it (KILL ×N and the newest medal).
- The lanes sync by key: an item that stays keeps its DOM node, so only a new item animates in.
- Night: red and amber on black only, with no white flash, no strobe and no motion.
- A dead player sees no lanes: the down screen owns the phone.

The end-of-match AWARDS tab on the results screen shows MC's A63 honours from the result push
(`honors[] = {medal, key, player_id, display, stat}`, one row per tied holder): mine first (a star and YOU), then in
`types.AWARDS` order, SHARED on an award with more than one holder, and MC's stat string on its own line. Nothing is
capped. The HONORS strip is hidden while the tab is on. The tab is icon-first: each award draws its style B icon
(`medalicons.js`), with the name on a long press and in the accessible label. The PLAYERS tab's medal column and MC's
recap draw the same icons with a legend (MC reads a generated copy, `app/scripts/gen-medalicons.mjs`).

### Aim tells and the lanes

Tony, 2026-09-25: "what about recoil screen in the alerts? ... That might overlap". The aim tells are the accuracy
pill (`.aimfx`: RECOIL · RELEASE TO STEADY, SMOKED, STUNNED or DISARMED), the OVERHEAT word (`.heatword`), TAKING
FIRE and a hit's number. The rule:

- The aim tell OWNS the centre. It says what to do now ("release to steady"), and a kill card does not.
- While a tell is up, the HERO collapses to one row above it: KILL ×N and the newest medal. When the tell clears, the
  HERO grows back to its full card if it is still up.
- The medal chain keeps its voice. The tell changes only what the HERO draws, never what the queue says.
- Nothing covers the ammo count or the vitals: not the HERO, not the tell.
- The tell's text stays at 11 px or more on screen at both gate widths, day and night.

Stages: `live-recoil-kill` (one held pull, two kills mid-burst, then the release), `live-smoke-kill`, `live-stun-kill`
and `live-overheat-kill` (the charge rifle). `app/tools/screens.mjs` checks each at both widths, day and night
(`aim tells` steps).

## Layering and priority on the phone HUD

Design of record, 2026-09-25 (F368). Tony asked: "how do KCs and hud event alerts and any warnings errors work? Does
the UI clash? does the errors have an overlay on top of the KCs?" He picked this model from the CLASH storyboard: "the
brx-alerts are very thorough. ship it". F371 (the other MC alerts stay in the FEED lane) was decided as shown.

Before this, the warning pill bar sat in the kill card's band (top 100, centre), and the lanes drew over the takeovers.

**The centre**, highest first. The higher one wins the centre; the lower one waits or moves:

1. The death screen: the whole phone.
2. GUN STOPPED (`gun_locked`): the whole phone, because play has stopped.
3. The play-blocking takeovers: SYNCING (reconcile), REDEPLOYED, RELOADING, SWITCHING.
4. The aim tells: RECOIL, SMOKED, STUNNED, OVERHEAT, TAKING FIRE, the hit number (*Aim tells and the lanes*).
5. The HERO.

Rules:

- **Vitals and ammo are never covered,** except by 1 and 2. STALE and POOLS WRONG stay beside the numbers they
  describe. NO GUN, the MC dot and the low-battery line stay in the top bar.
- **A kill card never draws under a takeover** (`hud.js` `_lanes`, `_heroWait`). While a takeover is up, the HERO is
  not drawn. A kill that is due waits, and draws when the takeover ends, with a full `LANE_HERO_MS` hold from then.
  Nothing is lost. The voice line, the medal lines and the kill buzz stay on time; only the card and its flash wait.
  While it waits, and for `LANE_HERO_MS` after, the card stays open in the engine (`_heroUntil`, `_laneTakeover`): a
  new kill JOINS it (×2, the first kept) and never opens a new card over a kill nobody has seen yet. A card never
  crosses a life: a death and a respawn each end it, and a takeover while down holds nothing open. The engine reads
  REDEPLOYED's end from the same `redeployOutMs` (`app/src/lanes.js`) as the HUD's overlay. The words of every warning
  have one source, `hud.js` `WARN`.
  The OBJECTIVE and FEED lanes keep drawing at the sides, and the hit number still shows.
- **The warnings live in a status rail** at the bottom centre, 150 px wide (x 347-497), between the vitals and the
  ammo, never in the kill card's band: GUN LINK LOST, HEADSET NOT JOINED or JOINING, HEADSET OFF?, GUN KEEPS DROPPING,
  MC out of range, ASK THE HOST, and the other pill-bar chips (WEAPONS HOT, ALT = RELOAD, RECONNECT NOW). Each stays
  until its cause clears. A tap target keeps its 56 frame px zone (44 px on the SE screen). The rail's type is 14 px
  (GUN LINK LOST 16 px), 11 px or more on screen.
- **Short headline while a kill card is up.** Each warning carries a short headline (`data-short`: GUN LINK LOST · TAP,
  HEADSET NOT JOINED, MC OUT OF RANGE, and so on). While the HERO is up (`#frame[data-hero]`), the rail shows it.
  With two or more warnings in the rail, each shows its headline too. Otherwise the rail shows the full sentence. The ⓘ panel's WARNINGS section always lists every warning's full
  sentence, the gun-health faults and HEADSET JOINING included, even when the rail shows none or the down screen's
  short copy.
- **The rail's neighbours:** the NIGHT label hides while the rail holds a warning. The powerup hint (and the label,
  above a plain chip) rides 12 px above the rail at the rail's REAL height (`hud.js` `_railFit`, `--rail`), however
  many lines its sentences wrap to, and keeps to the rail's column. It never rides over a centre tell (their band
  reaches frame y 252): while a tell is up and there is no room, it yields (hidden), because the tell and the rail's
  warnings outrank it; the held chip still shows. The rail's pills stand upright (no skew): a
  skewed pill of several lines leans wider than its column.
- **The medal chain keeps its voice** in every case.
- The death screen keeps its own pill band (`#frame[data-down]`), outside the rail.

`.gunwarn` (GUN NOT ANSWERING, GUN NOT REPORTING SHOTS) replaces the pills in the rail, 160 px wide, its headline at
16 px. Its headline always shows; its instruction hides while a kill card is up. GUN NOT ANSWERING, the most severe
fault, has the GUN LINK LOST treatment: a solid red box by day, `#ef6868` on `#2a0c0c` at night.

Stages: `clash-kc-gunlost`, `clash-medals-mc`, `clash-kc-reload`, `clash-kc-stale`, `clash-kc-headset`.
`app/tools/screens.mjs` checks each at both widths, day and night (`layering` and `F368` steps), and the gallery's
CLASH section renders them.

## Late lines (`ANNOUNCE_AUDIO_LATE_MS`)

Tony's match (2026-09-24) heard lines 10 to 15 s late: the phone wrote each on time, and the gun queued them behind
audio already playing. So a line that would START more than 2 s after its event is not said; its card still shows,
silently. The must-hear lines get longer: my kill confirm and its medal lines 6 s, a lead change no limit.

**Spree.** When a new MC kill arrives while older MC kills still wait, they fold into ONE item. A medal folds only
into a newer medal of its own kind (`MEDALS` `kind`, HUD QA R2-11): the item says first blood (never folded), then
the newest multi-kill (a triple supersedes the double), then the newest streak (KILLING SPREE is not a multi-kill).
The HERO lane shows every medal as it arrives, so a
line the voice says is always on screen when it starts. The folded kills keep their pairing, marked as said, so
their IR twins stay silent.

## Stale items and duplicates (`ANNOUNCE_TTL_MS`)

An item that waits longer than its TTL is dropped, never played late: hill 3 s, swap 4 s, alert 6 s, teammate and
enemy down 3 s, spawn 5 s (`PU_ANNOUNCE_LATE_MS`), pool lines 1.5 s. My own kill confirm and its medal lines have no
TTL (**Tony**: first, and never lost): behind a four-medal stack a kill waits about 8 s and still plays. A lead change
has no TTL either: outside a kill streak it waits behind ordinary lines, and it cannot go stale, because a newer lead
state replaces it (key `lead`). Inside a streak its line is dropped (above). An item that leaves
the queue unplayed runs its `onDrop`, which undoes its kill-confirm pairing, so a twin never stays silent for a
confirm nobody heard. Items with the same key collapse.
The same kind already playing or waiting is dropped. A different kind with the same key that is still waiting is
replaced: "takes the lead" then "lost the lead" says only the second, and a newer hill word replaces an older one.
When the state on air comes true again (on air "takes the lead", waiting "lost the lead", then "takes the lead" again),
the new item is a duplicate and the waiting item is false: both are dropped.

## My death wins (the trade)

**Tony**, 2026-09-25 (F149, F351, X4): "your death wins. delaying the death scream would be bad. while you are dead you
can listen to the queue of KCs and game alerts".

1. **The scream first, never cut.** At my death (`_death`) the phone sends one `$PLAYX,0,*` for each clip its model says
   the gun holds truly AHEAD of the native scream (the low-health line, my own kill line), and none for the scream
   itself. Not counted: the lethal hit's own `$SIR` row sound (the gun may play none on a lethal hit, or the scream
   may interrupt it: F158), and a clip that ends within `DEATH_STOP_SLACK_MS` (150 ms), since a stop that arrives
   after it lands on the scream. An extra stop here is not harmless. If such a spared clip is still playing at the
   front of the gun's queue, the stops wait until it ends, so none lands on it. Exactly the stopped clips leave the
   model. An ordinary death with a quiet gun sends no stop.
   With no scream id known, F149's one stop for the low-health line stays.
2. **A line the death stop cut is said again, and only what was not said.** Only when one of the item's OWN clips is
   among the stopped ones is it cut (`Announcer.death`; a must-hear or hill clip carries its item): its pending lines check `cut` and do not go out, and a copy holding the lines
   not yet finished goes back in the queue (`resume`). A medal stack cut on its second line says that line again, not
   the kill line or the first medal. The copy's medals and owed kill line are trimmed the same way, so a later spree
   fold does not say them again. It plays after the scream.
3. **While dead, everything queues.** Every KC, medal, lead and hill line waits for a SILENT gun and plays in priority
   order. Nothing flushes: no `$PLAYX` goes out for a must-hear or objective line while dead (X4). There is no streak
   silence. The death screen owns the view, so a card's hold does not pace the queue: the next line follows as soon
   as the one before it has ended. A hill line already queued is still said (its `ok()` no longer needs me alive).
4. **A longer life for what waits.** An item queued while dead, or waiting at the death, lives `DEAD_QUEUE_TTL_MS`
   (10 s), and may start that late with its line: the scream (1.27 s in the golden take, about 1.5 s at most), my kill
   line with its flash (0.76 s), two medal lines (up to 2.5 s each) and a lead line (2.7 s) come to about 10 s.
5. **The respawn ends it** (`Announcer.respawn`). What is left of the dead queue keeps only my kill confirm and the
   lead change (`KEEP_AT_RESPAWN`), with normal TTLs from the respawn, and each waits for the gun's real clips to end
   (the spawn line), so nothing flushes over it. The new life's shield loop does not count (F348 starts a Shields life
   at full shield); the must-hear flush cuts the loop as usual. The line on air is cut there too (its pending lines would flush the spawn line): a
   kill or lead item keeps its unsaid lines, anything else is dropped. Then the normal rules resume, the streak
   silence included.
6. **A match end inside the scream** keeps the dead rules until the scream has ended (`_screamUntil`).
7. **A hill preempt while dead** goes through `_sayMust`'s guard: no raw `$PLAYX`.
8. **A hill change while I am dead** is queued too (Tony's "game alerts"), and said after the scream. Before this, a
   control-point handover while down was said on the revive; now it is said while down, once.
9. **The low-health line never follows the scream** (F375, field 2026-09-24). It is not an item, but it waits: it goes
   out only after `HURT_DEBOUNCE_MS` (400 ms) with no damaging `$HP` (each hit restarts the wait), and only when the
   model holds no clip that can still play. So it is never queued behind another clip, and it never goes out while a
   burst is still landing. A death, a heal back to 15 HP or more, a match end, or a wait past `HURT_MAX_WAIT_MS`
   (3 s after the crossing) drops it. With no scream id known, F149's death stop goes out only for a line that was sent. The reason:
   the gun screams on the lethal `$HP,0` before the phone hears it, so a line written in that gap queues behind the
   scream, and the death stop then cuts the scream instead. A lethal hit after a pause of about 400 ms can still
   meet that gap (about one BLE delay wide); bench step 11.8 checks it.

"Target down" (`enemy_down`) is not in Tony's list: it is still dropped while I am dead.

## Pre-emption

1. Nothing cuts an announcer ITEM that is still on air: a kill confirm that arrives during a lower item's slot waits for
   it (up to 3.1 s behind one lower line, and up to about 8 s behind an earlier kill's four-medal stack, where the 6 s
   kill-voice limit then shows its card silently). When it does play, the must-hear flush above clears whatever the gun
   still holds. At my own death the scream goes first (above). F158 (does `$PLAYX,0` also clip the native death scream?)
   is still open for the case with a clip ahead of it.
2. A kill confirm takes over a SILENT lower item at once (a teammate card, a spawn or swap card): there is no sound to
   stop, only a card to replace. The displaced card goes back in the queue and shows again after the kill.
3. The hill rule is kept: a newer hill word takes over a hill item on air, and sends `$PLAYX,0,*` with it only while
   that hill line is still sounding. It does so only when no higher-priority item waits, so a flapping hill cannot
   starve a kill confirm or a lead change.
4. The pool lines share one key and supersede each other the same way, without `$PLAYX` (F57: the rarer cue wins), and
   only on a silent gun (rule 1 above), so a newer pool line never stacks behind an older one.

## Pairing

The S57 name pairing: a `DOWN` 250 to 800 ms after a `DOWN_BY` for the same victim team names that callout. Of several
open `DOWN_BY`s it takes the one whose age is closest to the sender's 300 ms gap, not the oldest. If the callout is on
air, its card takes the name in place. If it is waiting, or is a card a kill displaced, it shows named. One kill
never flashes twice:

- IR first, MC second, IR on air: MC's named card replaces the IR card in place, with no second line or flash. With
  medals, the medal lines follow the IR line as a `medal` item, after the banner of any lead change that waits (its
  line is silent in the streak).
- IR first, still waiting, MC second: MC's item replaces the waiting IR item and speaks the kill once.
- MC first, IR second: the IR word adds no line when MC's item says the kill line. If MC's item says only a medal (a
  medal replaces MC's plain line) or said nothing, the IR word says the kill line itself, voice only, with no card.
  If MC's item is still waiting, the IR word adds no card either.

**Cards.** The kill card and the alert banner live in `state().card`, which only the queue writes (`_card`). A hit or
a stun `moment` in the same render can no longer swallow them.

MC's kill moment carries `ir_at`, the `callout.at` of the exact IR card it paired with. hud.js matches that card, so an
IR card whose MC twin never came can never silence a later kill's flash.

## Stage

`npm run ui:stage` → **Callouts (S57)** → *announcer queue*: MC's kill feedback and its lead alert on one tick. The
voice says the kill first and the lead after it (the lead line is silent during a kill streak). The screen shows the kill HERO and the lead badge together, from the
first frame. More stages: `live-kill-lead-hill` (all three at once), `live-spree` (the storyboard: six kills on MC's
ladder with the lead, the hill and a teammate down inside it), `live-kill-beat-down`, `live-kill-killjoy` and
`result-awards`. `app/tools/screens.mjs` checks each lane (`lanes` steps). `app/tools/alert-gallery.mjs` renders the
storyboard as a static gallery.
