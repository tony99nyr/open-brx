# Design round 1 — what came back, and the deltas for round 2

Round 1 (`Open BRX Site.dc.html`, eight frames 1a–1h + a handoff README) was produced against the brief
*before* three rules landed. The visual direction is right and stays; these are the corrections to
carry into the next pass.

## Keep (it's good)
- Type system (Oswald / Inter / JetBrains Mono), the near-black navy ground, badges as pills, code blocks
  that stay dark in both themes, the placeholder treatment (blue = generate, amber = real photo).
- Frames 1d (reference page with hotspots), 1e (weapons explorer with a 2-pick comparator), 1g (ladder
  with Yes→fix / No→next) — these are the site.
- The "static home, changelog is the record" call.

## Change

1. **Remove the ❓ "unconfirmed" badge from the component sheet.** The manual is known-facts-only now;
   nothing unconfirmed is rendered, so the badge has no use. Four provenance badges remain (✅ 📖 🔍 👥)
   plus the three platform status badges (✅ 🧪 📐) and one new **🚧 under construction** card style.
2. **Stat row numbers:** "20 weapons" → **19** (the 20th captured frame is the default secondary — the
   Shotgun). Keep 2,166 sound ids. Re-source "11 game modes" and "43 `$WEAP` tokens" from the manual
   files before they ship; if either isn't stated there, drop it for one that is (63 players/game; 0
   firmware modifications).
3. **Platform door card + pieces:** Mission Control, the phone HUD, the Companion and stations are
   **under construction** — one 🚧 card each, no screenshots, no phase lists. `brx-mcp` is the piece
   shown in full. (Brief §10.)
4. **Content paths:** the content files moved from `content/*.md` to **`docs/manual/*.md`** and are now
   the repo's canonical manual; the site is built from them (brief §9). TODO chips bind to those.
5. **Deploy target:** not Vercel/Astro-anywhere — the built site lands in `webapp/` and ships on the
   existing Cloudflare Worker; static output only. `webapp/mc/` is untouched.
6. **LLM/search layer** (brief §11) needs designing into the templates: the "last verified" `<time>`,
   provenance rendered as visible text not only an icon, a glossary page template, and a visible
   "view as markdown" link on every page (the markdown twin).
7. **Images:** don't design around 84 slots. The working list is `images-priority.md` — 7 for launch,
   5 for polish. The hub's six section cards should use small crops from the real relit photos (a
   coherent set) rather than six generated illustrations.
8. **Home "start here" rows** in 1c link to `Quick start`, `Diagnose my tagger`, `Protocol reference` —
   slugs are `/manual/operate/quick-start`, `/manual/fix/diagnose`, `/manual/dev/commands`.
