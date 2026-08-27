# Charging & Batteries
_Two ports on the gun, two kinds of charger, one polarity trap._
Last verified: 2026-08-27

## Power at a glance
- **Gun pack:** 7.4 V Li-ion, ~2200 mAh, two cells, 2-pin connector. 👥
- **Gun charger:** the supplied 8.4 V two-cell smart charger; LED red while charging, green when done. 📖
- **Run time:** roughly 8 h of play per full charge. 📖
- **Headset:** charges from any USB 5 V source; the v2 headset runs on a single 18650 cell. 📖👥
- **Fallback:** the gun can run on an optional 6×AA holder — **alkaline only, never rechargeable AAs.** 📖
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

Battery polarity is REVERSED from the usual convention. If you ever replace the pack, build spares, or wire an external charger, verify polarity with a meter before connecting — a reversed pack risks damaging the tagger. Some aftermarket packs have a 3-pin connector; the BRX ignores the third (thermistor) pin.
Source: docs/reference/community-notes.md

Two ports, do not confuse them. The round charging port takes the charger. The micro-USB "Programing Port" next to it is for firmware and sound updates only (see *Firmware & Sounds*) — it is not a charging input.
Source: docs/reference/brx-manual-notes.md, docs/reference/brx-extended-user-guide.md

## Swapping the gun battery
1. Power off and unplug the charger. 📖
2. Remove the single screw near the reload switch to open the battery bay. 📖
3. Disconnect the old pack; check the new pack's polarity against the old one before plugging in. 👥
4. Close up, power on, listen for the startup sound. 📖
Source: docs/reference/brx-extended-user-guide.md, docs/reference/community-notes.md

Field practice from the owner community: keep a stack of charged spare packs and swap in the field instead of trying to top up a gun from a power bank. A spliced BRX AC adapter can charge packs outside the gun.
Source: docs/reference/community-notes.md

Low battery has a hidden cost: below a certain charge the BRX firmware will not re-establish its Bluetooth link to a phone. If the app suddenly cannot reconnect late in a day of play, suspect the battery before the phone.
Source: docs/reference/community-notes.md (SCREAMERS), docs/gotchas.md

_[image OPS-02: ]_
