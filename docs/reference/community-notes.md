# BRX community knowledge — distilled

Practical BRX know-how gathered from the **BRX Elite Owners Group** (Facebook, ~196 members) and
cross-referenced with LaserTagMods' work. **Distilled facts and procedures in our own words** —
not verbatim reposts. Attributed to a contributor only where they solved a specific procedure.
This is field-earned wisdom that complements the protocol/manual docs.

## Repairs & diagnostics

**Gun won't fire — diagnostic ladder** (community consensus):
1. **Is the headset on and paired?** Since a 2018/2019 firmware revision, the BRX **stops firing
   when the headset is off/disconnected** — anti-cheat. This is the #1 cause and corroborates our
   own headset-lockout finding (`experiment-log` §16, manual §7h). A tagger that "charges its
   energy weapon but nothing happens on trigger" is the classic symptom.
2. Can you select a weapon by pulling the trigger *before* starting a game? If not, controls are
   locked / not in the right state.
3. Open the gun — lots of internal wires/switches; check for **loose cables**. Do a **continuity
   test on the trigger switch** (it should beep on pull).
4. Past that it's the **mainboard** — not community-serviceable.

**Gen-3 headset re-pair procedure** (contributed by Jon Haidet — solves the "PAIRING MODE" mystery):
1. Turn the **headset** on (LEDs cycle colours).
2. Press and **HOLD** the small headset button (keep holding through the whole procedure).
3. On the **tagger**, hold **RIGHT on the D-pad while powering on**.
4. Wait for the voice **"PAIRING MODE"**.
5. **Pull the trigger once** → "HEADSET CONNECTED", headset LEDs stop cycling.
6. A **second trigger pull** announces "device paired".

This directly addresses our open "headset lockout" question — it's how you recover a tagger whose
headset link dropped (which blocks firing).

**Battery / power:**
- **BRX battery polarity is REVERSED** from the standard convention — check polarity carefully
  when building/charging packs or you risk damage.
