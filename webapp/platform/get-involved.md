# Get involved
_Open source, open hardware, open protocol, and one hard rule._
Last verified: 2026-09-06

## The hard rule: stock BRX firmware is never modified.
All control goes over the documented Bluetooth serial protocol (plus IR and nRF *observation*). A power-cycle always restores a tagger, and Battle Company's USB updater is the factory-restore path. This is also why the project stays compatible with stock and community gear.
Source: README.md §Prime directives, CLAUDE.md §Hard rules, docs/adr/0001-companion-rider-architecture.md

## Ways in
- **Play**: you own guns. Read *How it's wired* §Two deployment shapes, then *Build tiers*, then the `brx-mcp` quickstart. ✅
- **Run a match**: the match-day operator runbook (`docs/field-runbook-mc.md`) and the Armory Setup + Muster processes (`docs/field-process.md`). 🧪
- **Change the code**: `docs/spec/README.md` → `docs/spec/contracts.md` (the node↔MC wire is the single point of coordination; interface changes go through documented amendments, not silent edits). 🧪
- **Bench**: the "Needs Tony at the bench" and "System proofs" sections of `docs/FOLLOWUPS.md` list everything still blocked on a human with a tagger. Append to `docs/experiment-log.md` after every session. ✅ process
- **Print**: no public BRX print library exists. `hardware/print-files.md` lists the asks (reload-handle push-button mod, D-pad buttons, Companion mount, station enclosures). Clean-room, version-tagged, MIT. 📐
- **Sound**: the 2,477 on-gun sounds are catalogued by category and transcript, and custom on-tagger packs swap over USB. ✅
Source: docs/README.md, docs/FOLLOWUPS.md §Hardware / 3D printing, hardware/print-files.md

## GitHub:
https://github.com/tony99nyr/open-brx. Licence: **MIT** (`LICENSE`, © 2026 BRX Open Battle System contributors). Register the MCP server with Claude Code: `claude mcp add brx -- python -m brx_mcp`.
Source: LICENSE, README.md

## Credit where it's due.
Protocol discovery and the tagger-rider ESP32 concept originate with **LaserTagMods** (JEDGE / JBOX). The objective-node reference design is **Jay / Extreme Laser Tag's JBOX Mini**. Owner-community knowledge (including David Knox's audio map) informed the sound bank. Open BRX is a fresh, independent, clean-room implementation. Facts are restated with credit, no code is copied, and official PDFs are linked rather than rehosted.
Source: README.md §Credit, docs/VISION.md §Sourcing/policy, docs/spec/README.md §7

## Sequencing: prove → open-source → let demand pull.
The project builds the four units its owner needs, hardens them in real games, and open-sources everything. Assembled Companions, kits and fleet bundles only follow if people ask *and* it is proven reliable.
Source: docs/VISION.md §Companion as flagship
