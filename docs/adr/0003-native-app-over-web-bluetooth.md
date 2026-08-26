# ADR-0003 — Native app over Web Bluetooth for the player node

- **Status:** Accepted
- **Date:** 2026-08-25
- **Deciders:** Tony (owner)
- **Related:** `docs/adr/0001-companion-rider-architecture.md`, `docs/adr/0002-laptop-mission-control-host.md`,
  `app/README.md`, `docs/experiment-log.md` (2026-08-25 Web-Bluetooth spike).

---

## Context

The per-player node (ADR-0001) must drive a BRX tagger over **BLE** from the field. The attractive,
zero-install path was a **Web-Bluetooth PWA**: one browser tab per player, no app store, works on any
old Android. Much early planning (the now-retired `phone-app-spec.md`, `field-architecture.md`,
`brx-architecture-v0.2.md`, and the tier plans) was built on that assumption, and the repo shipped a
`webapp/` Web-Bluetooth **test harness** to prove it.

**The spike killed it (2026-08-25, on real devices):**
- Chrome on the test Android reported **"Web Bluetooth API globally disabled"** even after flipping the
  `chrome://flags` toggle and relaunching — no device chooser ever appeared. Getting it to work needed
  flag hackery no player would ever do.
- **iOS/Safari has no Web Bluetooth at all** — the entire iPhone half of the fleet is out.

A player-facing product cannot rest on a browser API that is off-by-default on Android and absent on iOS.

## Decision

The player node is a **native Capacitor app** (`app/`) — **one codebase → Android + iOS**, using native
BLE (`@capacitor-community/bluetooth-le`: WinRT/CoreBluetooth/BlueZ). It reuses a shared web UI/engine
under the native shell. **Web Bluetooth is retained only as a dev-only test harness** (`webapp/`), never
the player path.

Validated the same day: the native app connected to a tagger, spoke over BLE, drove the green-sight
flash (`$SFLASH`), armed a full game, and ran a stable session — all the gates Web Bluetooth could not
clear (see `app/README.md`, experiment-log "native app validated on hardware").

## Alternatives considered

| Alternative | Verdict | Why |
|---|---|---|
| **Web-Bluetooth PWA** | ❌ rejected | Globally disabled on the test Android; **absent on iOS**. Not a shippable player path. |
| **Native app (Capacitor)** | ✅ chosen | Reliable BLE on both platforms from one codebase; native permissions; ruggedizable; reuses the web UI/engine. Cost: an install step (APK / TestFlight) instead of a URL. |
| **Per-gun Companion only (no phone)** | ◐ complementary | The ADR-0001 endgame for a rental fleet, but BYOD phones are the near-term node; not mutually exclusive. |

## Consequences

- **Positive:** the node works on both Android and iOS with dependable native BLE; the app can hold
  screen-on/keep-awake/foreground-service, mount landscape, and access the camera — none possible in a
  sandboxed PWA. The MC↔node wire (contracts A1–A8) is transport-native, not bound to browser APIs.
- **Negative:** players install an app (hosted APK / TestFlight) rather than opening a URL — a one-time
  at-home step (see `app/README.md`).
- **Supersedes** the Web-Bluetooth-PWA framing in the retired `phone-app-spec.md` /
  `field-architecture.md` / tier plans. Anything still describing the player path as a browser PWA is
  wrong; cite this ADR.
