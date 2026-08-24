# Battle Company EDGE + Battle Rifle Pro — competitive study & parity targets

Factual study of Battle Company's commercial stack (the **EDGE** game engine and the **Battle Rifle
Pro / XL / Metal** hardware) to set feature targets for our open BRX platform — especially
environmental effects. Not copied; marketing paraphrased. Sources at the bottom.

## EDGE software (v7.0, Jan 2026) — what it is

A Windows PC game engine every Battle Company tagger connects to (license: **one computer, one
location**), plus an **EDGE Terminal** tablet admin app and the **CallSign** player phone app
(iOS+Android). A global cloud backend handles accounts/CallSign.

**Game/modes:** 35 customizable preset modes + unlimited custom presets (grouped into staff
categories); 90+ weapons via a builder; 15 abilities (power weapons, missiles, air strikes, care
packages); 9 melee weapons; player-types/classes with loadouts; special-rules engine; **killstreak
system** (15+, COD-style, activated from CallSign); damage/effect types (ice/poison/shields/heal);
**Battle Royale** (shrinking area, loot, squads); **Arcade** (wave/live-actor throughput).

**Scoring/analytics:** real-time live scoring, post-game scoreboards, game history, medals/
achievements, configurable **leaderboards** (daily/weekly/monthly/session).

**Accounts/progression:** CallSign = phone HUD + stats/medals/levels/reward unlocks; **login
auto-assigns a gun**; lobby add/remove/edit players live.

**Ops/monetization:** offline guest play + cloud accounts; Battle Coin currency + EDGE Store upsell;
Message Center (push/email/templated marketing); **Themes** (per-arena reskin of displays).

**Networking (partly unpublished):** local Windows PC + cloud backend; taggers connect **over WiFi**
to EDGE; Bluetooth is gun→headset and gun→phone. ⚠ The WiFi infrastructure spec (APs/base stations),
concurrent-tagger limits, and offline-vs-cloud split are **not published**.

## EDGE environmental effects — via the UBox + "Animatronics"

This is EDGE's immersion headline and its **moat**, delivered through the **Utility Box (UBox)**:
- EDGE drives **lights, smoke/fog machines, speakers, and moving props** tied to game events —
  e.g. dimming lights as a Battle-Royale storm closes, highlighting resupply zones, an "Exploding
  Room" effect. Feature name: **Animatronics** (EDGE 5.0+).
