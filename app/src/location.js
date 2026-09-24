// F340 (bench 2026-09-24, the grey Pixel 5 on Android 11): with Location services off, the gun picker
// found nothing while a gun advertised at -71 dBm. On Android 11 and older (API 30 and lower) a BLE scan
// returns nothing while the system Location toggle is off, even with the permission granted. Android 12+
// scans with BLUETOOTH_SCAN `neverForLocation` (app/scripts/android-setup.sh) and iOS has no such rule, so
// neither is ever checked.

/** The highest Android API level whose BLE scan needs Location services on (Android 11). */
export const LOCATION_MAX_SDK = 30;

/** True when a scan on this phone would find nothing because Location services are off. An unknown
 *  Android API level is not blocked: the phone scans as it did before this check existed. */
export function needsLocation({ platform, sdk, locationOn }) {
  if (platform !== 'android') return false;
  if (typeof sdk !== 'number' || !Number.isFinite(sdk)) return false;
  return sdk <= LOCATION_MAX_SDK && locationOn === false;
}

/** Asks the plugin (`probe`, BleClient.isLocationEnabled) only where the answer matters. A probe that
 *  throws is logged and does not block: the picker then scans exactly as it did before F340. */
export async function locationBlocked({ platform, sdk, probe, log = () => {} }) {
  if (!needsLocation({ platform, sdk, locationOn: false })) return false;
  let on;
  try { on = await probe(); } catch (e) { log('location check failed, scanning anyway: ' + (e && e.message || e), 'le'); return false; }
  return needsLocation({ platform, sdk, locationOn: !!on });
}

/** The one check both the phone (app.js) and the stage (demo.js) run. It writes `hud.locationOn` and says
 *  whether Location just came back on (`cleared`), which is the caller's cue to start the scan. `platform`
 *  and `sdk` are functions because the API level arrives from `Device.getInfo()` after boot. */
export function locationCheck({ platform, sdk, probe, hud, log = () => {} }) {
  return async () => {
    const blocked = await locationBlocked({ platform: platform(), sdk: sdk(), probe, log });
    const was = hud.locationOn === false;
    hud.locationOn = !blocked;
    return { blocked, cleared: was && !blocked };
  };
}

/** F340 review M2: whether `locationTick` (app.js) re-checks now. Only on native Android 30 and lower, in
 *  IDLE, with the radio free: never mid-connect, never over a pick, never with Bluetooth off (its own
 *  message wins). A list with guns on it is proof enough that Location is on, so the tick then rests. */
export function locationTickDue({ native, platform, sdk, phase, connected, picking, connecting, bluetoothOn, locationOn, hasGuns }) {
  if (!native || platform !== 'android' || typeof sdk !== 'number' || sdk > LOCATION_MAX_SDK) return false;
  if (phase !== 'idle' || connected || picking || connecting || bluetoothOn === false) return false;
  return !(locationOn !== false && hasGuns);
}

/** F340 review M1: what Location coming back on starts. A remembered gun (an app restart mid-match) rejoins
 *  by name, as boot does; otherwise the picker opens. Nothing when a gun is already linked. */
export function afterLocationOn({ rememberedGun, connected }) {
  if (connected) return null;
  return rememberedGun ? 'rejoin' : 'picker';
}
