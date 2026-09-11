# Callsign APK — full intelligence harvest (gameplay domains)

Everything useful mined from the Callsign IL2CPP app beyond the wire protocol (which is in
`protocol-classes.md`). Covers game modes, win conditions, the QR pickup/station system, the
grenade, weapon spawns, enums, monetization, and backend. Source policy per
`RAW_ASSETS_NOTE.md`: facts restated, no code/assets copied.

## Game modes (complete list)

Base + premium modes implemented in the app (each a class family
`…UI.<Mode>Game.*` / `Domain.WinningConditions`):

FreeForAll · TeamDeathMatch · Supremacy (factions) · Survival · Infection · **CaptureTheFlag** ·
**Domination** · **Assault** · Territory · LastManStanding · BattleRoyale · Swarm ·
**Generals** · **Commanders** (last three are GOTDLC premium unlocks).

- **"Edge" game** (`EdgeGame*`) = the **local/offline game engine** that runs on the phone when
  not cloud-connected. This is the exact role our BRX Companion accessory plays.
- Online variants (`…Online`) route scoring through the AWS backend; Edge/local variants keep it
  on-device. **Both use the same gun primitives** — confirming a self-hosted engine is viable.

### Win conditions (the rule types)

`ScoreWinningCondition`, `DeathWinningCondition` (elimination), `SlayerWinningCondition` (most
kills), `CaptureTheFlagWinningCondition`, `SquadLeaderWinningCondition`. A mode = {win condition}
+ {team layout} + {spawn rules} + {pickups}. All host-side — the gun enforces none of it.

## QR-code stations = the "boxes" (answers the JBOX question)

Battle Company implements field objectives — **respawn points, weapon pickups, capture/control
points, supply drops** — as **printed QR codes**, not physical boxes. The relevant commands:

| Command | Function |
|---|---|
| `RespawnByQrCodeCommand` | a QR code acts as a **respawn point** |
| `PickUpQrCodeWeaponCommand` / `…OnlineWeaponCommand` | a QR code grants a **weapon pickup** |
| `ControlPointGenerator`, `CapturePointer` | **domination/control points** |
| `DetectCaptureTheFlagCommand`, `BlinkFlagCarriyngCommand` | **CTF** flag carry/capture |
| `SpawnSupplyDropsCommand` | **supply drops** |
| `DecodeQrCodeCommand`, `FireQrCodeDetected`, `GAMEQrCode` | the gun/app reads a QR to trigger it |

**This is LaserTagMods' JBOX concept done with paper.** JBOX is a physical utility box
(respawn / capture point / armor / weapon pickup); Callsign gets the same functions from QR
codes the player scans or fires at. Implication for us: our platform can support **both** — cheap
printed QR codes *and* the physical `objective-station` IR node from the architecture (a real box
with an IR receiver + LED ring). QR = zero cost; station = better feel + works without a camera.

## Weapon spawns (answers the weapon-spawn question)

Weapons spawn as QR pickups. The **`WeaponPickUpType`** enum lists what can spawn:
OtherPlayers, AutoRifle, BurstRifle, SniperRifle, Shotgun, SmgSaw, Sticky, RailGun,
RocketLauncher, EnergyRifle, WarHammer, StrikeRifleUnscoped, StrikeRifleScoped. Supporting
fields: `WeaponPickUpSound`, `WeaponPickUpTime`, `WeaponPickUpTypeByIndex`, and an
**auto-pickup mode** (`ControlAutoPickupWeaponModeSelectionCommand`). Mechanically a pickup just
pushes a new `$WEAP` into a slot on the player's gun (via the phone/Companion) — which we can do
today.

## The grenade (answers "can we push the mode onto the grenade?")

