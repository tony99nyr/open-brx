# Smart Grenade — operation & modes (the de-facto manual)

The grenade has no real written manual; the best source is two 2019 videos by **"Extreme Laser Tag
And More!"** — *BRX Accessory Grenade Basics* (`youtu.be/A9DTQMrdjxk`, 26 min) and *Tips & tricks on
grenade settings/functionality* (`youtu.be/5xgKF2MBtWc`, 9.5 min). Facts distilled from their
transcripts (credit the channel), then **hardware-confirmed and extended** in exp-log #33–40. This makes
our reference the most complete grenade doc anywhere — it feeds the grenade **state-display** app
(FOLLOWUPS B8; note: over-BLE *config* was disproven — see §"Configuration is on-device only" below).
Complements the `$GREN` field facts in `../../protocol/callsign-extract/apk-harvest.md` and the
pairing/IR facts in `brx-extended-user-guide.md`.

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
   required. This is why it's fiddly (timing the hold + lock). **There is no over-BLE shortcut:**
   configuring the objective mode via `$GREN` was tested and **does not work** — the mode is button-set
   and locked on the device (see §"Configuration is on-device only", G8). The hardware-confirmed
   procedure + exact colour→mode map is in the next section.

**Modes (hardware-confirmed, 5):** red=Frag · green=Assault · blue=Hill (KotH) · yellow=Respawn ·
white=CTF (full table below). *(The APK's `GrenadeType` enum — FlashBang/Gas/Confusion/Molotov — is the
blast *effect* of a **thrown** grenade, a different axis from these objective *modes*; `$GREN` sets that
blast type for a paired thrown grenade, not the objective modes — G8/G10.)*

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

   **Only Hill (blue) and Respawn (yellow) beacon their state over IR** (→ `$HIR,0,15,…`
   on a bare-connected gun); **Assault (green), CTF (white), and Frag (red) do NOT beacon** — Assault/CTF
   capture silently (state on the grenade LED only) and Frag is a thrown/triggered blast.
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
*(Operational setup — arming each tagger to a station before kickoff — is the **Station Arming** sub-step
of the per-game **Muster** process: `../field-process.md`.)*
- Starts **white/neutral**; **shoot it with a team's gun to claim it that team's colour** (blue gun →
  blue → respawns only blue). Over BLE the claim flips the beacon's team field (`$HIR,0,15,0,<team>,6`).
