# Architecture Decision Records (ADRs)

Load-bearing design decisions — the ones that would be expensive to reverse and that a new
contributor (or a future session) must not silently re-litigate. Each ADR captures **the forces
that boxed us in, the decision, the alternatives rejected, and the consequences**, so the *why*
survives even as the code moves.

Not every choice needs one — reserve ADRs for decisions that shape the platform's architecture.
Smaller open work lives in `../FOLLOWUPS.md`; findings/history live in `../experiment-log.md`.

**Convention:** `NNNN-kebab-title.md`, numbered in order. Status is `Proposed` → `Accepted` →
(later) `Superseded by ADR-XXXX` (never delete a superseded ADR — mark it and link forward, the
way `experiment-log.md` bannered the superseded landmark entry).

| ADR | Title | Status |
|---|---|---|
| [0001](0001-companion-rider-architecture.md) | Per-player Companion (BLE rider) for live in-game feedback & scoring | Accepted |
