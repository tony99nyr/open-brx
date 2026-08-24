# ESP32-S3 IR bridge — capture (and later emit) BRX IR

The hardware half of `../ir-prototype-plan.md` and the eventual Claude↔hardware bridge for
`docs/diagnostic-game.md` (`diag-game ir`). Sketch(es) here are Arduino-IDE / arduino-esp32.

## Parts (the ordered kit)
- **ESP32-S3-DevKitC-1** (WROOM-1-N16R8) — 16 MB flash / 8 MB PSRAM.
- **VS1838B** 38 kHz IR receiver (CHANZON kit) — capture.
- **940 nm IR LED** + an NPN transistor (2N2222, from the ELEGOO kit) — emit (Phase B).
- Breadboard + jumpers + a 0.1 µF cap (ELEGOO kit).

## Wiring — `ir_capture.ino` (Phase A, capture)
```
VS1838B  OUT ── GPIO 4        (S3 safe pin; avoids octal-PSRAM 33–37 & flash 26–32)
         VCC ── 3V3
         GND ── GND
         0.1 µF cap across VCC/GND (noise)
```

## Flash it
1. Arduino IDE → Boards Manager → install **esp32 by Espressif** (v3.x).
2. Board: **ESP32S3 Dev Module**. Enable **USB CDC On Boot** (so Serial works over the native
   USB port). PSRAM: OPI (for N16R8).
3. Plug the S3 in. **Two USB ports** on the DevKitC-1 — try the one that enumerates a serial port;
   if upload fails, **hold BOOT, tap RESET, release BOOT**, then upload.
4. Open Serial Monitor @ **115200**.

## Use it
Fire a stock gun (or trigger a grenade) at the VS1838B. Each frame prints:
```
RAW <n> edges=<k> us=[d1,d2,d3,...]      # raw mark/space durations
DECODE bits=<b> val=<25-bit string>       # long mark(~1000us)=1, short(~500us)=0
```
Sweep every **weapon** (`$WEAP`), **team** (`$TID`), and **grenade mode** (Hill/Respawn beacon,
Assault/CTF capture) — log each `val`. **Diff the bit strings** to find which bits carry
type / team / mode / damage. That table **is followup B13** and unblocks the Utility Box emit side.

## Notes / tuning
- The VS1838B is **active-low** (idles HIGH, pulls LOW on carrier). The sketch times edges and takes
  the LOW durations as marks.
- If decode looks off, tune `MARK_THRESH_US` (default 750 µs — halfway between the known 500/1000 µs).
- `micros()` edge timing is framework-light and transparent — ideal for RE. A later revision can move
  to the RMT peripheral for tighter timing + TX.

## Next (when capture works)
- `ir_emit.ino` — RMT-drive the 940 nm LED to replay a captured frame; confirm a stock gun reacts.
- Then a small **serial command protocol** (`CAP`, `TX <bits>`, `ADC <pin>`) so the `brx-mcp`
  `ir_capture` / `ir_emit` tools drive the board over USB (pyserial) — the `diag-game ir` cases.