- **DMX lighting** is demonstrated (Battle Company FB video: "Utility Box with DMX lighting and the
  EDGE software"). ⚠ Whether DMX is native to EDGE or routed through the UBox relay is **not
  documented** — treat "DMX + relays via UBox" as the model, mechanism unconfirmed.
- **Sound/music:** a **unique soundtrack per game mode** over the venue PA + per-game SFX +
  announcements. Taggers carry **2000+ on-device SFX** (≈ our 2166-id bank, `sound-bank.md`).
- The **UBox is the physical bridge** — one hardware unit **reconfigured in software** to be any of
  **20+ box types**. It's a networked relay/effect-node + prop controller that "fully integrates to
  the EDGE engine."

### UBox = one hardware unit, 20+ roles (validates our single-station-primitive design)
Domination / King-of-the-Hill / Control Point · Capture the Flag · **Bomb Defuse** (with **"Order
Activation"** — chaining one box's function to actions at another) · Respawn stations · Weapon /
Armor / Health / Ammo dispensers · Target / Cover / Streak / **Proximity Mine** · **Bullseye Smart
Target** (live-scoring target) · hands-free "Ping/Damage" activation.

## Hardware: BRP / XL / Metal vs. our BRX

- **Battle Rifle Pro (BRP):** commercial flagship — nylon-fiberglass, button reload, vibration,
  **dual Bluetooth + built-in WiFi to EDGE**, **on-device LCD live scoring**, 2000+ SFX + **SD-card
  custom sounds**, USB drag-and-drop firmware, 8 preset + 3 custom weapon slots (primary+secondary),
  600+ ft day / 700+ night Class-1 laser, **swappable battery** (in/out-of-gun charge), powered
  scope port, front health LEDs, gun sensor for fast turnover. Head sensors: sunlight-visible LEDs,
  360° to ~30 ft.
- **BRXL:** larger, **removable flip magazine**.
- **BRM (Metal Hybrid):** metal receiver, **battery-powered recoil** (hot-swap battery), multi-stage
  charging-handle reload, strongest audio.
- **What BRP+EDGE does that stock BRX can't:** commercial EDGE suite, on-gun LCD scoring, swappable/
  hot-swap batteries for all-day ops, **removable-SD** custom sounds + bigger built-in library (the BRX also takes custom sounds, over
USB — `community-notes.md`), deep UBox/Animatronics prop
  & effects integration. **Important:** EDGE explicitly says **BRX can be used commercially too** —
  the **software tier is the gate, not just the gun.**

## Pricing / model
- EDGE **Seasonal** $599.99/6 mo · **Pro** $1,199.99/yr · **Enemies** $1,599.99/yr. All include
  unlimited modes/weapons/player-types, ranking/rewards, Terminal, CallSign, **audio + accessory/prop
  control**, cloud storage. One PC / one location; buy online then request a key.
- **Enemies Edition** unlocks the **Enemies module**: program **headsets to emit/receive damage
  independent of any gun** — place them on live actors or around the arena for walk-through
  attractions / target galleries / story experiences (own "Enemies App").
- Hardware is contact-sales (16-unit business bundles; BRP ~$650 legacy figure). ⚠ The earlier
  "~$999/yr Core Package" could **not** be confirmed — closest live tier is Pro $1,199.99/yr; treat
  $999 as outdated.

## Parity targets for our open platform

**Already matchable in software** (we have the decoded protocol + effect-node/subscriber bus):
game/mode management, weapon/class/ability presets, **killstreaks**, **live scoring + leaderboards +
medals + history**, accounts/progression (our per-player node ≈ CallSign), **sound/music per mode +
event stingers/announcements over a PA** (free — laptop audio), lobby/live control, offline play,
terminal/admin UI, **themes/skinning**, and all **prop game logic** (domination/respawn/bomb-defuse-
chaining/CTF/control points).

**Needs the hardware we've specced** (our effect-node/station = their UBox+Animatronics):
- **Environmental effects** (smoke/fog, lighting, **DMX**, relays, moving props) → ship effect nodes
  with **relay + DMX output**. This is Battle Company's key moat.
- **Multi-purpose station** (respawn/domination/ammo/health/target) → our station spec = their UBox
  20-in-1. Add **"order activation"** chaining (one station's event triggers another) — cheap in our
  MQTT bus.
- **"Enemies"-style standalone head sensors** (fire/take damage unpaired from a gun) → a
  differentiating target; the headset's ARGB is WS2812B (`community-notes.md`).
- Hardware niceties (hot-swap batteries, on-gun LCD, sunlight LED sensors) — not our layer (stock BRX).

**Where we can differentiate / leapfrog:**
- **Native, open DMX + scriptable effects** (their DMX is UBox-mediated and closed).
- **Open networking** (they don't publish WiFi/base-station scaling; ours is documented + pluggable).
- **No per-location license, no $600–1,600/yr subscription** — MIT, self-hosted.
- **Field play without venue WiFi** (our station-mesh + data-mule model, `field-architecture.md`) —
  Edge assumes venue WiFi coverage.

## Sources
battlecompany.com/software, /accessories (UBox), the EDGE 3.0/4.0/5.0/7.0 posts, the UBox-DMX
Facebook video; lasertagpro.com/battle-rifle-pro, /equipment, /subscribe-to-edge (pricing),
/metal-hybrid; battlecompany.net commercial portal. Flagged unverified: WiFi/base-station spec,
UBox DMX/relay mechanism, the $999 package, current per-unit hardware pricing.
