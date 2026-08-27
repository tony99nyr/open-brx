# 01 · Stale fixture  (section slug: /manual/stale)
**Last verified:** 2026-01-01
**Audience:** the test suite · **Goal of this section:** prove the renderer degrades visibly, never crashes.
**Provenance legend:** ✅ verified on our bench

## Pages
### Page: Resilience page  (`/manual/stale/resilience`)
_A page whose content is wrong in every way the future might make it wrong._

[hero] This page exists so the site proves it renders a visible TODO instead of crashing. ✅ src: site/test/fixtures/manual-stale/01-stale.md

[hologram] **A block type nobody has defined yet**
- it still has content
- and it must not vanish silently
✅ src: site/test/fixtures/manual-stale/01-stale.md

[table] **A table with a missing column and a ragged row**
| Thing | Value | Confidence |
|---|---|---|
| Complete row | 1 | ✅ |
| Ragged row | 2 |
| Extra cell row | 3 | ✅ | surprise |
✅ src: site/test/fixtures/manual-stale/01-stale.md

[image ZZZ-99] An image slot that has no file and no manifest entry.

[data-table:filterable] **Filterable table with an empty cell**
| Command | Meaning |
|---|---|
| `$PING,*` | Connectivity check |
| `$MYSTERY,*` |  |
✅ src: site/test/fixtures/manual-stale/01-stale.md

[faq]
- **Does an unknown block crash the page?** No — it renders a visible TODO chip. ✅
- **Does a missing image crash the page?** No — a placeholder with the slot ID. ✅
src: site/test/fixtures/manual-stale/01-stale.md

## Images for this section
| ID | Page / where | What it shows | Kind | Source | Gemini prompt |
|---|---|---|---|---|---|

## Research backlog (held — NOT published)
- This line must never appear on the site. NEVER-PUBLISH-SENTINEL
