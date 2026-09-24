## Open BRX phone app 0.4.6

**Uninstall the old app once before you install this one.** 0.4.6 is the first build signed with the
Open BRX release key. Earlier builds used a test key, so Android will not install 0.4.6 over them.

### New in play

- **What hit you.** When you are hit, the HUD names the weapon. It reads the hit's IR cell as well as its
  strength, so two weapons that hit equally hard are told apart far more often.
- **Who you killed.** A kill names the player you took out: their tagger says who downed it.
- **Poison kills count.** A kill by poison credits the player who poisoned you.
- **The death screen.** When you go down, you see who killed you and with what: the weapon, or PICKUP, CRIT or
  POISON, or "A / B" when two weapons could match. Below that are up to four callouts (damage taken, damage
  dealt, kills and time alive) and a game strip with the clock, the team race, the hill and your K/D.
  - A callout with nothing to say is not shown.
  - A number still waiting on Mission Control is greyed, with an out-of-sync icon, so the screen never passes
    off a partial count as final.
- **IR callouts.** A death or a hill capture is sent by infrared from the tagger where it happened, so nearby
  players see it on their HUD even when their phone has no signal.
- **Recoil and balance.** Recoil now builds with each round you fire in one pull, scaled by calibre, and
  resets when you release the trigger. Several weapons were retuned against the duel rules. The full list,
  with the reason for each, is the Balance rules table at the top of
  [weapon-design.md](https://github.com/tony99nyr/open-brx/blob/main/docs/weapon-design.md).

### Cleaner screens

- **One callout card.** Kills, IR callouts and hill changes share one card, and a kill buzzes once.
- **Night mode reads better.** Night screens keep their frames, drop the green, and the READY UP button is the
  strongest control on screen.
- **Bigger controls.** Kit, loadout and result buttons are at least 44 px tall on the smallest phones.
- **The host's console.** Mission Control got a full visual pass. Among the changes: a King of the Hill match
  shows hill time as the score, the board stays honest after Mission Control restarts, the lobby and kit screens
  lock while a match is live, and the spectator wall fits every player.

### Better connections

- **Coverage is counted honestly.** Mission Control now counts a phone as covered only when it reaches
  Mission Control through the internet tunnel on mobile data. You do not need to change any settings.
- **Stays on the game Wi-Fi.** On Android, the app keeps its link to Mission Control on the game Wi-Fi
  even when that Wi-Fi has no internet. Leave mobile data as it is.
- **The host can see a protected player.** If your phone drops out just after you respawn, the host's
  board now warns that you may still be protected.

### Not yet

- **Per-venue IR power (S48)** and the **close-range headset-damage setting (F275)** are still waiting
  on bench tests. They are not in this build.
- **Hearing your own team's hill capture (F312).** With friendly fire off, the team that takes a grenade
  hill may not hear its own capture. A fix is ready but bench-gated, so it is not in this build.
