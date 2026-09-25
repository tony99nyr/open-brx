## Open BRX phone app 0.4.12

If you have 0.4.6 or later, this build installs over it. If you still have 0.4.5 or earlier, uninstall that once first:
older builds used a test key, and Android will not update across keys.

### Fixed

- **Solo Last Man Standing registers hits (Q13).** Every player in a solo match shares one team, and team damage was
  off, so no hit could land and every kill counted as a team kill. Team damage is now on only in a one-team game
  (free-for-all, or Last Man Standing played solo). Every team game keeps it off, and the phone briefing and
  Mission Control say TEAM DAMAGE: OFF.
- **A corrupted health reading no longer leaves a player unkillable (F341).** After a dropped Bluetooth chunk, the app
  repairs an impossible health, armour or shield reading instead of reporting it as is.
- **On Android 11 and older, the tagger picker now says why it finds nothing (F340).** It asks you to turn Location
  services on, since a Bluetooth scan needs that setting on those versions, and it rescans once you do.
- **Kill and shield sound cues no longer queue up behind the shield's background hum (F347).** The hum held later
  cues back; the gun no longer plays it.
- **The "health critical" line no longer plays after the death scream (F375).**
- **Reconnecting mid-game restores your real ammo count, not a free magazine (F164).**
- **A pickup Stick station no longer offers its item before your first spawn (F374).**

### New

- **A voiced medal for every kill streak, from a double to an eight-kill (A61), and a recap AWARDS table with honours
  such as Killjoy and Beat Down (A63).**
- **Your own death always wins the announcer queue (F351): no other line cuts in ahead of it.**
- **No kill confirmation plays for a kill after the whistle, whether the frag cap, a host end or time runs out, and a
  kill credited only to a smoke or EMP hit now credits the team, not a bystander (F357, F354).**
- **A phone with no saved Mission Control auto-joins the only one it finds, no tap needed (F346 d).**
- **Gamertags are capped at 16 characters, with a warning past 12; the lobby and kit screens say so (F366).**
- **Pistol Extended Mags is now +50% ammo, not double (D5); every other weapon keeps the x2.**
- **SMG and Rocket Launcher outdoor range move to 40%, Rail Gun to 100% (F231); a held Assault Rifle trigger now uses its retuned recoil stages (F308).**

### For the host

- **Mission Control now assigns every station's id itself; you never type one (F364).**
- **A station's range and signal strength can be edited live, on the phone, the Stick or in Mission Control, and the
  change syncs everywhere (F365).**
- **Mission Control's alerts now follow one red/amber/neutral colour rule across every screen (F221).**
- **Respawn range is set per platform, about 3 m for either a phone station or a StickS3 (F345).**
- **In Infection, only the survivors hear that someone was infected; the zombies do not (F319).** The extraction
  alert is now a silent HUD event, and Mission Control keeps its event feed across a restart.
- **The hill setup says what each hill source announces (F319):** a phone or Stick hill says captured, lost and
  contested; the post-MVP grenade hill never says contested.
- **WebView debugging is now a switch in the app's diagnostics panel (Android only), default on for tester builds
  (B21).**

### Not yet

- **Powerups (F372)** are built but still off by default; they turn on once the full powerup bench sitting passes.
- **iOS** has no distribution build yet, and the debugging switch above is Android only (B21).
- **King of the Hill and melee** still show a generic icon in the phone briefing; custom art is still to come
  (S32).
- **A solo Last Man Standing match can still end without declaring a winner (F377)**, a gap the Q13 fix exposed.
