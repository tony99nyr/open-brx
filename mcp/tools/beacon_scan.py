"""Stand in for a player phone: watch Open BRX station/player adverts from the tower's radio, with RSSI.

The radius bench for utility items (docs/spec/utility.md §3, open item 1): put the STATION phone at a
tape distance, run this on the Windows tower (its BLE adapter is the "player"), and read the smoothed
RSSI at each transmit-power level. Prints one line per advert seen (decoded), a running smoothed value
per source (the same EMA alpha the phones use, 0.35), and a summary per source at the end.

No gun, no BLE connection: bleak's scanner only. Runs under the Windows venv (WSL has no radio).

Usage: python beacon_scan.py [secs=30] [label=]
  e.g.  python beacon_scan.py 20 ultraLow-3ft
"""
import asyncio
import sys
import time

from brx_mcp.beacon import decode_any

ALPHA = 0.35


async def main() -> None:
    secs = float(sys.argv[1]) if len(sys.argv) > 1 else 30.0
    label = sys.argv[2] if len(sys.argv) > 2 else ""
    from bleak import BleakScanner

    ema: dict[str, float] = {}
    raws: dict[str, list[int]] = {}
    seen: dict[str, str] = {}
    t0 = time.monotonic()

    def on_adv(device, adv):
        a = decode_any(adv.service_uuids)
        if not a:
            return
        key = f"{a.role}:{a.id}"
        rssi = adv.rssi
        ema[key] = rssi if key not in ema else ema[key] + ALPHA * (rssi - ema[key])
        raws.setdefault(key, []).append(rssi)
        seen[key] = a.describe()
        print(f"   [{time.monotonic() - t0:5.1f}s] {a.describe():58s} raw {rssi:4d}  ema {ema[key]:6.1f}"
              f"{'  tx ' + str(adv.tx_power) if adv.tx_power is not None else ''}", flush=True)

    print(f"# beacon scan {secs:.0f}s {label} -- put the station phone at the tape mark, hands off", flush=True)
    scanner = BleakScanner(detection_callback=on_adv)
    await scanner.start()
    try:
        await asyncio.sleep(secs)
    finally:
        await scanner.stop()
    print(f"\n# summary {label}")
    for key, r in raws.items():
        r_sorted = sorted(r)
        med = r_sorted[len(r_sorted) // 2]
        print(f"  {seen[key]:58s} n={len(r):3d}  median {med:4d}  min {r_sorted[0]:4d}  max {r_sorted[-1]:4d}  ema {ema[key]:6.1f}")
    if not raws:
        print("  nothing decoded -- is the station advertising (its screen says LIVE), and is the tower's Bluetooth on?")


if __name__ == "__main__":
    asyncio.run(main())
