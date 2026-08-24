# Vision & viability — an open platform for BRX

**What this is:** an open (MIT) platform that turns stock Battle Company BRX taggers into a fully
orchestrated laser-tag system — game modes, live scoring, objectives, powerups, effects, mission
control — that is **moddable, self-hosted, and free of Edge's subscription and one-PC-one-location
lock**, and that **works on large fields without venue WiFi** (which Edge assumes).

## Can we supersede Edge? — honest verdict

**For our audience (BRX owners / clubs / enthusiasts / small operators): yes, very viable.**
**As a wholesale replacement for Edge in large commercial arenas: no, not near-term.** The split:

**We can match — and beat on openness/cost/field-play — in software** (we have the fully decoded
protocol + the effect-node/subscriber architecture): game/mode management, custom weapons/classes/
abilities, killstreaks, live scoring, leaderboards, medals, accounts/progression, per-mode music +
event stingers + announcements, prop game logic (domination/CTF/bomb/respawn), themes, and
environmental effects (our effect nodes = Edge's UBox + Animatronics). Plus things Edge can't:
**MIT/self-hosted (no $600–1,600/yr, no location lock), native open DMX/scripting, moddable, and
large-field play with no venue WiFi** (the station-mesh + data-mule model).

**We can't quickly match Edge's moat:** product **maturity** (Edge 7.0, years of polish, ~6M
players, daily commercial use, support), a **global cloud/accounts/matchmaking network**, **marketing/
monetization tooling** (Battle Coin, Message Center), proven **scaling/reliability**, and the
**BRP+UBox hardware co-design** (below). We're specs + a working CLI; they're a shipping product.

**The wedge:** BRX owners who don't want a $1,200/yr subscription, clubs/meetups, small/mobile
operators, and the modding community (LaserTagMods ecosystem already exists). We win *there* by being
open, cheap, moddable, and field-capable — not by out-enterprising Edge for big arenas on day one.

## How much can we get out of the BRX? — nearly all of it

The BRX is effectively a **fully programmable IR-tag endpoint over BLE**, and we've decoded the
control surface: `$WEAP` (custom weapons), `$GSET`/`$PSET` (settings/loadouts), `$SIR` (IR effects),
`$AMMO`/`$SPAWN` (go live), `$GREN` (grenade objective modes), the 2166-id sound bank (+ USB sound-
pack swap), and the `QUERY`/`SETUP` serial console (incl. a settable `PlayerID`). Because **the gun
holds no game state**, the host controls essentially everything the gun can do. Functional ceiling
is **very high** — the real limits are ergonomic/physical, not protocol:
- No on-gun screen/HUD (BRX has none) — we add it on the rider/phone.
- No on-gun WiFi — the rider (Companion) provides it.
- IR hit carries shooter **team, not player** — fixable by setting `PlayerID` via `SETUP` (P2).
- The built-in **nRF radio is unprobed** — potential free field-range upside (D1).

## What the BRP does that the BRX can't (mostly hardware, not gameplay)

On-gun **LCD live scoring**; **built-in WiFi to Edge** + dual Bluetooth; **swappable/hot-swap
batteries** for all-day ops; **removable flip magazine** (XL) / **battery recoil + metal** (Metal);
larger built-in sound library + **removable-SD** custom sounds (note the BRX also takes custom sounds,
just over USB — §sound-swap); powered-scope port; sunlight-visible head-sensor LEDs; a gun
sensor for fast turnover. **These are ergonomics/durability/convenience — not different game logic.**
Our **Companion rider** closes the *functional* gap (WiFi, HUD, powerups, custom audio) in software +
cheap hardware; the *physical* niceties (LCD, hot-swap, flip mag, metal, recoil) are molded into BRP
and we can't retrofit them. Note Edge itself says **BRX can be used commercially** — the software
tier is the real gate, not the gun.

## What BRP + Edge does that we can't (the genuine gaps)

- **Commercial cloud** — accounts, matchmaking, cross-venue leaderboards, the ~6M-player network.
- **Monetization/marketing tooling** — Battle Coin, EDGE Store, Message Center (push/email/segments).
- **Polished prop hardware** — the UBox 20-in-1 + Animatronics DMX integration (we've *specced*
  effect nodes/stations; we haven't *built and hardened* them).
- **Maturity & support** — a turnkey product used in real arenas daily; reliability at scale.
- **The "Enemies" module** — head sensors that fight unpaired from a gun (walk-through attractions).
- **Hardware conveniences** — LCD scoring, hot-swap batteries, sunlight sensors.

Most of these are **catch-up work or hardware**, not fundamental blocks. None require anything the
BRX protocol can't do; they require *building and polishing*.

## Should it be open? — yes

Open-source is the right strategy for this niche, not a giveaway:
- The value is in serving a **small, passionate audience** (BRX owners + modders) that Edge underserves
  on cost/openness/field-play. Open earns adoption, contributions, and credibility, and plugs into the
  existing LaserTagMods ecosystem.
- The **"never modify firmware, control only via the documented BLE protocol"** stance and the
  **restate-facts-don't-copy** policy are good defensive posture for interoperability work.

## Should it be a business? — yes, as open-core + hardware + service (with eyes open)

Viable models, compatible with open-source:
1. **Sell assembled hardware** — Companions, effect nodes/stations, kits — open firmware, paid units
   (classic open-hardware business; modders DIY, everyone else buys). Most concrete revenue.
2. **Optional hosted service** — cloud accounts/leaderboards/cross-venue for those who want it
   (open core, paid convenience).
3. **Services** — setup, event operation, custom modes/sound packs, STLs.

**Risks to go in with:**
- **Dependence on Battle Company's hardware** — they control the firmware and could change it or view
  you as competitive (they reportedly shelved the SwapTX headset for being *too* competitive with
  BRP). Mitigate long-term by supporting **multiple tagger brands** (JBOX already spans BRX/Evolver/
  LTTO) or your own hardware.
- **Small market** — BRX is niche prosumer; realistic outcome is a **lifestyle/side business or a
  small hardware+service company**, not a big venture — unless you broaden to a **multi-brand open
  laser-tag platform**, which is the real large-TAM play.
- **Trademark/branding** — don't name it "Edge" or imply Battle Company endorsement (see below).
- **Legal** — reverse-engineering for interoperability is generally defensible (esp. US), but a
  *commercial* product invites more scrutiny; keep the clean-room, facts-not-code discipline.

## Naming

- **Project (OSS):** **"Open BRX"** is good — descriptive, references the hardware it serves
  (nominative/fair use), community-friendly. Fine to rename the repo to it.
- **Avoid "Open Edge"** — "Edge" is Battle Company's product name (and Microsoft's browser);
  it implies replacement/affiliation and is a trademark risk for a business.
- **For a business brand,** pick an **original, ownable name not derived from a competitor's product**
  (trademark-check it). It can sit *above* the open "Open BRX" project (brand = the company/hosted
  service; project = the open codebase). If you later go multi-brand, an original name ages better than
  "Open BRX."

## The definitive BRX manual — a high-polish public website

Beyond the platform, ship **the definitive BRX reference as a beautifully-designed public website** —
the single best, most complete manual for the BRX **tagger and headset** anywhere. No such thing
exists today: Battle Company's V7 quick manual and the 2018 Extended Guide are partial and scattered,
and the real knowledge is spread across PDFs, a Facebook group, and LaserTagMods' repos. **We've
already aggregated more than any single source** (`docs/reference/*`, `protocol/*`,
`callsign-extract/*`) — this turns that into a polished, authoritative product.

**Why it matters (strategically):**
- **Authority + community magnet** — becomes *the* place BRX owners land (SEO: "BRX manual", "BRX
  reload mod", "BRX sound files", "BRX headset pairing", "BRX won't fire").
- **Funnel** — the free definitive manual draws the audience; the platform, hardware (Companion,
  stations, kits), and hosted service are the offer. Classic open-content → product funnel.
- **Credibility** — a high-polish reference signals the project is serious and trustworthy.

**Scope — everything we have on tagger + headset:**
- Hardware anatomy (tagger + headset, ports, buttons, LEDs, battery, IR/laser specs 980nm/38kHz).
- Quick start, sighting/zeroing, indoor/outdoor mode, target mode.
- Pairing: headset (incl. the Gen-3 re-pair procedure), grenade/accessories (IR pairing), phone.
- Firmware + **sound-pack updates over USB** (SELECT-hold-boot → AUDIO folder).
- Game modes, weapons, classes/factions, perks, killstreaks.
- The **searchable 2166-id sound bank** with the meaning map (weapon sounds, cues, voice packs).
- The **serial console** (QUERY/SETUP) and settable PlayerID — a developer/power-user section.
- Repairs & troubleshooting (won't-fire ladder, battery polarity, reload-handle fix, D-pad, power switch).
- Mods & accessories (reload-button mod, JEDGE/Companion riders, scope, phone bracket, grenade).
- A **developer section**: the full BLE protocol reference (`brx-protocol.md`) + the decoded command/
  field maps — the interoperability spec.

**Presentation bar (extremely high polish):**
- Fast, responsive, dark-mode, searchable; clean typographic design; **interactive** where it earns
  it — a **searchable/filterable sound-bank table**, copy-to-clipboard command snippets, annotated
  hardware diagrams, expandable protocol tables. Feels like first-class product documentation, not a
  wiki dump.

**Build path:** author as a static site (the repo's `webapp/`, or a docs-site generator) so it
deploys free/cheap and updates by redeploy; a polished **Artifact** is a good way to prototype the
design and key interactive pieces (e.g. the sound-bank explorer) before committing to the full site.

**Sourcing/policy (important for a public site):** aggregate and **restate facts with credit**
(Battle Company manuals, LaserTagMods/JEDGE-JBOX, the owner community incl. David Knox's audio map) —
**link** official PDFs rather than rehosting copyrighted assets, and keep the restate-don't-copy
discipline (matters more now that it's public and possibly commercial).

## Brand name candidates (business side)

The OSS project is **Open BRX** (repo: `open-brx`). For the *business/brand* above it, pick an
original, trademarkable name — **not** derived from a competitor's product, not an existing laser-tag
brand (avoid Photon / Laser Tag Pro / Battle Company faction names), and ideally **not locked to
"BRX"** so it survives going multi-brand. Candidates (verify trademark + `.com` + social handles
before committing):

**Top picks (platform + tactical, ownable):**
- **Salvo** — a coordinated volley of fire; short, punchy, tech-brandable. (`salvo.gg`/`playsalvo`.)
- **TagForge** — "tag" + "forge" (build/mod); captures the open/maker platform ethos directly.
- **Sortie** — a combat mission/op; distinctive, one word, aviation-military flavor.
- **Skirmish** — light battle; strong laser-tag fit (check availability — somewhat common).

**Also strong:**
- **Volley** · **Muster** (rally troops) · **Redoubt** (a fortification — objectives vibe) ·
  **Ironsight** · **Killhouse** (CQB training) · **Fireteam** (squad) · **Vantage**.

**Platform-flavored (if you want an "OS for laser tag" feel):**
- **TagOS** · **Arena Kit / ArenaOS** · **OpenArena** (taken — avoid) · **Volley Stack**.

**Naming structure recommendation:** brand = an original name above (e.g. *Salvo* / *TagForge*); the
open project stays **Open BRX**; a hosted service can be *"<Brand> Cloud."* Keep "BRX" only in the
open-project/descriptive layer, not the company brand, so multi-brand expansion isn't boxed in.
Trademark-screen the finalist (USPTO/TESS + EUIPO) and grab the domain + handles before any public use.

## Bottom line

**Supersede Edge for BRX owners: realistic and worth doing.** Replace Edge across commercial arenas:
not the near-term goal. Get ~all of the BRX's capability: yes. The honest strategy is **open project +
open-hardware/service business, aimed at the enthusiast/club/small-operator/modder segment**, with a
**multi-brand platform** as the long-term expansion if it gains traction. Start open, let hardware/
service demand prove itself before betting big.
