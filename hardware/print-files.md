# BRX 3D print files — what exists (and the gap)

Researched 2026-08-24 (FB group + Thingiverse/Printables/STLFinder/Cults). **Bottom line: there is
no public library of BRX-specific print files.** The major repos (Printables, Thingiverse, STLFinder,
Cults) return **zero** Battle-Company-BRX models — only generic laser-tag gear (LTAR, Laser X, Recoil).
BRX files are shared **peer-to-peer inside the owner community**, not published. This is a real gap our
MIT `hardware/` directory can fill.

## What the community actually has (shared privately)

- **Reload-handle → push-button mod** — the most established BRX print. Replaces the pull-back reload
  handle with a button (easier to store/transport a fleet of taggers). YouTube tutorial:
  "Battle Company BRX Laser Tag Gun Reload Button Modification" (youtube.com/watch?v=JUP5ixjEZHw).
  An STL circulates in the FB group (Jon Haidet); people pay ~$35–50 for a printed 5-pack or the STL
  via Venmo. **Gotcha: older vs newer BRX models differ** — one member printed the wrong-version handle.
  A community fix (nylon washer + silicone) also addresses handle friction (`community-notes.md`).
- **JEDGE ESP32 rider mount / clip-on cover** — part of the JEDGE build (the San Diego / SoCal group's
  build docs; Jay Burden's instructions). A USB power bank + ESP32 held by the phone bracket, with a
  clip-on end cover; battery/ESP32 slide out for maintenance. No permanent BRX mod.
- **"3D printed skins"** — David Knox runs modded taggers with printed skins, but these are **SwapTX**
  custom work, not published; interest exists in bigger skins (e.g. a sniper body). No public files.
- **D-pad replacement buttons** — wanted (the D-pad button plastic cracks from wear) but **no STL exists
  yet** — an explicit open ask in the group. Good first contribution.

## Official / adjacent

- Battle Company sells the **phone bracket** (battlecompany.com/product/brx-phone-bracket/).
- **LaserTagMods JBOX** repo ships printable **enclosures** (Box V5 / Disk / Mini) + PCB Gerbers — for
  the JBOX accessory, not BRX skins, and **unlicensed** (facts only, don't copy files;
  `docs/reference/lasertagmods.md`).

## Opportunity for this repo's `hardware/`

Since no open BRX print library exists, ours could become the canonical one — all MIT, all
version-tagged (the older/newer-model gotcha matters):
1. **Reload-button mod** (clean-room STL; the highest-demand part).
2. **D-pad replacement buttons** (nobody has published these; explicitly requested).
3. **BRX Companion mount + ported audio enclosure** (`hardware/brx-companion-spec.md`) — clips to the
   rail/phone bracket, no gun mod.
4. **Objective-station / effect-node enclosures.**
5. Optional decorative **skins/covers**.

## Related hardware facts (for our own parts)

- **IR receiver** the community IDs on the BRX is a Vishay **TSSP38 / TSSP77P38** (38 kHz) — the part
  to use in our objective-station receivers (datasheet: vishay.com/docs/82481/tssp77p38.pdf). Pairs with
  the 25-bit / 38 kHz IR tag encoding in `docs/reference/lasertagmods.md`.