**⚠️ Hardware-tested — the answer is NO for objective modes (G8, exp-log #36).** This APK-derived
section originally hypothesized that `$GREN` sets the grenade's mode; **that was disproven on hardware.**
The grenade is not its own BLE device (correct — no grenade-BLE/QR class, only `SetupGrenade` + the
`$GREN` request in the gun's namespace), BUT:

- **Objective modes (Frag/Assault/Hill/Respawn/CTF) are button-set and LOCKED on the grenade** — sweeping
  `$GREN` `operationMode` (0–7 × iRType {0,15}) had **zero effect**. Anti-tamper by design.
- **`$GREN` fields:** `iRType, crit, modifier, indoorMode, operationMode, channel, GrenadeType, MaxCount`
  (see protocol-classes.md). **`GrenadeType` enum = FlashBang/Gas/Confusion/Molotov = the blast *effect*
  of a paired THROWN grenade** — this is what `$GREN` actually configures (untested end-to-end; needs the
  install-accessory pairing — followup G10), NOT the objective station modes.
- `channel` / `MaxCount` suggest per-grenade addressing (for thrown-blast config).

So there is **no `$GREN` grenade-config UI** for objective modes. The Companion/MCP value is a live
**grenade STATE DISPLAY** instead — read the grenade's `$HIR,0,15,0,<team>,<mode>` beacons (Hill/Respawn
broadcast; see `../../docs/reference/grenade.md`). See exp-log #35/#36 and FOLLOWUPS G8/G10.

## Does Callsign integrate the grenade's STATION modes in a hosted game? (checked 2026-09-04 — NO)

Asked after the bench showed a host-driven game ignores the Respawn-station words. Read straight from
`global-metadata.dat` identifiers (the APK is still at `~/.brx-mcp/callsign-base.apk`):

- **`RespawnType` enum = `AutoRespawn` · `Scanner` · `SquadLeaderOnly`.** `Scanner` is the phone camera:
  `RespawnByQrCodeCommand`, `DecodeQrCodeCommand`, and `DetectActivateScannerByGunCommand` (a gun button
  press opens the scanner, the same way `DetectActivateScoreboardByGunCommand` opens the scoreboard).
  `SquadLeaderOnly` is the squad-revive path (`ReviveTeammateCommand`, `SendReviveCommandsToGun`,
  `WaitForReviveCommand`, `_timerForReviveAbility`, FSET `SquadReviveKey`).
- **There is no gun-event detector for a station or a beacon.** The full `Detect*Command` family
  (~70 classes) has hits, deaths, melee, zoom, gyro, pickups (QR), CTF (QR), loot (QR), scanner and
  scoreboard activation, connection state — nothing for protocol 15 / grenade / respawn point.
- **The app's hit model** `BrxGunHitModel` = `shootedDeviceId`, `bulletType` (our `$HIR` tok2, the IR
  protocol). It carries the field but nothing consumes a value of 15.
- **`GrenadeMode` enum = FlashBang · Confusion · Molotov (· Gas)** = the *thrown* grenade's blast, i.e.
  the whole of the app's grenade support is `$GREN` for a paired thrown grenade. Domination is
  `CapturedDominationBoxes` / `BoxesToWinCount` / `BoxStage2Img` = printed QR "boxes"; King of the Hill
  has `KingOfHillMoved` notifications (a virtual/moving hill, not an IR point).
- Wire check: across every captured Callsign game the app sent only the standard set (no `$GREN`, no
  `$SIR` row for protocol 12–15, no `$RP`/`$RV`).

**Conclusion:** the grenade's Respawn/Hill/Assault/CTF station modes are an **on-gun native-mode
feature** that Callsign's hosted games never use; the app does stations with QR codes read by the phone
and revives with `$SPAWN`. That is exactly the shape FOLLOWUPS **B23** proposes for Mission Control.
Scope: identifier names only (no decompiled logic), so a hidden hosted-mode path that reuses an
unrelated name would be missed — but there is no gun→app event for it to hang on.

## Weapon fire modes (bonus — GunWeaponType enum)

`FullAutoFire, Bow, ChargeAndAutoRelease, ChargeAndRelease` — the firing behaviours a `$WEAP`
can use (Bow = draw/release, Charge = the Charge Rifle pattern we saw in the `$WEAP` diff).

## Region / legal power (GunLaserRegion enum)

`gunLaserRegion` (GSET token 3) = **USA / International** — IR emitter power profiles for legal
limits per region. Leave at the tagger's factory value unless you know the local rules.

