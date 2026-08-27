# Resilience page
_A page whose content is wrong in every way the future might make it wrong._
Last verified: 2026-01-01

This page exists so the site proves it renders a visible TODO instead of crashing.
Source: site/test/fixtures/manual-stale/01-stale.md

## A block type nobody has defined yet
- it still has content
- and it must not vanish silently
Source: site/test/fixtures/manual-stale/01-stale.md

## A table with a missing column and a ragged row
| Thing | Value | Confidence |
|---|---|---|
| Complete row | 1 | ✅ |
| Ragged row | 2 |
| Extra cell row | 3 | ✅ | surprise |
Source: site/test/fixtures/manual-stale/01-stale.md

_[image ZZZ-99: An image slot that has no file and no manifest entry.]_

## Filterable table with an empty cell
| Command | Meaning |
|---|---|
| `$PING,*` | Connectivity check |
| `$MYSTERY,*` |  |
Source: site/test/fixtures/manual-stale/01-stale.md

- **Does an unknown block crash the page?** No — it renders a visible TODO chip. ✅
- **Does a missing image crash the page?** No — a placeholder with the slot ID. ✅
Source: site/test/fixtures/manual-stale/01-stale.md
