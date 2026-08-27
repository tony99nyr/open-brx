# The Callsign App
_Battle Company's official phone app: what it actually does, how a game is built, and the three things nobody tells you._
Last verified: 2026-08-27

What the app is. Callsign turns a phone into the **game host**: it keeps the clock, the score and the respawn timer, and pushes weapons and settings to the gun over Bluetooth. The gun enforces none of the rules — take the phone out of Bluetooth range and nobody respawns and the round never ends.
Source: protocol/brx-protocol.md §7g, §7n

- **~1 m** — keep the phone this close to its gun for the whole match; it is the game engine. ✅
- **~1 min** — typical wait for a hosted game to appear as joinable on a second phone (it round-trips through the cloud). ✅
- **69 / 100** — the internal volume the app sets on the gun when it connects. ✅
- **Android ≤ 10** — owners report the app only works on older Android; iOS is fine. 👥
Source: protocol/brx-protocol.md §7g, §7b, docs/experiment-log.md, docs/reference/community-notes.md

## Building and starting a game
1. Get the top-right connection icon **green ("connected")**. You cannot create a game until it is — and it will not go green without a **paired headset**. ✅
2. **SELECT A GAME** — swipe the category carousel: Team Arena · Battle Royale · Battle Lines · Faction Wars · Infection. ✅
3. **SELECT GAME MODE** — e.g. under Team Arena: Arena · Team Arena · Team Snipers · Capture the Flag. ✅
4. **GAME SETTINGS** — primary and secondary weapon, then the rules (table below). Press **CREATE**. Some modes add a step for teams / starting health / players-remaining display. ✅
5. **Lobby** — other players join from their phones, pick weapons, and hit ready. Single device? Use **Start Offline Game**. ✅
6. **Host launches** — every gun goes live together, and the in-game HUD shows health, shield, ammo and weapon. ✅
Source: docs/reference/callsign-ui.md, protocol/brx-protocol.md §7g, §7m, docs/experiment-log.md (2026-08-25 cap10/cap11)

## Game settings the app exposes
| Setting | Choices |
|---|---|
| Primary / Secondary weapon | ~18-weapon roster (Assault Rifle, Sniper, Shotgun, SMG, Rail Gun, Rocket Launcher…); secondary removable |
| Weapon respawn | 30 s · 60 s · 90 s · 3 min |
| Weapon pick-up | Scan · Player · Both |
| Weapon selection | on / off |
| Outdoor mode | on / off |
| Voice | Male · Female |
| Time | minutes |
| Score to win | a number |
| Respawn type | Scanner (respawn at a printed QR code) · Auto (timed) |
| Respawn time | seconds |
| Lives | a count, or Unlimited |
| Extra step (some modes) | Allow Teams / No Teams · Starting health Low/Medium/Full · Players remaining Show/Hide |
Source: docs/reference/callsign-ui.md, protocol/callsign-extract/apk-harvest.md

Field objectives in Callsign are **printed QR codes** — respawn points, weapon pickups, control points and supply drops are all paper you scan or fire at, not boxes.
Source: protocol/callsign-extract/apk-harvest.md, docs/reference/brx-extended-user-guide.md

Volume. The app's entire global settings screen is one **Sound** slider. On connect it sets the gun to about 69 on its internal 0–100 scale — loud enough for weapon audio indoors and out. Anything much below 50 makes weapon sounds effectively silent; we measured 30 as inaudible over room noise.
Source: docs/reference/callsign-ui.md, docs/experiment-log.md (finding 6), protocol/brx-protocol.md §7b

Gotcha 1 — the app renames your gun. Every session Callsign writes the name **"Tactix2"** to the gun. If you have given a gun a custom Bluetooth name with Open BRX tools, opening Callsign on it silently resets that name.
Source: docs/gotchas.md, protocol/brx-protocol.md §7b

Gotcha 2 — "app is flaky" is almost always the headset. With no headset paired the app connects to the gun and drops it about a second later with no message; the icon simply never turns green. Nothing is intermittent — it works exactly when the headset happens to be linked.
Source: protocol/brx-protocol.md §7m

Gotcha 3 — the firmware warning is soft. Newer guns show *"firmware v4.32 … supported until v2.01e"*. The gun is *ahead* of the app's list, not behind it, and games still run. Do not downgrade firmware to satisfy the message.
Source: docs/experiment-log.md (finding 3), protocol/brx-protocol.md §7b

Player numbers in the app are shown 1–64. The gun stores them 0–63 — only matters if you ever compare app numbers with developer tools.
Source: docs/experiment-log.md (2026-08-25 P2)
