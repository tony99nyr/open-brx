## Open BRX phone app 0.4.28

This build installs over 0.4.6 or later. It includes everything in 0.4.27. Reflash every Stick from main before you play: Mission Control now flags any Stick below firmware h8-0.3 with STICK FIRMWARE TOO OLD: REFLASH IT.

### Changed

- **The loadout pickers offer only what works with your perk.** With Armour Piercing held, the weapon tabs offer only weapons that can carry it. A weapon pick that drops the held perk clears it with no warning. On the Shields health preset, Armour Piercing and Body Armor are not offered.
- **The Mission Control console is calmer** (F599, a Mission Control change). Faults show as red pills, warnings as amber chips on their item, and the help notes sit behind an INFO button.
- **The Toxin Rifle shows an ammo bar, not pips** (F547). Pips now show only when one pip is one round, for magazines of 20 or fewer. A larger magazine shows a bar that turns amber when low. With Extended Mags, the AMR, Glock, Bolt Rifle and Stinger also move to the bar.
- **Results wait for every phone** (F596, F597). After the whistle, RECAP shows RESULTS PENDING, with no winner or scores, until every phone bound at the whistle and every hill station has sent its match. The operator can press FINALISE to stop waiting. A sync strip above the table shows which phones are in, and it fits on a 1280 by 720 screen.
- **The post-match sync is faster** (F595). Mission Control keeps the Mac awake, and it starts the cellular backhaul itself during kit. A phone dials the game Wi-Fi first and uses the backhaul only when it loses the Wi-Fi. A phone also tells Mission Control how many results it still holds.
- **The perk texts say that the Sniper Rifle's bolt is exempt** (F584). Extended Mags, Quick Hands and Body Armor now say what the game already did.

### Fixed

- **A phone hill station keeps true time** (F590, F593). The station's clock never goes backwards and catches up after the phone sleeps, so a phone clock stepped back cannot hold the whistle off. A hill reopened after its whistle starts its clock again, and a whistle that passed with no tick is settled first.
- **A Stick restarted while offline keeps its tamper lock** (F391). The lock comes back as it was before the restart, and is saved at most once a minute. A Stick switched off long after its match comes back locked for its saved time: hold A and B for 7 s to clear it.
- **A Stick reports its hill pace** (F591), so Mission Control can show the capture time and the cap the Stick runs.
- **An ammo grant counts only once the gun takes it** (F589). A failed write no longer books the grant.
- **A Wi-Fi reconnect right after a cellular one is not held back** (F588).
- **Mission Control explains more of its refusals** (F585, F594). An empty secondary pool is refused like the primary, naming the slot. A fixed perk that leaves a weapon slot empty names the perk and the weapon it allows.
- **Seven small Mission Control fixes** (F586), among them a pasted console link that now reconnects the console at once.

### Not visible to players

- The EMP perk is built but hidden. It is not in any catalogue yet.
- Review and polish rounds for 0.4.28 fixed stale comments, test names and bench steps.

### Carried from 0.4.27

See `app-v0.4.27.md`.
