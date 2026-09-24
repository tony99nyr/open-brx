## Open BRX phone app 0.4.7

If you have 0.4.6, this build installs over it. If you still have 0.4.5 or earlier, uninstall that once first:
older builds used a test key, and Android will not update across keys.

### Steadier matches

- **Mission Control can restart mid-match without losing you.** A new automated stress test plays whole
  matches against Mission Control and restarts or crashes it at bad moments. It found four ways a restart
  could drop a player's kills and deaths from the board (F326-F329). All four are fixed:
  - a player who joined after the start;
  - a phone that was offline during a second restart;
  - an offline phone when the frag cap was checked again;
  - a player who joined in the two seconds before a crash.
- **A kit-lock notice clears with its game.** A "kit locked" notice from one game no longer stays on the
  phone into the next game (F133).
- **Gun light timings.** The phone and Mission Control now read the gun's light-readout timings from one
  place, so they cannot drift apart (F52). You will not see a change.

### For the host

- **Volume per game.** A game can set its own play volume (60-100) on the game setup screen. It stays when you
  switch modes, and a stock game uses the venue volume (K8).
- **Scanner respawn keeps its trigger setting.** A scanner respawn's trigger or presence setting no longer
  resets when the host changes the game settings (F325).
- **A clear message when the port is busy.** If another program holds Mission Control's port, Mission Control
  now says so and stops, instead of printing its start banner first (F108).
- **Console fixes from the visual review (F318).** When Mission Control is offline, LIVE reads LAST KNOWN
  instead of a red LIVE. The event feed no longer shows the same go-live or recall line twice. Locked KIT
  controls look locked, and small buttons and labels are bigger.
- **M5StickS3 stations join over Wi-Fi.** A StickS3 station can now join Mission Control over Wi-Fi as a
  utility station, and it keeps working if the Wi-Fi drops (H8).

### Built, but off

- **Powerups are in this build, and they are OFF by default.** Nothing about them shows in a normal game.
  A host turns them on only by starting Mission Control with `./start.sh -- --powerups`. They stay off until
  the bench tests of the spare weapon slots are done. When on, a station spawns a weapon (Rockets, Rail Gun)
  or an Overshield on a timer, and you take it by standing about a foot from the station for one second.

### Not yet

- **Per-venue IR power (S48)**, the **close-range headset-damage setting (F275)** and **hearing your own
  team's hill capture (F312)** are still waiting on bench tests. They are not in this build.
