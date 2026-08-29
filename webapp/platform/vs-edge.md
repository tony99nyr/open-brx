# Open BRX vs Edge
_What we match, what we beat, and what we can't do. Honestly._
Last verified: 2026-08-27

Battle Company's **EDGE** (v7.0, Jan 2026) is a mature commercial Windows engine with years of polish, ~6M players and daily arena use. Open BRX is specs plus working software plus a bench-proven Tier 0. The facts below are paraphrased from Battle Company's public pages, and nothing is copied. Open BRX is not affiliated with Battle Company.
Source: docs/reference/edge-brp.md, docs/VISION.md §Can we supersede Edge

| | **Edge + BRP** | **Open BRX** |
|---|---|---|
| **Price** | $599.99 / 6 mo · $1,199.99 / yr · $1,599.99 / yr (Enemies) | **$0 · MIT, self-hosted** ✅ |
| **Licence scope** | one computer, one location | any laptop, any field ✅ |
| **Venue network** | taggers connect to Edge over venue Wi-Fi (infrastructure spec unpublished) | **no venue Wi-Fi assumed**. The field is an island, and nodes store-and-forward 🧪 |
| **Cloud** | global accounts, matchmaking, cross-venue leaderboards | none in the loop; a hosted service is a future idea ❌ |
| **Game modes** | 35 preset + unlimited custom | TDM ✅ · FFA / Infection / LMS / CS / Domination / KotH / CTF / **Extraction** engines 🧪 |
| **Novel modes** | Battle Royale, Arcade | **Extraction (raid-and-extract)**: Edge has nothing like it 🧪; BR specified 📐 |
| **Weapons / classes / abilities** | 90+ weapons, 15 abilities, 9 melee, classes | full `$WEAP` control; all 19 Callsign weapons captured (20 frames) and rebalanced; perks (Body Armor, Extended Mags, Quick Hands, Easy Reload) ✅/🧪 |
| **Killstreaks / medals / announcer** | 15+ COD-style streaks | first-blood, multikill and streaks driven to the gun's own speaker and green-sight flash ✅ (mechanism) / 🧪 (in-match) |
| **Live scoring + recap** | real-time, leaderboards, history | live board with staleness + recap/CSV 🧪; results settle a little late by design |
| **Per-player HUD** | CallSign phone app (iOS + Android) | BRX Combat HUD: native, blackout night mode ✅ single-gun |
| **Props / objectives** | Utility Box: one unit, 20+ roles; "Order Activation" chaining | Utility Box design: one box, every objective, MC-programmable 📐; IR emit proven ✅ |
| **Environmental effects** | Animatronics: lights, smoke, DMX, moving props (closed) | same event model; **native open DMX + scripting** 📐 |
| **Custom sounds** | 2000+ on-gun SFX, SD card on BRP | 2,166-id bank decoded ✅; USB sound-pack swap on the BRX ✅; unlimited via Companion audio 📐 |
| **Marketing / monetisation** | Battle Coin, EDGE Store, Message Center, Themes | none ❌ |
| **"Enemies" module** | headsets that fight unpaired from a gun | not built ❌ (a differentiating target) |
| **Hardware niceties (BRP)** | on-gun LCD scoring, hot-swap batteries, flip mag, recoil, sunlight-visible sensors | can't retrofit, the BRX is what it is ❌; the phone or Companion adds the HUD |
| **Maturity / support** | shipping product, daily commercial use | bench-proven Tier 0, software-tested Tier 1, no field seasons yet ❌ |
| **Moddability** | closed | open protocol docs, open firmware, open STLs, MIT ✅ |
| **Firmware** | Battle Company's | **stock BRX firmware, never modified** ✅ |
Source: docs/reference/edge-brp.md, docs/VISION.md, docs/HANDOFF.md

## The honest verdict.
For BRX owners, clubs, meetups and small operators this is very viable. We match Edge in software, beat it on cost, openness and no-Wi-Fi field play, and add modes it does not have. As a full replacement for Edge in large commercial arenas: no, not any time soon. Maturity, cloud accounts, monetisation tooling and hardened prop hardware are real gaps. Edge itself notes the BRX can be used commercially, so the software tier is the gate, not the gun.
Source: docs/VISION.md §Can we supersede Edge
