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

REST: `ltp-prod-v4.us-east-1.elasticbeanstalk.com`. Multiplayer: **AWS SQS/SNS** (the ~1-min
lobby delay is a cloud round-trip). Networking DTOs live under
`LaserTag.Network.ArenaClient.Edge.Domain.CallSign.Games.*`. Replace the whole layer with the
local LAN (WebSocket, `docs/spec/net.md`).

## Where the game DATA lives — server, not the APK (verified 2026-08-24, UnityPy)

Deeper teardown (UnityPy over the 27,391 Unity objects + native/metadata scan) confirms the APK
holds the **structure** but not the **content**:

- The base APK is UI (RectTransform/Canvas/GameObject) + IL2CPP engine code + the sound *inventory*
  (`Sounds.json`, id→duration). Scanning all 8,003 MonoBehaviours found **zero** sound-id clusters
  and no weapon/character stat objects — the ScriptableObject *data* isn't bundled.
- It's **fetched at runtime from the Callsign server** (`ltp-prod-v4.us-east-1.elasticbeanstalk.com`,
  `/api/v1/callsign/...`) and an S3 bucket (`s3.amazonaws.com/ltp-prd-v4/...`). Relevant endpoints:
  `/api/v1/callsign/settings/`, **`/api/v1/callsign/voice-profiles/selected/`** (= the `$PSET`
  voice-pack presets — `$PSET`/`WeaponSettings` carries a `VoiceProfile` field), and
  `/api/v1/callsign/arenas/games/` (game definitions). Auth via AWS Cognito; lobby via SNS/SQS.

**Consequence for the three deep-dive goals:** the remaining unknowns are **data, not structure**,
so static teardown can't reach them. To recover:
- **Stock weapon stats** → capture the server API response, or capture more live `$WEAP` frames.
- **`$PSET` voice-pack → sound map** → the server's `voice-profiles` endpoint, or a BLE capture
  changing one voice profile.
- **`$WEAP` tok 7–13 (secondary fire) positions** → a BLE capture of a weapon with secondary fire
  configured (the field names/order are already known; only the wire positions are unpinned).

A new **API-capture route** (gun-off): MITM the Callsign HTTPS traffic (proxy + cert) while it
loads settings/voice-profiles/games — yields the weapon/voice/game data directly. Distinct from BLE
snooping.

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
