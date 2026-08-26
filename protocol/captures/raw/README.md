# Raw BLE captures (btsnoop)

The **unprocessed** iPhone Bluetooth HCI traces behind the decoded transcripts in the parent
directory. Committed because a raw trace answers questions we haven't thought of yet: the
`$SFLASH` kill-confirm decode (§7o, 2026-08-25) came out of a capture taken on **2026-08-23** and
sat unread for two days — we had the bytes, we just hadn't asked the right question.

**Provenance:** all captured on the MacBook with **PacketLogger** (`File ▸ New iOS Trace`, then
`File ▸ Export ▸ btsnoop`) against the official **iOS Callsign** app driving BRX taggers on
firmware `v4.32`/`devhost.03`. Format is **btsnoop datalink 1001** (unencapsulated HCI — Apple's
export; the ACL/event split lives in the record flags, not a leading type byte).

**Decode:**

```bash
python -m brx_mcp.btsnoop <file>                 # chronological $-frames, both directions
python -m brx_mcp.callsigndiff <file>            # + diff vs our own arm, per connection
python -m brx_mcp.gsetdiff <fileA> <fileB> ...   # token-by-token $GSET/$PSET/$WEAP comparison
```

**Privacy:** these contain BLE device addresses and the taggers' advertised name (`Tactix2`) and
firmware host string (`devhost.03`) — both already public in our docs. They were scanned against
`~/.brx-mcp/device-backups/` and contain **no headset PIN or serial**; those come from the USB
`QUERY`/`SETUP` console, never from BLE, and stay out of the repo by policy.

