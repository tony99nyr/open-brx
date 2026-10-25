## Open BRX phone app 0.4.26

This build installs over 0.4.6 or later. It includes everything in 0.4.25, plus the fixes and balance changes that followed the 2026-10-17 field day. Reflash every Stick from main: the Stick firmware changed (F557, F559).

### Changed

- **Single-shot weapons fire when the player pulls.** A single-shot weapon fires on the first trigger press at or after its cycle time. The Shotgun cycle is now 400 ms. The AMR, USP and Bolt Rifle are retuned.
- **Melee range is 60 outdoors, down from 90** (F567). Indoors keeps 90. The bench still has to show that 60 cuts the reach.
- **The USP does 10 damage and the Shotgun gun word is 19** (F579). The duel engine now runs at field pace. At that pace the rifles beat the USP too often and the Shotgun lost some fights. A close Shotgun pull is 39 and still kills in three.
- **The Sniper Rifle does 75 damage with a 2.2 s bolt** (F573). It is a pure bolt action: one round, one lever pull per shot. Two hits kill.
- **Mission Control publishes the field fight interval** (F576). Compile and the balance sims now time a single-shot weapon the same way.
- **Loadout weapons carry twice the reserve ammo**. The reserve is capped at the largest reserve proven on a gun, 384. Extended Mags now reads x2 MAG.
- **The default spawn weapon delay is 1500 ms** (A74). Players have to hide to spawn. 500 ms stays a legal choice.
- **A new AMMO pickup station refills the taker's ammo** (A76). It tops slots 0 and 1 up to each slot's spawn reserve. It repeats every 60 s, and the host adds it from the ITEMS panel.
- **The hill is about 10% larger.** The control presence default moves from -75 to -78 dBm, for phones and Sticks. The Stick value is not yet proven.
- **An owned hill banks time only while a living owner is on it** (F554). A hill no longer pays owners who are all down, and an enemy alone on the point drains it.
- **A control station scores its own held time** (F555). Mission Control scores a station hill on the station's `hold_ms`. The tally counts played time only and survives a station or MC restart.
- **A long hill hold is saved as it grows** (F557, Stick half). The Stick writes the tally at most every 30 s, so a restart loses at most that. Reflash the Stick.
- **The hill capture time and net cap are set from the console** (F559). KOTH shows CAPTURE TIME and NET CAP on the PLAY strip, and a favourite saves them. The Stick keeps the pace it runs after a restart. Reflash the Stick.
- **The control station status carries the hill inputs** (F558): net, counts and lead.
- **With two hills, held time adds up across the hills** (F556). LIVE and RECAP say so, and show the most a team can hold.
- **The KOTH hold target counts the time summed across both hills** (F572). The phone brief and the host note say so. The setup warning counts the assigned hills.
- **The Haze (smoke gun) is hidden** (F577). It leaves every picker, preset pool and type toggle until its blind is benched.
- **BUILD offers pistols for PRIMARY.** A pistols-only round can now be built in BUILD.

### Fixed

- **The SMG $WEAP frame keeps its `,*` terminator** (F548). A compiled frame with no terminator is now refused before it reaches the gun.
- **An ALT before the first pull is ignored, and an old-slot round closes the swap** (F542, cause 2; F445). An old-slot round at least 250 ms after the ALT press proves the swap did not happen.
- **A zeroed `$LCD` is no config** (F549, F550). Only a slot 0 `$ALCD` proves the config. A refused kit shows in the lobby. Mission Control blocks on GUN DID NOT TAKE THE CONFIG: CHECK THE KIT, and no longer marks the headset absent.
- **A reload the gun never answered says RELOAD DID NOT TAKE** (F277). The warning shows on the ammo block, on its own slot, until a shot retires it.
- **A head row echoed while the head is on the link is not a round** (F570). No 01/0 or OUT OF AMMO flash at go-live or after a heal.
- **The recap medals wrap and the honours strip names the holders** (F561). A nine-medal row showed six. A long leaderboard shows MORE.
- **The perk picker hides a perk blocked for the current weapons** (F551). Mission Control also drops such a perk from a stored loadout, and the phone hears the reason.
- **The phone names its device make and model** (F564), native app only. Mission Control keeps it per phone.
- **A charge rifle cell below one full charge reads NOT ENOUGH ENERGY, not OVERHEAT** (F238).
- **A welcome checked against an empty trust-key list fails as `no_key`** (F553). The log says to tap JOIN or scan the QR.
- **An expired saved context no longer logs before the engine exists** (F566).
- **The manual SHARE LOG offer counts as this phone's offer** (F157), so Mission Control's `pull_log` answer is handled.
- **A failed gun reconnect backs off** (F563). It tries at 10 s for 12 tries, then 30, 60 and longer. A resting reconnect wakes when a match arms.
- **A Stick hill in an adopted live match scores** (F568). Mission Control now starts the control station, with no deadline.

### Mission Control (host)

- **A write refused for a stale operator token shows a red line with the cure** (F540). A refused `/ui-ws` backs off and never reads as connected.
- **The RANGE EDITED line clears when the station reports Mission Control's value** (F543).
- **A pick keeps the operator's venue** (F546). A resumed match without a venue restores outdoors.
- **A new Mission Control install identity is logged and told to the operator once** (F552).
- **The stored match end time is the match's own end** (F560). An 838 s match no longer reads 6705 s.
- **A perk the new weapon cannot carry is dropped, not refused** (F551). The COULD NOT COMPILE line is told once per player.
- **The off-grid notice is exact**. With every phone off-grid it says no phone can reach Mission Control. Otherwise it counts and names the phones.
- **The charge rifle caution says what was measured** (F226). A charge below 10 rounds fires nothing.

### Carried from 0.4.25

See `app-v0.4.25.md`.
