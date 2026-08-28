# Battery and power
_A 7.4 V two-cell pack with one nasty surprise: the connector polarity is backwards._
Last verified: 2026-08-27

## Tagger battery 📖 👥
- Chemistry / pack: **7.4 V Li-ion, ~2,200 mAh**, two cells
- Connector: **2-pin** (aftermarket 3-pin packs fit — the third pin is a thermistor the BRX ignores)
- Charger: the supplied **8.4 V two-cell smart charger**; LED red while charging → green when full
- Play time: **~8 h**
- Alternative: **6 × AA** alkaline. **Never rechargeable AAs.**
- Swap: one screw near the reload switch
- Live readout on the wire: a pack voltage, cell voltage and state-of-charge % every ~30 s (e.g. 7.52 V pack / 3.96 V cell / 43 %) ✅
Source: docs/reference/community-notes.md, docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/experiment-log.md (2026-08-24)

## POLARITY IS REVERSED.
Battle Company wires the pack connector opposite to the usual convention. Verify with a meter before wiring any replacement pack, external charger or adapter — getting it wrong risks damaging the tagger.
Source: docs/reference/community-notes.md (Battery / power)

_[image HW-06: (battery pack + connector — see Images table)]_

## Power habits that keep a fleet alive
- **Charge outside the gun** — community practice: splice a BRX AC adapter onto a spare connector, keep a stack of charged packs, swap in the field. 👥
- **Keep them topped up** — the stock firmware **stops re-pairing Bluetooth below a battery threshold**, which quietly drops players out of hosted games. 👥
- **Rest the guns between sessions** — a tagger left powered all day can enter the "screamer" state (loud buzz, refuses connections) until rebooted and rested. 👥 ✅
- **Riding electronics** — pulling under ~300 mA from the tagger for an add-on is fine (confirmed by Battle Company); anything bigger should carry its own power bank. 👥
Source: docs/reference/community-notes.md, docs/gotchas.md, docs/experiment-log.md (2026-08-26 screamer)

Headset power
| col 1 | col 2 | col 3 |
|---|---|---|
| Cell | one 18650 lithium cell (v2) | 👥 |
| Charging | any USB 5 V supply | 📖 |
| Voltage readout | reported through the tagger's USB console (e.g. "Head: 3.84 V") | ✅ |
Source: docs/reference/community-notes.md, docs/reference/brx-extended-user-guide.md, protocol/brx-protocol.md §7c
