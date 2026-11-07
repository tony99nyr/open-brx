"""Bench helper: scan BLE for SECS and print every advertised 128-bit service UUID starting with the filter.

A88: a hill that advertises its Domination tally (manufacturer data, company 0xFFFF, beside its OBRX UUID) also prints
one `tally` line each time the tally changes: the game byte, final/partial, and the seconds per tid
(beacon.js decodeTally). `python blescan.py 60` on Windows Python (bleak).
"""
import sys, asyncio
from bleak import BleakScanner
secs = float(sys.argv[1]) if len(sys.argv) > 1 else 10
TALLY_COMPANY, TALLY_FORMAT, SECS_MAX = 0xFFFF, 1, 16383
seen = {}
tallies = {}


def decode_tally(b):
    if len(b) != 6 or (b[1] >> 4) != TALLY_FORMAT:
        return None
    own = {}
    for i in (2, 4):
        v = (b[i] << 8) | b[i + 1]
        if v & SECS_MAX:
            own[v >> 14] = v & SECS_MAX
    return {"game": b[0], "final": bool(b[1] & 1), "partial": bool(b[1] & 2), "own_s": own}


def cb(d, adv):
    for u in adv.service_uuids or []:
        if u not in seen: seen[u] = (d.address, adv.rssi); print(u, d.address, adv.rssi, flush=True)
    raw = (adv.manufacturer_data or {}).get(TALLY_COMPANY)
    if raw is not None and any(u.lower().startswith("4f425258-0101") for u in adv.service_uuids or []):
        t = decode_tally(bytes(raw))
        key = (d.address, t["game"] if t else None)
        if t and tallies.get(key) != t:
            tallies[key] = t
            print("tally", d.address, f"game={t['game']} final={t['final']} partial={t['partial']} own_s={t['own_s']}", flush=True)


async def main():
    async with BleakScanner(cb): await asyncio.sleep(secs)
asyncio.run(main())
