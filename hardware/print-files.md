# BRX 3D print files — what this repo should publish

No open BRX print library exists: the survey behind that claim (who shares what privately, who sells
it, the Vishay receiver part) is [`../docs/reference/print-files.md`](../docs/reference/print-files.md).
This page is only what *we* would print and the one thing blocking it.

## Opportunity for this repo's `hardware/`

Since no open BRX print library exists, ours could become the canonical one — all MIT, all
version-tagged (the older/newer-model gotcha matters):
1. **Reload-button mod** (clean-room STL; the highest-demand part).
2. **D-pad replacement buttons** (nobody has published these; explicitly requested).
3. **BRX Companion mount + ported audio enclosure** (`hardware/brx-companion-spec.md`) — clips to the
   rail/phone bracket, no gun mod.
4. **Objective-station / effect-node enclosures.**
5. Optional decorative **skins/covers**.

## The CAD blocker

**Every part above is blocked on caliper measurements of a real gun** — the reload socket, the D-pad
pocket, and the rail/body profile the Companion mount clips to. Nothing can be modelled to fit until
those numbers exist, and no amount of photographs substitutes. Tracked as **H1–H5** in
`docs/FOLLOWUPS.md` §4.
