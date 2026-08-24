# Smart Grenade — operation & modes (the de-facto manual)

The grenade has no real written manual; the best source is two 2019 videos by **"Extreme Laser Tag
And More!"** — *BRX Accessory Grenade Basics* (`youtu.be/A9DTQMrdjxk`, 26 min) and *Tips & tricks on
grenade settings/functionality* (`youtu.be/5xgKF2MBtWc`, 9.5 min). Facts distilled from their
transcripts (credit the channel). This makes our reference the most complete grenade doc anywhere —
directly feeds the grenade config app (FOLLOWUPS B8/G1). Complements the `$GREN` field facts in
`../../protocol/callsign-extract/apk-harvest.md` and the pairing/IR facts in `brx-extended-user-guide.md`.

## How the grenade communicates (hardware-confirmed, exp-log #38)

**The grenade is an IR *broadcaster* — no pairing, no addressing.** Every few seconds it emits an
omnidirectional-ish IR beacon carrying its state (`$HIR,0,15,0,<owner>,<mode>`), and **every headset in
range receives the same broadcast**: guns in a game *react* (play "hill captured", ticking timer, etc.),
and a **BLE-connected tagger relays it to a phone/laptop** — this is the entire basis of the state-display
(one connected tagger in range = a live feed of every objective's owner+mode). Verified: E20D (a manual
game) and 3D4F (BLE-connected, idle) both received the *same* captured-Hill beacon simultaneously.

**The grenade also actively modifies the holder's gun over IR** — e.g. **holding the Hill grants a higher
rate of fire** (the "rapid-refill advantage"). So the grenade both *broadcasts state* and *pushes perks/
effects* to guns via IR.

## The big picture: the grenade is a portable objective/station device

Beyond exploding, the grenade **programs nearby guns by IR beacon** and can *become* a **respawn
station, King-of-the-Hill / checkpoint / domination point, or assault point** — a portable
JBOX-equivalent. It has: a **button on top**, **3 IR emitters**, and an **emitter+receiver**. On
power-up it flashes green = ready. Default mode = plain "grenade."

## Programming a game mode (on-grenade — the finicky part)

1. Power the grenade on (pop the safety clip, press the top button → flashes green).
2. **Hold the top button ~10 seconds.** It IR-emits a mode signal to every gun/headset in front of
   it (from any angle, all at once), cycling through the modes as you hold.
3. Release on the mode you want; **after it sits ~10 s in a mode it LOCKS in** that programming.
   To re-program, **power-cycle** it (once locked it stays).
4. Guns receive the mode via their IR receiver — no app needed; headsets can receive too but aren't
   required. This is why it's fiddly (timing the hold + lock), and why a clean **`$GREN`-over-BLE
   config app (B8) is the fix** — same modes, no button-timing dance.

**Modes it cycles through:** Respawn Station · King of the Hill · Checkpoint/Domination · Assault ·
(plus default grenade; "more coming" per the video). *(The APK also decodes a `GrenadeType` enum —
FlashBang/Gas/Confusion/Molotov — which is the blast *effect*; these game *modes* are the
`operationMode`/objective behaviour. Reconciling the two exactly is followup G1.)*

### Exact setup procedure + colour→mode map (HARDWARE-CONFIRMED, Tony, exp-log #35)

