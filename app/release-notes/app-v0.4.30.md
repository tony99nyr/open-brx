## Open BRX phone app 0.4.30

This build installs over 0.4.6 or later. It includes everything in 0.4.29. The Stick firmware floor is still h8-0.3.

### Changed

- **Your phone shows its own sync after the whistle.** A track on the phone shows what Mission Control sees: NOT LINKED, LINKED, SENDING with the count left, then RECEIVED. If it stalls, the phone says why in one line (no Wi-Fi to Mission Control, Mission Control not answering, mobile data, no progress) and what to do. The lobby shows the same state as a small chip.
- **The phone shows "Result pending" until Mission Control releases the result** (A81). No winner shows at the whistle. The result arrives when every phone and hill is in, or when the host presses FINALISE. The victory sound plays only if that happens within 30 s of the whistle.
- **[PENDING A83] Mission Control releases the result by itself 120 s after the whistle,** if phones or hills are still missing. _Fill in at cut time._
- **[PENDING F595] The phone's post-match sync is faster.** _Fill in at cut time._
- **[PENDING] A result that changes after release shows RESULT UPDATED on the phone.** _Fill in at cut time._
- **Perks and weapons (the 0.4.31 balance set):**
  - **Fast Hands replaces Quick Hands and Quick Switch.** It halves your reload and swap times, with no ammo or armour cost. A saved loadout with either old perk gets Fast Hands.
  - **Body Armor gives 20 extra armour,** down from 25. It still makes your reload a quarter slower.
  - **Extended Mags gives half again as many rounds on the Shields preset** (×1.5). On Standard it still doubles the magazine.
  - **The AMR fires more slowly:** 450 ms between shots, up from 350 ms.
  - **Armour Piercing rounds are rebalanced.** The Assault Rifle, SMG and Energy Rifle fire lighter AP rounds faster. The Suppressor fires heavier AP rounds more slowly. The Shotgun's AP round cycles a little faster.
- **Kill-speed numbers include the headset hit** (F614). When a kill needs the headset to register the last hit, the published time to kill now counts it. The Shotgun reads 0.97 s, up from 0.89 s. The game itself did not change.
- **The Mission Control console has fewer long help notes** (F599, a Mission Control change). The report, push and locked-kit messages are clearer.

### Fixed

- **A hill's last moments count who was there at the whistle** (F598). A player who walks into the hill after the whistle no longer contests the time before it.
- **The Mission Control operator menu stays in view** (F615) when a new line appears above the board, until you scroll the page.

### Not visible to players

- The balance simulator now matches the 0.4.31 catalogue and counts whole hits for every gun (F617, F619, F620, F625). The gate and lander tooling changed (F574, F621, F624).
- The September firmware addresses are gone from the docs (F622).

### Carried from 0.4.29

See `app-v0.4.29.md`.
