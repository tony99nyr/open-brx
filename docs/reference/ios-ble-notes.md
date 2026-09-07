# iOS BLE notes for the app (read before touching scan/connect)

Reference, not a handoff (it was `docs/handoff-ios-ble-findings.md` until 2026-09-06). Written by the
MacBook session on 2026-08-25 after getting `app/` running on an iPhone X; the facts still hold
(`app/src/brxlink.js` memoizes `initialize()` exactly as §1 says).
**Trace:** `protocol/captures/raw/2026-08-25-our-app-ios-double-init-drop.btsnoop` (`cap9`) — the
first capture of **our own** software failing rather than Callsign's.

---

## 1. Never call `BleClient.initialize()` more than once — it drops live connections

**This is the one that will bite scan code.** The iOS plugin's `initialize()` is not idempotent
despite reading like it is:

```swift
@objc func initialize(_ call: CAPPluginCall) {
    self.deviceManager = DeviceManager(...)   // REPLACES the manager
```

It replaces the object that owns the `CBCentralManager` **and every connected peripheral**. The old
one is deallocated, so *all live guns disconnect*.

`app/src/app.js` had `ensureInit()` calling it on every `setGun` — so **connecting Gun B
disconnected Gun A**. Symptom on hardware: *"the tagger keeps connecting and disconnecting; I hit
Set Gun B again and it seemed to work."* Fixed by memoizing (`let _init = null; _init ||= …`).

**If you add a "rescan" / "scan again" button, do not re-initialize inside it.** Initialize once per
app lifetime, then scan and connect as often as you like.

## 2. How to tell who hung up — use the HCI reason code, don't theorise

Every disconnect in `cap9` carried reason **`0x16` = Connection Terminated By Local Host**: the
*phone*. That immediately ruled out the gun, supervision timeout, and the headset gate — and it
ruled out the flaky-establishment story too, because the connects all **succeeded**.

Decode any iPhone trace with:

```bash
python -m brx_mcp.btsnoop <capture.btsnoop>          # frames
# reason codes: parse HCI events (flags==3), event 0x05 = Disconnection Complete
```

Worth knowing by heart:

| reason | meaning |
|---|---|
| `0x16` | **local host terminated** — our app/the phone hung up (a bug on our side) |
| `0x13` | **remote user terminated** — the gun hung up (e.g. the `protocol/session-findings-2026-08.md` §7m headset gate) |
| `0x08` | supervision timeout — out of range / gun powered off |
| `0x3E` | connection failed to be established — the flaky-establishment case |

`cap9` also shows **zero UART frames across 81 s**, which is itself the tell: the churn happened
entirely before any `$` frame was written, so no amount of protocol-level debugging would have found it.

## 3. Scanning UX: both guns look identical on iOS

iOS gives you **only the advertised name** — no MAC. Stock guns advertise `Tactix2` / `Tactix-<tail>`,
so a picker showing two taggers is **ambiguous** (operator hit exactly this: *"it has tactix2 for
both, so I don't know which is which"*).

Two things worth building into the scan work:

- **Show more than the name.** `requestDevice` opens the plugin's own picker and gives you no
  control. `requestLEScan` + our own list would let us show **RSSI** (closest = the one in your
  hand) and the **MAC tail**, which is what actually disambiguates.
- **Lean on `$NAME`.** It sets the *persistent* gun name over BLE and the advert becomes
  `<GunName>-<MACtail>`, confirmed to survive a power-cycle (commit `4889e2c`, `rename` CLI). The
  Armory Setup process already calls for naming each gun after its headset sticker id. Guns that
  have been through it are unambiguous in any picker — **the naming problem is already solved,
  it just hasn't been applied to the field units.** Note the deliberate rule from `70e5aba`:
  `$NAME` is the permanent hardware label, vanity callsigns stay a display layer — don't push
  gamertags to the gun.

## 4. Two more bugs fixed on the same path (real, but not the cause of §1)

- **No retry on the initial connect.** BRX establishment succeeds ~1 attempt in 3; retrying was the
  *entire* fix on the Python side (`ble.py`, 5 attempts). The app had a reconnect loop for drops but
  nothing for the first connect, so the user was the retry loop. Now 5 attempts, shared with reconnect.
- **`p.deviceId` was assigned before `connect()` resolved**, so a failed connect still marked the gun
  as set — and `deviceId` gates `updateStart()`, so **Start game** could enable for a gun that was
  never connected. Now committed only on success.

## 5. Platform notes that affect shared code

- **`deviceId` is an opaque handle, not an address.** iOS gives a per-device CoreBluetooth UUID;
  Android gives a MAC. The current code treats it opaquely — keep it that way, and **never persist a
  deviceId and expect it to mean anything on another phone or platform.**
- `androidNeverForLocation` is ignored on iOS; harmless.
- **`Info.plist` needs `NSBluetoothAlwaysUsageDescription`** or iOS *terminates* the app the moment
  `initialize()` runs, with no useful diagnostic. `ios/` is git-ignored, so this is applied by
  `app/scripts/ios-setup.sh` — **put any future iOS setting there, not in Xcode.**
- iOS deployment target is **15.0**; the iPhone X (iOS 16.7) is supported.

## Status

The app is **running on the iPhone X** — installed, Bluetooth permission granted, both guns
connecting. Build instructions incl. every real-device gate: `app/README.md`.
