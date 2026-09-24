"""Bench helper: scan BLE for SECS and print every advertised 128-bit service UUID starting with the filter."""
import sys, asyncio
from bleak import BleakScanner
secs = float(sys.argv[1]) if len(sys.argv) > 1 else 10
seen = {}
def cb(d, adv):
    for u in adv.service_uuids or []:
        if u not in seen: seen[u] = (d.address, adv.rssi); print(u, d.address, adv.rssi, flush=True)
async def main():
    async with BleakScanner(cb): await asyncio.sleep(secs)
asyncio.run(main())