There are **5 modes**, indicated by **LED colour** (the video's 4-mode list was incomplete):

1. **Turn the grenade OFF, then ON**; wait for the **green LED** (ready).
2. **Hold the top button ~4 s** → a **loud long beep** = entering setup.
3. In setup it **beeps rapidly** and **cycles colour** as you hold. **A second tagger in setup mode
   announces each mode's name** as you cycle. Confirmed colour → mode map (Tony, exp-log #35):

   | Mode | Colour | Function |
   |---|---|---|
   | 1 | **red** | **Frag** — a blast grenade (event-driven; detonate by button/throw, no passive beacon) |
   | 2 | **green** | **Assault** |
   | 3 | **blue** | **Hill** (King of the Hill) |
   | 4 | **yellow** | **Respawn** |
   | 5 | **white** | **CTF** (Capture the Flag) |

   The four objective modes (green/blue/yellow/white) **beacon their state over IR** (→ `$HIR,0,15,…`
   on a bare-connected gun); **Frag (red) does not beacon** — it's a thrown/triggered blast.
4. **Release** on the colour you want → it **locks** that mode.
5. **The mode persists across a power-cycle** (off/on keeps it) — only re-entering setup changes it.
6. **LED goes white when a mode locks in** (the lock confirmation).
7. **On boot, the grenade flashes its current mode's colour for ~1 s** — so you can verify the active
   mode by power-cycling and watching the boot colour (it's not always green).

**Over BLE, some grenade modes beacon their state as `$HIR` frames** — but **only when the gun is NOT in
a host game whose `$SIR` table swallows the IR** (use a bare connect, or a `$SIR` config that passes
grenade IR through). Hardware-confirmed decode (exp-log #35):

- **`$HIR,0,15,0,<owningTeam>,<mode>,0,0,*`** — full decode (hardware-confirmed, exp-log #35):
  - **token 2 = 15** means the hit is from a **GRENADE** (a gun shot has `0` there). Filter grenade IR by
    `token2 == 15`.
  - **token 4 = the OWNING TEAM** — verified: a neutral/team-2 Respawn beaconed `…,2,6`; the instant a
    **team-1 (blue)** gun claimed it, the beacon flipped to `…,1,6`. So **1 = blue/team-1, 2 = team-2**
    (same team encoding as a gun hit's shooter-team field).
  - **token 5 = the mode** — **Respawn = 6, Hill = 8**.
- **Only Hill and Respawn beacon** their state passively (~2.5–5 s); **Assault, CTF, Frag do not.**
- **A node reads `$HIR,0,15,0,<team>,<mode>` to show who owns each Hill/Respawn point, live** — this is
  the buildable core of the grenade **state-display** app (B8).
- **Operational trick:** a **tagger left in setup mode is a free audible grenade-state monitor** — it
  announces the grenade's state aloud ("respawn point enabled," a claim chime, mode names as you cycle).
  Handy for setup + as a no-app complement to the BLE display.
- **Capture caveat:** the beacon is **aim-sensitive** — the grenade's IR emitter must face the headset
  dome closely, or the gun sees nothing (several runs caught zero purely from positioning).

| Mode (colour) | Beacons? | Signature / behaviour |
|---|---|---|
| Frag (red) | ❌ | blast weapon — thrown/triggered, no beacon |
| Assault (green) | ❌ | **captures silently** — shot by a team's gun → grenade LED turns that team's colour; no beacon |
| **Hill (blue)** | ✅ ~5 s | `$HIR,0,15,0,2,8,0,0` |
| **Respawn (yellow)** | ✅ ~2.5 s | `$HIR,0,15,0,2,6,0,0` |
| CTF (white) | ❌ passive | flag grab mechanic (shoot to grab); no passive beacon |

**G6 answer (mode-dependent):** a phone/node **can read Hill & Respawn state live over BLE**; **Assault/
CTF/Frag expose nothing** — their state lives on the grenade LED only, so those must be inferred from
*our own gun's* capture shots. **Capture needs a real weapon firing** (bare-connect trigger is disabled;
use a `minfire` config = weapon loaded, `$SIR` stripped).

## Respawn Station mode

*(All below **hardware-confirmed** by Tony, exp-log #37, matching the videos.)*
- Starts **white/neutral**; **shoot it with a team's gun to claim it that team's colour** (blue gun →
  blue → respawns only blue). Over BLE the claim flips the beacon's team field (`$HIR,0,15,0,<team>,6`).
- **Once the guns know a respawn station is configured, their auto/self-respawn is DISABLED** — a dead
  player's trigger just makes the dead/out-of-ammo noise. Two ways to respawn:
  1. **Press the button on the grenade** → respawns everyone of that team **in the area**.
  2. **Face the respawn station with the FRONT of your headset and pull the trigger** → signals the
     grenade to emit a respawn signal (the hands-free / at-range method; ~18–20 ft, range scales with
     indoor/outdoor mode's forward IR projection).
- **The critical gotcha (root of the "grenade is confusing/buggy" reputation):** setting a gun to
  respawn-station mode via the beacon is **not enough** — you must **signal the respawn action to each
  gun AFTER the game starts** (press the grenade button on each player at the base pre-game). A gun
  that was *not* hit by the station signal post-start will just **self-respawn normally**; once hit by
  the station beacon it's locked to needing the station. Practical flow: everyone starts at base, a
  leader presses the grenade on each player, *then* the game starts (use a two-horn start to buy the
  ~5 s), **or** run unlimited-time and pre-set everyone to respawn mode before the match.
- Respawn stations **can be overtaken** by another team (shoot/grenade it) — "not always consistent"
  (a real reliability quirk the community also reports).

## King of the Hill / Checkpoint / Domination mode

- **Checkpoint:** changes colour **once** when a team shoots it (red/blue/green; 3 colours in
  Supremacy). Seize-a-base feel; most checkpoints held = win. No central — relies on team comms.
- **King of the Hill:** **starts white/neutral until someone shoots it** (hardware-confirmed, same as
  Respawn — exp-log #37); on capture, all guns announce **"control point captured"**; the grenade
  **emits every ~3–4 s who holds it** (our BLE decode: `$HIR,0,15,0,<team>,8`), so nearby guns know
  possession. It **charges**: each shot adds
  charge up to a max; to retake, the other team must fire **at least as many rounds back into it**
  (2–3 rounds to 2–3 magazines depending on weapon; ~4 on an MG, ~10–12 on a shotgun). The holder has
  a rapid-refill advantage while defending. Win = possession at time / fully charged.
- **A thrown grenade blast on the point instantly captures it 100%** for the thrower's team (full
  charge in one hit) — a deliberate quick-takeover mechanic.

## Assault mode

Cycled alongside the above (attack/hold an objective). Details thin in the videos — behaves like the
checkpoint/KotH objective family; confirm specifics on hardware (G1).

> **Hardware-confirmed (exp-log #34):** the grenade **flashes white when shot** — it receives gun IR and
> reacts (so the gun→grenade path works), but white = **neutral/unclaimed**, so a bare shot reads as a
> hit-acknowledge, not a team capture (a blue gun did not claim it blue). And the **mode announcement
> through the tagger speaker only happens when the gun is in SETUP mode, not mid-game.**

## Using it as a thrown grenade (pairing — ONLY for thrown use, NOT objective modes)

**Important (Tony, exp-log #34):** you do **NOT** "install accessory" to use the grenade in its
**objective modes** (Respawn/KotH/Checkpoint/Assault) — in those it's a **station** any gun interacts
with by IR, no pairing. The pairing below is **only** for using it as a *thrown* grenade tied to your
own headset.

Matches the accessory-pairing procedure in `brx-extended-user-guide.md`:
1. Power the gun holding the **RIGHT** button → "install accessory".
2. **Shoot the grenade** right away → it pairs to you (so only you trigger it). Pair all accessories
   in one session; power-cycle the grenade and set its mode.
3. Needs the **headset paired/functioning**. To throw: press the grenade button in proximity → it
   signals your headset → arms → detonates, affecting everyone in range (can wipe a group / instantly
   flip a respawn point or hill).

## Two config paths (why the app matters)

- **On-grenade IR beacon** (these videos): hold-button-cycle-lock — works, but finicky and buggy.
- **`$GREN` over BLE** (from the APK, `apk-harvest.md`): the app path — a clean UI (B8) that sets the
  grenade/gun mode without the button-timing dance. **This is the single biggest usability win we can
  build for the grenade**, since the grenade already provides Respawn/KotH/Checkpoint/Assault for $0.

## Can we put new audio on the grenade?

**Practically yes — because most "grenade audio" actually plays on the GUN/HEADSET, not the grenade.**
The grenade is an IR-paired accessory with a button, 3 IR emitters, an emitter+receiver, and status
LEDs (flashes green). What you *hear* — the detonation, flashbang/gas effect, the CTF "scary music,"
respawn chimes, KotH "control point captured" callouts — is played by the **gun and headset from
their own sound banks** in response to the grenade's IR signal. The grenade itself only appears to
chirp/flash for status.

So the clean, rule-compliant path to "new grenade audio" is to **reskin the gun/headset sounds that
grenade events trigger** — the tagger sound bank is swappable over USB (`brx-extended-user-guide.md`:
hold SELECT at boot → `AUDIO` folder → replace `<ID>.LTP`). Change the explosion/flashbang/CTF-music
ids and every grenade "sounds" different, with **zero grenade modification**. The **Companion node**
(Tier 2) goes further: a grenade IR event can trigger *any* custom sound on its own speaker — unlimited,
dynamic grenade audio without touching the accessory at all.

*Likely direct path (the grenade has a USB-C port — confirmed by Tony):* the same firmware/audio-swap
mechanism the gun and headset use is a **USB mass-storage disk** you reach by a button-hold boot. The
grenade having its **own USB-C port** strongly suggests it exposes that disk too — so if it carries a
speaker, it very probably has a swappable **`AUDIO` folder of `<ID>.LTP` files** just like the tagger.
The concrete test (followup G7): with the grenade **off, hold its button (or PROGRAM pin) while
plugging in USB-C** → does a disk mount with a firmware `.BIN` and/or an `AUDIO` folder? If yes,
grenade-local custom audio is a direct file swap — **no firmware modification, fully within our rules**
(same as swapping gun sounds). Either way, the gun/headset/Companion reskin above already delivers new
grenade audio today.

## Can we add new modes to the grenade?

Two different questions:

- **New mode *inside* the grenade's firmware?** **No — by policy and practicality.** Our hard rule is
  *never modify stock BRX firmware*, and the grenade is stock BRX. Writing custom grenade firmware is
  off-limits (and undocumented/risky). Note: Jay's "updated grenade firmware improving respawn" was
  applying **Battle Company's own official firmware update**, not custom code — that's a vendor update,
  not a mod. What we *can* set over the wire is **parameters within the existing modes** via `$GREN`
  (`operationMode`, `GrenadeType`, `channel`, `indoorMode`, `crit`, `modifier`) — tuning modes, not
  inventing on-device ones.
- **New *effective* modes built around the grenade? Yes — this is the whole architecture.** The grenade,
  like the gun, **keeps no game state** — it's an IR objective/effect *emitter*. Its native modes
  (Respawn / KotH / Checkpoint-Domination / Assault) and blast types (FlashBang/Gas/Confusion/Molotov)
  are raw **IR primitives**; what they *mean* is decided by our host + nodes. So we layer any new
  ruleset on top without touching the grenade:
  - grenade in **KotH mode** → our engine treats its zone beacon as the **Extraction point**
    (`game-modes.md` §Extraction) or a **Counter-Strike bomb site**;
  - grenade as a **placed objective** → nodes track capture/hold and score it however the mode wants;
  - `channel` + `MaxCount` let multiple grenades be **multiple addressable objectives**.

  So the grenade can anchor *many* new modes — the new-mode logic lives in Mission Control / the player
  nodes, exactly like every other Open BRX mode. The grenade is dumb hardware; the engine off-device is
  where modes are born.

## Known grenade quirks (FB group crawl)

- **No winner display:** the grenade **can't show a winner** for its KotH/Domination modes — scoring/
  win must be adjudicated off-device (our host), which is exactly the gap our engine fills.
  ([post](https://www.facebook.com/groups/712027809192113/posts/1483712818690271/))
- **Assault friendly-capture bug:** as an Assault objective the grenade **can be accidentally captured
  by the defending (friendly) team** — a reliability quirk to design around.
- **ALT-fired grenade plays a different/incorrect sound** than the normal grenade cue — possible
  leftover/bug (single-source, unverified). ([post](https://www.facebook.com/groups/712027809192113/posts/2413135579081319/))
- Note also: community reports **Assault is "unusable"** and was removed from JEDGE hosting — treat
  grenade-Assault as low-confidence until we test it (`../game-modes.md`).

## Open (followups F/G)

Confirm on hardware: exact `$GREN` ↔ each mode mapping (G1); whether `$GREN` reprograms an
already-paired grenade live; the grenade's BLE visibility (G2); what objective state the gun
exposes over BLE during a grenade game, for a live status display (G6); and **whether the grenade's
USB-C port mounts a mass-storage disk with a firmware `.BIN` / swappable `AUDIO` folder** like the gun
and headset (G7 — the direct grenade-audio-swap test).
