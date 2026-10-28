## Open BRX phone app 0.4.30

This build installs over 0.4.6 or later. It includes everything in 0.4.29. The Stick firmware floor is still h8-0.3.

### Changed

- **Your phone shows its own sync after the whistle.** A track on the phone shows what Mission Control sees: NOT LINKED, LINKED, SENDING with the count left, then RECEIVED. If it stalls, the phone says why in one line (no Wi-Fi to Mission Control, Mission Control not answering, no progress) and what to do. Over mobile data it says that sending is slower. The lobby shows the same state as a small chip.
- **The phone shows RESULT PENDING until Mission Control releases the result** (A81). No winner shows at the whistle. The result arrives when every phone and hill is in, or when the host presses FINALISE. The victory sound plays only if that happens within 30 s of the whistle. If the phone has not reached Mission Control 30 s after the whistle, it shows MC NOT REACHED · SEE MISSION CONTROL.
- **The result never waits more than 2 minutes** (A83). If a phone or hill still has not reported 2 minutes after the whistle, Mission Control releases the result without it. The console names who it is waiting for (for example WAITING FOR ECHO, CONTROL POINT 1, with +N MORE past three) and counts down with FINAL IN. After a timeout it shows FINAL AFTER 2 MIN WITHOUT and the names. The host can still press FINALISE sooner. A phone that is still sending gets no result until it has sent everything.
- **The result reaches every phone sooner** (F595). After the whistle, the phone reports to Mission Control at once. For up to 10 minutes it redials after at most about 2 s, instead of up to 10 s. Mission Control waits for every phone before it releases the result, so one slow phone delays it for everyone. That wait is now shorter.
- **Your phone shows RESULT UPDATED if a late phone or a host correction changes the winner or your outcome.** The results screen opens again, once, and the match history marks the match with UPDATED. A change to the scores alone does not count.
- **Perks and weapons (the balance set signed off on 25 October):**
  - **Fast Hands replaces Quick Hands and Quick Switch.** It halves your reload and swap times, with no ammo or armour cost. A saved loadout with either old perk gets Fast Hands.
  - **Body Armor gives 20 extra armour,** down from 25. It still makes your reload a quarter slower.
  - **Extended Mags gives half again as many rounds on the Shields preset** (×1.5). On Standard it still doubles the magazine.
  - **The AMR fires more slowly:** 450 ms between shots, up from 350 ms.
  - **Armour Piercing rounds are rebalanced.** The Assault Rifle, SMG and Energy Rifle fire lighter AP rounds faster. The Suppressor fires heavier AP rounds more slowly. The Shotgun's AP round cycles a little faster.
- **Kill-speed numbers include the headset hit** (F614). When a kill needs the headset to register the last hit, the published time to kill now counts it. The Shotgun reads 0.97 s, up from 0.89 s. The game itself did not change.
- **The Mission Control console has fewer long help notes** (F599, a Mission Control change). The report, push and locked-kit messages are clearer.

### Fixed

- **A phone hill station's last moments count who was there at the whistle** (F598). A player who walks into the hill after the whistle no longer contests the time before it.
- **A phone no longer stays on PROVISIONAL after the 2-minute release** (F630), and no second, identical result arrives.
- **A team change after the whistle no longer changes that match's result** (F631, a Mission Control change).
- **A rename or team change in the debrief no longer clears that player's result on their phone** (F632). Only the next match's setup leaves the results screen.
- **A host edit in the last moments of a timed match no longer clears a phone's result** (F634). A phone keeps its result for the match it ended, even if the host renames or re-teams a player before Mission Control reaches the debrief.
- **A phone that rejoins after the release gets the current result, never the old one first** (F633). While it waits, the console shows MATCH OVER · WAITING FOR RESULTS.
- **The Mission Control operator menu stays in view** (F615) when a new line appears above the board, until you scroll or tap elsewhere.

### Not visible to players

- The start script installs or updates cloudflared to 2026.10.2 or later, and says so if it cannot (a Mission Control change).
- The balance simulator now matches the new catalogue and counts whole hits for every gun (F608, F611, F617, F619, F620, F625). The gate and lander tooling changed (F574, F621, F624).
- The September firmware addresses are gone from the docs (F622).

### Carried from 0.4.29

See `app-v0.4.29.md`.
