# Smart Grenade — operation & modes (the de-facto manual)

The grenade has no real written manual; the best source is two 2019 videos by **"Extreme Laser Tag
And More!"** — *BRX Accessory Grenade Basics* (`youtu.be/A9DTQMrdjxk`, 26 min) and *Tips & tricks on
grenade settings/functionality* (`youtu.be/5xgKF2MBtWc`, 9.5 min). Facts distilled from their
transcripts (credit the channel). This makes our reference the most complete grenade doc anywhere —
directly feeds the grenade config app (FOLLOWUPS B8/G1). Complements the `$GREN` field facts in
`../../protocol/callsign-extract/apk-harvest.md` and the pairing/IR facts in `brx-extended-user-guide.md`.

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

## Respawn Station mode

- Starts **white/neutral**; **shoot it with a team's gun to claim it that team's colour** (blue gun →
  blue → respawns only blue).
- **Guns told to be a respawn-station client can no longer self-respawn** — trigger just makes the
  dead/out-of-ammo noise. To respawn: come to the station and **press its button** → respawns everyone
  of that team in proximity (up to their life limit).
- **Hands-free / at range:** flip the accessory upside-down; a dead player in proximity does a **melee
  (front-only) trigger pull** → the station respawns everyone of that team within ~18–20 ft. Range
  scales with indoor/outdoor mode (forward IR projection).
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
- **King of the Hill:** on capture, all guns announce **"control point captured"**; the grenade
  **emits every ~3–4 s who holds it**, so nearby guns know possession. It **charges**: each shot adds
  charge up to a max; to retake, the other team must fire **at least as many rounds back into it**
  (2–3 rounds to 2–3 magazines depending on weapon; ~4 on an MG, ~10–12 on a shotgun). The holder has
  a rapid-refill advantage while defending. Win = possession at time / fully charged.
- **A thrown grenade blast on the point instantly captures it 100%** for the thrower's team (full
  charge in one hit) — a deliberate quick-takeover mechanic.

## Assault mode

Cycled alongside the above (attack/hold an objective). Details thin in the videos — behaves like the
checkpoint/KotH objective family; confirm specifics on hardware (G1).

## Using it as a thrown grenade (pairing)

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

## Open (followups F/G)

Confirm on hardware: exact `$GREN` ↔ each mode mapping (G1); whether `$GREN` reprograms an
already-paired grenade live; the grenade's BLE visibility (G2); and what objective state the gun
exposes over BLE during a grenade game, for a live status display (G6).
