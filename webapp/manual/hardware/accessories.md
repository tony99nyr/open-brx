# Grenade and accessories
_What each add-on physically is. How to use them lives in the Accessories & Stations section._
Last verified: 2026-08-27

_[image HW-07: (see Images table)]_

## Smart Grenade: anatomy
✅
- **Top button**: powers it on, sets the mode (hold it), and sets off a blast or a respawn by hand.
- **Safety clip**: pop it off to power up.
- **3 IR emitters + 1 emitter/receiver**: it *broadcasts* over IR with a state beacon every few seconds. It also *receives* shots, and flashes white when hit.
- **Status LED**: green at boot means ready. In setup it cycles **red · green · blue · yellow · white** (Frag · Assault · Hill · Respawn · CTF). It turns white when a mode locks in. At boot it flashes the stored mode's colour for ~1 s.
- **USB-C**: **charge and power only.** It shows no data interface at all, and it has no PROGRAM pin. We tested it off, on and in setup mode with a known-good cable.
- **No pairing for objective modes**: as a respawn point, hill or flag, any tagger can work with it over IR. You only need IR pairing to throw it as a grenade tied to your headset.
Source: docs/reference/grenade.md, docs/reference/brx-extended-user-guide.md

Like the tagger, the grenade **keeps no game state and cannot show a winner**. It is an IR emitter for objectives and effects. The taggers and headsets really play every sound you *hear* from a grenade event. That covers the explosion, "control point captured" and the CTF music, all from their own sound banks.
Source: docs/reference/grenade.md

Other accessories
| col 1 | col 2 | col 3 |
|---|---|---|
| **Hatchet, shield, sidearm** | Accessories you pair over IR, the same way as a thrown grenade. Each has a PROGRAM button for USB firmware updates | 📖 |
| **Scope** | An optical sight. You zero it with the tagger's Target Mode. Sight snipers long and shotguns or SMGs short | 📖 👥 |
| **Phone bracket** | Holds a phone for the Callsign app. Owners also use it to carry an ESP32 and a USB power bank rider (JEDGE-style). That needs **no permanent modification** to the tagger. A 5,000 mAh pack runs such a rider ~15 h | 👥 |
| **Sling mount** | Community drill size for a sling stud: **7/32"** (15/64" is too loose) | 👥 |
| **Utility Box (UBox)** | Battle Company's commercial station. It is one networked box that software can switch into 20+ roles (domination, CTF, bomb, respawn, dispensers, targets). It belongs to the EDGE commercial suite, not the BRX consumer kit | 📖 |
| **3D-printed skins** | The most popular way to change how a tagger looks. Paint is rare (use a black plastic primer base coat if you do) | 👥 |
Source: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md, docs/reference/lasertagmods.md, docs/reference/edge-brp.md

## Known wear points (anatomy-level; fixes are in Repairs)
- **D-pad buttons**: the plastic cracks with use. This is the most common failure. 👥
- **Power switch**: a gun that turns itself on and off almost always needs a new switch. 👥
- **Reload handle**: it can bind. A thin nylon washer and silicone lube fix that, and you can test its switch with a pen. 👥 📖
- **IR emitters**: they do die in the end. The emitter and the headset receivers are separate replaceable parts. 👥 📖
Source: docs/reference/community-notes.md, docs/reference/brx-manual-notes.md