## Monetization (context only — not needed for a self-hosted build)

`MagicLootBox` (loot boxes), `BattleCoins` (in-app currency), subscriptions, `UpsellPackDto`,
`Gift`/`ArenaGift`. The DLC/GOTDLC premium modes (Generals/Commanders/Swarm) unlock through this.
A self-hosted platform simply reimplements any wanted mode host-side and skips the economy.

## Backend (context)

REST: `ltp-prod-v4.us-east-1.elasticbeanstalk.com`; multiplayer over AWS SQS/SNS. **The lobby +
match protocol was captured live on 2026-09-11 — the canonical facts (auth, endpoints, message
catalog, game-data model) are in [`protocol-classes.md`](protocol-classes.md) § Backend.** These
static-teardown DTO names (`LaserTag.Network.ArenaClient.Edge.Domain.CallSign.Games.*`) are the
Edge/offline layer, distinct from the cloud lobby's `MeliorGames.Net.*` + `LaserTag.CallSign.Domain.*`.
Replace the whole layer with the local LAN (WebSocket, `docs/spec/contracts.md` §5).

## Where the game DATA lives — server, not the APK (verified 2026-08-24, UnityPy)

Deeper teardown (UnityPy over the 27,391 Unity objects + native/metadata scan) confirms the APK
holds the **structure** but not the **content**:

- The base APK is UI (RectTransform/Canvas/GameObject) + IL2CPP engine code + the sound *inventory*
  (`Sounds.json`, id→duration). Scanning all 8,003 MonoBehaviours found **zero** sound-id clusters
  and no weapon/character stat objects — the ScriptableObject *data* isn't bundled.
- It's server-side, not in the APK. ⚠ **The runtime route is NOT what this teardown guessed
  (corrected by the 2026-09-11 live capture).** The endpoints named here from strings —
  `/api/v1/callsign/settings/`, `voice-profiles/selected/`, `arenas/games/` — **were silent in the
  capture**: they are cached client-side, and the live game data (weapons, mode, voices) rides the
  **SNS/SQS lobby** as .NET blobs, not REST. The API is also **plain HTTP, not HTTPS**. The S3 bucket
  (`s3.amazonaws.com/ltp-prd-v4/...`) was seen only as a string, not on the wire. Auth is AWS Cognito.
  Canonical: [`protocol-classes.md`](protocol-classes.md) § Backend.

**Consequence for the three deep-dive goals:** the remaining unknowns are **data, not structure**.
To recover:
- **Stock weapon stats** → **NOT in the lobby payload** (weapon *names/enum* only); capture more live
  `$WEAP` frames, or find where the numeric stats are fetched (unproven).
- **`$PSET` voice-pack → sound map** → the lobby's `SquadLeaderVoices` field (was empty; set a squad
  voice and re-host), or a BLE capture changing one voice profile.
- **`$WEAP` tok 7–13 (secondary fire) positions** → a BLE capture of a weapon with secondary fire
  configured (the field names/order are already known; only the wire positions are unpinned).

**Capture route (gun-off, method corrected 2026-09-11):** use mitmproxy **WireGuard** mode, not the
system HTTP proxy (Unity ignores it) — see `docs/capture-runbook.md`. It yields the lobby + match
traffic; the REST endpoints stay cached/silent.

## What we have NOT harvested (and why)

- **Actual stock-weapon `$WEAP` stat values** — not in the JSON assets; server-fetched or in
  metadata field-default data (encrypted). We have the manual's stats + two live `$WEAP` frames
  as anchors, which is enough to build from.
- **Method bodies / exact serialization order** — compiled to native `libil2cpp.so`; needs Ghidra.
  Field *declaration* order (what we used) matches serialization for these DTOs and is
  cross-validated against live frames, so this is low-priority.
- **Full 168-command list** — most are app-internal UI/networking commands, not tagger protocol.
  The tagger-relevant subset is fully captured in `protocol-classes.md`.

This is a complete sweep of the **gameplay-relevant** intelligence. The remaining unharvested
material is either server-side, native-code-only, or app-plumbing irrelevant to building the
platform.
