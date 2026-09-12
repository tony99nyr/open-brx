# Superseded 2026-08-27 screen notes (from `docs/spec/loadout.md` §5)

Archived 2026-09-12 out of `docs/spec/loadout.md`, where it sat inside a `<details>` block "for grep
provenance only". The authoritative description of these screens is `docs/spec/design/mission-control.md`.

- **GAMES** (replaces BUILD in the stepper; Tony 2026-08-27 — "pick tonight's game" is a different job from
  "define a game"): `YOUR GAMES` row (saved cards: name, base-mode art, one-line summary, EDIT / DUPLICATE; `+ CREATE
  A GAME`) and `STOCK MODES` row (TDM / FFA / … with defaults; CUSTOMIZE opens the designer with that base). Tap a
  card → it is the game; a summary panel shows what players get; **VENUE** chips (indoor/outdoor, night — about
  where you play, not saved into the game; re-asserted after a game is applied); `CONTINUE ▸` to KIT. No forms.
  `State.active_preset_id` (set by `POST /api/presets/{id}/apply`, cleared by any non-venue `PUT /api/config`) is
  how GAMES knows which saved game is PLAYING — never by config content (a copy is identical to its source).
  Verbs: CUSTOMIZE (stock mode) · EDIT (your game) · COPY / MAKE MY OWN (open a draft named after the source;
  nothing is written until SAVE). Playing another card while the draft is TUNED — NOT SAVED asks once.
- **GAME DESIGNER** (a full-width page opened from GAMES via CREATE / EDIT / CUSTOMIZE — authoring, not a phase):
  one scrolling page — BASE (mode) → RULES (teams, time, score, respawn, health) → LOADOUT (PRIMARY / SECONDARY as
  two columns: who picks, the allowed pool as a tappable weapon grid with class quick-filters, fixed pick, perks) →
  NAME & NOTES — with a sticky summary rail (reads like the card will) holding `SAVE` / `SAVE AS NEW` / `PLAY THIS
  NOW ▸` (saves and jumps to KIT; an unnamed draft plays without being saved, and says so). Edits a DRAFT: nothing
  touches the live config until PLAY. The pool is computed ON THE CLIENT from the rules being edited (instant,
  server-independent — the same engine as `policy.py`); `POST /api/loadout/pool` only re-confirms the preset name.
  Class chips are ON / ◐ partial (n/N) / OFF; a tile dimmed by a chip is still tappable (allows just that weapon).
  A12: the secondary column's kind chips are `WEAPONS · SIDEARMS` (pistols only; mutually exclusive since "weapon"
  already admits pistols — the PERKS chip left with A14), the class chips gain `SIDEARM`, and the summary reads
  `SIDEARMS ONLY · 3 PISTOLS`. KIT's arsenal header Seg reads `SIDEARMS · n` for the same rule. OPEN / NO HEAVIES / SNIPERS are starting templates
  inside the designer, not match-night choices.
- *(superseded)* **BUILD** — "LOADOUT RULES" panel under GLOBAL SETTINGS: preset Seg `OPEN · NO HEAVIES · SNIPERS · CUSTOM`,
  `PLAYERS PICK ON PHONE` toggle, per-slot rows (choice Seg + pool summary "15 OF 18 · NO HEAVIES" + fixed picker),
  CUSTOM exposes tag chips + per-weapon include/exclude.
- **KIT** — roster rows: live state (`PICKING…` / `TRYING SMG` / `READY ✓`) + the loadout line `PRIMARY + SECONDARY ◆ PERK`.
  Detail: identity strip → **loadout rail** (PRIMARY / SECONDARY / PERK cards — A14; secondary is weapon | empty, perk is
  perk | empty) → arsenal for the selected slot (header carries the pool summary; out-of-pool tiles dimmed, no per-tile
  labels; the PERK slot shows the perk grid) → hero for the selected slot's item (perks: effects block instead of
  DMG/ROF/RNG). Fixed/off slots show a padlock and "SET IN BUILD". A14: picking Easy Reload over a loaded secondary (or
  the reverse) is a two-tap confirm on the tile ("DROPS THEIR SMG — TAP AGAIN"). Tablet ≤ 900 px: roster becomes a chip
  strip, cards stack.
- **GAME DESIGNER** LOADOUT section (A14): three columns PRIMARY / SECONDARY / PERK. The PERK column has WHO PICKS
  (player / host / fixed / off) and the perk grid; the SECONDARY column's kind chips are `WEAPONS · SIDEARMS` only.
