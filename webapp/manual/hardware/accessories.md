# Grenade and accessories
_What each add-on physically is. How to use them lives in the Accessories & Stations section._
Last verified: 2026-08-27

_[image HW-07: (see Images table)]_

## Smart Grenade — anatomy
✅
- **Top button** — power on, mode setup (hold), and manual detonation / respawn trigger.
- **Safety clip** — pop it to power up.
- **3 IR emitters + 1 emitter/receiver** — it *broadcasts* over IR (state beacons every few seconds) and *receives* shots (it flashes white when hit).
- **Status LED** — green at boot = ready; in setup it cycles **red · green · blue · yellow · white** (Frag · Assault · Hill · Respawn · CTF); white when a mode locks; on boot it flashes the stored mode's colour for ~1 s.
- **USB-C** — **charge/power only.** It exposes no data interface (tested off, on and in setup mode on a known-good cable) and has no PROGRAM pin.
- **No pairing for objective modes** — as a respawn point, hill or flag any tagger interacts with it over IR. IR pairing is only needed to use it as a *thrown* grenade tied to your headset.
Source: docs/reference/grenade.md, docs/reference/brx-extended-user-guide.md

The grenade, like the tagger, **keeps no game state and cannot show a winner** — it is an IR objective/effect emitter. Everything you *hear* from a grenade event (explosion, "control point captured", the CTF music) is actually played by the taggers and headsets from their own sound banks.
Source: docs/reference/grenade.md

Other accessories
| col 1 | col 2 | col 3 |
|---|---|---|
| **Hatchet, shield, sidearm** | IR-paired accessories (paired the same way as a thrown grenade); each has a PROGRAM button for USB firmware updates | 📖 |
| **Scope** | An optical sight; zeroed using the tagger's Target Mode. Snipers sight long, shotgun/SMG short | 📖 👥 |
| **Phone bracket** | Mounts a phone for the Callsign app. The community also uses it to carry an ESP32 + USB power bank rider (JEDGE-style) with **no permanent modification** to the tagger — a 5,000 mAh pack runs such a rider ~15 h | 👥 |
| **Sling mount** | Community drill size for a sling stud: **7/32"** (15/64" is too loose) | 👥 |
| **Utility Box (UBox)** | Battle Company's commercial station: one networked box reconfigured in software into 20+ roles (domination, CTF, bomb, respawn, dispensers, targets). Part of the EDGE commercial suite, not the BRX consumer kit | 📖 |
| **3D-printed skins** | The dominant cosmetic mod; paint is rare (black plastic primer base coat if you do) | 👥 |
Source: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/reference/lasertagmods.md, docs/reference/edge-brp.md

## Known wear points (anatomy-level; fixes are in Repairs)
- **D-pad buttons** — the plastic cracks with use; the most common failure. 👥
- **Power switch** — random power on/off almost always means the switch. 👥
- **Reload handle** — can bind; a thin nylon washer and silicone lube fix it. Its switch is testable with a pen. 👥 📖
- **IR emitters** — do eventually die; the emitter and headset receivers are separately replaceable parts. 👥 📖
Source: docs/reference/community-notes.md, docs/reference/brx-manual-notes.md
