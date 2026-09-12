# Vision & viability — an open platform for BRX

**What this is:** an open (MIT) platform that turns stock Battle Company BRX taggers into a fully
orchestrated laser-tag system — game modes, live scoring, objectives, powerups, effects, mission
control — that is **moddable, self-hosted, and free of Edge's subscription and one-PC-one-location
lock**, and that **works on large fields without venue WiFi** (which Edge assumes).

The public platform page (`docs/platform/index.md`: `/`) carries a short, current version of
this pitch; it no longer carries the Edge comparison or the dated status board that used to back this
argument in detail (see `docs/architecture-topology.md` §7-8 for that detail now). The
definitive-manual-as-website idea that used to live here shipped as that site (`docs/manual/README.md`).
Trimmed 2026-09-06 to strategy + naming.

## Can we supersede Edge? — honest verdict

**For our audience (BRX owners / clubs / enthusiasts / small operators): yes, very viable.**
**As a wholesale replacement for Edge in large commercial arenas: no, not near-term.** The split:

**We can match — and beat on openness/cost/field-play — in software** (we have the fully decoded
protocol + the effect-node/subscriber architecture): game/mode management, custom weapons/classes/
abilities, killstreaks, live scoring, leaderboards, medals, accounts/progression, per-mode music +
event stingers + announcements, prop game logic (domination/CTF/bomb/respawn), themes, and
environmental effects (our effect nodes = Edge's UBox + Animatronics). Plus things Edge can't:
**MIT/self-hosted (no subscription — EDGE's own tiers run $599.99/6 mo to $1,599.99/yr — and no location lock), native open DMX/scripting, moddable, and
large-field play with no venue WiFi** — and **novel game modes Edge doesn't have**, headlined by a full
**Extraction (raid-and-extract) mode** (`extraction-design.md`).

**We can't quickly match Edge's moat:** product **maturity** (Edge 7.0, years of polish, ~6M
players, daily commercial use, support), a **global cloud/accounts/matchmaking network**, **marketing/
monetization tooling** (Battle Coin, Message Center), proven **scaling/reliability**, and the
**BRP+UBox hardware co-design**. We're specs + working software, a bench-proven Tier 0, two whole outdoor phone matches (2026-08-30 and
2026-09-01) and a 1v1 game test on the Mac (2026-09-11); they're a shipping product.

**The wedge:** BRX owners who don't want that subscription, clubs/meetups, small/mobile
operators, and the modding community (LaserTagMods ecosystem already exists). We win *there* by being
open, cheap, moddable, and field-capable — not by out-enterprising Edge for big arenas on day one.

## How much can we get out of the BRX? — nearly all of it

The BRX is effectively a **fully programmable IR-tag endpoint over BLE**, and we've decoded the
control surface: `$WEAP` (custom weapons), `$GSET`/`$PSET` (settings/loadouts, incl. the per-game player id),
`$SIR` (IR effects: damage, multipliers, heal, armor, shield, audio suppression), `$AMMO`/`$SPAWN` (go live),
the 2,477-file sound bank (+ USB sound-pack swap), and the `QUERY`/`SETUP` serial console. Because **the gun
holds no game state**, the host controls essentially everything the gun can do. The real limits are
ergonomic/physical, not protocol: no on-gun screen (the phone/rider adds it), no on-gun WiFi (the rider
provides it), and the built-in **nRF radio is unprobed** (D1) — potential free field-range upside.

## What the BRP does that the BRX can't (mostly hardware, not gameplay)

On-gun **LCD live scoring**; **built-in WiFi to Edge** + dual Bluetooth; **swappable/hot-swap
batteries**; **removable flip magazine** (XL) / **battery recoil + metal** (Metal); removable-SD custom
sounds (the BRX takes them over USB); powered-scope port; sunlight-visible head-sensor LEDs. **These are
ergonomics/durability/convenience — not different game logic.** Our **Companion rider** closes the
*functional* gap (WiFi, HUD, powerups, custom audio) in software + cheap hardware; the *physical* niceties are
molded into BRP and we can't retrofit them. Edge itself says **BRX can be used commercially** — the software
tier is the real gate, not the gun.

## What BRP + Edge does that we can't (the genuine gaps)

Commercial cloud (accounts, matchmaking, cross-venue leaderboards) · monetization/marketing tooling ·
polished prop hardware (UBox 20-in-1 + Animatronics DMX; we've specced effect nodes/stations, not hardened
them) · maturity & support · the **"Enemies" module** (head sensors that fight unpaired from a gun) · hardware
conveniences. Most of these are **catch-up work or hardware**, not fundamental blocks.

## Should it be open? — yes

The value is in serving a **small, passionate audience** (BRX owners + modders) that Edge underserves on
cost/openness/field-play. Open earns adoption, contributions, and credibility, and plugs into the existing
LaserTagMods ecosystem. The **"never modify firmware, control only via the documented BLE protocol"** stance
and the **restate-facts-don't-copy** policy are good defensive posture for interoperability work.

## Should it be a business? — yes, as open-core + hardware + service (with eyes open)

1. **Sell assembled hardware** — Companions, effect nodes/stations, kits — open firmware, paid units. Most
   concrete revenue.
2. **Optional hosted service** — cloud accounts/leaderboards/cross-venue for those who want it.
3. **Services** — setup, event operation, custom modes/sound packs, STLs.

**Risks:** dependence on Battle Company's hardware (they control the firmware; mitigate long-term by supporting
multiple tagger brands — JBOX already spans BRX/Evolver/LTTO); a small market (realistic outcome is a
lifestyle/side business unless it broadens to a multi-brand open laser-tag platform); trademark (don't name it
"Edge" or imply endorsement); legal (interoperability reverse-engineering is generally defensible, a commercial
product invites more scrutiny — keep the clean-room, facts-not-code discipline).