- **Once the guns know a respawn station is configured, their auto/self-respawn is DISABLED** — a dead
  player's trigger just makes the dead/out-of-ammo noise. Two ways to respawn:
  1. **Press the button on the grenade** → respawns everyone of that team **in the area**.
  2. **Face the respawn station with the FRONT of your headset and pull the trigger** → signals the
     grenade to emit a respawn signal (the hands-free / at-range method; ~18–20 ft, range scales with
     indoor/outdoor mode's forward IR projection).
- **The critical gotcha (root of the "grenade is confusing/buggy" reputation) — arming each tagger to
  the station.** Setting the *grenade* to Respawn mode is **not enough**: each **tagger** must also
  **receive the respawn-station IR** to switch from auto-respawn to station-respawn. This is a per-game
  **arming** step (Open BRX calls it **"Station Arming"** — see `../field-process.md` §Muster). A tagger
  that never got the station signal just **self-respawns normally**; once it has received the station
  beacon it's locked to needing the station.

  **Timing — RECONCILED (Jay's grenade video, 2026-08-25, Tony relaying — Extreme Laser Tag And More! /
  @extremelasertag3602):** arming works **both** pre-game and mid-game, because there are **two arming
  paths** and either one switches a gun from auto-respawn to station-respawn:
  - **Pre-game (passive/config) arming:** set the grenade to Respawn and expose each tagger to its station
    IR **before** the game starts. Once armed, that tagger **knows during the game to respawn at the
    station instead of automatically** (self-respawn disabled). This is the natural config step.
  - **Post-start (button) arming — the reliable per-gun force:** even if you **START the game BEFORE**
    setting the grenade to a respawn station, **pressing the button on the grenade** beams the station IR
    to each gun in range and **forces the tagger into respawn-station mode mid-game** (not auto-spawn).
    So the grenade-button press is a **distinct arming action that works AFTER `$SPAWN`** — this is exactly
    the exp-log #37 "signal each gun after the game starts" behaviour, now explained.
  - **Bottom line:** pre-game passive arming **or** a post-start grenade-button press per gun both arm a
    tagger; the button press is the dependable per-gun re-arm at any time. A tagger that is never armed by
    either path just **self-respawns normally**. **Still to confirm on hardware** (verification-checklist):
    (a) a gun armed by the post-start button stays station-respawn for the rest of the match, and (b)
    whether the **passive beacon alone (no button)** also arms. Credit Jay (Extreme Laser Tag And More!).
- Respawn stations **can be overtaken** by another team (shoot/grenade it) — "not always consistent"
  (a real reliability quirk the community also reports).

## King of the Hill (blue) — incl. checkpoint/domination-style play

*(There is no separate "Checkpoint" button mode — the confirmed 5 are Frag/Assault/Hill/Respawn/CTF. The
video's "checkpoint/domination" behaviour is how the **blue Hill** mode is *used*: a seize-a-base point
you shoot to own. Described here for completeness.)*

- **King of the Hill (blue):** **starts white/neutral until someone shoots it** (hardware-confirmed, same as
  Respawn — exp-log #37); on capture, all guns announce **"control point captured"**; the grenade
  **emits every ~3–4 s who holds it** (our BLE decode: `$HIR,0,15,0,<team>,8`), so nearby guns know
  possession. It **charges**: each shot adds
  charge up to a max; to retake, the other team must fire **at least as many rounds back into it**
  (2–3 rounds to 2–3 magazines depending on weapon; ~4 on an MG, ~10–12 on a shotgun). The holder has
  a rapid-refill advantage while defending. Win = possession at time / fully charged.
- **A thrown grenade blast on the point instantly captures it 100%** for the thrower's team (full
  charge in one hit) — a deliberate quick-takeover mechanic.

## Assault mode (green)

Attack/hold an objective. **Hardware-confirmed (exp-log #35):** shooting it with a team's gun **captures
it to that team's colour** (blue gun → blue), but — unlike Hill/Respawn — it **does NOT beacon** its
state over BLE (the capture state lives on the grenade LED only). So a live Assault display isn't
possible from the grenade; infer capture from your own gun's shots. (Community also reports Assault is
finicky / was removed from JEDGE hosting — treat its *reliability* as low, though the mode works.)

> **Hardware-confirmed (exp-log #34):** the grenade **flashes white when shot** — it receives gun IR and
> reacts (so the gun→grenade path works), but white = **neutral/unclaimed**, so a bare shot reads as a
> hit-acknowledge, not a team capture (a blue gun did not claim it blue). And the **mode announcement
> through the tagger speaker only happens when the gun is in SETUP mode, not mid-game.**

## Using it as a thrown grenade (pairing — ONLY for thrown use, NOT objective modes)

**Important (Tony, exp-log #34):** you do **NOT** "install accessory" to use the grenade in its
**objective modes** (Assault/Hill/Respawn/CTF) — in those it's a **station** any gun interacts
with by IR, no pairing. The pairing below is **only** for using it as a *thrown* grenade tied to your
own headset.

Matches the accessory-pairing procedure in `brx-extended-user-guide.md`:
1. Power the gun holding the **RIGHT** button → "install accessory".
2. **Shoot the grenade** right away → it pairs to you (so only you trigger it). Pair all accessories
   in one session; power-cycle the grenade and set its mode.
3. Needs the **headset paired/functioning**. To throw: press the grenade button in proximity → it
   signals your headset → arms → detonates, affecting everyone in range (can wipe a group / instantly
   flip a respawn point or hill).

## Configuration is on-device only (hardware-confirmed — G8)

**There is exactly ONE way to set a grenade's objective mode: the on-grenade button** (hold-button-
cycle-lock, finicky but the only path). We tested driving the mode over BLE with `$GREN` (swept every
`operationMode` value × iRType {0,15}) and it had **zero effect** — the mode is **button-set and locked
on the device** (anti-tamper). `$GREN`'s `GrenadeType` (FlashBang/Gas/Confusion/Molotov) configures a
**paired *thrown* grenade's blast effect**, not objective modes (G10). So there is **no `$GREN` config
app** — the app's real value is a live **STATE DISPLAY** (below), not configuration.

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

*No grenade-local swap path (G7, RESOLVED negative):* the grenade **has a USB-C port**, but it exposes
**no USB data interface** — tested off, on, and in the purple button-hold mode on a **confirmed-good data
path** (a Pixel enumerated on it); the grenade never enumerated a drive, serial console, or DFU. There is
**no pinhole/PROGRAM pin** either. So its USB-C is **power/charge only** — no on-grenade `AUDIO` folder to
swap. **The gun/headset/Companion reskin above is the only way to change grenade audio**, and it already
delivers it today.

## Can we add new modes to the grenade?

Two different questions:

- **New mode *inside* the grenade's firmware?** **No — by policy and practicality.** Our hard rule is
  *never modify stock BRX firmware*, and the grenade is stock BRX. Writing custom grenade firmware is
  off-limits (and undocumented/risky). Note: Jay's "updated grenade firmware improving respawn" was
  applying **Battle Company's own official firmware update**, not custom code — that's a vendor update,
  not a mod. And **`$GREN` does NOT let us set the objective mode over BLE** (G8 — button-locked on the
  device); `$GREN` only configures a **paired thrown grenade's blast type** (`GrenadeType`), not the
  objective `operationMode`. So there is no over-the-wire mode tuning for the objective modes.
- **New *effective* modes built around the grenade? Yes — this is the whole architecture.** The grenade,
  like the gun, **keeps no game state** — it's an IR objective/effect *emitter*. Its native modes
  (Frag / Assault / Hill / Respawn / CTF) and blast types (FlashBang/Gas/Confusion/Molotov)
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
- Note also: community reports **Assault was "unusable" / removed from JEDGE hosting** — the mode itself
  works (we confirmed capture-to-team-colour), but treat its *reliability* as low.

## Resolved this session, and what's still open

**Resolved (exp-log #33–40):** the 5-mode colour map; the on-device setup procedure; the `$HIR,0,15,0,
<team>,<mode>` beacon decode incl. live ownership; the IR-broadcast comms model; **G8** (`$GREN` does
NOT set objective modes — button-locked); **G7** (USB-C is power/charge only — no data interface);
**G6** (mode-dependent — Hill/Respawn beacon over BLE, Assault/CTF/Frag don't).

**Still open:** **G9** — CTF flag team-assignment (shooting a CTF grenade turned it *red*, not the
shooter's team colour; likely needs a team/flag assignment first — pull Jay's CTF videos). **G10** —
`$GREN` for a *paired thrown* grenade's blast type (untested — needs the install-accessory pairing).
The **KotH charge/progress level** is not in the beacon (it's a per-gun local timer); decoding a charge
value needs a `$SIR`-passthrough rig that lets the gun fire *and* surface grenade IR (exp-log #38).
