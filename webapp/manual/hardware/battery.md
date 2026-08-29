# Battery and power
_A 7.4 V two-cell pack with one nasty surprise: the connector polarity is backwards._
Last verified: 2026-08-27

## Tagger battery 📖 👥
- Chemistry / pack: **7.4 V Li-ion, ~2,200 mAh**, two cells
- Connector: **2-pin** (aftermarket 3-pin packs fit, because the third pin is a thermistor the BRX ignores)
- Charger: the supplied **8.4 V two-cell smart charger**. Its LED is red while charging and green when full
- Play time: **~8 h**
- Alternative: **6 × AA** alkaline. **Never rechargeable AAs.**
- Swap: undo one screw near the reload switch
- Live readout on the wire: pack voltage, cell voltage and charge % every ~30 s (e.g. 7.52 V pack / 3.96 V cell / 43 %) ✅
Source: docs/reference/community-notes.md, docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/experiment-log.md (2026-08-24)

## POLARITY IS REVERSED.
Battle Company wires the pack connector the opposite way to the usual convention. Check it with a meter before you wire any replacement pack, external charger or adapter. Getting it wrong risks damaging the tagger.
Source: docs/reference/community-notes.md (Battery / power)

_[image HW-06: (battery pack + connector, see Images table)]_

## Power habits that keep a fleet alive
- **Charge outside the gun**: owners splice a BRX AC adapter onto a spare connector. Keep a stack of charged packs and swap them in the field. 👥
- **Keep them topped up**: below a certain battery level the stock firmware **stops re-pairing Bluetooth**. That quietly drops players out of hosted games. 👥
- **Rest the guns between sessions**: a tagger left powered all day can enter the "screamer" state. It buzzes loudly and refuses connections until you reboot it and let it rest. 👥 ✅
- **Riding electronics**: an add-on may pull under ~300 mA from the tagger, and Battle Company confirmed that is fine. Anything bigger should carry its own power bank. 👥
Source: docs/reference/community-notes.md, docs/gotchas.md, docs/experiment-log.md (2026-08-26 screamer)

Headset power
| col 1 | col 2 | col 3 |
|---|---|---|
| Cell | one 18650 lithium cell (v2) | 👥 |
| Charging | any USB 5 V supply | 📖 |
| Voltage readout | shown in the tagger's USB console (e.g. "Head: 3.84 V") | ✅ |
Source: docs/reference/community-notes.md, docs/reference/brx-extended-user-guide.md, protocol/brx-protocol.md §7c