### The Companion as the flagship product (post-`$SFLASH`, 2026-08-25)

The `$SFLASH` capture (protocol §7o, ADR-0001) upgrades the Companion's product case: it reconstructs the gun's
**own** native feedback over BLE — the green-sight kill flash *and* the kill/killstreak audio — so it delivers
the **full native feel at a ~$15 BOM, with no speaker or screen**. Cheaper and more capable than the existing
DIY riders. **Sell tiers:** assembled unit · kit · files-only · fleet bundle (Companions + Mission Control).
**The gate — reliability:** before selling anything, nail the BLE-drop / "SCREAMERS" re-pair problem, a durable
mount, OTA + pairing, and real multi-session field play; plan for the support burden. **Sequencing: prove →
open-source → let demand pull.**

## Naming

- **Project (OSS):** **"Open BRX"** — descriptive, references the hardware it serves (nominative/fair use).
- **Avoid "Open Edge"** — Battle Company's product name; implies affiliation; trademark risk.
- **For a business brand,** pick an **original, ownable name not derived from a competitor's product**, ideally
  not locked to "BRX" so it survives going multi-brand. Candidates (verify trademark + `.com` + handles):
  **Salvo**, **TagForge**, **Sortie**, **Skirmish**; also Volley · Muster · Redoubt · Ironsight · Killhouse ·
  Fireteam · Vantage; platform-flavoured TagOS · ArenaOS.
- **"IRL" (In Real Life)** works as a tagline/experience layer, not the ownable mark: "real-life video game" is
  already the category's de-facto tagline (Classified/iCOMBAT, TAG, NxGn) and "IRL" is a generic acronym with
  baggage from the defunct social app.
- **Adopted one-line pitch:** **"Video game inspired tactical laser tag — open and self-hosted."**
- **Structure:** brand = an original name; the open project stays **Open BRX**; the positioning is
  "video-game-inspired tactical laser tag"; a hosted service can be *"<Brand> Cloud."* Trademark-screen the
  finalist (USPTO/TESS + EUIPO) and grab the domain + handles before any public use.

## Bottom line

**Supersede Edge for BRX owners: realistic and worth doing.** Replace Edge across commercial arenas: not the
near-term goal. Get ~all of the BRX's capability: yes. The honest strategy is **open project + open-hardware/
service business, aimed at the enthusiast/club/small-operator/modder segment**, with a **multi-brand platform**
as the long-term expansion if it gains traction. Start open, let hardware/service demand prove itself before
betting big.