| File | What it is | Why it matters |
|---|---|---|
| `2026-08-25-two-gun-3-kills-sflash.btsnoop` | **The `$SFLASH` capture — operator-annotated end to end.** The captured iPhone **hosted** the game (a second phone joined with the other tagger). 262 s: connect → arm → **3 kills scored** → manual *Settings ▸ End Game*. The captured gun is the **shooter** — never hit (`$ALCD` ammo 36→6, `$BUT` bursts, zero `$HIR`). 3× `$SFLASH` + 3× `$PLAY,,4,6,V3A`. | **Source of §7o.** Proves the green-sight kill-confirm and the announcer ride plain BLE, and that the app's arm is byte-identical to ours. The single most important capture we have. |
| `2026-08-25-our-app-ios-double-init-drop.btsnoop` | **Our own app failing**, not Callsign — the BRX Companion app on an iPhone X connecting two guns. 864 HCI packets, 81 s, **zero UART frames written**: both guns connect, notifications are enabled, then disabled, then the links drop. All three disconnects are HCI reason **`0x16` Connection Terminated By Local Host** — the phone hung up. | Root-caused the "tagger keeps connecting and disconnecting": the plugin's `initialize()` *replaces* the object owning the CBCentralManager and all peripherals, and the app called it per-`setGun`, so **connecting Gun B disconnected Gun A**. Fixed by memoizing. Also the template for diagnosing our own BLE bugs — reason codes name who hung up. |
| `2026-08-25-offline-game-playerid-69.btsnoop` | Single device, **Start Offline Game**, with the app's **player id set to 69**. 55 frames, 58 s, one gun, no combat. | **The P2 lead.** `$PSET` token 1 — `0` in every other capture we have — comes across as **63**, the 6-bit maximum (the IR shot payload's player field is 6 bits, 0–63, per `brx-ir-protocol.md`). So 69 was clamped, and **`$PSET` token 1 looks like the player id**, settable over BLE. Needs one confirming capture at a small value. |
| `2026-08-25-offline-game-playerid-7.btsnoop` | Same offline game with the app's player id set to **7**. The app had also **prefilled 64** from the previous run (69 was clamped to its max). | **Confirms P2's set-path.** Wire carries **`$PSET,6`** — app 7 → wire 6, and app 64 → wire 63. **The app is 1-based (1–64); the wire is 0-based (0–63).** Two points, one of them predicted in advance. |
| `2026-08-25-hosted-game-playerid-default.btsnoop` | Control capture: same flow with the id left at default — `$PSET,0`. No novel commands. | The negative control for the two above: token 1 returns to `0` when the operator doesn't set an id, so 63/6 really did track the field. |
| `2026-08-26-weapons-ar-plus-burstrifle.btsnoop` | Arm with two **operator-named** weapons: slot 0 **Assault Rifle** (`R01`, full auto), slot 1 **Burst Rifle** (`R18`, 3-round burst, one pull per burst). | **Confirms `$WEAP` token 23 = burstWeaponTime** — `275` on the burst weapon, **empty** on the full-auto AR and on every other weapon we have. Also names two wire signatures: `R01` = Assault Rifle, `R18` = Burst Rifle. Naming the weapons at capture time is what makes a frame decodable later. |
| `2026-08-26-weapons-sniper.btsnoop` | Arm with **Sniper** (slot 0, `S16`) — operator also selected a Shotgun, but slot 1 came through byte-identical to the historical default secondary (`T01`), so only one new weapon landed. | **`t28`/`t29` are TWO-STAGE ACTION sounds, not 'charge' sounds.** `S16` populates them (`D20`/`D19`) exactly as the operator described the bolt: *pull back, then let it go*. Previously seen only on the Charge Rifle, which is why they were named chargeUp/chargeDown. `S16` = Sniper: 80 damage, 4-round clip. |
| `2026-08-26-weapons-smg-plus-amr.btsnoop` | Arm with **SMG** (slot 0, `G03` — full auto with an **overheat** mechanic that plays a sound if you fire too long) and **AMR** (slot 1, `S07` — single shot, no full auto). | **Confirms `t24` = overheat**: `5` on the SMG, `0` on all nine other weapons. **`t35` (`weaponFeatureA`) = `D11` on the SMG alone** — the overheat sound itself, so `weaponFeatureA` is a sound slot for a weapon's special mechanic. The AMR carries the same `D20`/`D19` two-stage pair as the Sniper, confirming that reading with a second independent example. |
| `2026-08-26-weapons-energylauncher-railgun.btsnoop` | **Energy Launcher** (slot 0, `J15`) and **Rail Gun** (slot 1, `C03` — charges on hold and **auto-fires after ~1 s**, but also fires on a tap). | Names `J15`. **Shows `t14`/`t15` are swapped in the metadata-derived map**: `t15` is `850` on every gun (a swap delay), while `t14` tracks each weapon's real cadence — and the Rail Gun's `t14`=**1200** is the ~1 s charge the operator felt. **`C03` has `t28`=`C08` but `t29` EMPTY**: it auto-fires, so there is no release phase and no release sound — the Sniper/AMR, which you must release, carry both. |
| `2026-08-26-weapons-rocket-lasercannon.btsnoop` | **Rocket Launcher** (slot 0 — standard single shot) and **Laser Cannon** (slot 1, `C06` — must be **held to charge**; a light tap fires nothing). | **Proves token 27 is a SOUND, not a weapon id**: the Rocket Launcher reuses `C03`, the Rail Gun's fire sound, with completely different stats. `weapmap` now keys columns on the full stat line. The Rocket Launcher has **no `t28`** (nothing to charge) and is the 2nd weapon ever to populate `t12`/`t13` (**115**/80). |
| `2026-08-23-two-tagger-combat.btsnoop` | Richest game trace: 421 s, **23 hits taken, 2 deaths, 4 kills scored**. Both sides of combat in one file. | Source of §7f (combat/death/respawn) and §7k (`$HIR` token 4 = shooter's team). Independently corroborates §7o — the same `$SFLASH → V3A → VB17` burst is at 295 s and 325 s. |
| `2026-08-23-solo-game-full-arm.btsnoop` | Clean 81 s solo game, no combat. The complete arm sequence with nothing else in the way. | The canonical reference for the config order our `GameConfig.setup_frames()` reproduces. Best file to diff a new capture against. |
| `2026-08-23-gset-respawn15.btsnoop` | Armed game, in-app respawn set to **15 s**. | One of the three that **settled §7n**: respawn is not in the protocol at all. |
| `2026-08-23-gset-respawn30.btsnoop` | Same, respawn **30 s** (game time also changed to 1 min on this run). | With the other two: `$GSET` and `$PSET` come out **byte-identical** across all three. |
| `2026-08-23-gset-respawn05.btsnoop` | Same, respawn **5 s**. | The confirming third point — the app keeps the clock and drives respawn itself. |
| `2026-08-23-no-headset-instant-disconnect.btsnoop` | The **failure mode**: app connects and drops immediately, 9 frames, never arms. | Evidence for §7m — no headset paired means no game, silently. Useful as a negative control when a session "won't work". |
| `2026-08-23-connect-attempts-no-headset.btsnoop` | 464 s of repeated connect attempts across two taggers; `$NAME` + `$VERSION` exchanged, never arms. | The long-form version of the same failure. Contains the `$VERSION` reply that identified `v4.32`/`devhost.03`. |

## Reading a capture correctly — one trap

**A kill you *score* is invisible in your own gun's stream.** The shooter's gun reports `$BUT`
(trigger) and `$ALCD` (ammo) and nothing else; `$HIR`/`$HP` only ever describe damage *taken*.
This is exactly why `$SFLASH` was logged for two days as "periodic, never near a hit" — the file
it was first seen in was the **victim's** gun. Correlate host→gun feedback against **`$BUT`
bursts**, not against `$HIR`.