- You can charge a pack **outside the tagger** by cutting the end off a BRX AC adapter and wiring
  on the battery connector. Community practice: build a stack of spare packs, charge at home,
  swap in the field (don't rely on power-bank charging the internal cell).
- **Forgetting to unplug the battery during a mod fries the mainboard** (→ send for repair).
- **Headset (v2) battery = a single 18650 lithium cell.**

## Scoping / sighting & outdoor play

- **Sight the scope per the manual** (§ manual notes) — indoors ~20 ft, outdoors ~300 ft; snipers
  sight long (300–400 ft), shotgun/SMG sight close (50–100 ft).
- **swaptx headset LEDs are dimmer than BRX headset LEDs** — in direct sun it's hard to tell if
  you're landing tags at range. Prefer BRX headsets outdoors for hit feedback.
- **Play OUTSIDE for ESP32-based mods.** The recurring community verdict: ESP32/BLE/LoRa range is
  limited and flaky indoors and around solid cover; in an open outdoor arena (field, forest,
  park) the mods "work wonderfully" without special antennas. Keep the setup simple.

## The scoring gap (the #1 thing players want)

- Out of the box the BRX is a **non-scoring** system. "How do I see my score?" is *always* the
  first question at a game. The two features people most want that stock BRX lacks: **hosting/
  starting games from the tagger itself** and **on-device K/D tracking**. (STX/SwapTX gear adds
  both, at the cost of some BRX features.) **This is precisely the gap our platform + Companion
  accessory fills.**

## Modding landscape & hard-won cautions

- **"JEDGE 6 doesn't work, LoRa doesn't work."** The community's strong, repeated guidance is to
  use *exactly* the units/wiring in the maintained build docs; off-script LoRa modules and newer
  JEDGE builds are a common source of wasted effort. (Useful signal: the field-range problem is
  hard even for the originators — reinforces our followup D / the Companion approach.)
- **SwapTX headset mod** (≈$50 headset, single 18650): unlocks STX-style hosting + JEDGE controls,
  but the swaptx headset **has no IR emitters**, so it loses splash damage, shotguns, pass-through,
  medics, many Supremacy/Deathmatch perks, and base/commander respawn requests. Non-final beta.
  BC declined to productise it (deemed too competitive with their pro line).
- **No permanent BRX modification** is the community norm — the ESP32/power-bank rides externally
  on the phone bracket. Validates our Companion design.

## Game-mode design ideas (host-side rules we can build)

- **Physical team flags** (coloured ribbon on a binder clip): run "everyone on one team +
  friendly-fire on", differentiate teams only by the clipped flag. On death a player swaps their
  flag and rejoins the other team; refs collect a flag before respawn (anti-cheat). Great for
  Infection (start one "infected" with no flag) and team-swap modes. Simple, kid-friendly,
  easy to referee.
- **Ammo restock in limited-ammo games** — several stock mechanisms exist: a **grenade**, giving
  ammo like health via **ALT-fire or an unused L/C/R button**, or a **respawn-point character**
  (as Generals/Commanders/Swarm already do — a character that revives others with the trigger and
  can have limited lives; the same slot can hand out ammo).
- **Respawn delay ramps** — latest firmware/audio: respawn penalty ramps up per death (e.g. to
  45 s / 90 s max). "RAMP 45 / RAMP 90" in the manual settings.
- **Balance notes:** taking damage while in the respawn state (stock BRX) is disliked. Nexus
  faction is considered over-strong. The **Body-Armor perk on a General actually lowers total
  health** (a stock imbalance/bug). Sniper head-shots: prefer boosting **crit rate** over damage
  (the headset is an easier target than the gun sensor).

## Grenade notes (feeds followup F)

- A grenade can be **set as a CTF base**. The "scary music" a tagger plays is the **capture-the-
  flag music** (played when a tagger holds the flag). Running grenades in the wrong mode with
  CTF-capable firmware can trigger unexpected game responses — Battle Company left the grenade↔
  game responses enabled. Grenade firmware is field-updatable via a `.bin` (community asks for the
  flashing procedure — not well documented, matches our "grenade config is hard/buggy" note).

## Custom sounds ON the tagger — via the data port (community-confirmed)

**You CAN swap the tagger's sound files** — corrects our earlier "no on-gun sound change" note.
- Files are sent over the **micro-USB data port** (the "Programing Port"). The **SD card is NOT
  removed** — it's hot-glued to the mainboard and stays put.
- To expose the storage: **plug the gun into a computer, hold SELECT while turning the gun on**
  (gun makes no startup sound). It does **not** show up as a drive on a normal power-on. A disk
  drive then appears with a firmware `.BIN` at the root and an **`AUDIO` folder** — drop new
  `<ID>.LTP` files into `AUDIO` (overwrite = YES; slow, ~1 hr per 250 MB). Authoritative process +
  details in `brx-extended-user-guide.md`.
- People use this to install custom packs (e.g. a **Star Wars sound pack**).
- Source: FB group thread (David Knox: "Files are sent via the data port. SD card does not get
  removed."; Don Richardson: "hold select while turning on the gun" while plugged in).
- **Keep the originals** before swapping; Battle Company's USB updater is the factory restore.
- This is changing stored *content*, not firmware — within the "never modify firmware" directive,
  and reversible. (Reconciles the earlier "no SD card" finding, which was about *firmware* backup
  via the HalfKay bootloader, a separate thing.)

## Headset ARGB LEDs = WS2812B (5050 SMD)

The headset's addressable RGB LEDs are **WS2812B 5050 SMD** — standard single-wire addressable
(NeoPixel-compatible: one data line, chainable, per-LED colour). This answers the group's open ask
("anyone identify the swaptx headset pins used to control the RGB LEDs?") — WS2812B needs just one
data GPIO + 5 V + GND, driven with any NeoPixel library. Relevant for any headset LED mod or our
own effect nodes.

## Cosmetics — painting & skins

Painting the BRX shell is discussed only lightly in the group; the dominant cosmetic route is
**3D-printed skins** rather than paint. What exists:
- **Paint prep:** a **base coat of black Krylon primer** (community tip) — prime the ABS/plastic
  first for adhesion, then top-coat. (Standard practice for painting a textured plastic tagger:
  clean/degrease → light scuff-sand → plastic-adhesion primer like Krylon Fusion → thin colour
  coats → matte/satin clear. The group specifically cites the black Krylon primer base.)
- **Labeling / team matching:** paint or **stickers** to match a gun to its headset and label
  pairs so they don't get mixed up at events (also applied to the ESP32/power-bank rider cover).
- **3D-printed skins** are the popular cosmetic + functional mod (e.g. SwapTX's swappable skins;
  members run modded taggers with printed skins, and want bigger printed skins like a sniper
  body). If we publish STLs (`hardware/`), printable skins/covers are a high-interest community item.
- **Decals** come up as an interest but no established process documented.

If you want painting depth, the group's painting threads are mostly **photo posts** (hard to
extract as text); browse the group's **Media** tab visually for painted examples.

## More repairs (from the group)

- **Reload handle stiff/binding:** a thin **nylon washer** (cut a disk from a soft clear plastic
  lid) between the handle and the assembly removes the friction; a light **silicone lube** (e.g.
  Specialist WD-40 Silicone) on the inner track makes it move smoothly. (Reload-button mods are
  the other route.)
- **D-pad button failures:** the button plastic **cracks from wear** — a known recurring failure.
  Parts can be pulled from a "parts gun" or potentially 3D-printed (no STL published yet — an open
  opportunity). Battle Company may sell the part.
- **Random power on/off:** usually the **power switch failing** (mechanical). See also the
  trigger-switch continuity test above for the fire-path.

## Reverse-engineering wanted by the community (open opportunities)

- **SwapTX headset PCBs (V2/V3)** — full trace maps + Gerbers wanted; base code is ~80% done but
  stalled. The headset RGB-LED control pins are unidentified.
- These are the same "map the board" gaps our hardware docs flag.
