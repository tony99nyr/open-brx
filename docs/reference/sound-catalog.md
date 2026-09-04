# BRX sound catalog (derived)

Every sound on a v4.32 tagger, read off the gun's own `AUDIO` folder on 2026-09-03 and analysed with `mcp/tools/soundbank_analyze.py` (transcripts by Whisper, shapes by librosa), then labelled by `soundbank_classify.py`. **Restated, derived data only: no audio and no Battle Company files live in this repo.** Machine-readable copy: `mcp/brx_mcp/data/sound_catalog.json`.

- **2634 ids**: 2477 on the gun, 157 listed by the app but NOT on the gun (they play the fallback), 468 on the gun but unknown to the app.
- Format on the gun: headerless raw PCM, signed 16-bit little-endian, mono, 44 100 Hz, one `<ID>.LTP` per id.
- Transcripts are Whisper's; a word-level slip is possible on a single line (e.g. "Flight captured" for "Flag captured"). Where a family repeats a line three times (kill confirms), the majority reading is right.

## Character voices — one 22-slot layout, every character

| slot | role | example (Heavy) |
|---|---|---|
| 1 | intro | V31 Charge! |
| 2 | idle loop | V32 Oh |
| 3 | death scream | V33 AHHHHHHHHH |
| 4 | death scream | V34 AHHHHHHHHHH |
| 5 | death scream | V35 AHHHHHHHHH! |
| 6 | hurt loop | V36 Hmm. Hmm. Hmm. |
| 7 | healed | V37 patched up |
| 8 | kill confirm | V38 All clear! |
| 9 | kill confirm | V39 All clear. |
| A | kill confirm | V3A All clear. |
| B | defeat taunt | V3B Pain is my friend. |
| C | pain | V3C Hmm |
| D | pain | V3D Phew! |
| E | pain | V3E MMMMMMMMMMMMMMMMMMMM |
| F | pain | V3F Yeah |
| G | pain | V3G OOF |
| H | pain | V3H MMMM |
| I | boast | V3I Get some! |
| J | long death | V3J Bwrrrrrrrr!! Zzzzzzzzzzzztttttttttttt!! |
| K | taunt | V3K Ooh, bet that hurt. |
| L | taunt | V3L The battle is ours. |
| M | name | V3M heavy |

The `$PSET` voice tail is six of these slots (death scream · boast · pain ×3 · healed for Heavy: V33 V3I V3C V3G V3E V37). Swap the character prefix to change the voice.


### Announcer (female, objectives) (68)

| id | s | category | words |
|---|---|---|---|
| VB01 | 1.2 | objective_other | base captured. |
| VB02 | 1.5 | objective_other | BASE DESTROYED |
| VB03 | 2.5 | game_over | Blue team is closing in on victory. |
| VB04 | 1.6 | objective_flag | Blue flag captured. |
| VB05 | 1.7 | objective_flag | Blue flag returned. |
| VB06 | 1.7 | objective_flag | Blue flag taken. |
| VB07 | 2.0 | lead | Blue team takes the lead. |
| VB08 | 2.6 | clock | Blue team has one player remaining. |
| VB09 | 1.1 | objective_codes | Code's captured! |
| VB0A | 1.4 | objective_codes | Code's compromised. |
| VB0B | 1.4 | objective_codes | Codes returned. |
| VB0C | 1.3 | objective_flag | Flag captured. |
| VB0D | 1.6 | objective_flag | Flag returned. |
| VB0E | 1.7 | objective_flag | flag taken |
| VB0F | 1.4 | objective_other | Fortress Captured. |
| VB0G | 1.4 | objective_other | Fortress Lost. |
| VB0H | 2.7 | game_over | Green team is closing in on victory. |
| VB0I | 1.5 | objective_flag | Green flag captured. |
| VB0J | 1.8 | objective_flag | Green flag returned. |
| VB0K | 1.5 | objective_flag | Green flag taken. |
| VB0L | 2.0 | lead | Green Team takes the lead. |
| VB0M | 2.8 | clock | Green Team has one player remaining. |
| VB0N | 1.9 | objective_hill | Hill Captured |
| VB0O | 2.1 | objective_hill | Hill Contested |
| VB0P | 3.0 | objective_hill | Hill Lost! |
| VB0Q | 2.4 | objective_hill | Hill Moved |
| VB0R | 2.6 | game_over | Pink Team is closing in on victory. |
| VB0S | 1.5 | objective_flag | Pink flag captured. |
| VB0T | 1.7 | objective_flag | Pink Flag Returns! |
| VB0U | 1.5 | objective_flag | Pink Flag Taken. |
| VB0V | 1.9 | lead | Pink Team takes the lead. |
| VB0W | 2.5 | clock | Think Team has one player remaining. |
| VB0X | 2.7 | game_over | Purple team is closing in on victory. |
| VB0Y | 1.5 | objective_flag | Purple flag captured. |
| VB0Z | 1.9 | objective_flag | Purple Flag Returns. |
| VB10 | 1.7 | objective_flag | Purple flag taken. |
| VB11 | 1.8 | lead | Purple team takes the lead. |
| VB12 | 2.7 | clock | Purple team has one player remaining. |
| VB13 | 2.6 | game_over | Red team is closing in on victory. |
| VB14 | 1.7 | objective_flag | Red flag captured. |
| VB15 | 1.8 | objective_flag | Red flag returned. |
| VB16 | 1.5 | objective_flag | Red Flag Ticken |
| VB17 | 1.9 | lead | Red team takes the lead. |
| VB18 | 2.8 | clock | Red team has one player remaining. |
| VB19 | 2.9 | game_over | SCIEN TEAM IS CLOSING IN ON VICTORY! |
| VB1A | 1.7 | objective_flag | Scion flag captured! |
| VB1B | 1.9 | objective_flag | Cyan Flag returned. |
| VB1C | 1.9 | objective_flag | Sion Flag Ticken |
| VB1D | 2.4 | lead | SCIEN TEAM TAKES THE LEAD |
| VB1E | 2.8 | clock | Sion Team has one player remaining. |
| VB1F | 2.6 | game_over | Yellow team is closing in on victory. |
| VB1G | 1.6 | objective_flag | Yellow flag captured. |
| VB1H | 2.0 | objective_flag | Yellow flag returned. |
| VB1I | 1.5 | objective_flag | Yellow flag taken. |
| VB1J | 2.0 | lead | Yellow team takes the lead. |
| VB1K | 2.6 | clock | Yellow team has one player remaining. |
| VB1L | 1.5 | line | you control the battlefield. |
| VB1M | 1.6 | objective_other | The infection is spread. |
| VB1N | 1.9 | game_over | Grame Team wins! |
| VB1O | 1.8 | game_over | Bravo Team wins! |
| VB1P | 1.9 | game_over | Blue Team wins! |
| VB1Q | 1.8 | game_over | Alpha Team wins! |
| VB1R | 2.0 | game_over | Yellow Team wins! |
| VB1S | 2.3 | game_over | SCIENTEAM WINS! |
| VB1T | 2.2 | line | The survivors have held their ground. |
| VB1U | 1.9 | game_over | Red team wins. |
| VB1V | 2.1 | game_over | Purple Team wins! |
| VB1W | 1.8 | game_over | Pink Team wins! |

### Announcer (game callouts) (34)

| id | s | category | words |
|---|---|---|---|
| V100 | 1.6 | grunt | AHHHHHHHHH! |
| V108 | 12.0 | objective_hill | King of the hill. Control the hill to earn points. |
| V109 | 13.3 | objective_flag | Capture the flag! |
| V110 | 12.3 | team | Slayer Pro. Eliminate the enemy team. |
| V111 | 1.5 | game_over | Game over! |
| V112 | 2.3 | clock | 30 seconds left. |
| V113 | 2.1 | clock | One minute left. |
| V114 | 1.1 | clock | 10 seconds! |
| V115 | 2.9 | game_over | NEXT KILL WINS! |
| V116 | 1.3 | line | Can't believe! |
| V117 | 1.1 | lead | lost the lead. |
| V118 | 1.6 | game_over | Victory! |
| V119 | 2.1 | game_over | Closing in on victory! |
| V120 | 2.4 | clock | Five minutes remain. |
| V121 | 1.4 | killstreak | Ordinance ready! |
| V122 | 1.5 | medal | Double kill! |
| V123 | 1.3 | medal | Triple kill |
| V124 | 1.9 | medal | KILL TACULAR! |
| V125 | 1.5 | medal | Killing spree |
| V130 | 1.8 | line | Overshield |
| V131 | 1.9 | objective_flag | Flag Defense! |
| V132 | 1.7 | objective_flag | Flag champion! |
| V133 | 1.4 | objective_flag | Flight Captured! |
| V134 | 2.1 | lead | Enemy team scored. |
| V135 | 1.5 | objective_flag | Carrying flag |
| V136 | 1.4 | objective_flag | Carrier kill! |
| V137 | 1.7 | objective_flag | Your flag taken. |
| V138 | 2.2 | objective_flag | Protect your flag |
| V139 | 1.7 | kill_confirm | Kill their carrier! |
| V140 | 2.2 | objective_flag | flight assassination |
| V141 | 1.3 | objective_flag | Flight Runner! |
| V142 | 1.6 | objective_flag | flag reset. |
| V143 | 1.3 | objective_flag | Flag kill. |
| V144 | 2.1 | objective_flag | FLAG JOST! |

### Announcer (lives) (8)

| id | s | category | words |
|---|---|---|---|
| VT00 | 1.5 | status_health | for lives remaining. |
| VT01 | 1.8 | status_health | Three lives remaining. |
| VT02 | 1.6 | status_health | Two lives remaining. |
| VT03 | 1.4 | clock | One life remaining. |
| VT0U | 1.3 | status_battery | Battery low. |
| VT1Q | 0.5 | menu | deaths. |
| VT1T | 0.6 | kill_confirm | kills |
| VT1U | 0.5 | grunt | No. |

### Announcer (male) (354)

| id | s | category | words |
|---|---|---|---|
| VA01 | 0.7 | grunt | one. |
| VA02 | 0.5 | number | 2. |
| VA03 | 0.5 | number | 3. |
| VA04 | 0.7 | number | Four. |
| VA05 | 0.7 | number | Five. |
| VA06 | 1.0 | number | Six. |
| VA07 | 0.8 | number | seven |
| VA08 | 0.6 | number | 8. |
| VA09 | 0.7 | grunt | Nine. |
| VA0A | 0.5 | number | 10 |
| VA0B | 0.9 | number | 11 |
| VA0C | 0.8 | number | 12 |
| VA0D | 0.9 | number | 13 |
| VA0E | 1.1 | number | 14 |
| VA0F | 0.8 | number | 15 |
| VA0G | 1.0 | number | 16. |
| VA0H | 1.0 | number | Seventeen. |
| VA0I | 0.7 | number | 18. |
| VA0J | 0.9 | number | 19. |
| VA0K | 0.5 | number | 20. |
| VA0L | 0.9 | number | 21. |
| VA0M | 0.8 | number | 22. |
| VA0N | 1.0 | number | 23 |
| VA0O | 0.9 | number | 24. |
| VA0P | 1.3 | number | 25 |
| VA0Q | 1.2 | clock | Seven minutes. |
| VA0R | 1.1 | clock | 30 seconds. |
| VA0S | 2.1 | clock | 45 seconds ramp up |
| VA0T | 1.8 | clock | 45 seconds. |
| VA0U | 1.4 | line | Ramp 60. |
| VA0V | 1.3 | clock | 60 seconds. |
| VA0W | 2.0 | clock | 90 seconds ramp up. |
| VA0X | 1.5 | clock | 90 seconds. |
| VA0Y | 1.8 | line | Advanced Communications. |
| VA0Z | 1.9 | killstreak | Advanced UAV detected. |
| VA1 | 1.1 | line | Watch this. |
| VA10 | 1.5 | killstreak | Advanced UAV. |
| VA11 | 0.9 | killstreak | Air Raid |
| VA12 | 1.4 | killstreak | Airstrike detected. |
| VA13 | 1.1 | team | Alpha Team. |
| VA14 | 1.1 | menu | ammo pouch. |
| VA15 | 1.6 | weapon_name | Armor Piercing Rounds |
| VA16 | 0.9 | menu | armor suit. |
| VA17 | 1.0 | menu | awareness. |
| VA18 | 0.7 | weapon_name | Baton |
| VA19 | 1.1 | weapon_name | Battle Axe. |
| VA1A | 1.9 | greeting | Let the battle begin. |
| VA1B | 1.9 | game_mode | Welcome to Battle Reality. |
| VA1C | 1.8 | killstreak | Black Hawk inbound. |
| VA1D | 1.0 | killstreak | Blackhawk. |
| VA1E | 1.0 | line | Blind Eye. |
| VA1F | 1.1 | killstreak | Blockade. |
| VA1G | 1.2 | menu | Body Armor. |
| VA1H | 2.4 | objective_other | BOMB DEFUSED |
| VA1I | 3.0 | objective_other | Bomb Planted |
| VA1J | 1.2 | weapon_name | Bow staff. |
| VA1K | 1.2 | line | BOO |
| VA1L | 1.1 | team | Bravo team! |
| VA1M | 1.2 | weapon_name | Burst Glock. |
| VA1N | 1.8 | killstreak | enemy care package detected. |
| VA1O | 1.8 | killstreak | enemy care package underway. |
| VA1P | 1.6 | killstreak | Incoming Care Package. |
| VA1Q | 1.1 | killstreak | Care Package. |
| VA1R | 1.2 | team | Charlie team. |
| VA1S | 1.6 | killstreak | enemy chopper detected. |
| VA1T | 1.9 | killstreak | enemy chopper in your vicinity. |
| VA1U | 1.3 | killstreak | Incoming Chopper. |
| VA1V | 1.0 | weapon_name | Claymore. |
| VA1W | 1.3 | menu | Cluster Grenade. |
| VA1X | 1.1 | weapon_name | Combat Axe. |
| VA1Y | 1.2 | game_mode | Commanders! |
| VA1Z | 1.5 | weapon_name | Concussion Grenades |
| VA2 | 6.0 | line | Ehehhehehehhehheheheh h! ehehheheheeh ruler ugh |
| VA20 | 1.3 | system | Connection established. |
| VA21 | 1.6 | objective_other | Control Point Contested. |
| VA22 | 1.8 | objective_other | Control Point Lost. |
| VA23 | 1.6 | objective_other | Control Point Captured. |
| VA24 | 1.2 | killstreak | Critical Strike. |
| VA25 | 1.1 | menu | dead eye. |
| VA26 | 1.0 | game_mode | Deathmatch |
| VA27 | 1.3 | team | Delta Team. |
| VA28 | 1.0 | killstreak | Deployment. |
| VA29 | 1.0 | weapon_name | Desert Eagle. |
| VA2A | 0.9 | system | device paired. |
| VA2B | 1.1 | system | device removed. |
| VA2C | 1.3 | menu | double mags. |
| VA2D | 1.0 | menu | Double Trigger. |
| VA2E | 3.0 | grunt | Raw Game! |
| VA2F | 1.2 | line | Do a wheeled. |
| VA2G | 0.9 | team | Echo Team. |
| VA2H | 1.0 | killstreak | EMP |
| VA2I | 2.5 | line | Enemy flank has been lost. |
| VA2J | 1.8 | objective_flag | Enemy team has our flag! |
| VA2K | 2.2 | objective_flag | Enemy flag has been captured. |
| VA2L | 1.7 | killstreak | enemy sentry detected. |
| VA2M | 1.5 | weapon_name | Explosive Rounds. |
| VA2N | 1.6 | menu | Extended Mags |
| VA2O | 1.1 | menu | Fast track. |
| VA2P | 1.2 | clock | 15 minutes. |
| VA2Q | 1.3 | clock | 15 seconds. |
| VA2R | 1.0 | menu | First Aid. |
| VA2S | 1.1 | clock | Five minutes. |
| VA2T | 1.1 | menu | Flak jacket. |
| VA2U | 1.1 | weapon_name | Flashbang! |
| VA2V | 1.0 | weapon_name | FMJ. |
| VA2W | 1.1 | menu | laser sight |
| VA2X | 0.9 | menu | Accuracy. |
| VA2Y | 1.4 | team | Foxtrot Team. |
| VA2Z | 0.8 | weapon_name | FRAG |
| VA3 | 1.3 | grunt | AHHHHHH |
| VA30 | 1.4 | game_mode | Free for all. |
| VA31 | 1.6 | menu | Friendly fire off. |
| VA32 | 1.4 | menu | Friendly fire on. |
| VA33 | 1.9 | game_over | Game over. |
| VA34 | 1.1 | clock | Game time. |
| VA35 | 0.9 | line | General. |
| VA36 | 1.2 | game_mode | Generals. |
| VA37 | 0.7 | line | Ghost. |
| VA38 | 1.4 | menu | Grenade Launcher |
| VA39 | 1.0 | menu | Grenade type. |
| VA3A | 1.6 | killstreak | guided missile detected. |
| VA3B | 1.8 | killstreak | Goddid missile inbound. |
| VA3C | 1.2 | killstreak | guided missile. |
| VA3D | 1.1 | status_battery | Gun battery low. |
| VA3E | 1.3 | system | Headset connected. |
| VA3F | 1.6 | system | headset disconnected. |
| VA3G | 1.0 | menu | Healing Kit. |
| VA3H | 1.3 | killstreak | Hellstorm missile. |
| VA3I | 0.6 | grunt | Hi. |
| VA3J | 1.3 | killstreak | Hijack complete. |
| VA3K | 1.3 | killstreak | hijack enabled. |
| VA3L | 2.0 | line | the enemy has hijacked your equipment. |
| VA3M | 1.0 | killstreak | Hijack. |
| VA3N | 1.1 | weapon_name | Hallow Point. |
| VA3O | 1.2 | grunt | Woo-hoo! |
| VA3P | 1.2 | grunt | Woo! |
| VA3Q | 1.4 | grunt | Yeah! |
| VA3R | 1.3 | objective_other | Hostage down. |
| VA3S | 1.4 | objective_other | Hostage Rescued. |
| VA3T | 0.9 | grunt | Human |
| VA3U | 2.3 | killstreak | Incoming air raid, find cover. |
| VA3V | 1.4 | killstreak | Incoming Air Raid |
| VA3W | 1.2 | menu | Indoor mode. |
| VA3X | 0.7 | menu | indoor. |
| VA3Y | 1.1 | objective_other | Infected. |
| VA3Z | 1.0 | menu | fairing mode |
| VA4 | 1.5 | grunt | HUUUUUUUUUUUUUUUUU |
| VA40 | 1.4 | greeting | Join a faction. |
| VA41 | 1.5 | greeting | Join the ranks! |
| VA42 | 0.8 | weapon_name | knife. |
| VA43 | 1.1 | game_mode | Last Stand. |
| VA44 | 0.8 | menu | Lethal |
| VA45 | 0.9 | line | Lights out. |
| VA46 | 1.5 | status_health | Life's depleted. |
| VA47 | 1.1 | status_health | lives |
| VA48 | 1.2 | menu | long barrel. |
| VA49 | 0.8 | menu | long. |
| VA4A | 0.9 | menu | Low. |
| VA4B | 1.1 | weapon_name | M4. |
| VA4C | 0.8 | line | Mall. |
| VA4D | 1.0 | menu | Medkit. |
| VA4E | 0.8 | menu | medium. |
| VA4F | 1.1 | weapon_name | MG7. |
| VA4G | 1.2 | grunt | MGR. |
| VA4H | 1.5 | killstreak | incoming missile strike. |
| VA4I | 1.8 | killstreak | enemy missile strike detected. |
| VA4J | 1.0 | killstreak | missile strike. |
| VA4K | 1.7 | objective_other | missile swarm detected. |
| VA4L | 1.2 | killstreak | Incoming mortar. |
| VA4M | 1.1 | killstreak | Mortar round. |
| VA4N | 1.1 | line | NEXUS |
| VA4O | 1.2 | weapon_name | 9mm. |
| VA4P | 1.9 | killstreak | Nuclear launch detected. |
| VA4Q | 2.1 | killstreak | Enemy nuclear launch detected. |
| VA4R | 1.7 | killstreak | incoming nuclear missile. |
| VA4S | 0.7 | killstreak | Nuke. |
| VA4T | 0.7 | menu | off. |
| VA4U | 1.1 | line | offhand equipped. |
| VA4V | 0.6 | grunt | on. |
| VA4W | 1.1 | menu | Outdoor mode. |
| VA4X | 0.8 | menu | Outdoor |
| VA4Y | 0.9 | weapon_name | pepper spray. |
| VA4Z | 0.9 | killstreak | Phoenix. |
| VA5 | 1.3 | grunt | HAAA! |
| VA50 | 0.8 | weapon_name | Pistol |
| VA51 | 1.1 | menu | Quick hands. |
| VA52 | 0.8 | line | Recon. |
| VA53 | 1.0 | grunt | region. |
| VA54 | 1.4 | menu | Respawn Time. |
| VA55 | 1.4 | menu | Respawn Type. |
| VA56 | 1.3 | weapon_name | Rocket Launcher! |
| VA57 | 0.8 | weapon_name | Saber. |
| VA58 | 1.0 | menu | Scavenger |
| VA59 | 1.3 | clock | Second Life. |
| VA5A | 1.3 | menu | Choose a class. |
| VA5B | 1.1 | menu | Select fire. |
| VA5C | 1.4 | menu | Select a game. |
| VA5D | 1.2 | menu | Select a perk. |
| VA5E | 1.4 | team | Select a team. |
| VA5F | 1.5 | menu | Select a weapon. |
| VA5G | 1.6 | killstreak | Self-Destruct initiated. |
| VA5H | 1.4 | status_battery | Sensor battery low. |
| VA5I | 1.6 | killstreak | Century Deployed. |
| VA5J | 0.8 | killstreak | Century. |
| VA5K | 1.0 | status_shield | Shield equipped. |
| VA5L | 0.8 | status_shield | SHIELD |
| VA5M | 0.7 | menu | Short. |
| VA5N | 1.0 | game_mode | Siege |
| VA5O | 0.9 | menu | Silencer. |
| VA5P | 1.0 | clock | Six minutes. |
| VA5Q | 1.3 | weapon_name | Slug round. |
| VA5R | 1.7 | weapon_name | SMG X3. |
| VA5S | 1.4 | weapon_name | Sniper R50. |
| VA5T | 1.2 | menu | Speed boost. |
| VA5U | 0.9 | line | Spy. |
| VA5V | 1.6 | menu | Squad leader off. |
| VA5W | 1.5 | menu | Squad Leader on! |
| VA5X | 0.9 | line | Squad leader. |
| VA5Y | 1.3 | weapon_name | SR 100. |
| VA5Z | 1.4 | system | Admin Unlocked. |
| VA6 | 6.0 | grunt | Ah. Ah. Ah. |
| VA60 | 1.1 | menu | Night Mode. |
| VA61 | 1.2 | clock | Sudden death. |
| VA62 | 1.2 | game_mode | Supremacy! |
| VA63 | 0.9 | menu | Suppressor |
| VA64 | 1.1 | game_mode | Survival. |
| VA65 | 1.1 | objective_other | Survivor |
| VA66 | 1.0 | menu | Swap Lift. |
| VA67 | 1.0 | weapon_name | Sword |
| VA68 | 1.5 | killstreak | System hack initiated. |
| VA69 | 1.0 | killstreak | System hack. |
| VA6A | 1.4 | weapon_name | TAC 87. |
| VA6B | 1.3 | weapon_name | TAR 33. |
| VA6C | 0.8 | weapon_name | Taser |
| VA6D | 1.9 | lead | Your team takes the lead. |
| VA6E | 2.7 | lead | Your team has lost the lead. |
| VA6F | 1.0 | menu | Tactical. |
| VA6G | 1.1 | line | Tier Gas |
| VA6H | 1.1 | clock | 10 minutes. |
| VA6I | 1.6 | objective_other | The Hive |
| VA6J | 1.2 | objective_other | The Swarm. |
| VA6K | 1.0 | menu | thick skin. |
| VA6L | 3.0 | countdown | Three, two, one. |
| VA6M | 0.9 | menu | Toughness. |
| VA6N | 1.2 | menu | Tracker Rounds |
| VA6O | 0.7 | weapon_name | TRIP MINE! |
| VA6P | 1.2 | clock | 25 minutes. |
| VA6Q | 1.0 | clock | 20 minutes. |
| VA6R | 1.8 | killstreak | enemy UAV detected. |
| VA6S | 1.5 | killstreak | incoming UAV. |
| VA6T | 1.1 | killstreak | UAB |
| VA6U | 1.0 | line | Undercover. |
| VA6V | 1.0 | menu | Unlimited. |
| VA6W | 1.1 | menu | Upgrade complete. |
| VA6X | 2.0 | status_shield | Shields Depleted |
| VA6Y | 2.0 | status_shield | Shields Online |
| VA6Z | 1.6 | kill_confirm | Kill! |
| VA7 | 2.1 | line | Ugh, that's better. |
| VA70 | 1.0 | menu | Target Mode. |
| VA71 | 1.4 | line | Vanguard. |
| VA72 | 2.7 | line | The VIT has been killed! |
| VA73 | 1.1 | menu | water cooling. |
| VA74 | 1.5 | killstreak | Weapons Box Delivered. |
| VA75 | 1.5 | killstreak | weapons box detected. |
| VA76 | 1.7 | killstreak | Incoming Weapon Box. |
| VA77 | 1.1 | killstreak | Weapons Box. |
| VA78 | 2.4 | greeting | Welcome to Battle Company! |
| VA79 | 1.9 | line | A flank has been returned. |
| VA7A | 3.3 | objective_flag | Our flag has been captured! |
| VA7B | 1.8 | objective_flag | Our team has the flag! |
| VA7C | 2.0 | game_mode | Welcome to Battle 360! |
| VA7D | 1.7 | menu | Choose your destiny! |
| VA7E | 1.8 | medal | Double Kill |
| VA7F | 1.9 | medal | FATALITY |
| VA7G | 1.0 | line | Finish him! |
| VA7H | 2.5 | medal | First Blood |
| VA7I | 1.7 | medal | Flawless victory! |
| VA7J | 1.9 | kill_confirm | Kill them in Juro! |
| VA7K | 1.9 | medal | Killing spree |
| VA7L | 1.9 | kill_confirm | Killian Air |
| VA7M | 1.9 | medal | GO TACULAR! |
| VA7N | 1.9 | line | Joltastrophe |
| VA7O | 1.9 | line | CULTURUSITY |
| VA7P | 1.5 | line | Test your might. |
| VA7Q | 1.9 | medal | Triple Kill! |
| VA8 | 1.0 | kill_confirm | Kill! |
| VA80 | 3.0 | countdown | Three, two, one. |
| VA81 | 3.0 | countdown | Three, two, one. |
| VA82 | 3.0 | countdown | Three, two, one. |
| VA83 | 10.7 | countdown | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. |
| VA84 | 11.1 | countdown | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. |
| VA85 | 10.0 | countdown | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. |
| VA86 | 2.0 | status_health | Health Critical. |
| VA87 | 2.9 | status_health | health low. |
| VA88 | 1.1 | status_armor | Armored depleted. |
| VA89 | 1.1 | status_armor | Armor critical. |
| VA8A | 1.1 | status_armor | Armor low. |
| VA8B | 1.2 | status_shield | Shields depleted. |
| VA8C | 1.5 | status_shield | SHIELD ONLINE |
| VA8D | 2.3 | clock | Overtime |
| VA8E | 2.1 | kill_confirm | Kill confirmed. |
| VA8F | 1.4 | status_health | Shared lives. |
| VA8G | 1.0 | line | auto detection. |
| VA8H | 2.0 | system | Battle Company Systems Online. |
| VA8I | 1.2 | game_mode | Battle Lines. |
| VA8J | 1.6 | game_mode | Battle Royale |
| VA8K | 1.3 | killstreak | battle strike |
| VA8L | 1.1 | game_mode | battle watch. |
| VA8M | 1.4 | game_mode | Battle World. |
| VA8N | 1.5 | game_mode | Borderlands |
| VA8O | 1.2 | grunt | GUN GAME! |
| VA8P | 1.6 | objective_flag | Capture the flag. |
| VA8Q | 1.3 | system | Connection accepted. |
| VA8R | 1.3 | system | Connection lost. |
| VA8S | 1.2 | system | Connection rejected. |
| VA8T | 1.2 | system | Debug Mode. |
| VA8U | 1.2 | system | demo mode. |
| VA8V | 1.2 | system | pairing cleared |
| VA8W | 1.1 | line | enemy detected. |
| VA8X | 0.8 | system | Fail. |
| VA8Y | 1.4 | system | Game found. |
| VA8Z | 1.2 | system | HUD Connected. |
| VA9 | 1.2 | kill_confirm | Kill. |
| VA90 | 1.5 | system | How Disconnected. |
| VA91 | 2.0 | system | incoming HUD connection request. |
| VA92 | 2.1 | system | incoming phone connection request. |
| VA93 | 1.2 | objective_hill | King of the hill! |
| VA94 | 1.4 | system | laser calibration. |
| VA95 | 0.8 | system | loading. |
| VA96 | 1.3 | line | motion detected. |
| VA97 | 1.4 | line | Motion Sensor |
| VA98 | 0.8 | system | Pass. |
| VA99 | 1.1 | system | Phone connected. |
| VA9A | 1.3 | system | Phone disconnected. |
| VA9B | 1.9 | menu | Please confirm with the select key. |
| VA9C | 1.6 | system | Primary bootloader. |
| VA9D | 1.5 | system | primary device. |
| VA9E | 1.2 | system | Admin locked. |
| VA9F | 1.4 | killstreak | Proximity Mind. |
| VA9G | 1.0 | line | Replicant. |
| VA9H | 1.5 | line | RESPONSE STATION |
| VA9I | 1.5 | system | Scanning for device. |
| VA9J | 0.7 | system | Searching. |
| VA9K | 1.9 | system | Secondary bootloader. |
| VA9L | 1.7 | system | secondary device. |
| VA9M | 1.4 | system | Admin full arc. |
| VA9N | 1.5 | system | Sensors offline |
| VA9O | 1.3 | line | Silence, they are |
| VA9P | 1.4 | game_mode | Survival Games. |
| VA9Q | 1.2 | line | Testing complete. |
| VA9R | 1.0 | system | Test mode. |
| VA9S | 0.9 | system | Volume. |
| VA9T | 1.8 | system | One more weapon ready for duty. |
| VA9U | 2.4 | greeting | Welcome to Battle Company! |

### Announcer (numbers / menu) (133)

| id | s | category | words |
|---|---|---|---|
| VX01 | 0.5 | grunt | ONE. |
| VX02 | 0.4 | number | too. |
| VX03 | 0.5 | number | 3 |
| VX04 | 0.6 | number | Four. |
| VX05 | 0.5 | number | 5 |
| VX06 | 0.5 | number | 6 |
| VX07 | 0.5 | number | 7 |
| VX08 | 0.4 | number | 8. |
| VX09 | 0.5 | number | 9 |
| VX0A | 1.2 | menu | dual wheeled |
| VX0B | 1.1 | system | Field ID. |
| VX0C | 1.2 | system | Game found. |
| VX0D | 1.2 | system | Game host. |
| VX0E | 1.0 | system | Game joined! |
| VX0F | 1.3 | system | Initiating game. |
| VX0G | 1.3 | system | No update found. |
| VX0H | 1.6 | menu | Select Game Rules. |
| VX0I | 1.0 | system | Update complete. |
| VX0J | 1.1 | system | Update found. |
| VX0K | 0.9 | system | Update Mode. |
| VX0L | 1.0 | system | Update started. |
| VX0M | 0.7 | system | version. |
| VX0N | 1.5 | status_health | lives remaining. |
| VX0O | 1.0 | system | Browse |
| VX0P | 1.2 | team | Blue Team |
| VX0Q | 0.9 | killstreak | Airstrike |
| VX0R | 1.8 | clock | 10 Seconds Remain. |
| VX0S | 1.0 | menu | Weapon Swap |
| VX0T | 0.9 | line | depleted |
| VX0U | 1.2 | game_mode | Domination. |
| VX0V | 1.6 | killstreak | EMP Pulse |
| VX0W | 0.8 | grunt | Error! |
| VX0X | 1.6 | medal | first blood. |
| VX0Y | 1.3 | objective_flag | Flag codes! |
| VX0Z | 1.0 | menu | Focus. |
| VX10 | 0.5 | number | 10. |
| VX11 | 0.6 | number | 11 |
| VX12 | 0.5 | number | well. |
| VX13 | 0.5 | number | 13. |
| VX14 | 0.6 | number | 14 |
| VX15 | 0.7 | number | 15 |
| VX16 | 0.8 | number | 16 |
| VX17 | 0.8 | number | 17 |
| VX18 | 0.6 | number | 18 |
| VX19 | 0.8 | number | 19 |
| VX1A | 0.8 | menu | For grip. |
| VX1B | 0.9 | line | button |
| VX1C | 1.2 | killstreak | Share Package! |
| VX1D | 0.8 | objective_other | Checkpoint |
| VX1E | 2.4 | status_health | Deathmatch. Lives pooled. |
| VX1F | 1.6 | game_mode | Deathmatch timed. |
| VX1G | 1.0 | menu | Defense. |
| VX1H | 1.5 | medal | Killstreak Ready! |
| VX20 | 0.5 | number | 20. |
| VX21 | 0.7 | number | 21 |
| VX22 | 0.7 | number | 22. |
| VX23 | 0.7 | number | 23 |
| VX24 | 0.8 | number | 24. |
| VX25 | 0.7 | number | 25 |
| VX26 | 0.7 | number | 26 |
| VX27 | 0.7 | number | 27. |
| VX28 | 0.6 | number | 28 |
| VX29 | 0.7 | number | 29. |
| VX30 | 0.6 | number | 30 |
| VX31 | 0.7 | number | 31 |
| VX32 | 0.7 | number | 32 |
| VX33 | 0.7 | number | 33 |
| VX34 | 0.7 | number | 34 |
| VX35 | 0.6 | number | 35 |
| VX36 | 0.7 | number | 36 |
| VX37 | 0.7 | number | 37. |
| VX38 | 0.6 | number | 38 |
| VX39 | 0.7 | number | 39 |
| VX40 | 0.4 | number | 40. |
| VX41 | 0.7 | number | 41. |
| VX42 | 0.6 | number | 42. |
| VX43 | 0.7 | number | 43 |
| VX44 | 0.7 | number | 44 |
| VX45 | 0.6 | number | 45. |
| VX46 | 0.7 | number | 46 |
| VX47 | 0.6 | number | 47 |
| VX48 | 0.6 | number | 48 |
| VX49 | 0.7 | number | 49 |
| VX50 | 0.5 | number | 50 |
| VX51 | 1.3 | system | Standard headset. |
| VX52 | 1.4 | system | Scoring headset. |
| VX53 | 0.8 | system | Scanning! |
| VX54 | 1.8 | menu | Respawn Point Enabled. |
| VX55 | 2.0 | menu | Respawn Point Disabled. |
| VX56 | 1.7 | menu | Respawn Station. |
| VX57 | 0.8 | menu | Assault! |
| VX58 | 0.8 | weapon_name | FRAG |
| VX59 | 1.2 | objective_other | Storm Enabled. |
| VX60 | 1.0 | menu | Ticket Mode |
| VX61 | 2.2 | line | The survivors have held their ground. |
| VX62 | 1.6 | objective_other | The infection is spread. |
| VX63 | 0.5 | menu | Tank! |
| VX64 | 0.9 | menu | SUPPORT! |
| VX65 | 1.5 | system | Stress Test Mode. |
| VX66 | 1.5 | objective_other | Storm Disabled. |
| VX67 | 1.0 | menu | Stimpak! |
| VX68 | 1.8 | menu | Sticky Grenade Launcher |
| VX69 | 1.3 | status_shield | SHIELD PULSE |
| VX70 | 0.9 | line | SAFE |
| VX71 | 1.7 | line | Revive at Squad Leader. |
| VX72 | 1.7 | menu | Revive at Respawn Point. |
| VX73 | 1.0 | menu | Reload |
| VX74 | 1.7 | menu | READ GENERATION ROUNDS |
| VX75 | 1.1 | team | Red Team. |
| VX76 | 0.9 | menu | random |
| VX77 | 0.9 | menu | Rally |
| VX78 | 1.4 | killstreak | Proximity Mine. |
| VX79 | 1.3 | menu | Poison Grenades |
| VX80 | 0.9 | menu | Offense. |
| VX81 | 1.3 | line | Motion detected. |
| VX82 | 1.0 | killstreak | Mortar Strike. |
| VX83 | 1.2 | killstreak | Many Rockets! |
| VX84 | 1.2 | menu | melee attack |
| VX85 | 1.1 | menu | Medigel. |
| VX86 | 1.2 | medal | Lucky shot! |
| VX87 | 0.9 | system | Loading. |
| VX88 | 1.2 | menu | Lifesteal |
| VX89 | 1.6 | medal | Killstrike ready! |
| VX90 | 1.0 | menu | Kids Mode |
| VX91 | 1.7 | menu | Hold Trigger to Charge. |
| VX92 | 2.2 | menu | Hold Reload to fully reload. |
| VX93 | 1.3 | greeting | Hello Kitty! |
| VX94 | 1.3 | menu | Healing Tracker Dart. |
| VX95 | 1.6 | system | Grenade Disconnected. |
| VX96 | 1.3 | system | Grenade connected. |
| VX97 | 1.4 | team | Green Team. |
| VX98 | 0.9 | system | Gesture! |
| VX99 | 1.4 | menu | Frost Grenades. |

### Announcer (upgrades) (66)

| id | s | category | words |
|---|---|---|---|
| VZ01 | 1.9 | weapon_name | two-shot sniper rifle. |
| VZ02 | 1.8 | weapon_name | Two Shot Steam Rifle |
| VZ03 | 1.3 | weapon_name | 8-Bit Rifle |
| VZ04 | 2.3 | weapon_name | Armor Piercing Sniper Rifle |
| VZ05 | 1.8 | menu | Automatic Assault Rifle |
| VZ06 | 1.8 | weapon_name | Automatic Shotgun |
| VZ07 | 2.6 | weapon_name | BFG 9000 Charge Gun |
| VZ08 | 1.6 | menu | Burst Assault Rifle. |
| VZ09 | 2.0 | weapon_name | Burst Submachine Gun |
| VZ0A | 2.4 | menu | Burst Sticky Grenade Launcher |
| VZ0B | 1.8 | weapon_name | Charge Pulse Rifle. |
| VZ0C | 1.5 | menu | Choose and upgrade. |
| VZ0D | 1.2 | weapon_name | Crossbow! |
| VZ0E | 0.8 | menu | Damage! |
| VZ0F | 2.1 | weapon_name | Double Barrel Shotgun. |
| VZ0G | 1.8 | line | DROID AUTOBLASTER |
| VZ0H | 1.9 | menu | Energy Assault Rifle |
| VZ0I | 2.0 | weapon_name | Energy Automatic Rifle |
| VZ0J | 1.8 | weapon_name | Energy Burst Rifle. |
| VZ0K | 2.2 | weapon_name | Energy Charge Sniper Rifle. |
| VZ0L | 1.9 | weapon_name | Energy Guttling Gun. |
| VZ0M | 1.5 | weapon_name | energy laser. |
| VZ0N | 1.6 | weapon_name | Energy Shotgun. |
| VZ0O | 1.8 | weapon_name | Energy Sniper Rifle. |
| VZ0P | 0.9 | menu | Finesse. |
| VZ0Q | 1.5 | weapon_name | Flamethrower |
| VZ0R | 1.7 | menu | Frost Burst Rifle |
| VZ0S | 1.4 | menu | Frost laser. |
| VZ0T | 2.4 | menu | Frost Semi-Automatic Rifle |
| VZ0U | 1.2 | weapon_name | Gatling gun! |
| VZ0V | 1.5 | weapon_name | Heavy Machine Gun. |
| VZ0W | 1.6 | weapon_name | Incendiary Rifle |
| VZ0X | 1.9 | objective_other | Infected spray attack. |
| VZ0Y | 2.1 | weapon_name | M4 Automatic Rifle |
| VZ0Z | 2.1 | weapon_name | Magnet Semi-Auto Rifle |
| VZ10 | 1.7 | weapon_name | Mini Rocket Launcher |
| VZ11 | 1.6 | weapon_name | Newbie Cannon! |
| VZ12 | 0.7 | menu | off. |
| VZ13 | 0.7 | grunt | on. |
| VZ14 | 1.7 | menu | Poison Burst Rifle |
| VZ15 | 1.8 | menu | Poison Gas Launcher |
| VZ16 | 1.8 | menu | Poison submachine gun. |
| VZ17 | 1.8 | objective_other | Randomize Infection. |
| VZ18 | 1.1 | menu | RANK 1 |
| VZ19 | 1.1 | menu | RANK 2 |
| VZ1A | 1.3 | menu | Rank 3! |
| VZ1B | 2.1 | weapon_name | Rapid Fire Sniper Rifle |
| VZ1C | 1.0 | menu | Recovery! |
| VZ1D | 2.1 | menu | Semi-auto Assault Rifle |
| VZ1E | 2.1 | weapon_name | Semi Auto Sniper Rifle |
| VZ1F | 1.2 | weapon_name | Shotgun! |
| VZ1G | 2.1 | weapon_name | silenced submachine gun. |
| VZ1H | 1.9 | weapon_name | Silence Sniper Rifle |
| VZ1I | 1.5 | weapon_name | Submachine gun. |
| VZ1J | 1.3 | weapon_name | Sniper Rifle |
| VZ1K | 1.3 | menu | Specialists |
| VZ1L | 0.9 | menu | speed |
| VZ1M | 1.0 | menu | Stealth |
| VZ1N | 2.2 | weapon_name | Steambolt submachine gun. |
| VZ1O | 1.7 | weapon_name | Stormtrooper Rifle |
| VZ1P | 2.4 | weapon_name | Sustain Fire Submachine Gun. |
| VZ1Q | 1.3 | weapon_name | Taser Rifle |
| VZ1R | 2.0 | weapon_name | Thumper submachine gun. |
| VZ1S | 0.9 | menu | Toughness |
| VZ1T | 1.8 | menu | Upgrade available! |
| VZ1U | 1.0 | menu | Upgrade mode. |

### Creature (25)

| id | s | category | words |
|---|---|---|---|
| V51 | 1.6 | intro | HMMMMMMMMMMMMMMMMMMM |
| V52 | 6.0 | idle_loop | The End |
| V53 | 3.5 | death_scream | R-r-r-rrrrrrrr |
| V54 | 3.0 | death_scream | HELLO! |
| V55 | 3.3 | death_scream | HELLO! |
| V56 | 6.2 | line | A bug! A bug! A bug... |
| V57 | 2.1 | healed | GRR! |
| V58 | 1.8 | kill_confirm | THANKS FOR WATCHING! |
| V59 | 1.7 | kill_confirm | THANKS FOR WATCHING!! |
| V5A | 1.8 | kill_confirm | MMMMMMMMMMMMMM |
| V5B | 3.2 | defeat_taunt | Ha-ha-ha! |
| V5C | 1.0 | pain | Grrr! |
| V5D | 1.1 | pain | HELLO |
| V5E | 2.1 | pain | GRRHAAAAGHH! |
| V5F | 1.7 | pain | Arrrrrrrrrrrrrrrrrr. |
| V5G | 1.1 | pain | Rrrrrrrr! |
| V5H | 0.7 | pain | Arrggh! |
| V5I | 1.4 | boast | MMMMMMMMMMMMMMMM |
| V5J | 6.3 | long_death | Yeah |
| V5K | 3.1 | taunt | Oh-ho-ho-ho-ho-ho-ho! |
| V5L | 2.9 | taunt | Rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr... |
| V5M | 1.8 | name | You're in fact in. |
| V5N | 3.0 | line | Oh |
| V5O | 2.3 | line | If you enjoy this video, please give it a thumbs up and subscribe t... |
| V5P | 2.1 | line | Rrrrrrrrrrrrrrrrrr |

### Female (clean) (21)

| id | s | category | words |
|---|---|---|---|
| VM1 | 1.1 | intro | Target locked. |
| VM2 | 6.0 | line | IT'S HOTTEN TO BE THE GUN |
| VM3 | 1.5 | death_scream | AHHHHHHHHH |
| VM4 | 1.4 | death_scream | AHHHHHH! |
| VM5 | 2.0 | death_scream | AHHHHHHHHH |
| VM6 | 6.0 | hurt_loop |  |
| VM7 | 1.4 | healed | Reloaded |
| VM8 | 1.1 | kill_confirm | Still confirmed. |
| VM9 | 1.2 | kill_confirm | feel confirmed. |
| VMA | 1.2 | kill_confirm | Kill confirmed. |
| VMB | 1.7 | defeat_taunt | I demand a rematch. |
| VMC | 0.5 | pain | Huh! |
| VMD | 0.7 | pain | UGH! |
| VME | 0.9 | pain | UGH! |
| VMF | 0.8 | pain | Eugh! |
| VMG | 0.4 | pain | UGH! |
| VMH | 0.4 | pain | Oh! |
| VMI | 1.2 | boast | locked and loaded. |
| VMJ | 6.0 | long_death | AHH! |
| VMK | 2.1 | taunt | right between the eyes. |
| VML | 2.1 | taunt | I always shoot first. |

### Fury (22)

| id | s | category | words |
|---|---|---|---|
| V01 | 1.4 | intro | Fury! |
| V02 | 6.0 | idle_loop | Ah! Ah! Ah! Ah! Ah! |
| V03 | 1.6 | death_scream | UGH! |
| V04 | 2.1 | death_scream | AHHHHHHHHH |
| V05 | 1.8 | death_scream | UGH! |
| V06 | 6.0 | hurt_loop |  |
| V07 | 1.2 | healed | No pain. |
| V08 | 1.2 | kill_confirm | FATALITY |
| V09 | 1.3 | kill_confirm | RETALITY |
| V0A | 1.4 | kill_confirm | FATALITY |
| V0B | 2.7 | defeat_taunt | Embrace death, not defeat. |
| V0C | 0.4 | pain | Ha! |
| V0D | 0.3 | pain | Ha! |
| V0E | 0.8 | pain | UGH! |
| V0F | 1.1 | pain | MMMMMMMMMMMMMM |
| V0G | 0.4 | pain | Oh! |
| V0H | 0.4 | pain | UGH! |
| V0I | 2.3 | boast | Swift and silent, I move. |
| V0J | 6.0 | long_death | Uuuuuuuuuuuuutooooooouuuuuuuuuntiuuuuuuuun... broke |
| V0K | 2.0 | taunt | No one will hear your scream. |
| V0L | 3.0 | taunt | True warriors are born in blood. |
| V0M | 0.6 | name | Ghost. |

### Grenadier (22)

| id | s | category | words |
|---|---|---|---|
| V11 | 1.6 | intro | Power Surge. |
| V12 | 6.0 | idle_loop |  |
| V13 | 2.3 | death_scream | AHHHHHHHHHH |
| V14 | 2.1 | death_scream | AHHHHHHHHH |
| V15 | 1.9 | death_scream | HELLO! |
| V16 | 6.1 | hurt_loop |  |
| V17 | 1.4 | healed | systems repaired. |
| V18 | 1.0 | kill_confirm | Get ready! |
| V19 | 1.2 | kill_confirm | terminated |
| V1A | 0.9 | kill_confirm | Germany did |
| V1B | 2.2 | defeat_taunt | This cannot be. |
| V1C | 0.6 | pain | Mm-hmm |
| V1D | 0.6 | pain | NGH! |
| V1E | 1.1 | pain | Oh |
| V1F | 0.8 | pain |  |
| V1G | 0.4 | pain | Oh |
| V1H | 0.4 | pain | MWAH! |
| V1I | 2.5 | boast | Obliteration awaits. |
| V1J | 6.0 | long_death |  |
| V1K | 2.1 | taunt | You will break. |
| V1L | 2.5 | taunt | Their will is broken. |
| V1M | 1.1 | name | Grenadier |

### Guardian (22)

| id | s | category | words |
|---|---|---|---|
| V21 | 1.6 | intro | Shields over a mile mean. |
| V22 | 6.1 | idle_loop |  |
| V23 | 2.7 | death_scream | AHHHHHHHHHHHHHHHHH |
| V24 | 2.5 | death_scream | AHHHHHH!! |
| V25 | 2.4 | death_scream | AHHHHHHHHH |
| V26 | 6.1 | hurt_loop | Oh |
| V27 | 1.2 | healed | energized. |
| V28 | 1.1 | kill_confirm | Sanitized. |
| V29 | 1.2 | kill_confirm | Sanitized. |
| V2A | 1.1 | kill_confirm | Sanitized. |
| V2B | 2.9 | defeat_taunt | My shields will never fail me again. |
| V2C | 0.7 | pain | HUH! |
| V2D | 0.6 | pain | RUH! |
| V2E | 1.1 | pain | Oh! |
| V2F | 1.5 | pain | Oh |
| V2G | 0.4 | pain | Oh! |
| V2H | 0.7 | pain | Ugh! |
| V2I | 1.7 | boast | Shields engaged. |
| V2J | 5.9 | line | OR like I'm talking to you right now? Take a chance now |
| V2K | 4.0 | taunt | Ha ha ha ha, nexus shield, never fail. |
| V2L | 3.0 | taunt | My shields are unstoppable. Ha ha ha! |
| V2M | 0.8 | name | Guardian |

### Heavy (22)

| id | s | category | words |
|---|---|---|---|
| V31 | 1.3 | intro | Charge! |
| V32 | 6.0 | idle_loop | Oh |
| V33 | 2.2 | death_scream | AHHHHHHHHH |
| V34 | 2.4 | death_scream | AHHHHHHHHHH |
| V35 | 2.7 | death_scream | AHHHHHHHHH! |
| V36 | 6.0 | hurt_loop | Hmm. Hmm. Hmm. |
| V37 | 0.9 | healed | patched up |
| V38 | 1.0 | kill_confirm | All clear! |
| V39 | 1.2 | kill_confirm | All clear. |
| V3A | 0.8 | kill_confirm | All clear. |
| V3B | 1.6 | defeat_taunt | Pain is my friend. |
| V3C | 0.7 | pain | Hmm |
| V3D | 0.6 | pain | Phew! |
| V3E | 2.4 | pain | MMMMMMMMMMMMMMMMMMMM |
| V3F | 1.3 | pain | Yeah |
| V3G | 0.5 | pain | OOF |
| V3H | 0.8 | pain | MMMM |
| V3I | 1.5 | boast | Get some! |
| V3J | 6.0 | long_death | Bwrrrrrrrr!! Zzzzzzzzzzzztttttttttttt!! |
| V3K | 1.7 | taunt | Ooh, bet that hurt. |
| V3L | 1.8 | taunt | The battle is ours. |
| V3M | 0.8 | name | heavy |

### Hive Queen (32)

| id | s | category | words |
|---|---|---|---|
| V41 | 1.1 | intro | BLOOD! |
| V42 | 6.0 | idle_loop |  |
| V43 | 2.2 | death_scream | AHHHHHHHHH |
| V44 | 1.9 | death_scream | AHHHHHHHHH! |
| V45 | 2.4 | death_scream | AHHHHHHHHH |
| V46 | 6.0 | hurt_loop | Uhhh! Uhhhh! Uhhhh! |
| V47 | 1.7 | healed | I hunger! |
| V48 | 1.7 | kill_confirm | Come to me! |
| V49 | 1.5 | kill_confirm | Come to me! |
| V4A | 1.7 | kill_confirm | Come to me! |
| V4B | 3.0 | defeat_taunt | Another queen shall rise. |
| V4C | 0.7 | pain | Yeah |
| V4D | 0.8 | pain | UGH! |
| V4E | 1.5 | pain | MMMMMMMMMMMMMMMMMMMMMM |
| V4F | 1.7 | pain | Uggggghhh! |
| V4G | 0.5 | pain | Cough! |
| V4H | 0.4 | pain |  |
| V4I | 2.6 | boast | Cleanse the intruders! |
| V4J | 6.0 | long_death | hahahahahahahahahahahaha |
| V4K | 1.6 | taunt | fear me |
| V4L | 2.0 | taunt | Your blood is mine! |
| V4M | 1.9 | name | The Hive Queen |
| V4N | 2.4 | line | MMMMMMMMMMMMMMMMMMMM |
| V4O | 4.5 | line | You |
| V4P | 3.7 | line | Pffftttttttttttttttttttttttttttt |
| V4Q | 2.9 | line | Rrroooaahhhh! |
| V4R | 1.3 | game_over | Defeat! |
| V4S | 1.6 | objective_other | Infected! |
| V4T | 2.6 | objective_other | Infection Survival |
| V4U | 2.9 | objective_other | Infection! The Swarm! |
| V4V | 2.7 | objective_other | One survivor remains. |
| V4W | 1.9 | game_over | VICTORY! |

### Infiltrator (22)

| id | s | category | words |
|---|---|---|---|
| V61 | 1.3 | intro | FIRGE! |
| V62 | 6.0 | idle_loop | Oh |
| V63 | 1.7 | death_scream | RRRRRAAAAAAAA |
| V64 | 2.3 | death_scream | Ha ha ha ha ha ha! |
| V65 | 2.6 | death_scream |  |
| V66 | 6.0 | hurt_loop | Rr! Rr! Rr! |
| V67 | 1.4 | healed | Reset. |
| V68 | 1.4 | kill_confirm | I'm gonna get it. |
| V69 | 1.2 | kill_confirm | I'm eliminated. |
| V6A | 1.1 | kill_confirm | I'm eliminated. |
| V6B | 2.0 | defeat_taunt | My vision is clouded! |
| V6C | 0.6 | pain | MWAH! |
| V6D | 0.6 | pain |  |
| V6E | 1.3 | pain | URGH! |
| V6F | 1.2 | pain | ah |
| V6G | 0.4 | pain | Oh |
| V6H | 0.6 | pain | MWAH |
| V6I | 2.2 | boast | Your end has come. |
| V6J | 6.0 | long_death |  |
| V6K | 2.2 | taunt | Accept your destiny. |
| V6L | 2.6 | taunt | Victory is my destiny. |
| V6M | 1.4 | name | Infiltrator |

### Male (clean) (21)

| id | s | category | words |
|---|---|---|---|
| VP1 | 0.7 | intro | URA! |
| VP2 | 6.0 | idle_loop | Oh |
| VP3 | 1.6 | death_scream | OHHHHH! |
| VP4 | 2.3 | death_scream | AHH! |
| VP5 | 2.6 | death_scream | Oh |
| VP6 | 6.0 | hurt_loop | Ah |
| VP7 | 0.8 | healed | Reloaded |
| VP8 | 1.0 | kill_confirm | Target down. |
| VP9 | 1.2 | kill_confirm | Target down. |
| VPA | 1.0 | kill_confirm | Target down. |
| VPB | 1.6 | defeat_taunt | I demand a rematch. |
| VPC | 0.6 | pain | NGH! |
| VPD | 0.6 | pain | UGH! |
| VPE | 1.3 | pain | UGH! |
| VPF | 1.2 | pain | Oh |
| VPG | 0.4 | pain | Ugh! |
| VPH | 0.5 | pain | UGH! |
| VPI | 1.7 | boast | I return to battle. |
| VPJ | 6.0 | long_death | Uuughhhhhh! |
| VPK | 1.3 | taunt | Watch and learn. |
| VPL | 1.0 | taunt | Who's next? |

### Male player (18)

| id | s | category | words |
|---|---|---|---|
| VAA | 0.6 | kill_confirm | Kill. |
| VAB | 1.5 | defeat_taunt | Everybody dies. |
| VAC | 0.8 | pain | HAH! |
| VAD | 0.6 | pain | HOO! |
| VAE | 1.2 | pain | AHHHHH! |
| VAF | 1.2 | pain | Aargh! |
| VAG | 0.6 | pain | Huh! |
| VAH | 0.4 | pain | HUH! |
| VAI | 1.8 | boast | There's nowhere for you to hide. |
| VAJ | 6.0 | long_death | NONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONON... |
| VAK | 0.7 | taunt | Take that! |
| VAL | 1.4 | taunt | No mercy. |
| VAM | 0.7 | name | Reaper |
| VAN | 0.8 | line | Hoorah! |
| VAO | 0.8 | line | Good to go. |
| VAP | 1.2 | objective_other | Let's head back to base. |
| VAQ | 1.0 | line | Let's move out. |
| VAR | 1.1 | team | Good job, team. |

### Marauder (22)

| id | s | category | words |
|---|---|---|---|
| V71 | 2.1 | intro | Ultra charged! |
| V72 | 6.0 | idle_loop | The poor. |
| V73 | 1.5 | death_scream | Arrrrggggggghhh! |
| V74 | 2.6 | death_scream | OWWWWWWWW |
| V75 | 2.3 | death_scream |  |
| V76 | 6.0 | hurt_loop |  |
| V77 | 0.9 | healed | Top |
| V78 | 1.4 | kill_confirm | ROAR! |
| V79 | 1.2 | kill_confirm | BYE! |
| V7A | 1.3 | kill_confirm | BYE! |
| V7B | 1.9 | defeat_taunt | Not enough power! |
| V7C | 1.2 | pain | Yeah! |
| V7D | 1.1 | pain | Rrroar! |
| V7E | 1.2 | pain | Oh |
| V7F | 1.4 | pain |  |
| V7G | 0.6 | pain | Aargh! |
| V7H | 0.7 | pain | BOOM! |
| V7I | 1.9 | boast | We're charged and ready! |
| V7J | 7.0 | line | NoooooooooOOOOoooooOoOoOooOoOoOд Woooohoooo www. Level 4 W O W |
| V7K | 2.4 | taunt | I have the power! |
| V7L | 2.7 | taunt | Now you know my power! |
| V7M | 1.3 | name | the hotter. |

### Medic (34)

| id | s | category | words |
|---|---|---|---|
| V81 | 0.8 | intro | Med's here. |
| V82 | 6.0 | idle_loop | Ahem. Ahem. |
| V83 | 0.9 | death_scream | Ah! |
| V84 | 1.2 | death_scream | AHHHHH! |
| V85 | 1.1 | death_scream | AHHHHHH! |
| V86 | 6.0 | hurt_loop | HMM! HMM! HMM! HMM! |
| V87 | 1.0 | healed | Bleeding stopped. |
| V88 | 1.1 | kill_confirm | Sterilized. |
| V89 | 1.2 | kill_confirm | sterilized. |
| V8A | 1.1 | kill_confirm | sterilized. |
| V8B | 1.4 | defeat_taunt | Medavek, on route. |
| V8C | 0.5 | pain | Huh! |
| V8D | 0.8 | pain | Oh |
| V8E | 1.0 | pain | Oh |
| V8F | 1.6 | pain | Oh |
| V8G | 0.5 | pain | Ahem. |
| V8H | 0.6 | pain | Oh |
| V8I | 1.1 | boast | The doctor is in. |
| V8J | 6.1 | line | Mmm, mmm, mmm, mmm握握,丨握握握 grams I'm out! |
| V8K | 1.4 | taunt | Need a bandage for that? |
| V8L | 2.1 | taunt | I love the smell of metagel. |
| V8M | 0.6 | name | Medic. |
| V8N | 1.0 | line | Target locked. |
| V8O | 0.7 | line | patched up |
| V8P | 1.0 | kill_confirm | Kill confirmed. |
| V8Q | 1.2 | objective_hill | Hill Confirmed |
| V8R | 1.1 | kill_confirm | Kill confirmed. |
| V8S | 1.0 | kill_confirm | All clear. |
| V8T | 1.2 | kill_confirm | All clear. |
| V8U | 0.8 | kill_confirm | All clear. |
| V8V | 1.5 | game_over | We failed the mission. |
| V8W | 1.9 | line | One shot, one kill. |
| V8X | 1.3 | line | Too easy. |
| V8Y | 1.0 | game_over | Mission complete. |

### Mercenary (22)

| id | s | category | words |
|---|---|---|---|
| VN1 | 0.9 | intro | Target locked. |
| VN2 | 6.0 | idle_loop | Ah! Ah! Ah! Ah! Ah! Ah! |
| VN3 | 1.6 | death_scream | UGH! |
| VN4 | 2.1 | death_scream | DAAAAAAA |
| VN5 | 1.8 | death_scream | URGH! |
| VN6 | 6.0 | hurt_loop |  |
| VN7 | 0.8 | healed | Restocked. |
| VN8 | 1.0 | kill_confirm | Co-confirmed |
| VN9 | 1.2 | kill_confirm | Kill confirmed. |
| VNA | 1.0 | kill_confirm | Kill confirmed. |
| VNB | 1.4 | defeat_taunt | the target is lost. |
| VNC | 0.4 | pain | HA! |
| VND | 0.3 | pain | Ha! |
| VNE | 0.8 | pain | UGH! |
| VNF | 1.1 | pain | Oh |
| VNG | 0.4 | pain | Huh! |
| VNH | 0.4 | pain | UGH! |
| VNI | 2.1 | boast | The battle begins. |
| VNJ | 6.0 | long_death | HUUUUUUUUUUUUUUUUUUUUUUUUUUUUU UGH UGH |
| VNK | 1.1 | taunt | Bullseye! |
| VNL | 1.9 | taunt | No one will stand in my way. |
| VNM | 1.1 | name | Mercenary |

### Nexus commander (19)

| id | s | category | words |
|---|---|---|---|
| VQ1 | 1.4 | line | Commander! |
| VQ2 | 1.3 | unknown |  |
| VQ3 | 2.2 | objective_codes | And the codes have been captured! |
| VQ4 | 2.5 | line | and go to the worst. |
| VQ5 | 2.5 | objective_codes | Everything has our codes. |
| VQ6 | 2.3 | game_over | Game Over! |
| VQ7 | 1.0 | line | NEXUS |
| VQ8 | 1.8 | game_over | Objective complete! |
| VQ9 | 1.1 | menu | random |
| VQA | 2.6 | clock | Sixty seconds remaining. |
| VQB | 10.9 | countdown | Ten, nine, eight, seven, six, five, four, three, two, one. |
| VQC | 2.1 | clock | 30 seconds remaining. |
| VQD | 2.3 | clock | Two minutes remain. |
| VQE | 1.8 | menu | Upgrade available. |
| VQF | 1.9 | greeting | Get ready. |
| VQG | 3.3 | line | Our goal to the captain! |
| VQH | 2.4 | objective_codes | Our codes have been returned. |
| VQI | 2.3 | objective_codes | Our team has the codes. |
| VQJ | 1.6 | line | self-destructive as shit. |

### Raider (22)

| id | s | category | words |
|---|---|---|---|
| V91 | 1.0 | intro | Turn up the heat! |
| V92 | 6.1 | idle_loop | Cough. |
| V93 | 1.4 | death_scream | Agh! |
| V94 | 1.5 | death_scream | Uggggggggggggggggggggggg |
| V95 | 1.4 | death_scream | URGH! |
| V96 | 6.0 | hurt_loop | Ah |
| V97 | 1.4 | healed | REFUELED! |
| V98 | 1.1 | kill_confirm | Toasted! |
| V99 | 1.2 | kill_confirm | Coasted! |
| V9A | 1.2 | kill_confirm | Toasted! |
| V9B | 1.8 | defeat_taunt | Burn it! Burn it all! |
| V9C | 0.8 | pain | Rrroar! |
| V9D | 0.6 | pain | Hrm! |
| V9E | 1.0 | pain | Oh |
| V9F | 1.4 | pain | O-o-o-o-o-o-o-o-o-o! |
| V9G | 0.4 | pain | Oh |
| V9H | 0.4 | pain | Huh! |
| V9I | 1.5 | boast | Let it burn! |
| V9J | 5.9 | line | UUUUUUUUUUURRRRRRRRRRRGGGGGGGGG! UUGH! UGh... UGh... UUugh... |
| V9K | 1.1 | taunt | Can't take the heat! |
| V9L | 2.6 | taunt | That's why you don't play with matches, kids! |
| V9M | 0.8 | name | Raider! |

### Resistance commander (18)

| id | s | category | words |
|---|---|---|---|
| VS1 | 1.0 | line | Commander! |
| VS2 | 1.7 | game_over | DEFEAT! |
| VS3 | 2.5 | objective_codes | Enemy codes have been lost. |
| VS4 | 2.2 | objective_codes | Enemy codes have been captured. |
| VS5 | 1.9 | objective_codes | Enemy team has our codes. |
| VS6 | 2.4 | game_over | Game over. |
| VS7 | 1.3 | game_over | Objective Complete! |
| VS8 | 0.8 | menu | random. |
| VS9 | 1.2 | line | The resistance. |
| VSA | 1.8 | clock | 60 seconds remain. |
| VSB | 10.5 | countdown | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. |
| VSC | 1.8 | clock | 30 seconds remain. |
| VSD | 1.6 | clock | Two minutes remain. |
| VSE | 1.8 | menu | Upgrade available. |
| VSF | 1.9 | game_over | Victory! |
| VSG | 3.3 | objective_codes | Our codes have been captured. |
| VSH | 1.8 | objective_codes | Our team has the codes. |
| VSI | 1.9 | objective_codes | Our codes have been returned. |

### Russian (clean) (21)

| id | s | category | words |
|---|---|---|---|
| VL1 | 1.4 | intro | Very nice! |
| VL2 | 6.0 | line | Yeah? Ah, ugh Ugh Eugh Now |
| VL3 | 2.0 | death_scream | AHHHHHHHHH |
| VL4 | 2.3 | death_scream | Oh |
| VL5 | 2.0 | death_scream | URGH! |
| VL6 | 6.0 | line | Uggh, uggh, uggh, uggh, uggh, uggh, uggh. |
| VL7 | 0.9 | healed | Reloaded |
| VL8 | 1.0 | kill_confirm | Terminated. |
| VL9 | 1.2 | kill_confirm | Terminated. |
| VLA | 1.0 | kill_confirm | terminated. |
| VLB | 1.7 | defeat_taunt | need bigger gun |
| VLC | 0.6 | pain | Yeah! |
| VLD | 0.8 | pain | No! |
| VLE | 0.9 | pain | Ugh. |
| VLF | 0.9 | pain | Oof. |
| VLG | 0.5 | pain | Ugh. |
| VLH | 0.4 | pain | EW! |
| VLI | 1.5 | boast | locked and loaded. |
| VLJ | 5.9 | long_death | E-E-E-E-E-E-E-E-E-E |
| VLK | 1.6 | taunt | Watch and learn. |
| VLL | 1.7 | taunt | Like Fishing Battle. |

### Scout (female) (22)

| id | s | category | words |
|---|---|---|---|
| VB1 | 1.4 | intro | Go, go, go! |
| VB2 | 6.0 | idle_loop |  |
| VB3 | 2.7 | death_scream | Ah! Ah! Ah! |
| VB4 | 1.7 | death_scream | AHHHHH! |
| VB5 | 1.7 | death_scream | Uuugh! |
| VB6 | 6.0 | hurt_loop | Ah |
| VB7 | 1.0 | healed | All set! |
| VB8 | 1.0 | kill_confirm | Target down. |
| VB9 | 1.2 | kill_confirm | Target down. |
| VBA | 0.9 | kill_confirm | Target down. |
| VBB | 1.6 | defeat_taunt | Gotta lose some time. |
| VBC | 0.7 | pain | HUH! |
| VBD | 0.7 | pain | HUH |
| VBE | 1.3 | pain | Uwaaah! |
| VBF | 1.0 | pain | UGH! |
| VBG | 0.6 | pain | Ugh! |
| VBH | 0.4 | pain | Uh! |
| VBI | 1.2 | boast | Let's move! |
| VBJ | 5.9 | long_death | Wheeeeeelllllllllllllll |
| VBK | 1.6 | taunt | Dead man walking. |
| VBL | 1.7 | taunt | too easy |
| VBM | 1.0 | name | Scout |

### Sentinel (22)

| id | s | category | words |
|---|---|---|---|
| VC1 | 1.7 | intro | energy. |
| VC2 | 6.0 | idle_loop |  |
| VC3 | 2.0 | death_scream | Oh |
| VC4 | 2.6 | death_scream |  |
| VC5 | 2.0 | death_scream |  |
| VC6 | 6.0 | hurt_loop | You |
| VC7 | 1.5 | healed | Recharged! |
| VC8 | 1.5 | kill_confirm | You're eradicated. |
| VC9 | 1.4 | kill_confirm | Eradicate it! |
| VCA | 1.5 | kill_confirm | You eradicate it! |
| VCB | 2.7 | defeat_taunt | I shall endure! |
| VCC | 1.1 | pain | Hey |
| VCD | 1.3 | pain |  |
| VCE | 0.8 | pain | Oh |
| VCF | 1.2 | pain | You |
| VCG | 0.3 | pain | Hey! |
| VCH | 0.3 | pain | You |
| VCI | 2.0 | boast | Exterminate! |
| VCJ | 6.0 | long_death | GAAAAH |
| VCK | 3.4 | taunt | I am... I am the storm. |
| VCL | 3.6 | taunt | I need a more worthy challenge. |
| VCM | 1.8 | name | SET NO! |

### Sniper (female) (22)

| id | s | category | words |
|---|---|---|---|
| VD1 | 1.1 | intro | Target locked. |
| VD2 | 6.0 | line | Cough, cough, cough, cough, cough, cough, cough, cough, cough, coug... |
| VD3 | 1.5 | death_scream | AHHHHHHHHH |
| VD4 | 1.4 | death_scream | AHHHHHHHHH |
| VD5 | 2.0 | death_scream | AHHHHHHHHH |
| VD6 | 6.0 | line | Sigh... Sigh... Sigh... |
| VD7 | 1.4 | healed | Reloaded |
| VD8 | 1.1 | kill_confirm | KILP FARBED |
| VD9 | 1.2 | kill_confirm | Feel Confirmed. |
| VDA | 1.2 | kill_confirm | Kill Confirmed. |
| VDB | 1.6 | defeat_taunt | Lost visual on the target. |
| VDC | 0.5 | pain | Huh! |
| VDD | 0.7 | pain | BOO! |
| VDE | 0.9 | pain | UGH! |
| VDF | 0.8 | pain | Eugh! |
| VDG | 0.4 | pain | UGH! |
| VDH | 0.4 | pain | Oh! |
| VDI | 2.6 | boast | One shot, one kill. |
| VDJ | 6.0 | long_death | Aughh! Observatory? |
| VDK | 2.1 | taunt | Boom! Headshot! |
| VDL | 2.1 | taunt | My aim is true. |
| VDM | 1.0 | name | Sniper |

### Soldier (22)

| id | s | category | words |
|---|---|---|---|
| VE1 | 1.0 | intro | Hoorah! |
| VE2 | 6.0 | idle_loop | Ah. Oh. Ah. Oh. Oh. Oh. Oh. |
| VE3 | 2.0 | death_scream | AHHHHHHHHH |
| VE4 | 2.1 | death_scream | AHHHHHHHHH |
| VE5 | 1.6 | death_scream | AHHHHHHHHH! |
| VE6 | 5.8 | line | Phew. Ah. Ah. Phew. |
| VE7 | 1.1 | healed | Good to go. |
| VE8 | 1.0 | kill_confirm | Tangle down! |
| VE9 | 1.2 | kill_confirm | Tango Down! |
| VEA | 1.0 | kill_confirm | Tangle down. |
| VEB | 1.3 | defeat_taunt | We'll get them next time. |
| VEC | 0.7 | pain | Ha! |
| VED | 0.6 | pain | Hup! |
| VEE | 2.3 | pain | UGH! |
| VEF | 3.0 | pain | Oh |
| VEG | 0.5 | pain | Uh! |
| VEH | 0.6 | pain | Ah! |
| VEI | 1.1 | boast | Locked and loaded. |
| VEJ | 5.9 | line | Aaaaaaahhh, Aaaaahhh. Aaaaaaahhh. W- w- w- w- w- w- w- AAH! Aah. |
| VEK | 1.4 | taunt | Get back to Bootcamp. |
| VEL | 1.1 | taunt | Mission complete. |
| VEM | 0.9 | name | Soldier |

### Stalker (22)

| id | s | category | words |
|---|---|---|---|
| VF1 | 1.8 | intro | strike now |
| VF2 | 6.0 | idle_loop |  |
| VF3 | 2.0 | death_scream | GRRRRRRRRRRRRRRRRRR |
| VF4 | 1.8 | death_scream | RRRRRRRRRRRRRR |
| VF5 | 2.3 | death_scream | Yeah! |
| VF6 | 6.0 | hurt_loop |  |
| VF7 | 1.5 | healed | Re-engaged! |
| VF8 | 1.4 | kill_confirm | destroyed |
| VF9 | 1.4 | kill_confirm | Destroyed |
| VFA | 1.2 | kill_confirm | destroyed. |
| VFB | 2.1 | defeat_taunt | Recalibration required. |
| VFC | 0.4 | pain | You |
| VFD | 0.6 | pain |  |
| VFE | 1.0 | pain |  |
| VFF | 0.8 | pain |  |
| VFG | 0.5 | pain |  |
| VFH | 0.5 | pain |  |
| VFI | 2.2 | boast | I have awakened. |
| VFJ | 6.0 | long_death | BOOM! |
| VFK | 2.2 | taunt | Embrace your end. |
| VFL | 2.5 | taunt | We are profession. |
| VFM | 1.1 | name | Stalker! |

### Technician (22)

| id | s | category | words |
|---|---|---|---|
| VG1 | 0.9 | intro | upgrade |
| VG2 | 6.0 | idle_loop | I |
| VG3 | 1.8 | death_scream | AHHHHHHHHH! |
| VG4 | 1.5 | death_scream | AHHHHHHHHH! |
| VG5 | 1.5 | death_scream | AAH! |
| VG6 | 6.0 | hurt_loop | UGH! UGH! UGH! |
| VG7 | 0.9 | healed | Fixed up! |
| VG8 | 1.0 | kill_confirm | Nice! |
| VG9 | 1.3 | kill_confirm | NICE! |
| VGA | 0.7 | kill_confirm | Nice. |
| VGB | 3.5 | defeat_taunt | Ugh! So many repairs! |
| VGC | 0.7 | pain | MMMMMMMMMMMMMM |
| VGD | 0.9 | pain | MMMMMMMMMMMMMMMMMMMM |
| VGE | 1.2 | pain | Ow! |
| VGF | 0.8 | pain | Aargh! |
| VGG | 0.4 | pain | Oh |
| VGH | 0.3 | pain | MMM! |
| VGI | 2.3 | boast | Technician, reporting for duty. |
| VGJ | 6.0 | line | boop boop boop boop doop boop boop |
| VGK | 4.1 | taunt | Even I can't fix my name. And I can fix everything. |
| VGL | 4.1 | taunt | Ooh, I'm glad my meta gel didn't explode in the allies this time! H... |
| VGM | 0.9 | name | Technician! |

### Valkyrie (31)

| id | s | category | words |
|---|---|---|---|
| VH1 | 1.1 | intro | Load up. |
| VH2 | 6.0 | idle_loop | Ahem Ahem |
| VH3 | 2.0 | death_scream | AHHHHHHHHH! |
| VH4 | 1.7 | death_scream | AHHHHHHHHH! |
| VH5 | 1.6 | death_scream | UGH! UGH! |
| VH6 | 6.0 | hurt_loop |  |
| VH7 | 1.2 | healed | Reloaded. |
| VH8 | 1.5 | kill_confirm | BOOM! |
| VH9 | 1.5 | kill_confirm | BOOM! |
| VHA | 1.5 | kill_confirm | BOOM! |
| VHB | 1.5 | defeat_taunt | Fresh out of ordinance. |
| VHC | 0.7 | pain | HUEH |
| VHD | 1.2 | pain | Oh |
| VHE | 1.1 | pain | UGH! |
| VHF | 1.0 | pain | AHH! |
| VHG | 0.5 | pain | Ah! |
| VHH | 0.6 | pain | Huh! |
| VHI | 1.7 | boast | It's boom time! |
| VHJ | 6.0 | long_death | HUUUUUUUM |
| VHK | 1.8 | taunt | Watch and learn, noob. |
| VHL | 1.8 | taunt | Barely broke a sweat. |
| VHM | 1.1 | name | Valkyrie. |
| VHN | 0.9 | line | Yeah! |
| VHO | 0.8 | line | Good to go. |
| VHP | 1.0 | kill_confirm | Kill! |
| VHQ | 1.2 | objective_hill | Hill. |
| VHR | 0.6 | kill_confirm | kill. |
| VHS | 1.3 | line | We'll get him next time. |
| VHT | 1.2 | line | Weapons hot. |
| VHU | 3.5 | line | Ugh, there's pieces of you all over my new boots. |
| VHV | 1.1 | game_over | Mission complete. |

### Vanguard commander (18)

| id | s | category | words |
|---|---|---|---|
| VR1 | 0.8 | line | Commander |
| VR2 | 1.3 | line | You piece of shit! |
| VR3 | 2.6 | objective_codes | enemy codes captured. |
| VR4 | 2.5 | line | And it will return. |
| VR5 | 1.7 | objective_codes | And the machine has codes. |
| VR6 | 2.3 | game_over | Game Over! |
| VR7 | 1.2 | game_over | Objective complete. |
| VR8 | 0.7 | menu | Random |
| VR9 | 1.7 | clock | Sixty seconds remain. |
| VRA | 10.8 | countdown | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. |
| VRB | 1.5 | clock | 30 Second Remaining |
| VRC | 1.3 | clock | Two minutes remaining. |
| VRD | 1.5 | menu | Upgrade available. |
| VRE | 1.0 | line | Vanguard |
| VRF | 1.9 | game_over | Victory! |
| VRG | 3.4 | line | You're called Captain. |
| VRH | 1.9 | line | You're called pretend. |
| VRI | 1.9 | team | Your team has closed. |

### Viper (22)

| id | s | category | words |
|---|---|---|---|
| VJ1 | 1.3 | intro | All right. |
| VJ2 | 6.2 | idle_loop | Th-Th-Th-Th-Th-Th-Th-Th... |
| VJ3 | 2.1 | death_scream | HAAAAAAA |
| VJ4 | 1.8 | death_scream | No! |
| VJ5 | 2.0 | death_scream | AHHHHH! |
| VJ6 | 6.3 | hurt_loop | No... No... No... |
| VJ7 | 2.3 | healed | Ah, feeling good. |
| VJ8 | 1.1 | kill_confirm | That's a kill. |
| VJ9 | 1.2 | kill_confirm | That's a kill. |
| VJA | 1.1 | kill_confirm | That's a kill. |
| VJB | 2.5 | defeat_taunt | Oh, next time. |
| VJC | 0.9 | pain | HMMMMMMMMMMMMM |
| VJD | 0.9 | pain | NAH! |
| VJE | 1.5 | pain | HAAAARGHH! |
| VJF | 1.5 | pain | Uggggggggggggggggggggggg |
| VJG | 0.6 | pain | Oh |
| VJH | 0.8 | pain | HELLO |
| VJI | 1.5 | boast | Feel the sting. |
| VJJ | 6.0 | line | RRRGGGHHHHHHHHHH RRRRRGGGHHHHHHHHHHHHHHH RRRRRRRRRGGGHHHHHHHH RRRRR... |
| VJK | 1.7 | taunt | Ooh! Heh heh heh! |
| VJL | 2.3 | taunt | Yeah, that's how it's done. |
| VJM | 1.0 | name | Viper |

### Voice (1)

| id | s | category | words |
|---|---|---|---|
| VIP | 1.3 | objective_other | VIP |

### Wraith (22)

| id | s | category | words |
|---|---|---|---|
| VK1 | 1.4 | intro | Very nice! |
| VK2 | 6.0 | line | You're fine. You're fine. You're gonna get better. |
| VK3 | 2.0 | death_scream | AHHHHHHHHH |
| VK4 | 2.3 | death_scream | Oh |
| VK5 | 2.0 | death_scream | URGH! |
| VK6 | 6.0 | line | Uh, uh, uh, uh, uh, uh. |
| VK7 | 1.3 | healed | Much better. |
| VK8 | 1.1 | kill_confirm | That's a kill. |
| VK9 | 1.2 | kill_confirm | That's a kill! |
| VKA | 1.2 | kill_confirm | That's a kill. |
| VKB | 1.7 | defeat_taunt | NEED BIGGER GUN |
| VKC | 0.6 | pain | Yeah! |
| VKD | 0.8 | pain | Nuh! |
| VKE | 0.9 | pain | Ugh! |
| VKF | 0.9 | pain | oof |
| VKG | 0.5 | pain | Oh |
| VKH | 0.4 | pain | You |
| VKI | 1.4 | boast | I return to battle. |
| VKJ | 5.9 | line | Eey you eyes, yellow eey you eyes |
| VKK | 1.3 | taunt | Who's next? |
| VKL | 2.4 | taunt | Drembel and Shadow of Vanguard |
| VKM | 0.9 | name | Drayf |

## Effects — by family

Shape words come from the descriptors: impact (hits hard, dies fast) · decaying · sustained (loop-like) · rising (charge-up); tonal / mixed / noisy; bright / mid / dull.


### N — misc effect (114)

| id | s | shape |
|---|---|---|
| N01 | 1.1 | one-shot, decaying tail, 1.1 s, tonal, mid, repeating / rattling, steady pitch ~902 Hz |
| N02 | 1.0 | one-shot impact, 1.0 s, mixed, mid, falling pitch/brightness |
| N03 | 0.8 | one-shot, decaying tail, 0.8 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| N04 | 1.4 | one-shot, decaying tail, 1.4 s, mixed, mid, falling pitch/brightness |
| N05 | 2.6 | one-shot impact, 2.6 s, tonal, mid |
| N06 | 1.0 | one-shot impact, 1.0 s, tonal, mid, repeating / rattling, steady pitch ~369 Hz |
| N07 | 1.2 | one-shot, decaying tail, 1.2 s, tonal, dull/low |
| N08 | 0.3 | one-shot, decaying tail, 0.3 s, tonal, bright, rising pitch/brightness |
| N09 | 0.8 | sustained / loop-like, 0.8 s, mixed, bright, repeating / rattling |
| N10 | 1.7 | one-shot impact, 1.7 s, mixed, bright |
| N100 | 3.4 | rising / charge-up, 3.4 s, tonal, mid |
| N101 | 2.6 | one-shot, decaying tail, 2.6 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| N102 | 2.1 | rising / charge-up, 2.1 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| N103 | 0.9 | one-shot, decaying tail, 0.9 s, tonal, mid |
| N104 | 0.8 | one-shot, decaying tail, 0.8 s, tonal, dull/low, rising pitch/brightness |
| N105 | 1.1 | one-shot impact, 1.1 s, tonal, mid |
| N106 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, mid |
| N107 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, mid, repeating / rattling |
| N108 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, mid, repeating / rattling |
| N109 | 0.9 | rising / charge-up, 0.9 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| N11 | 0.4 | sustained / loop-like, 0.4 s, tonal, dull/low, steady pitch ~701 Hz |
| N110 | 1.8 | one-shot impact, 1.8 s, tonal, bright |
| N12 | 2.8 | one-shot impact, 2.8 s, tonal, dull/low, falling pitch/brightness |
| N13 | 1.4 | one-shot impact, 1.4 s, tonal, mid |
| N14 | 4.6 | one-shot impact, 4.6 s, tonal, dull/low, falling pitch/brightness |
| N15 | 2.5 | one-shot impact, 2.5 s, tonal, dull/low, falling pitch/brightness |
| N16 | 2.5 | one-shot impact, 2.5 s, tonal, dull/low, falling pitch/brightness |
| N17 | 1.0 | one-shot impact, 1.0 s, tonal, mid |
| N18 | 3.2 | one-shot impact, 3.2 s, mixed, bright, rising pitch/brightness |
| N19 | 1.4 | one-shot impact, 1.4 s, tonal, mid, falling pitch/brightness |
| N1A | 0.0 | silent / near-empty |
| N1B | 0.3 | rising / charge-up, 0.3 s, mixed, bright |
| N1C | 2.7 | sustained / loop-like, 2.7 s, mixed, bright |
| N1D | 0.1 | very short, 0.1 s, tonal, dull/low |
| N20 | 0.7 | one-shot impact, 0.7 s, tonal, mid, falling pitch/brightness |
| N21 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, mid |
| N22 | 3.1 | one-shot, decaying tail, 3.1 s, tonal, dull/low, falling pitch/brightness |
| N23 | 3.1 | one-shot impact, 3.1 s, mixed, mid, falling pitch/brightness |
| N24 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| N25 | 2.5 | one-shot, decaying tail, 2.5 s, tonal, dull/low, repeating / rattling, rising pitch/brightness |
| N26 | 0.4 | sustained / loop-like, 0.4 s, mixed, mid |
| N27 | 0.7 | sustained / loop-like, 0.7 s, mixed, mid |
| N28 | 2.8 | one-shot impact, 2.8 s, mixed, bright, repeating / rattling |
| N29 | 2.1 | one-shot, decaying tail, 2.1 s, tonal, mid |
| N30 | 1.3 | one-shot impact, 1.3 s, tonal, mid |
| N31 | 3.6 | varying, 3.6 s, mixed, mid, repeating / rattling |
| N32 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, bright, rising pitch/brightness |
| N33 | 2.2 | varying, 2.2 s, mixed, bright, repeating / rattling |
| N34 | 1.5 | one-shot impact, 1.5 s, tonal, mid |
| N35 | 2.6 | one-shot impact, 2.6 s, tonal, mid |
| N36 | 1.9 | one-shot impact, 1.9 s, mixed, bright |
| N37 | 0.5 | one-shot impact, 0.5 s, tonal, bright |
| N38 | 1.2 | one-shot, decaying tail, 1.2 s, tonal, dull/low, repeating / rattling |
| N39 | 2.1 | one-shot impact, 2.1 s, tonal, bright, steady pitch ~1321 Hz |
| N40 | 0.3 | one-shot, decaying tail, 0.3 s, tonal, bright, steady pitch ~1246 Hz |
| N41 | 0.7 | auto-label was: misc effect; one-shot impact, 0.7 s, tonal, dull/low, steady pitch ~933 Hz) |
| N42 | 1.2 | one-shot, decaying tail, 1.2 s, tonal, dull/low |
| N43 | 1.0 | one-shot impact, 1.0 s, tonal, bright, repeating / rattling |
| N44 | 1.2 | one-shot impact, 1.2 s, mixed, bright |
| N45 | 3.9 | one-shot, decaying tail, 3.9 s, tonal, dull/low |
| N46 | 1.2 | one-shot, decaying tail, 1.2 s, tonal, dull/low, rising pitch/brightness |
| N47 | 0.6 | one-shot impact, 0.6 s, mixed, bright |
| N48 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, mid |
| N49 | 0.2 | one-shot, decaying tail, 0.2 s, mixed, mid, rising pitch/brightness |
| N50 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, dull/low, rising pitch/brightness |
| N51 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, mid |
| N52 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, mid, repeating / rattling |
| N53 | 0.2 | one-shot, decaying tail, 0.2 s, mixed, bright |
| N54 | 2.3 | one-shot impact, 2.3 s, tonal, mid |
| N55 | 1.1 | one-shot impact, 1.1 s, tonal, mid, repeating / rattling |
| N56 | 0.6 | one-shot impact, 0.6 s, mixed, mid, falling pitch/brightness |
| N57 | 0.3 | sustained / loop-like, 0.3 s, mixed, mid, rising pitch/brightness |
| N58 | 0.3 | one-shot, decaying tail, 0.3 s, noisy, bright, rising pitch/brightness |
| N59 | 0.6 | one-shot, decaying tail, 0.6 s, mixed, mid, rising pitch/brightness |
| N60 | 0.6 | one-shot, decaying tail, 0.6 s, mixed, bright |
| N61 | 0.3 | one-shot, decaying tail, 0.3 s, mixed, mid, rising pitch/brightness |
| N62 | 0.3 | one-shot, decaying tail, 0.3 s, mixed, mid, rising pitch/brightness |
| N63 | 0.2 | one-shot, decaying tail, 0.2 s, mixed, mid |
| N64 | 0.3 | one-shot, decaying tail, 0.3 s, mixed, mid, rising pitch/brightness |
| N65 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, mid |
| N66 | 2.2 | sustained / loop-like, 2.2 s, tonal, mid |
| N67 | 5.6 | sustained / loop-like, 5.6 s, tonal, mid, repeating / rattling |
| N68 | 1.3 | sustained / loop-like, 1.3 s, tonal, bright, repeating / rattling |
| N69 | 2.1 | sustained / loop-like, 2.1 s, tonal, bright, repeating / rattling |
| N70 | 5.8 | sustained / loop-like, 5.8 s, tonal, mid, repeating / rattling |
| N71 | 3.6 | sustained / loop-like, 3.6 s, tonal, dull/low |
| N72 | 2.6 | sustained / loop-like, 2.6 s, tonal, mid |
| N73 | 6.7 | one-shot, decaying tail, 6.7 s, tonal, mid |
| N74 | 1.9 | sustained / loop-like, 1.9 s, tonal, dull/low, repeating / rattling |
| N75 | 2.9 | varying, 2.9 s, tonal, dull/low, repeating / rattling |
| N76 | 0.2 | one-shot impact, 0.2 s, mixed, bright, rising pitch/brightness |
| N77 | 0.8 | one-shot, decaying tail, 0.8 s, mixed, mid |
| N78 | 1.6 | sustained / loop-like, 1.6 s, tonal, bright, repeating / rattling |
| N79 | 6.4 | sustained / loop-like, 6.4 s, noisy, bright, repeating / rattling |
| N80 | 3.5 | one-shot impact, 3.5 s, tonal, mid, repeating / rattling |
| N81 | 0.9 | one-shot, decaying tail, 0.9 s, mixed, mid |
| N82 | 1.1 | rising / charge-up, 1.1 s, tonal, mid, repeating / rattling |
| N83 | 2.4 | one-shot impact, 2.4 s, tonal, dull/low, falling pitch/brightness |
| N84 | 0.7 | one-shot impact, 0.7 s, tonal, dull/low, rising pitch/brightness |
| N85 | 1.5 | one-shot, decaying tail, 1.5 s, mixed, mid, rising pitch/brightness |
| N86 | 1.9 | one-shot, decaying tail, 1.9 s, tonal, mid, steady pitch ~596 Hz |
| N87 | 0.0 | silent / near-empty |
| N88 | 2.0 | one-shot, decaying tail, 2.0 s, mixed, mid |
| N89 | 0.0 | silent / near-empty |
| N90 | 0.3 | one-shot, decaying tail, 0.3 s, tonal, mid |
| N91 | 0.3 | one-shot, decaying tail, 0.3 s, mixed, dull/low |
| N92 | 0.2 | sustained / loop-like, 0.2 s, tonal, dull/low, steady pitch ~450 Hz |
| N93 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, bright |
| N94 | 0.1 | sustained / loop-like, 0.1 s, tonal, bright |
| N95 | 0.1 | very short, 0.1 s, tonal, bright |
| N96 | 0.1 | very short, 0.1 s, mixed, bright |
| N97 | 0.1 | one-shot, decaying tail, 0.1 s, noisy, mid, falling pitch/brightness |
| N98 | 0.1 | very short, 0.1 s, tonal, dull/low |
| N99 | 0.1 | sustained / loop-like, 0.1 s, tonal, mid |

### H — hit / impact (113)

| id | s | shape |
|---|---|---|
| H01 | 2.1 | one-shot impact, 2.1 s, noisy, bright, repeating / rattling |
| H02 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, mid, falling pitch/brightness |
| H03 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, mid, falling pitch/brightness |
| H04 | 1.5 | sustained / loop-like, 1.5 s, mixed, mid, repeating / rattling |
| H05 | 2.2 | varying, 2.2 s, tonal, mid, repeating / rattling |
| H06 | 0.4 | one-shot, decaying tail, 0.4 s, noisy, bright, rising pitch/brightness |
| H07 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid |
| H08 | 0.5 | one-shot, decaying tail, 0.5 s, noisy, bright |
| H09 | 0.5 | one-shot, decaying tail, 0.5 s, noisy, bright |
| H10 | 0.7 | one-shot, decaying tail, 0.7 s, noisy, bright |
| H100 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, bright, repeating / rattling |
| H101 | 3.1 | one-shot impact, 3.1 s, mixed, bright |
| H102 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, mid, repeating / rattling |
| H103 | 0.8 | one-shot, decaying tail, 0.8 s, noisy, bright |
| H104 | 0.7 | one-shot, decaying tail, 0.7 s, noisy, bright, rising pitch/brightness |
| H105 | 0.5 | one-shot, decaying tail, 0.5 s, noisy, bright |
| H106 | 0.8 | one-shot, decaying tail, 0.8 s, mixed, bright |
| H107 | 0.9 | one-shot, decaying tail, 0.9 s, tonal, bright, repeating / rattling, rising pitch/brightness |
| H108 | 0.8 | one-shot, decaying tail, 0.8 s, mixed, mid |
| H109 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, bright, rising pitch/brightness |
| H11 | 0.6 | one-shot, decaying tail, 0.6 s, noisy, bright |
| H110 | 1.2 | one-shot impact, 1.2 s, noisy, bright, repeating / rattling |
| H111 | 1.1 | one-shot impact, 1.1 s, noisy, bright, repeating / rattling |
| H112 | 0.6 | one-shot, decaying tail, 0.6 s, mixed, bright, rising pitch/brightness |
| H113 | 0.6 | one-shot, decaying tail, 0.6 s, noisy, bright |
| H114 | 1.4 | one-shot impact, 1.4 s, noisy, bright, repeating / rattling |
| H115 | 1.1 | one-shot, decaying tail, 1.1 s, noisy, bright, repeating / rattling |
| H116 | 1.4 | one-shot impact, 1.4 s, mixed, bright |
| H117 | 1.9 | one-shot impact, 1.9 s, mixed, bright |
| H118 | 0.9 | one-shot impact, 0.9 s, mixed, bright, repeating / rattling |
| H119 | 0.7 | one-shot impact, 0.7 s, mixed, bright |
| H12 | 1.9 | one-shot impact, 1.9 s, noisy, bright, rising pitch/brightness |
| H120 | 1.2 | one-shot, decaying tail, 1.2 s, tonal, mid, repeating / rattling |
| H121 | 0.9 | one-shot, decaying tail, 0.9 s, tonal, mid |
| H122 | 0.9 | one-shot, decaying tail, 0.9 s, tonal, bright |
| H123 | 3.0 | one-shot impact, 3.0 s, tonal, dull/low, steady pitch ~389 Hz, rising pitch/brightness |
| H124 | 3.0 | one-shot, decaying tail, 3.0 s, tonal, dull/low, repeating / rattling, rising pitch/brightness |
| H125 | 2.9 | one-shot, decaying tail, 2.9 s, tonal, dull/low, repeating / rattling, steady pitch ~537 Hz |
| H126 | 0.5 | one-shot impact, 0.5 s, mixed, bright |
| H127 | 0.9 | one-shot impact, 0.9 s, tonal, bright, repeating / rattling |
| H128 | 1.3 | one-shot impact, 1.3 s, tonal, mid |
| H129 | 6.0 | varying, 6.0 s, mixed, mid |
| H13 | 0.8 | one-shot impact, 0.8 s, tonal, mid, falling pitch/brightness |
| H130 | 2.5 | one-shot, decaying tail, 2.5 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| H131 | 3.8 | one-shot impact, 3.8 s, tonal, dull/low, falling pitch/brightness |
| H132 | 6.1 | sustained / loop-like, 6.1 s, tonal, dull/low, rising pitch/brightness |
| H133 | 6.1 | one-shot, decaying tail, 6.1 s, tonal, dull/low, rising pitch/brightness |
| H134 | 0.7 | one-shot impact, 0.7 s, noisy, bright, rising pitch/brightness |
| H135 | 0.9 | one-shot impact, 0.9 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| H136 | 0.5 | one-shot, decaying tail, 0.5 s, tonal, mid, falling pitch/brightness |
| H137 | 0.6 | one-shot, decaying tail, 0.6 s, mixed, mid |
| H138 | 0.9 | one-shot impact, 0.9 s, mixed, mid, repeating / rattling |
| H139 | 0.9 | one-shot impact, 0.9 s, mixed, bright, repeating / rattling, rising pitch/brightness |
| H14 | 0.4 | one-shot, decaying tail, 0.4 s, tonal, mid |
| H140 | 0.5 | one-shot impact, 0.5 s, mixed, mid |
| H141 | 0.5 | one-shot impact, 0.5 s, mixed, mid |
| H142 | 1.2 | one-shot impact, 1.2 s, noisy, bright, repeating / rattling |
| H143 | 1.2 | one-shot impact, 1.2 s, noisy, bright, repeating / rattling, rising pitch/brightness |
| H144 | 1.1 | one-shot impact, 1.1 s, mixed, bright, repeating / rattling |
| H145 | 1.2 | one-shot impact, 1.2 s, noisy, bright, repeating / rattling, rising pitch/brightness |
| H146 | 0.7 | one-shot impact, 0.7 s, noisy, bright, rising pitch/brightness |
| H147 | 0.7 | one-shot impact, 0.7 s, mixed, bright |
| H148 | 1.1 | one-shot impact, 1.1 s, noisy, bright |
| H149 | 1.1 | one-shot impact, 1.1 s, noisy, bright, rising pitch/brightness |
| H15 | 0.5 | one-shot impact, 0.5 s, mixed, mid |
| H150 | 2.1 | one-shot, decaying tail, 2.1 s, tonal, mid |
| H151 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, bright, repeating / rattling |
| H152 | 1.9 | one-shot, decaying tail, 1.9 s, tonal, mid |
| H153 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, bright, repeating / rattling |
| H154 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, bright |
| H155 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, bright, rising pitch/brightness |
| H16 | 6.3 | one-shot impact, 6.3 s, mixed, bright, rising pitch/brightness |
| H17 | 2.2 | one-shot impact, 2.2 s, mixed, mid |
| H18 | 4.9 | one-shot, decaying tail, 4.9 s, tonal, mid, falling pitch/brightness |
| H19 | 3.3 | one-shot impact, 3.3 s, noisy, bright, repeating / rattling |
| H20 | 0.9 | one-shot impact, 0.9 s, mixed, bright, repeating / rattling, rising pitch/brightness |
| H21 | 0.7 | one-shot impact, 0.7 s, mixed, mid, falling pitch/brightness |
| H22 | 0.6 | one-shot impact, 0.6 s, mixed, mid, falling pitch/brightness |
| H23 | 1.4 | one-shot impact, 1.4 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| H24 | 1.2 | one-shot impact, 1.2 s, noisy, bright, repeating / rattling |
| H25 | 1.2 | one-shot impact, 1.2 s, noisy, bright, repeating / rattling |
| H26 | 0.6 | one-shot impact, 0.6 s, noisy, bright |
| H27 | 1.2 | one-shot impact, 1.2 s, noisy, bright, repeating / rattling |
| H28 | 1.0 | one-shot impact, 1.0 s, tonal, bright, repeating / rattling |
| H29 | 1.2 | one-shot, decaying tail, 1.2 s, mixed, bright, repeating / rattling, rising pitch/brightness |
| H30 | 1.2 | one-shot impact, 1.2 s, mixed, bright, rising pitch/brightness |
| H31 | 0.6 | one-shot impact, 0.6 s, mixed, mid, rising pitch/brightness |
| H32 | 0.6 | one-shot impact, 0.6 s, mixed, bright, rising pitch/brightness |
| H33 | 0.4 | one-shot, decaying tail, 0.4 s, noisy, bright |
| H34 | 0.9 | one-shot, decaying tail, 0.9 s, mixed, bright, repeating / rattling |
| H35 | 0.6 | one-shot impact, 0.6 s, mixed, mid, falling pitch/brightness |
| H36 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid, falling pitch/brightness |
| H37 | 0.7 | one-shot impact, 0.7 s, mixed, mid, falling pitch/brightness |
| H39 | 1.0 | one-shot, decaying tail, 1.0 s, noisy, bright, rising pitch/brightness |
| H40 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, mid, repeating / rattling |
| H41 | 1.6 | one-shot impact, 1.6 s, noisy, bright |
| H42 | 0.7 | one-shot impact, 0.7 s, noisy, bright |
| H43 | 0.6 | one-shot impact, 0.6 s, noisy, bright |
| H44 | 1.4 | one-shot impact, 1.4 s, tonal, mid, repeating / rattling, rising pitch/brightness |
| H45 | 1.6 | one-shot impact, 1.6 s, mixed, mid, repeating / rattling |
| H46 | 3.1 | one-shot impact, 3.1 s, mixed, bright |
| H47 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, bright, repeating / rattling |
| H48 | 1.2 | one-shot impact, 1.2 s, noisy, mid, repeating / rattling, falling pitch/brightness |
| H49 | 1.2 | one-shot impact, 1.2 s, mixed, mid, repeating / rattling |
| H50 | 1.0 | one-shot impact, 1.0 s, noisy, bright |
| H51 | 1.0 | one-shot impact, 1.0 s, noisy, bright |
| H52 | 0.9 | one-shot, decaying tail, 0.9 s, mixed, mid, repeating / rattling |
| H53 | 1.1 | one-shot, decaying tail, 1.1 s, mixed, mid |
| H54 | 0.8 | one-shot impact, 0.8 s, mixed, mid, falling pitch/brightness |
| H55 | 0.4 | one-shot, decaying tail, 0.4 s, tonal, mid, rising pitch/brightness |
| H56 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid, rising pitch/brightness |
| H57 | 0.8 | one-shot, decaying tail, 0.8 s, mixed, mid, rising pitch/brightness |
| H58 | 1.1 | one-shot, decaying tail, 1.1 s, tonal, mid, repeating / rattling, falling pitch/brightness |

### U — beep / boop (110)

| id | s | shape |
|---|---|---|
| U01 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, bright |
| U02 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, bright |
| U03 | 0.8 | one-shot, decaying tail, 0.8 s, mixed, bright, repeating / rattling |
| U04 | 0.7 | one-shot, decaying tail, 0.7 s, tonal, bright, falling pitch/brightness |
| U05 | 0.5 | one-shot, decaying tail, 0.5 s, tonal, bright, rising pitch/brightness |
| U06 | 1.5 | one-shot, decaying tail, 1.5 s, tonal, dull/low, falling pitch/brightness |
| U07 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, bright, rising pitch/brightness |
| U08 | 0.5 | one-shot, decaying tail, 0.5 s, tonal, bright, rising pitch/brightness |
| U09 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, bright, rising pitch/brightness |
| U10 | 0.6 | rising / charge-up, 0.6 s, mixed, bright |
| U100 | 0.1 | one-shot, decaying tail, 0.1 s, mixed, bright |
| U101 | 0.1 | one-shot, decaying tail, 0.1 s, mixed, bright |
| U102 | 0.5 | one-shot, decaying tail, 0.5 s, tonal, dull/low, falling pitch/brightness |
| U103 | 0.5 | one-shot, decaying tail, 0.5 s, tonal, mid, falling pitch/brightness |
| U104 | 0.1 | very short, 0.1 s, mixed, bright |
| U105 | 0.1 | one-shot, decaying tail, 0.1 s, noisy, bright |
| U106 | 0.3 | one-shot, decaying tail, 0.3 s, noisy, bright |
| U107 | 0.3 | one-shot, decaying tail, 0.3 s, mixed, bright |
| U108 | 0.4 | one-shot, decaying tail, 0.4 s, tonal, mid, falling pitch/brightness |
| U109 | 1.1 | one-shot impact, 1.1 s, tonal, mid |
| U11 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, dull/low, repeating / rattling, rising pitch/brightness |
| U110 | 0.8 | one-shot impact, 0.8 s, tonal, mid, falling pitch/brightness |
| U12 | 1.8 | one-shot impact, 1.8 s, mixed, mid, falling pitch/brightness |
| U13 | 0.1 | one-shot, decaying tail, 0.1 s, mixed, bright, rising pitch/brightness |
| U14 | 0.4 | one-shot, decaying tail, 0.4 s, tonal, dull/low, rising pitch/brightness |
| U15 | 0.2 | sustained / loop-like, 0.2 s, tonal, mid, rising pitch/brightness |
| U16 | 0.4 | one-shot impact, 0.4 s, tonal, bright |
| U17 | 0.3 | one-shot, decaying tail, 0.3 s, mixed, bright, rising pitch/brightness |
| U18 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, bright |
| U19 | 0.5 | rising / charge-up, 0.5 s, noisy, bright |
| U20 | 0.9 | sustained / loop-like, 0.9 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| U21 | 0.3 | one-shot, decaying tail, 0.3 s, noisy, bright |
| U22 | 0.4 | one-shot, decaying tail, 0.4 s, tonal, mid |
| U23 | 0.7 | sustained / loop-like, 0.7 s, noisy, bright |
| U24 | 1.3 | one-shot impact, 1.3 s, mixed, bright, repeating / rattling |
| U25 | 0.3 | one-shot, decaying tail, 0.3 s, mixed, bright |
| U26 | 0.2 | one-shot, decaying tail, 0.2 s, mixed, bright |
| U27 | 0.6 | rising / charge-up, 0.6 s, mixed, bright |
| U28 | 1.4 | one-shot impact, 1.4 s, mixed, bright |
| U29 | 0.2 | one-shot, decaying tail, 0.2 s, mixed, bright |
| U30 | 1.4 | one-shot impact, 1.4 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| U31 | 0.3 | sustained / loop-like, 0.3 s, noisy, bright |
| U32 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, bright |
| U33 | 0.2 | varying, 0.2 s, tonal, bright |
| U34 | 1.2 | one-shot impact, 1.2 s, mixed, bright |
| U35 | 0.6 | one-shot, decaying tail, 0.6 s, noisy, bright |
| U36 | 0.6 | rising / charge-up, 0.6 s, noisy, bright |
| U37 | 0.1 | very short, 0.1 s, noisy, bright |
| U38 | 1.5 | one-shot impact, 1.5 s, mixed, bright, repeating / rattling |
| U39 | 0.4 | sustained / loop-like, 0.4 s, noisy, bright |
| U40 | 0.7 | sustained / loop-like, 0.7 s, mixed, bright |
| U41 | 0.2 | one-shot, decaying tail, 0.2 s, mixed, bright |
| U42 | 0.6 | one-shot, decaying tail, 0.6 s, noisy, bright |
| U43 | 0.1 | very short, 0.1 s, noisy, bright |
| U44 | 0.5 | rising / charge-up, 0.5 s, mixed, mid, rising pitch/brightness |
| U45 | 0.1 | very short, 0.1 s, mixed, bright |
| U46 | 0.5 | one-shot, decaying tail, 0.5 s, noisy, bright |
| U47 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, dull/low, rising pitch/brightness |
| U48 | 1.9 | one-shot, decaying tail, 1.9 s, tonal, dull/low, falling pitch/brightness |
| U49 | 0.3 | sustained / loop-like, 0.3 s, mixed, bright, falling pitch/brightness |
| U50 | 0.6 | sustained / loop-like, 0.6 s, mixed, bright |
| U51 | 0.1 | one-shot, decaying tail, 0.1 s, mixed, bright |
| U52 | 1.1 | one-shot, decaying tail, 1.1 s, tonal, mid, rising pitch/brightness |
| U53 | 0.1 | sustained / loop-like, 0.1 s, tonal, bright |
| U54 | 0.7 | one-shot, decaying tail, 0.7 s, tonal, mid, rising pitch/brightness |
| U55 | 0.3 | one-shot, decaying tail, 0.3 s, tonal, mid, falling pitch/brightness |
| U56 | 0.9 | one-shot impact, 0.9 s, tonal, bright, repeating / rattling |
| U57 | 0.2 | one-shot, decaying tail, 0.2 s, mixed, bright |
| U58 | 0.6 | one-shot, decaying tail, 0.6 s, mixed, bright |
| U59 | 0.4 | one-shot, decaying tail, 0.4 s, tonal, mid |
| U60 | 1.2 | one-shot impact, 1.2 s, tonal, dull/low, falling pitch/brightness |
| U61 | 0.1 | very short, 0.1 s, noisy, bright |
| U62 | 0.3 | one-shot, decaying tail, 0.3 s, tonal, mid |
| U63 | 1.2 | one-shot impact, 1.2 s, mixed, mid |
| U64 | 0.3 | one-shot, decaying tail, 0.3 s, mixed, bright |
| U65 | 0.2 | sustained / loop-like, 0.2 s, mixed, bright |
| U66 | 0.8 | one-shot, decaying tail, 0.8 s, mixed, mid, rising pitch/brightness |
| U67 | 0.2 | rising / charge-up, 0.2 s, mixed, bright |
| U68 | 0.2 | rising / charge-up, 0.2 s, mixed, bright |
| U69 | 0.7 | one-shot, decaying tail, 0.7 s, tonal, dull/low, rising pitch/brightness |
| U70 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, bright |
| U71 | 0.2 | rising / charge-up, 0.2 s, mixed, bright |
| U72 | 0.1 | very short, 0.1 s, tonal, bright |
| U73 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, bright |
| U74 | 0.4 | sustained / loop-like, 0.4 s, mixed, bright |
| U75 | 1.0 | one-shot impact, 1.0 s, mixed, bright, falling pitch/brightness |
| U76 | 1.1 | one-shot, decaying tail, 1.1 s, mixed, mid, repeating / rattling |
| U77 | 1.1 | one-shot, decaying tail, 1.1 s, noisy, bright, repeating / rattling |
| U78 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid, falling pitch/brightness |
| U79 | 0.5 | one-shot impact, 0.5 s, noisy, bright |
| U80 | 0.7 | one-shot impact, 0.7 s, tonal, mid, falling pitch/brightness |
| U81 | 0.8 | one-shot, decaying tail, 0.8 s, noisy, mid |
| U82 | 0.7 | one-shot impact, 0.7 s, tonal, mid, falling pitch/brightness |
| U83 | 0.2 | one-shot, decaying tail, 0.2 s, mixed, bright |
| U84 | 0.6 | one-shot impact, 0.6 s, mixed, bright |
| U85 | 1.5 | one-shot impact, 1.5 s, mixed, mid, repeating / rattling |
| U86 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, mid |
| U87 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, mid |
| U88 | 0.3 | one-shot, decaying tail, 0.3 s, mixed, mid, falling pitch/brightness |
| U89 | 0.6 | one-shot impact, 0.6 s, noisy, bright |
| U90 | 0.7 | one-shot impact, 0.7 s, mixed, mid |
| U91 | 0.4 | one-shot impact, 0.4 s, tonal, mid |
| U92 | 0.8 | one-shot, decaying tail, 0.8 s, tonal, mid |
| U93 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, mid, repeating / rattling |
| U94 | 1.2 | rising / charge-up, 1.2 s, mixed, mid, repeating / rattling |
| U95 | 1.1 | sustained / loop-like, 1.1 s, noisy, bright, repeating / rattling |
| U96 | 1.2 | one-shot, decaying tail, 1.2 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| U97 | 0.2 | one-shot, decaying tail, 0.2 s, tonal, bright, steady pitch ~1796 Hz, falling pitch/brightness |
| U98 | 0.3 | sustained / loop-like, 0.3 s, mixed, bright |
| U99 | 0.3 | rising / charge-up, 0.3 s, noisy, bright, rising pitch/brightness |

### M — Mortal-Kombat-style effect (95)

| id | s | shape |
|---|---|---|
| M01 | 0.1 | rising / charge-up, 0.1 s, tonal, mid, falling pitch/brightness |
| M02 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid |
| M03 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid |
| M04 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, bright, falling pitch/brightness |
| M05 | 3.4 | one-shot, decaying tail, 3.4 s, tonal, mid, repeating / rattling |
| M06 | 1.6 | varying, 1.6 s, tonal, mid, repeating / rattling |
| M07 | 1.7 | one-shot, decaying tail, 1.7 s, mixed, mid, repeating / rattling |
| M08 | 1.3 | one-shot, decaying tail, 1.3 s, tonal, mid, repeating / rattling |
| M09 | 1.4 | one-shot, decaying tail, 1.4 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| M10 | 1.2 | sustained / loop-like, 1.2 s, mixed, mid, repeating / rattling |
| M100 | 1.7 | one-shot, decaying tail, 1.7 s, noisy, bright |
| M101 | 2.8 | one-shot, decaying tail, 2.8 s, tonal, dull/low, falling pitch/brightness |
| M11 | 2.0 | one-shot, decaying tail, 2.0 s, tonal, mid, falling pitch/brightness |
| M12 | 0.3 | one-shot, decaying tail, 0.3 s, tonal, mid |
| M13 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, mid, rising pitch/brightness |
| M14 | 0.5 | one-shot, decaying tail, 0.5 s, tonal, mid |
| M15 | 1.3 | one-shot, decaying tail, 1.3 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| M16 | 1.6 | one-shot, decaying tail, 1.6 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| M17 | 0.7 | one-shot, decaying tail, 0.7 s, tonal, dull/low |
| M18 | 0.7 | one-shot, decaying tail, 0.7 s, tonal, mid |
| M19 | 1.3 | one-shot, decaying tail, 1.3 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| M20 | 1.1 | one-shot, decaying tail, 1.1 s, tonal, dull/low, falling pitch/brightness |
| M21 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, mid |
| M22 | 1.2 | one-shot, decaying tail, 1.2 s, noisy, mid, repeating / rattling |
| M23 | 1.9 | one-shot, decaying tail, 1.9 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| M24 | 1.8 | one-shot, decaying tail, 1.8 s, mixed, bright, falling pitch/brightness |
| M25 | 2.1 | one-shot, decaying tail, 2.1 s, noisy, bright |
| M26 | 2.0 | one-shot impact, 2.0 s, mixed, bright |
| M27 | 0.2 | sustained / loop-like, 0.2 s, mixed, mid |
| M28 | 0.9 | one-shot, decaying tail, 0.9 s, mixed, mid, repeating / rattling |
| M29 | 2.8 | one-shot, decaying tail, 2.8 s, tonal, dull/low, falling pitch/brightness |
| M30 | 1.7 | one-shot, decaying tail, 1.7 s, noisy, bright |
| M31 | 0.3 | rising / charge-up, 0.3 s, noisy, bright |
| M32 | 0.3 | one-shot, decaying tail, 0.3 s, noisy, bright |
| M33 | 0.6 | one-shot impact, 0.6 s, mixed, mid, falling pitch/brightness |
| M34 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, mid, repeating / rattling |
| M35 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, bright |
| M36 | 0.5 | one-shot, decaying tail, 0.5 s, tonal, dull/low, rising pitch/brightness |
| M37 | 0.5 | one-shot, decaying tail, 0.5 s, tonal, dull/low |
| M38 | 0.7 | one-shot impact, 0.7 s, tonal, dull/low |
| M39 | 0.6 | one-shot impact, 0.6 s, tonal, mid |
| M40 | 1.1 | one-shot impact, 1.1 s, tonal, mid, falling pitch/brightness |
| M41 | 1.4 | one-shot impact, 1.4 s, tonal, mid |
| M42 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, mid |
| M43 | 0.9 | one-shot, decaying tail, 0.9 s, tonal, mid, rising pitch/brightness |
| M44 | 0.7 | one-shot, decaying tail, 0.7 s, tonal, mid |
| M45 | 1.0 | one-shot impact, 1.0 s, tonal, mid, falling pitch/brightness |
| M46 | 0.7 | one-shot impact, 0.7 s, mixed, mid, falling pitch/brightness |
| M47 | 0.6 | one-shot impact, 0.6 s, mixed, mid, falling pitch/brightness |
| M48 | 2.0 | one-shot, decaying tail, 2.0 s, noisy, bright |
| M49 | 1.8 | one-shot, decaying tail, 1.8 s, mixed, bright |
| M50 | 1.0 | one-shot impact, 1.0 s, mixed, bright, repeating / rattling, rising pitch/brightness |
| M51 | 0.9 | one-shot, decaying tail, 0.9 s, mixed, bright, repeating / rattling |
| M52 | 1.0 | one-shot impact, 1.0 s, noisy, bright |
| M53 | 1.5 | one-shot impact, 1.5 s, mixed, bright |
| M54 | 1.5 | one-shot impact, 1.5 s, noisy, bright |
| M55 | 1.6 | one-shot impact, 1.6 s, noisy, bright |
| M56 | 1.7 | one-shot impact, 1.7 s, noisy, bright, repeating / rattling |
| M57 | 25.2 | varying, 25.2 s, tonal, mid |
| M58 | 1.1 | one-shot impact, 1.1 s, mixed, mid, falling pitch/brightness |
| M59 | 1.2 | one-shot, decaying tail, 1.2 s, mixed, mid |
| M60 | 1.2 | one-shot impact, 1.2 s, mixed, bright |
| M61 | 1.2 | one-shot impact, 1.2 s, noisy, bright |
| M62 | 1.1 | one-shot impact, 1.1 s, noisy, bright, rising pitch/brightness |
| M63 | 0.4 | one-shot impact, 0.4 s, tonal, dull/low |
| M64 | 0.4 | one-shot, decaying tail, 0.4 s, tonal, dull/low, rising pitch/brightness |
| M65 | 0.4 | one-shot, decaying tail, 0.4 s, tonal, mid |
| M66 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, mid |
| M67 | 0.5 | one-shot, decaying tail, 0.5 s, tonal, mid |
| M68 | 1.0 | one-shot impact, 1.0 s, tonal, mid |
| M69 | 1.2 | one-shot impact, 1.2 s, tonal, mid |
| M70 | 0.9 | one-shot impact, 0.9 s, mixed, mid, falling pitch/brightness |
| M71 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, bright, rising pitch/brightness |
| M72 | 0.6 | one-shot, decaying tail, 0.6 s, mixed, mid |
| M73 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, bright |
| M74 | 0.6 | one-shot, decaying tail, 0.6 s, mixed, bright |
| M75 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid |
| M76 | 0.6 | one-shot impact, 0.6 s, mixed, mid, falling pitch/brightness |
| M77 | 0.5 | one-shot impact, 0.5 s, mixed, bright, falling pitch/brightness |
| M78 | 1.1 | one-shot impact, 1.1 s, tonal, mid, falling pitch/brightness |
| M79 | 0.9 | one-shot impact, 0.9 s, tonal, mid, falling pitch/brightness |
| M80 | 0.8 | one-shot impact, 0.8 s, tonal, mid, rising pitch/brightness |
| M81 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, mid, rising pitch/brightness |
| M82 | 0.4 | one-shot, decaying tail, 0.4 s, tonal, mid |
| M83 | 0.5 | one-shot impact, 0.5 s, tonal, mid |
| M84 | 0.5 | sustained / loop-like, 0.5 s, tonal, dull/low, steady pitch ~75 Hz, falling pitch/brightness |
| M85 | 0.8 | one-shot, decaying tail, 0.8 s, tonal, dull/low, repeating / rattling, rising pitch/brightness |
| M86 | 0.8 | one-shot, decaying tail, 0.8 s, tonal, dull/low, repeating / rattling, rising pitch/brightness |
| M87 | 0.8 | one-shot, decaying tail, 0.8 s, tonal, dull/low |
| M88 | 0.8 | one-shot, decaying tail, 0.8 s, tonal, dull/low, repeating / rattling, rising pitch/brightness |
| M89 | 0.8 | one-shot, decaying tail, 0.8 s, tonal, dull/low, repeating / rattling |
| M90 | 1.1 | one-shot, decaying tail, 1.1 s, tonal, dull/low, rising pitch/brightness |
| M91 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, dull/low, rising pitch/brightness |
| M92 | 0.8 | one-shot, decaying tail, 0.8 s, mixed, mid |
| M93 | 1.2 | one-shot, decaying tail, 1.2 s, mixed, mid, repeating / rattling |

### A — sci-fi effect (90)

| id | s | shape |
|---|---|---|
| A01 | 2.5 | one-shot, decaying tail, 2.5 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| A02 | 1.2 | one-shot impact, 1.2 s, noisy, bright, repeating / rattling |
| A03 | 0.5 | one-shot, decaying tail, 0.5 s, tonal, dull/low, falling pitch/brightness |
| A04 | 4.2 | one-shot impact, 4.2 s, mixed, mid |
| A05 | 4.2 | one-shot impact, 4.2 s, noisy, mid, falling pitch/brightness |
| A06 | 2.1 | one-shot impact, 2.1 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| A07 | 1.8 | one-shot impact, 1.8 s, noisy, bright, repeating / rattling |
| A08 | 1.5 | one-shot, decaying tail, 1.5 s, mixed, mid, falling pitch/brightness |
| A09 | 1.5 | one-shot, decaying tail, 1.5 s, tonal, mid |
| A10 | 15.0 | sustained / loop-like, 15.0 s, tonal, dull/low, repeating / rattling, steady pitch ~61 Hz |
| A100 | 19.2 | one-shot impact, 19.2 s, tonal, dull/low |
| A101 | 7.2 | one-shot impact, 7.2 s, tonal, mid |
| A102 | 11.9 | one-shot impact, 11.9 s, tonal, mid |
| A103 | 24.1 | one-shot impact, 24.1 s, tonal, mid |
| A11 | 0.9 | one-shot impact, 0.9 s, mixed, mid |
| A12 | 0.9 | one-shot impact, 0.9 s, noisy, bright, repeating / rattling |
| A13 | 0.8 | one-shot, decaying tail, 0.8 s, mixed, bright, repeating / rattling |
| A14 | 2.0 | one-shot, decaying tail, 2.0 s, noisy, bright, repeating / rattling |
| A15 | 2.0 | varying, 2.0 s, noisy, bright, repeating / rattling |
| A16 | 2.9 | one-shot impact, 2.9 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| A17 | 2.0 | one-shot impact, 2.0 s, mixed, bright, repeating / rattling |
| A18 | 0.6 | sustained / loop-like, 0.6 s, tonal, mid |
| A19 | 1.0 | one-shot impact, 1.0 s, mixed, bright, repeating / rattling |
| A20 | 18.1 | sustained / loop-like, 18.1 s, mixed, bright, repeating / rattling |
| A21 | 1.3 | one-shot, decaying tail, 1.3 s, mixed, mid, falling pitch/brightness |
| A22 | 1.5 | one-shot, decaying tail, 1.5 s, mixed, bright, rising pitch/brightness |
| A23 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| A24 | 1.8 | rising / charge-up, 1.8 s, noisy, bright, repeating / rattling, rising pitch/brightness |
| A25 | 1.0 | sustained / loop-like, 1.0 s, noisy, bright, repeating / rattling |
| A26 | 1.2 | one-shot impact, 1.2 s, mixed, bright, repeating / rattling |
| A27 | 2.4 | one-shot impact, 2.4 s, noisy, bright, repeating / rattling |
| A28 | 1.0 | one-shot impact, 1.0 s, tonal, mid, falling pitch/brightness |
| A29 | 1.3 | one-shot, decaying tail, 1.3 s, mixed, mid, falling pitch/brightness |
| A30 | 1.5 | one-shot, decaying tail, 1.5 s, mixed, mid, rising pitch/brightness |
| A31 | 1.7 | sustained / loop-like, 1.7 s, noisy, mid, repeating / rattling |
| A32 | 1.3 | one-shot impact, 1.3 s, tonal, bright |
| A33 | 1.1 | one-shot impact, 1.1 s, noisy, bright |
| A34 | 3.5 | rising / charge-up, 3.5 s, mixed, mid, repeating / rattling |
| A35 | 2.1 | one-shot, decaying tail, 2.1 s, mixed, mid, falling pitch/brightness |
| A36 | 1.4 | one-shot impact, 1.4 s, mixed, mid |
| A37 | 7.1 | one-shot impact, 7.1 s, noisy, bright |
| A38 | 7.1 | one-shot, decaying tail, 7.1 s, mixed, mid, rising pitch/brightness |
| A39 | 7.1 | one-shot impact, 7.1 s, noisy, mid, rising pitch/brightness |
| A40 | 7.1 | one-shot impact, 7.1 s, tonal, dull/low |
| A41 | 7.1 | one-shot impact, 7.1 s, noisy, mid, rising pitch/brightness |
| A42 | 7.1 | one-shot impact, 7.1 s, noisy, bright, rising pitch/brightness |
| A43 | 7.1 | one-shot impact, 7.1 s, mixed, mid, rising pitch/brightness |
| A44 | 2.5 | one-shot impact, 2.5 s, mixed, mid |
| A45 | 2.5 | one-shot impact, 2.5 s, tonal, mid |
| A46 | 2.6 | one-shot impact, 2.6 s, tonal, mid |
| A47 | 1.9 | one-shot impact, 1.9 s, noisy, mid, falling pitch/brightness |
| A48 | 1.9 | one-shot, decaying tail, 1.9 s, noisy, mid, falling pitch/brightness |
| A49 | 0.8 | one-shot, decaying tail, 0.8 s, mixed, mid, repeating / rattling |
| A50 | 1.8 | one-shot, decaying tail, 1.8 s, mixed, mid, falling pitch/brightness |
| A51 | 1.9 | one-shot, decaying tail, 1.9 s, mixed, mid |
| A52 | 1.9 | one-shot, decaying tail, 1.9 s, tonal, mid, repeating / rattling |
| A53 | 2.3 | one-shot impact, 2.3 s, noisy, bright |
| A54 | 0.8 | one-shot impact, 0.8 s, mixed, bright |
| A55 | 3.9 | one-shot, decaying tail, 3.9 s, tonal, mid, falling pitch/brightness |
| A56 | 0.8 | one-shot impact, 0.8 s, tonal, mid, repeating / rattling |
| A57 | 0.8 | one-shot impact, 0.8 s, tonal, mid, falling pitch/brightness |
| A58 | 1.5 | one-shot impact, 1.5 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| A59 | 0.2 | one-shot, decaying tail, 0.2 s, noisy, bright, falling pitch/brightness |
| A60 | 0.6 | one-shot, decaying tail, 0.6 s, mixed, mid |
| A61 | 0.4 | one-shot, decaying tail, 0.4 s, noisy, bright |
| A62 | 7.3 | sustained / loop-like, 7.3 s, noisy, bright, repeating / rattling |
| A63 | 1.4 | one-shot impact, 1.4 s, mixed, mid |
| A64 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, bright |
| A65 | 0.8 | one-shot, decaying tail, 0.8 s, tonal, mid |
| A66 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid |
| A67 | 0.6 | one-shot, decaying tail, 0.6 s, mixed, mid |
| A68 | 0.6 | one-shot impact, 0.6 s, noisy, bright |
| A69 | 0.2 | rising / charge-up, 0.2 s, tonal, bright |
| A70 | 0.2 | sustained / loop-like, 0.2 s, noisy, bright |
| A71 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, mid |
| A72 | 0.2 | one-shot, decaying tail, 0.2 s, tonal, bright |
| A73 | 0.3 | one-shot, decaying tail, 0.3 s, tonal, mid, steady pitch ~120 Hz, falling pitch/brightness |
| A74 | 1.1 | sustained / loop-like, 1.1 s, mixed, bright |
| A75 | 0.2 | rising / charge-up, 0.2 s, tonal, mid, rising pitch/brightness |
| A76 | 1.6 | one-shot, decaying tail, 1.6 s, tonal, mid, falling pitch/brightness |
| A77 | 2.4 | one-shot, decaying tail, 2.4 s, noisy, bright, repeating / rattling |
| A78 | 1.2 | one-shot, decaying tail, 1.2 s, noisy, bright, repeating / rattling |
| A79 | 2.9 | one-shot impact, 2.9 s, noisy, bright |
| A80 | 2.3 | one-shot impact, 2.3 s, noisy, bright |
| A81 | 2.5 | one-shot impact, 2.5 s, noisy, bright |
| A82 | 2.6 | one-shot impact, 2.6 s, noisy, bright |
| A83 | 2.7 | one-shot impact, 2.7 s, noisy, bright |
| A84 | 2.4 | one-shot impact, 2.4 s, noisy, bright |
| A85 | 1.5 | one-shot, decaying tail, 1.5 s, tonal, mid, repeating / rattling |
| A86 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, mid, repeating / rattling, rising pitch/brightness |

### W — reload (74)

| id | s | shape |
|---|---|---|
| W01 | 1.3 | one-shot, decaying tail, 1.3 s, noisy, bright, repeating / rattling |
| W02 | 1.1 | sustained / loop-like, 1.1 s, noisy, bright, repeating / rattling |
| W03 | 2.4 | one-shot, decaying tail, 2.4 s, mixed, bright, rising pitch/brightness |
| W04 | 2.4 | one-shot, decaying tail, 2.4 s, tonal, bright, repeating / rattling |
| W05 | 4.6 | varying, 4.6 s, mixed, mid, repeating / rattling |
| W06 | 1.6 | one-shot, decaying tail, 1.6 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| W07 | 4.6 | one-shot, decaying tail, 4.6 s, mixed, mid, repeating / rattling |
| W08 | 0.3 | one-shot, decaying tail, 0.3 s, mixed, mid, falling pitch/brightness |
| W09 | 0.3 | sustained / loop-like, 0.3 s, noisy, bright |
| W10 | 0.4 | rising / charge-up, 0.4 s, mixed, mid |
| W11 | 1.7 | one-shot impact, 1.7 s, tonal, mid, rising pitch/brightness |
| W12 | 2.0 | rising / charge-up, 2.0 s, noisy, bright, repeating / rattling, rising pitch/brightness |
| W13 | 4.0 | one-shot, decaying tail, 4.0 s, mixed, mid, repeating / rattling |
| W14 | 3.8 | one-shot impact, 3.8 s, mixed, mid |
| W15 | 3.8 | one-shot impact, 3.8 s, mixed, mid |
| W16 | 3.8 | one-shot impact, 3.8 s, mixed, mid |
| W17 | 2.0 | one-shot, decaying tail, 2.0 s, mixed, mid, repeating / rattling |
| W18 | 1.3 | one-shot, decaying tail, 1.3 s, tonal, dull/low, falling pitch/brightness |
| W19 | 5.1 | one-shot, decaying tail, 5.1 s, mixed, bright |
| W20 | 2.6 | one-shot, decaying tail, 2.6 s, tonal, dull/low, repeating / rattling |
| W21 | 3.4 | one-shot, decaying tail, 3.4 s, mixed, bright |
| W22 | 3.8 | one-shot impact, 3.8 s, mixed, bright, repeating / rattling |
| W23 | 2.6 | one-shot impact, 2.6 s, noisy, bright, repeating / rattling |
| W24 | 0.4 | rising / charge-up, 0.4 s, noisy, bright |
| W25 | 1.4 | one-shot, decaying tail, 1.4 s, mixed, bright |
| W26 | 1.1 | one-shot, decaying tail, 1.1 s, noisy, bright |
| W27 | 3.3 | one-shot, decaying tail, 3.3 s, noisy, bright |
| W28 | 3.6 | one-shot impact, 3.6 s, tonal, mid |
| W29 | 0.9 | one-shot, decaying tail, 0.9 s, noisy, mid, repeating / rattling |
| W30 | 1.3 | one-shot, decaying tail, 1.3 s, mixed, mid, repeating / rattling |
| W31 | 0.9 | one-shot, decaying tail, 0.9 s, mixed, mid, repeating / rattling |
| W32 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, mid, repeating / rattling |
| W33 | 8.7 | sustained / loop-like, 8.7 s, mixed, mid |
| W34 | 2.7 | one-shot, decaying tail, 2.7 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| W35 | 1.3 | rising / charge-up, 1.3 s, noisy, bright, repeating / rattling |
| W36 | 1.3 | one-shot impact, 1.3 s, noisy, bright, repeating / rattling |
| W37 | 1.6 | sustained / loop-like, 1.6 s, tonal, mid, repeating / rattling |
| W38 | 1.9 | one-shot impact, 1.9 s, tonal, bright |
| W39 | 1.6 | one-shot, decaying tail, 1.6 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| W40 | 0.4 | one-shot, decaying tail, 0.4 s, noisy, bright |
| W41 | 1.6 | sustained / loop-like, 1.6 s, tonal, mid, rising pitch/brightness |
| W42 | 0.9 | one-shot, decaying tail, 0.9 s, mixed, mid, falling pitch/brightness |
| W43 | 2.0 | one-shot impact, 2.0 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| W44 | 3.4 | one-shot impact, 3.4 s, mixed, bright, rising pitch/brightness |
| W45 | 3.8 | one-shot impact, 3.8 s, mixed, mid |
| W46 | 3.8 | one-shot impact, 3.8 s, mixed, mid |
| W47 | 3.8 | one-shot impact, 3.8 s, mixed, mid |
| W48 | 2.7 | one-shot, decaying tail, 2.7 s, tonal, dull/low, falling pitch/brightness |
| W49 | 2.0 | one-shot, decaying tail, 2.0 s, tonal, dull/low, falling pitch/brightness |
| W50 | 2.3 | one-shot, decaying tail, 2.3 s, mixed, bright, rising pitch/brightness |
| W51 | 5.0 | one-shot, decaying tail, 5.0 s, mixed, bright, repeating / rattling, falling pitch/brightness |
| W52 | 1.4 | one-shot, decaying tail, 1.4 s, mixed, bright, repeating / rattling, rising pitch/brightness |
| W53 | 0.9 | one-shot, decaying tail, 0.9 s, mixed, bright |
| W54 | 0.7 | sustained / loop-like, 0.7 s, noisy, bright |
| W55 | 3.4 | one-shot impact, 3.4 s, noisy, bright, falling pitch/brightness |
| W56 | 0.9 | one-shot impact, 0.9 s, noisy, bright, repeating / rattling, rising pitch/brightness |
| W57 | 1.3 | sustained / loop-like, 1.3 s, noisy, bright, repeating / rattling |
| W58 | 3.8 | one-shot, decaying tail, 3.8 s, noisy, bright, falling pitch/brightness |
| W59 | 0.8 | one-shot, decaying tail, 0.8 s, noisy, bright, repeating / rattling |
| W60 | 1.3 | sustained / loop-like, 1.3 s, mixed, mid, repeating / rattling |
| W61 | 0.7 | one-shot, decaying tail, 0.7 s, noisy, bright |
| W62 | 0.8 | varying, 0.8 s, noisy, bright |
| W63 | 2.4 | one-shot, decaying tail, 2.4 s, mixed, bright |
| W64 | 1.8 | one-shot, decaying tail, 1.8 s, noisy, bright, repeating / rattling |
| W65 | 1.0 | one-shot, decaying tail, 1.0 s, noisy, bright, repeating / rattling |
| W66 | 0.9 | sustained / loop-like, 0.9 s, noisy, bright, repeating / rattling |
| W67 | 3.2 | sustained / loop-like, 3.2 s, mixed, mid, repeating / rattling |
| W68 | 0.5 | one-shot impact, 0.5 s, noisy, bright |
| W69 | 0.4 | sustained / loop-like, 0.4 s, mixed, bright |
| W70 | 3.5 | one-shot, decaying tail, 3.5 s, mixed, bright, repeating / rattling |
| W71 | 0.7 | sustained / loop-like, 0.7 s, noisy, bright |
| W72 | 0.6 | sustained / loop-like, 0.6 s, noisy, bright |
| W73 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid, falling pitch/brightness |
| W74 | 1.6 | one-shot, decaying tail, 1.6 s, noisy, bright, repeating / rattling |

### D — cocking / mechanical (69)

| id | s | shape |
|---|---|---|
| D01 | 0.3 | one-shot, decaying tail, 0.3 s, noisy, bright |
| D02 | 0.4 | rising / charge-up, 0.4 s, noisy, bright |
| D03 | 0.4 | rising / charge-up, 0.4 s, noisy, bright |
| D04 | 0.4 | sustained / loop-like, 0.4 s, noisy, bright |
| D05 | 0.4 | one-shot, decaying tail, 0.4 s, noisy, bright |
| D06 | 0.3 | one-shot, decaying tail, 0.3 s, noisy, bright |
| D07 | 0.2 | one-shot, decaying tail, 0.2 s, noisy, bright |
| D08 | 0.4 | one-shot, decaying tail, 0.4 s, noisy, bright |
| D09 | 1.0 | varying, 1.0 s, noisy, bright, repeating / rattling |
| D10 | 1.0 | one-shot, decaying tail, 1.0 s, noisy, bright, repeating / rattling |
| D100 | 0.6 | sustained / loop-like, 0.6 s, mixed, bright |
| D101 | 0.4 | one-shot, decaying tail, 0.4 s, noisy, bright |
| D102 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, bright, repeating / rattling |
| D103 | 0.5 | sustained / loop-like, 0.5 s, noisy, mid |
| D104 | 0.7 | one-shot, decaying tail, 0.7 s, noisy, bright |
| D105 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, bright |
| D106 | 0.5 | varying, 0.5 s, noisy, bright |
| D107 | 0.3 | one-shot, decaying tail, 0.3 s, noisy, bright |
| D108 | 0.2 | one-shot, decaying tail, 0.2 s, noisy, bright |
| D109 | 0.8 | varying, 0.8 s, noisy, bright |
| D11 | 2.5 | one-shot impact, 2.5 s, noisy, bright |
| D110 | 0.7 | one-shot, decaying tail, 0.7 s, noisy, mid |
| D111 | 0.9 | one-shot, decaying tail, 0.9 s, noisy, bright, repeating / rattling |
| D112 | 1.1 | varying, 1.1 s, noisy, bright, repeating / rattling |
| D113 | 1.5 | one-shot, decaying tail, 1.5 s, noisy, bright, repeating / rattling |
| D114 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, mid |
| D115 | 0.7 | one-shot impact, 0.7 s, noisy, bright |
| D116 | 0.4 | sustained / loop-like, 0.4 s, mixed, mid, rising pitch/brightness |
| D117 | 1.4 | one-shot impact, 1.4 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| D118 | 2.5 | one-shot impact, 2.5 s, mixed, mid, repeating / rattling |
| D119 | 0.7 | varying, 0.7 s, noisy, bright |
| D12 | 0.6 | one-shot, decaying tail, 0.6 s, noisy, bright |
| D120 | 0.6 | rising / charge-up, 0.6 s, noisy, bright |
| D121 | 0.8 | one-shot, decaying tail, 0.8 s, noisy, bright |
| D122 | 2.0 | one-shot impact, 2.0 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| D123 | 3.9 | one-shot impact, 3.9 s, noisy, bright, repeating / rattling, falling pitch/brightness |
| D124 | 0.3 | one-shot, decaying tail, 0.3 s, mixed, mid |
| D125 | 0.4 | rising / charge-up, 0.4 s, noisy, bright, rising pitch/brightness |
| D126 | 0.8 | sustained / loop-like, 0.8 s, noisy, bright |
| D127 | 0.4 | rising / charge-up, 0.4 s, mixed, mid, rising pitch/brightness |
| D128 | 0.2 | sustained / loop-like, 0.2 s, mixed, mid |
| D129 | 1.0 | one-shot impact, 1.0 s, noisy, bright, repeating / rattling |
| D13 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, mid, falling pitch/brightness |
| D130 | 0.3 | one-shot, decaying tail, 0.3 s, noisy, bright |
| D131 | 0.8 | one-shot impact, 0.8 s, mixed, mid, falling pitch/brightness |
| D14 | 0.6 | varying, 0.6 s, noisy, bright |
| D15 | 1.1 | one-shot impact, 1.1 s, noisy, bright, repeating / rattling |
| D16 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, mid, rising pitch/brightness |
| D17 | 0.7 | one-shot impact, 0.7 s, mixed, mid |
| D18 | 0.1 | one-shot, decaying tail, 0.1 s, noisy, bright |
| D19 | 0.2 | sustained / loop-like, 0.2 s, noisy, bright |
| D20 | 0.3 | one-shot, decaying tail, 0.3 s, noisy, bright |
| D21 | 0.6 | varying, 0.6 s, noisy, bright |
| D22 | 0.6 | one-shot impact, 0.6 s, noisy, bright |
| D23 | 0.1 | sustained / loop-like, 0.1 s, noisy, bright |
| D24 | 0.3 | sustained / loop-like, 0.3 s, noisy, bright |
| D25 | 0.3 | one-shot, decaying tail, 0.3 s, noisy, bright |
| D26 | 0.1 | sustained / loop-like, 0.1 s, noisy, bright |
| D27 | 0.2 | rising / charge-up, 0.2 s, noisy, bright |
| D28 | 0.4 | one-shot, decaying tail, 0.4 s, noisy, bright |
| D29 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid, falling pitch/brightness |
| D30 | 0.8 | one-shot impact, 0.8 s, mixed, bright, rising pitch/brightness |
| D31 | 0.6 | one-shot, decaying tail, 0.6 s, noisy, bright |
| D32 | 0.6 | one-shot impact, 0.6 s, noisy, bright |
| D33 | 1.0 | one-shot impact, 1.0 s, tonal, mid, falling pitch/brightness |
| D34 | 0.8 | one-shot, decaying tail, 0.8 s, noisy, bright, repeating / rattling, rising pitch/brightness |
| D35 | 0.8 | one-shot, decaying tail, 0.8 s, noisy, bright |
| D36 | 1.0 | one-shot impact, 1.0 s, mixed, bright |
| D37 | 0.8 | one-shot, decaying tail, 0.8 s, mixed, bright |

### X — grenade / explosion (51)

| id | s | shape |
|---|---|---|
| X01 | 5.3 | one-shot, decaying tail, 5.3 s, noisy, bright, falling pitch/brightness |
| X02 | 3.0 | one-shot impact, 3.0 s, noisy, bright, repeating / rattling |
| X03 | 5.3 | one-shot, decaying tail, 5.3 s, noisy, mid, falling pitch/brightness |
| X04 | 2.5 | rising / charge-up, 2.5 s, mixed, bright |
| X05 | 3.3 | one-shot, decaying tail, 3.3 s, mixed, mid, falling pitch/brightness |
| X06 | 2.0 | sustained / loop-like, 2.0 s, mixed, mid |
| X07 | 1.3 | one-shot impact, 1.3 s, mixed, mid, falling pitch/brightness |
| X08 | 7.9 | one-shot impact, 7.9 s, mixed, bright |
| X09 | 2.5 | one-shot, decaying tail, 2.5 s, tonal, mid, falling pitch/brightness |
| X10 | 1.9 | one-shot impact, 1.9 s, mixed, mid |
| X11 | 1.5 | one-shot impact, 1.5 s, tonal, mid, falling pitch/brightness |
| X12 | 2.0 | one-shot impact, 2.0 s, mixed, mid, repeating / rattling |
| X13 | 1.5 | one-shot impact, 1.5 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| X14 | 1.2 | one-shot impact, 1.2 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| X15 | 1.2 | one-shot impact, 1.2 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| X16 | 1.3 | one-shot impact, 1.3 s, mixed, mid |
| X17 | 7.9 | one-shot impact, 7.9 s, tonal, mid, repeating / rattling |
| X18 | 1.8 | one-shot impact, 1.8 s, tonal, dull/low, falling pitch/brightness |
| X19 | 3.6 | one-shot impact, 3.6 s, noisy, bright |
| X20 | 5.3 | varying, 5.3 s, mixed, mid |
| X21 | 2.8 | one-shot impact, 2.8 s, mixed, mid |
| X22 | 3.7 | one-shot impact, 3.7 s, tonal, mid |
| X23 | 2.8 | one-shot impact, 2.8 s, tonal, mid, falling pitch/brightness |
| X24 | 3.0 | one-shot impact, 3.0 s, tonal, dull/low, falling pitch/brightness |
| X25 | 1.8 | one-shot impact, 1.8 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| X26 | 3.2 | one-shot impact, 3.2 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| X27 | 3.4 | one-shot impact, 3.4 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| X28 | 6.7 | one-shot impact, 6.7 s, tonal, mid |
| X29 | 4.0 | one-shot impact, 4.0 s, tonal, mid, falling pitch/brightness |
| X30 | 8.1 | one-shot impact, 8.1 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| X31 | 4.0 | one-shot impact, 4.0 s, noisy, bright, repeating / rattling |
| X32 | 2.7 | one-shot impact, 2.7 s, tonal, dull/low, rising pitch/brightness |
| X33 | 5.3 | varying, 5.3 s, noisy, bright, repeating / rattling, falling pitch/brightness |
| X34 | 3.2 | one-shot impact, 3.2 s, tonal, dull/low, falling pitch/brightness |
| X35 | 3.7 | one-shot impact, 3.7 s, mixed, mid, repeating / rattling |
| X36 | 6.2 | one-shot, decaying tail, 6.2 s, tonal, mid, falling pitch/brightness |
| X37 | 0.1 | very short, 0.1 s, tonal, bright |
| X38 | 5.3 | varying, 5.3 s, noisy, bright, repeating / rattling, falling pitch/brightness |
| X39 | 5.3 | varying, 5.3 s, noisy, bright, falling pitch/brightness |
| X40 | 3.5 | one-shot impact, 3.5 s, noisy, bright, rising pitch/brightness |
| X41 | 3.0 | one-shot, decaying tail, 3.0 s, mixed, mid, repeating / rattling |
| X42 | 0.5 | sustained / loop-like, 0.5 s, tonal, mid |
| X43 | 2.4 | one-shot impact, 2.4 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| X44 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, bright |
| X45 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, bright |
| X46 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, bright, repeating / rattling, falling pitch/brightness |
| X47 | 0.2 | sustained / loop-like, 0.2 s, tonal, bright |
| X48 | 0.4 | sustained / loop-like, 0.4 s, mixed, bright, rising pitch/brightness |
| X49 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, mid, rising pitch/brightness |
| X50 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, bright |
| X51 | 3.4 | one-shot impact, 3.4 s, tonal, dull/low, falling pitch/brightness |

### R — gunshot (47)

| id | s | shape |
|---|---|---|
| R01 | 1.8 | one-shot impact, 1.8 s, tonal, dull/low, falling pitch/brightness |
| R02 | 2.2 | one-shot impact, 2.2 s, tonal, mid, repeating / rattling |
| R03 | 2.0 | one-shot impact, 2.0 s, tonal, dull/low, falling pitch/brightness |
| R04 | 2.4 | one-shot impact, 2.4 s, tonal, mid |
| R05 | 1.9 | one-shot impact, 1.9 s, tonal, mid, falling pitch/brightness |
| R06 | 2.2 | one-shot impact, 2.2 s, tonal, dull/low, falling pitch/brightness |
| R07 | 1.6 | one-shot impact, 1.6 s, tonal, dull/low, falling pitch/brightness |
| R08 | 1.6 | one-shot impact, 1.6 s, mixed, mid |
| R09 | 1.4 | one-shot impact, 1.4 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| R10 | 1.3 | one-shot impact, 1.3 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| R100 | 1.3 | one-shot impact, 1.3 s, tonal, mid, repeating / rattling, rising pitch/brightness |
| R101 | 1.0 | one-shot impact, 1.0 s, mixed, mid |
| R102 | 2.0 | one-shot impact, 2.0 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| R103 | 1.9 | one-shot impact, 1.9 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| R104 | 1.0 | one-shot impact, 1.0 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| R105 | 1.3 | one-shot, decaying tail, 1.3 s, tonal, mid, repeating / rattling, rising pitch/brightness |
| R106 | 0.8 | one-shot impact, 0.8 s, mixed, mid, repeating / rattling |
| R107 | 2.4 | one-shot impact, 2.4 s, tonal, dull/low, falling pitch/brightness |
| R108 | 1.7 | one-shot impact, 1.7 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| R109 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, mid |
| R11 | 2.0 | one-shot impact, 2.0 s, tonal, dull/low |
| R110 | 1.0 | one-shot impact, 1.0 s, tonal, mid, falling pitch/brightness |
| R111 | 1.2 | one-shot impact, 1.2 s, tonal, mid |
| R112 | 5.0 | sustained / loop-like, 5.0 s, tonal, mid, repeating / rattling |
| R113 | 1.3 | one-shot impact, 1.3 s, mixed, mid |
| R114 | 1.2 | rising / charge-up, 1.2 s, mixed, bright, repeating / rattling |
| R115 | 3.0 | one-shot impact, 3.0 s, tonal, mid, repeating / rattling |
| R116 | 2.6 | one-shot impact, 2.6 s, tonal, mid, repeating / rattling |
| R117 | 1.7 | one-shot impact, 1.7 s, tonal, mid, falling pitch/brightness |
| R118 | 2.0 | one-shot impact, 2.0 s, mixed, mid, repeating / rattling |
| R119 | 1.9 | one-shot impact, 1.9 s, mixed, mid, falling pitch/brightness |
| R12 | 1.9 | one-shot impact, 1.9 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| R120 | 2.5 | rising / charge-up, 2.5 s, mixed, mid |
| R121 | 3.0 | one-shot impact, 3.0 s, tonal, mid, repeating / rattling |
| R122 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid |
| R123 | 1.2 | one-shot impact, 1.2 s, tonal, mid, repeating / rattling |
| R13 | 2.3 | one-shot impact, 2.3 s, tonal, mid |
| R14 | 1.4 | one-shot impact, 1.4 s, tonal, mid |
| R15 | 3.2 | one-shot impact, 3.2 s, tonal, mid, repeating / rattling |
| R16 | 1.9 | one-shot impact, 1.9 s, tonal, mid |
| R17 | 2.0 | one-shot impact, 2.0 s, tonal, mid, repeating / rattling |
| R18 | 1.5 | one-shot impact, 1.5 s, tonal, mid, repeating / rattling |
| R19 | 1.0 | one-shot impact, 1.0 s, tonal, mid, repeating / rattling |
| R20 | 1.0 | one-shot impact, 1.0 s, mixed, mid, repeating / rattling |
| R21 | 1.2 | one-shot impact, 1.2 s, mixed, mid, repeating / rattling |
| R22 | 1.2 | one-shot impact, 1.2 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| R23 | 2.1 | one-shot impact, 2.1 s, tonal, dull/low, falling pitch/brightness |

### J — music / sting (45)

| id | s | shape |
|---|---|---|
| J01 | 62.8 | varying, 62.8 s, tonal, dull/low, repeating / rattling |
| J02 | 1.8 | one-shot impact, 1.8 s, tonal, mid, repeating / rattling |
| J03 | 1.5 | sustained / loop-like, 1.5 s, tonal, mid |
| J04 | 1.5 | sustained / loop-like, 1.5 s, mixed, mid, repeating / rattling |
| J05 | 1.5 | sustained / loop-like, 1.5 s, tonal, mid |
| J06 | 1.5 | one-shot, decaying tail, 1.5 s, tonal, mid |
| J07 | 1.6 | one-shot impact, 1.6 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| J08 | 2.1 | one-shot impact, 2.1 s, mixed, mid, repeating / rattling |
| J09 | 2.0 | one-shot impact, 2.0 s, tonal, mid |
| J10 | 8.5 | sustained / loop-like, 8.5 s, tonal, mid |
| J100 | 250.0 | sustained / loop-like, 250.0 s, mixed, mid, repeating / rattling |
| J11 | 8.3 | sustained / loop-like, 8.3 s, tonal, mid, repeating / rattling |
| J12 | 9.5 | rising / charge-up, 9.5 s, tonal, mid, falling pitch/brightness |
| J13 | 21.4 | sustained / loop-like, 21.4 s, tonal, mid, repeating / rattling |
| J14 | 20.0 | varying, 20.0 s, tonal, mid, repeating / rattling |
| J15 | 21.9 | varying, 21.9 s, tonal, mid |
| J16 | 3.4 | one-shot, decaying tail, 3.4 s, tonal, dull/low, falling pitch/brightness |
| J17 | 6.0 | sustained / loop-like, 6.0 s, tonal, mid, repeating / rattling |
| J18 | 6.3 | rising / charge-up, 6.3 s, tonal, mid, repeating / rattling |
| J19 | 5.7 | sustained / loop-like, 5.7 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| J1A | 4.3 | one-shot, decaying tail, 4.3 s, tonal, dull/low, falling pitch/brightness |
| J1B | 4.2 | one-shot, decaying tail, 4.2 s, tonal, dull/low, falling pitch/brightness |
| J1C | 1.6 | one-shot, decaying tail, 1.6 s, tonal, mid, falling pitch/brightness |
| J1D | 3.5 | one-shot, decaying tail, 3.5 s, tonal, mid, falling pitch/brightness |
| J1E | 1.8 | one-shot, decaying tail, 1.8 s, tonal, dull/low, falling pitch/brightness |
| J1F | 2.1 | one-shot, decaying tail, 2.1 s, tonal, mid, falling pitch/brightness |
| J1G | 1.7 | one-shot, decaying tail, 1.7 s, tonal, mid, falling pitch/brightness |
| J1H | 2.1 | one-shot, decaying tail, 2.1 s, tonal, dull/low, steady pitch ~60 Hz, falling pitch/brightness |
| J1I | 1.9 | one-shot, decaying tail, 1.9 s, tonal, mid, falling pitch/brightness |
| J1J | 2.4 | one-shot, decaying tail, 2.4 s, tonal, mid, falling pitch/brightness |
| J1K | 2.4 | one-shot, decaying tail, 2.4 s, tonal, mid, falling pitch/brightness |
| J1L | 1.9 | one-shot, decaying tail, 1.9 s, tonal, mid, falling pitch/brightness |
| J1M | 3.0 | one-shot, decaying tail, 3.0 s, tonal, mid, falling pitch/brightness |
| J1N | 60.1 | rising / charge-up, 60.1 s, tonal, mid |
| J1O | 53.7 | rising / charge-up, 53.7 s, tonal, mid, repeating / rattling, rising pitch/brightness |
| J1P | 50.9 | varying, 50.9 s, tonal, mid |
| J1Q | 11.1 | sustained / loop-like, 11.1 s, tonal, mid |
| J1R | 11.3 | varying, 11.3 s, tonal, mid, repeating / rattling |
| J1S | 10.7 | sustained / loop-like, 10.7 s, tonal, mid, repeating / rattling |
| J1T | 3.8 | one-shot, decaying tail, 3.8 s, tonal, mid, falling pitch/brightness |
| J1U | 3.0 | one-shot, decaying tail, 3.0 s, tonal, mid, falling pitch/brightness |
| J1V | 4.3 | one-shot, decaying tail, 4.3 s, tonal, mid |
| J1W | 8.1 | sustained / loop-like, 8.1 s, tonal, mid |
| J1X | 8.8 | sustained / loop-like, 8.8 s, tonal, mid, repeating / rattling |
| J1Y | 5.7 | rising / charge-up, 5.7 s, tonal, mid, falling pitch/brightness |

### SW — Star-Wars-style effect (37)

| id | s | shape |
|---|---|---|
| SW00 | 10.1 | one-shot, decaying tail, 10.1 s, tonal, mid, falling pitch/brightness |
| SW01 | 1.7 | one-shot impact, 1.7 s, mixed, mid, falling pitch/brightness |
| SW02 | 28.3 | one-shot, decaying tail, 28.3 s, tonal, dull/low, repeating / rattling, steady pitch ~91 Hz |
| SW03 | 93.1 | varying, 93.1 s, tonal, mid |
| SW04 | 94.0 | varying, 94.0 s, tonal, mid |
| SW05 | 1.3 | rising / charge-up, 1.3 s, mixed, mid, rising pitch/brightness |
| SW06 | 1.0 | one-shot impact, 1.0 s, mixed, mid, repeating / rattling |
| SW07 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| SW08 | 0.8 | one-shot, decaying tail, 0.8 s, mixed, mid, falling pitch/brightness |
| SW10 | 0.6 | sustained / loop-like, 0.6 s, tonal, dull/low, steady pitch ~98 Hz |
| SW11 | 0.5 | one-shot, decaying tail, 0.5 s, tonal, dull/low, steady pitch ~94 Hz |
| SW13 | 1.4 | one-shot, decaying tail, 1.4 s, tonal, dull/low, repeating / rattling, steady pitch ~93 Hz |
| SW14 | 1.3 | one-shot, decaying tail, 1.3 s, tonal, dull/low, repeating / rattling, steady pitch ~98 Hz |
| SW15 | 0.3 | sustained / loop-like, 0.3 s, tonal, dull/low, steady pitch ~97 Hz |
| SW16 | 0.3 | one-shot, decaying tail, 0.3 s, tonal, dull/low, steady pitch ~94 Hz |
| SW17 | 0.8 | sustained / loop-like, 0.8 s, tonal, dull/low, repeating / rattling |
| SW18 | 0.8 | sustained / loop-like, 0.8 s, tonal, dull/low, repeating / rattling |
| SW19 | 1.2 | sustained / loop-like, 1.2 s, tonal, dull/low, repeating / rattling, steady pitch ~97 Hz, rising pitch/brightness |
| SW20 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, dull/low |
| SW21 | 0.7 | one-shot, decaying tail, 0.7 s, tonal, dull/low, steady pitch ~92 Hz |
| SW23 | 0.9 | one-shot impact, 0.9 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| SW24 | 0.7 | one-shot impact, 0.7 s, mixed, mid, falling pitch/brightness |
| SW25 | 0.9 | one-shot impact, 0.9 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| SW26 | 2.2 | one-shot, decaying tail, 2.2 s, tonal, mid, repeating / rattling |
| SW28 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, mid, falling pitch/brightness |
| SW29 | 2.3 | one-shot, decaying tail, 2.3 s, tonal, mid, falling pitch/brightness |
| SW30 | 1.9 | one-shot impact, 1.9 s, tonal, dull/low, falling pitch/brightness |
| SW31 | 60.8 | sustained / loop-like, 60.8 s, tonal, mid |
| SW32 | 1.4 | one-shot, decaying tail, 1.4 s, mixed, mid |
| SW33 | 1.4 | one-shot, decaying tail, 1.4 s, mixed, bright |
| SW34 | 1.4 | one-shot impact, 1.4 s, tonal, mid, falling pitch/brightness |
| SW35 | 1.0 | one-shot impact, 1.0 s, tonal, mid, falling pitch/brightness |
| SW36 | 0.7 | one-shot impact, 0.7 s, mixed, mid |
| SW37 | 1.0 | one-shot impact, 1.0 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| SW38 | 0.9 | one-shot impact, 0.9 s, mixed, mid, falling pitch/brightness |
| SW39 | 1.5 | one-shot impact, 1.5 s, tonal, dull/low, falling pitch/brightness |
| SW40 | 0.9 | one-shot impact, 0.9 s, mixed, mid, falling pitch/brightness |

### SH — swipe / swish (34)

| id | s | shape |
|---|---|---|
| SH00 | 2.0 | one-shot impact, 2.0 s, noisy, bright, repeating / rattling |
| SH01 | 2.1 | one-shot impact, 2.1 s, noisy, bright, repeating / rattling |
| SH02 | 2.2 | one-shot impact, 2.2 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| SH03 | 2.8 | one-shot impact, 2.8 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| SH04 | 1.1 | one-shot, decaying tail, 1.1 s, mixed, mid, rising pitch/brightness |
| SH05 | 0.9 | one-shot impact, 0.9 s, mixed, mid |
| SH06 | 3.5 | one-shot impact, 3.5 s, tonal, dull/low |
| SH07 | 1.5 | one-shot impact, 1.5 s, mixed, mid, repeating / rattling |
| SH08 | 1.5 | one-shot impact, 1.5 s, tonal, dull/low, repeating / rattling |
| SH09 | 1.1 | one-shot, decaying tail, 1.1 s, tonal, mid, falling pitch/brightness |
| SH0A | 1.1 | one-shot, decaying tail, 1.1 s, tonal, mid, falling pitch/brightness |
| SH0B | 1.2 | one-shot, decaying tail, 1.2 s, tonal, dull/low, falling pitch/brightness |
| SH0C | 1.2 | one-shot, decaying tail, 1.2 s, tonal, mid |
| SH0D | 6.0 | sustained / loop-like, 6.0 s, mixed, bright, repeating / rattling |
| SH0E | 1.4 | one-shot impact, 1.4 s, mixed, mid, falling pitch/brightness |
| SH0F | 1.4 | one-shot impact, 1.4 s, noisy, bright, repeating / rattling |
| SH0G | 1.0 | one-shot, decaying tail, 1.0 s, tonal, mid, falling pitch/brightness |
| SH0H | 1.6 | one-shot, decaying tail, 1.6 s, tonal, mid, steady pitch ~110 Hz |
| SH0I | 3.0 | one-shot, decaying tail, 3.0 s, tonal, mid, falling pitch/brightness |
| SH0J | 2.1 | one-shot, decaying tail, 2.1 s, tonal, dull/low, falling pitch/brightness |
| SH0K | 1.5 | one-shot impact, 1.5 s, mixed, bright |
| SH0L | 1.5 | one-shot impact, 1.5 s, mixed, bright |
| SH0M | 3.1 | one-shot impact, 3.1 s, tonal, mid, rising pitch/brightness |
| SH0N | 1.1 | one-shot impact, 1.1 s, noisy, bright, repeating / rattling |
| SH0O | 1.2 | one-shot impact, 1.2 s, noisy, bright, repeating / rattling |
| SH0P | 1.2 | one-shot, decaying tail, 1.2 s, tonal, bright |
| SH0Q | 1.2 | one-shot, decaying tail, 1.2 s, tonal, bright |
| SH0R | 0.9 | one-shot, decaying tail, 0.9 s, mixed, bright, repeating / rattling |
| SH0S | 0.7 | one-shot, decaying tail, 0.7 s, tonal, bright |
| SH0T | 1.3 | one-shot, decaying tail, 1.3 s, tonal, mid, falling pitch/brightness |
| SH0U | 1.2 | one-shot, decaying tail, 1.2 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| SH0V | 1.0 | one-shot impact, 1.0 s, tonal, mid |
| SH0W | 1.0 | one-shot, decaying tail, 1.0 s, tonal, mid, falling pitch/brightness |
| SH0X | 1.9 | one-shot, decaying tail, 1.9 s, tonal, mid |

### E — sci-fi effect (32)

| id | s | shape |
|---|---|---|
| E01 | 1.2 | one-shot impact, 1.2 s, mixed, mid |
| E02 | 1.2 | one-shot impact, 1.2 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| E03 | 1.5 | one-shot impact, 1.5 s, tonal, dull/low, falling pitch/brightness |
| E04 | 1.5 | one-shot impact, 1.5 s, mixed, mid |
| E05 | 1.4 | one-shot impact, 1.4 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| E06 | 1.5 | one-shot impact, 1.5 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| E07 | 4.5 | one-shot impact, 4.5 s, tonal, dull/low, falling pitch/brightness |
| E08 | 2.1 | one-shot impact, 2.1 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| E09 | 2.0 | one-shot impact, 2.0 s, mixed, mid, falling pitch/brightness |
| E10 | 0.9 | one-shot impact, 0.9 s, tonal, mid, repeating / rattling, rising pitch/brightness |
| E11 | 0.9 | one-shot impact, 0.9 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| E12 | 1.0 | one-shot impact, 1.0 s, tonal, mid, falling pitch/brightness |
| E13 | 0.7 | one-shot impact, 0.7 s, mixed, mid |
| E14 | 1.3 | one-shot, decaying tail, 1.3 s, mixed, mid |
| E15 | 1.3 | one-shot impact, 1.3 s, tonal, mid, repeating / rattling |
| E16 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, mid |
| E17 | 1.5 | one-shot impact, 1.5 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| E18 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, dull/low, falling pitch/brightness |
| E19 | 0.9 | one-shot impact, 0.9 s, tonal, mid |
| E20 | 1.5 | one-shot impact, 1.5 s, tonal, dull/low, falling pitch/brightness |
| E21 | 0.8 | one-shot impact, 0.8 s, tonal, dull/low, falling pitch/brightness |
| E22 | 0.8 | one-shot, decaying tail, 0.8 s, tonal, mid, falling pitch/brightness |
| E23 | 0.7 | one-shot impact, 0.7 s, mixed, mid |
| E24 | 0.8 | one-shot impact, 0.8 s, tonal, mid, rising pitch/brightness |
| E25 | 1.3 | one-shot impact, 1.3 s, mixed, mid, falling pitch/brightness |
| E26 | 0.9 | one-shot, decaying tail, 0.9 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| E27 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, mid, falling pitch/brightness |
| E28 | 0.9 | one-shot impact, 0.9 s, tonal, mid, repeating / rattling |
| E29 | 0.7 | one-shot impact, 0.7 s, tonal, mid, falling pitch/brightness |
| E30 | 0.9 | one-shot impact, 0.9 s, tonal, dull/low, falling pitch/brightness |
| E31 | 0.9 | one-shot impact, 0.9 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| E32 | 2.5 | one-shot impact, 2.5 s, tonal, dull/low, falling pitch/brightness |

### ST — sci-fi mortar / rocket (32)

| id | s | shape |
|---|---|---|
| ST00 | 1.7 | one-shot, decaying tail, 1.7 s, mixed, bright, repeating / rattling |
| ST01 | 2.1 | one-shot, decaying tail, 2.1 s, mixed, bright, rising pitch/brightness |
| ST02 | 1.8 | one-shot, decaying tail, 1.8 s, mixed, mid, rising pitch/brightness |
| ST03 | 1.5 | varying, 1.5 s, mixed, bright, repeating / rattling |
| ST04 | 1.6 | one-shot impact, 1.6 s, mixed, mid, repeating / rattling |
| ST05 | 1.6 | one-shot impact, 1.6 s, tonal, mid, falling pitch/brightness |
| ST06 | 2.1 | one-shot impact, 2.1 s, mixed, mid, repeating / rattling |
| ST07 | 1.1 | varying, 1.1 s, mixed, mid, repeating / rattling |
| ST08 | 4.4 | sustained / loop-like, 4.4 s, mixed, mid, repeating / rattling |
| ST09 | 2.2 | one-shot impact, 2.2 s, mixed, mid |
| ST10 | 2.3 | one-shot impact, 2.3 s, tonal, mid, rising pitch/brightness |
| ST11 | 1.8 | one-shot, decaying tail, 1.8 s, mixed, bright, rising pitch/brightness |
| ST12 | 2.7 | one-shot, decaying tail, 2.7 s, mixed, bright, repeating / rattling |
| ST13 | 2.4 | sustained / loop-like, 2.4 s, mixed, mid, repeating / rattling |
| ST14 | 2.4 | varying, 2.4 s, noisy, bright, repeating / rattling |
| ST15 | 1.1 | one-shot impact, 1.1 s, mixed, bright |
| ST16 | 1.1 | one-shot impact, 1.1 s, mixed, mid |
| ST17 | 2.0 | one-shot, decaying tail, 2.0 s, mixed, bright, repeating / rattling |
| ST18 | 1.1 | one-shot impact, 1.1 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| ST19 | 1.1 | one-shot impact, 1.1 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| ST20 | 2.0 | one-shot, decaying tail, 2.0 s, noisy, bright, repeating / rattling |
| ST21 | 1.8 | one-shot, decaying tail, 1.8 s, tonal, dull/low, falling pitch/brightness |
| ST22 | 1.8 | one-shot, decaying tail, 1.8 s, tonal, dull/low, falling pitch/brightness |
| ST23 | 1.5 | one-shot, decaying tail, 1.5 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| ST24 | 1.8 | one-shot impact, 1.8 s, mixed, bright, rising pitch/brightness |
| ST25 | 1.5 | one-shot impact, 1.5 s, mixed, mid, rising pitch/brightness |
| ST26 | 1.5 | one-shot impact, 1.5 s, mixed, bright, repeating / rattling, rising pitch/brightness |
| ST27 | 0.5 | one-shot, decaying tail, 0.5 s, tonal, mid, falling pitch/brightness |
| ST28 | 0.4 | one-shot, decaying tail, 0.4 s, noisy, bright |
| ST29 | 0.8 | one-shot, decaying tail, 0.8 s, mixed, bright, repeating / rattling, rising pitch/brightness |
| ST30 | 1.3 | one-shot impact, 1.3 s, mixed, bright, repeating / rattling |
| ST31 | 1.1 | one-shot impact, 1.1 s, mixed, bright |

### B — bow / arrow (31)

| id | s | shape |
|---|---|---|
| B01 | 1.5 | rising / charge-up, 1.5 s, noisy, bright, repeating / rattling |
| B02 | 1.5 | rising / charge-up, 1.5 s, noisy, mid, repeating / rattling |
| B03 | 1.5 | varying, 1.5 s, mixed, mid, repeating / rattling |
| B04 | 0.7 | one-shot impact, 0.7 s, mixed, bright |
| B05 | 0.7 | one-shot impact, 0.7 s, mixed, bright |
| B06 | 0.7 | one-shot impact, 0.7 s, noisy, bright |
| B07 | 0.6 | sustained / loop-like, 0.6 s, noisy, bright |
| B08 | 0.7 | one-shot, decaying tail, 0.7 s, noisy, bright |
| B09 | 0.8 | sustained / loop-like, 0.8 s, noisy, mid |
| B10 | 0.4 | rising / charge-up, 0.4 s, mixed, mid |
| B11 | 0.7 | sustained / loop-like, 0.7 s, noisy, bright |
| B12 | 0.2 | one-shot, decaying tail, 0.2 s, mixed, bright |
| B13 | 1.0 | one-shot impact, 1.0 s, noisy, bright |
| B14 | 0.6 | one-shot impact, 0.6 s, mixed, bright, rising pitch/brightness |
| B15 | 0.7 | one-shot impact, 0.7 s, mixed, bright, rising pitch/brightness |
| B16 | 2.0 | one-shot, decaying tail, 2.0 s, mixed, bright, repeating / rattling, rising pitch/brightness |
| B17 | 0.9 | one-shot, decaying tail, 0.9 s, mixed, bright, rising pitch/brightness |
| B18 | 1.3 | one-shot, decaying tail, 1.3 s, noisy, bright, repeating / rattling |
| B19 | 1.7 | rising / charge-up, 1.7 s, noisy, bright |
| B20 | 0.9 | one-shot, decaying tail, 0.9 s, noisy, bright, repeating / rattling |
| B21 | 0.8 | one-shot impact, 0.8 s, mixed, bright |
| B22 | 0.5 | one-shot impact, 0.5 s, noisy, bright |
| B23 | 1.1 | one-shot impact, 1.1 s, noisy, bright |
| B24 | 0.5 | one-shot, decaying tail, 0.5 s, noisy, bright |
| B25 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid, falling pitch/brightness |
| B26 | 0.6 | one-shot, decaying tail, 0.6 s, mixed, mid, falling pitch/brightness |
| B27 | 0.7 | one-shot impact, 0.7 s, mixed, mid, falling pitch/brightness |
| B28 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| B29 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, bright |
| B30 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, mid |
| B31 | 0.4 | one-shot, decaying tail, 0.4 s, noisy, bright |

### C — sci-fi effect (23)

| id | s | shape |
|---|---|---|
| C01 | 2.1 | sustained / loop-like, 2.1 s, mixed, bright, repeating / rattling |
| C02 | 1.4 | one-shot, decaying tail, 1.4 s, noisy, bright, repeating / rattling |
| C03 | 3.1 | one-shot impact, 3.1 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| C04 | 1.7 | one-shot impact, 1.7 s, noisy, bright |
| C05 | 1.2 | one-shot impact, 1.2 s, mixed, mid, falling pitch/brightness |
| C06 | 1.9 | one-shot impact, 1.9 s, tonal, dull/low, falling pitch/brightness |
| C07 | 2.3 | one-shot, decaying tail, 2.3 s, mixed, mid, falling pitch/brightness |
| C08 | 2.0 | rising / charge-up, 2.0 s, mixed, mid, rising pitch/brightness |
| C09 | 1.8 | sustained / loop-like, 1.8 s, mixed, mid |
| C10 | 1.2 | rising / charge-up, 1.2 s, tonal, dull/low, repeating / rattling, rising pitch/brightness |
| C11 | 3.5 | one-shot impact, 3.5 s, tonal, bright |
| C12 | 3.0 | one-shot impact, 3.0 s, mixed, mid, falling pitch/brightness |
| C13 | 1.5 | sustained / loop-like, 1.5 s, tonal, mid, rising pitch/brightness |
| C14 | 1.0 | one-shot, decaying tail, 1.0 s, noisy, bright, repeating / rattling |
| C15 | 1.5 | rising / charge-up, 1.5 s, mixed, bright, repeating / rattling |
| C16 | 1.5 | rising / charge-up, 1.5 s, tonal, dull/low, repeating / rattling, rising pitch/brightness |
| C17 | 4.0 | sustained / loop-like, 4.0 s, mixed, bright |
| C18 | 2.2 | one-shot, decaying tail, 2.2 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| C19 | 1.4 | one-shot, decaying tail, 1.4 s, mixed, bright, repeating / rattling |
| C20 | 1.7 | sustained / loop-like, 1.7 s, tonal, mid, repeating / rattling |
| C21 | 1.6 | one-shot impact, 1.6 s, mixed, mid, falling pitch/brightness |
| C22 | 1.8 | rising / charge-up, 1.8 s, tonal, bright |
| C23 | 1.3 | rising / charge-up, 1.3 s, tonal, mid, repeating / rattling |

### G — gunshot (23)

| id | s | shape |
|---|---|---|
| G01 | 1.4 | one-shot impact, 1.4 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| G02 | 0.5 | one-shot impact, 0.5 s, tonal, mid |
| G03 | 1.1 | one-shot impact, 1.1 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| G04 | 0.9 | one-shot impact, 0.9 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| G05 | 0.9 | one-shot impact, 0.9 s, tonal, mid, repeating / rattling |
| G06 | 1.0 | one-shot impact, 1.0 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| G07 | 2.0 | one-shot impact, 2.0 s, tonal, mid, repeating / rattling |
| G08 | 1.3 | one-shot impact, 1.3 s, tonal, mid, falling pitch/brightness |
| G09 | 0.8 | one-shot impact, 0.8 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| G10 | 1.3 | one-shot impact, 1.3 s, tonal, mid |
| G11 | 1.0 | one-shot impact, 1.0 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| G12 | 1.6 | one-shot impact, 1.6 s, mixed, mid |
| G13 | 0.9 | one-shot impact, 0.9 s, mixed, mid, repeating / rattling |
| G14 | 1.3 | one-shot impact, 1.3 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| G15 | 1.1 | one-shot impact, 1.1 s, tonal, mid, repeating / rattling |
| G16 | 1.6 | one-shot impact, 1.6 s, tonal, mid, repeating / rattling, rising pitch/brightness |
| G17 | 1.4 | one-shot impact, 1.4 s, tonal, dull/low, falling pitch/brightness |
| G18 | 1.3 | one-shot impact, 1.3 s, tonal, mid, falling pitch/brightness |
| G19 | 1.9 | one-shot impact, 1.9 s, tonal, mid, falling pitch/brightness |
| G20 | 2.0 | one-shot impact, 2.0 s, mixed, mid, falling pitch/brightness |
| G21 | 0.8 | one-shot impact, 0.8 s, tonal, mid |
| G22 | 0.9 | one-shot impact, 0.9 s, tonal, mid, repeating / rattling |
| G23 | 1.0 | one-shot impact, 1.0 s, tonal, mid |

### S — gunshot (19)

| id | s | shape |
|---|---|---|
| S01 | 1.9 | one-shot impact, 1.9 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| S02 | 4.1 | one-shot impact, 4.1 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| S03 | 3.6 | one-shot impact, 3.6 s, tonal, dull/low, falling pitch/brightness |
| S04 | 2.4 | one-shot impact, 2.4 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| S05 | 3.1 | one-shot impact, 3.1 s, tonal, mid, repeating / rattling |
| S06 | 2.8 | one-shot impact, 2.8 s, tonal, mid, repeating / rattling |
| S07 | 1.1 | one-shot impact, 1.1 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| S08 | 2.2 | one-shot impact, 2.2 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| S09 | 2.0 | one-shot impact, 2.0 s, tonal, mid, falling pitch/brightness |
| S10 | 1.6 | one-shot impact, 1.6 s, tonal, mid, repeating / rattling |
| S11 | 2.5 | one-shot impact, 2.5 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| S12 | 3.2 | one-shot impact, 3.2 s, tonal, dull/low, falling pitch/brightness |
| S13 | 2.8 | one-shot impact, 2.8 s, tonal, dull/low |
| S14 | 3.9 | one-shot impact, 3.9 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| S15 | 2.4 | one-shot impact, 2.4 s, tonal, dull/low, falling pitch/brightness |
| S16 | 1.6 | one-shot impact, 1.6 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| S17 | 2.5 | one-shot impact, 2.5 s, tonal, dull/low |
| S18 | 1.6 | one-shot impact, 1.6 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| S19 | 1.9 | one-shot impact, 1.9 s, tonal, dull/low |

### P — gunshot (18)

| id | s | shape |
|---|---|---|
| P01 | 1.1 | one-shot impact, 1.1 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| P02 | 0.7 | one-shot impact, 0.7 s, mixed, mid |
| P03 | 1.4 | one-shot impact, 1.4 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| P04 | 1.4 | one-shot impact, 1.4 s, mixed, mid, repeating / rattling |
| P05 | 0.9 | one-shot impact, 0.9 s, mixed, mid, falling pitch/brightness |
| P06 | 1.3 | one-shot impact, 1.3 s, tonal, mid, repeating / rattling |
| P07 | 1.1 | one-shot impact, 1.1 s, mixed, mid |
| P08 | 1.2 | one-shot impact, 1.2 s, mixed, mid, falling pitch/brightness |
| P09 | 0.9 | one-shot impact, 0.9 s, tonal, mid, falling pitch/brightness |
| P10 | 1.5 | one-shot impact, 1.5 s, tonal, mid, falling pitch/brightness |
| P11 | 1.4 | one-shot impact, 1.4 s, tonal, mid, falling pitch/brightness |
| P12 | 2.1 | one-shot impact, 2.1 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| P13 | 1.0 | one-shot impact, 1.0 s, mixed, mid |
| P14 | 1.2 | one-shot impact, 1.2 s, tonal, mid |
| P15 | 0.7 | one-shot impact, 0.7 s, mixed, mid |
| P16 | 1.0 | one-shot impact, 1.0 s, tonal, dull/low, falling pitch/brightness |
| P17 | 1.4 | one-shot impact, 1.4 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| P18 | 1.2 | one-shot impact, 1.2 s, tonal, mid, falling pitch/brightness |

### F — fire / novelty (16)

| id | s | shape |
|---|---|---|
| F01 | 1.9 | one-shot impact, 1.9 s, mixed, mid, falling pitch/brightness |
| F02 | 1.2 | one-shot, decaying tail, 1.2 s, mixed, mid, repeating / rattling |
| F03 | 0.9 | one-shot, decaying tail, 0.9 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| F04 | 3.0 | sustained / loop-like, 3.0 s, tonal, mid, repeating / rattling |
| F05 | 1.3 | one-shot, decaying tail, 1.3 s, tonal, mid |
| F06 | 0.5 | one-shot impact, 0.5 s, tonal, mid, falling pitch/brightness |
| F07 | 1.4 | rising / charge-up, 1.4 s, tonal, mid, repeating / rattling, rising pitch/brightness |
| F08 | 3.6 | one-shot, decaying tail, 3.6 s, mixed, mid |
| F09 | 0.9 | one-shot impact, 0.9 s, tonal, mid |
| F10 | 0.5 | sustained / loop-like, 0.5 s, mixed, mid |
| F11 | 0.2 | sustained / loop-like, 0.2 s, mixed, bright |
| F12 | 1.5 | sustained / loop-like, 1.5 s, mixed, mid, repeating / rattling |
| F13 | 1.5 | sustained / loop-like, 1.5 s, mixed, mid, repeating / rattling |
| F14 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, mid, falling pitch/brightness |
| F15 | 0.5 | one-shot impact, 0.5 s, tonal, mid, rising pitch/brightness |
| F16 | 0.5 | one-shot impact, 0.5 s, tonal, mid, falling pitch/brightness |

### T — gunshot (16)

| id | s | shape |
|---|---|---|
| T01 | 1.3 | one-shot impact, 1.3 s, tonal, dull/low |
| T02 | 0.8 | one-shot impact, 0.8 s, tonal, mid, falling pitch/brightness |
| T03 | 1.5 | one-shot impact, 1.5 s, tonal, dull/low, repeating / rattling, rising pitch/brightness |
| T04 | 1.8 | one-shot impact, 1.8 s, mixed, dull/low, rising pitch/brightness |
| T05 | 1.6 | one-shot impact, 1.6 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| T06 | 1.2 | one-shot impact, 1.2 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| T07 | 1.3 | one-shot impact, 1.3 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| T08 | 1.6 | one-shot impact, 1.6 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| T09 | 1.2 | one-shot impact, 1.2 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| T10 | 1.4 | one-shot impact, 1.4 s, tonal, dull/low |
| T11 | 1.4 | one-shot impact, 1.4 s, tonal, dull/low, falling pitch/brightness |
| T12 | 1.8 | one-shot impact, 1.8 s, tonal, dull/low |
| T13 | 1.5 | one-shot impact, 1.5 s, tonal, mid, falling pitch/brightness |
| T14 | 0.9 | one-shot impact, 0.9 s, tonal, dull/low, repeating / rattling |
| T15 | 1.4 | one-shot impact, 1.4 s, tonal, dull/low |
| T16 | 1.4 | one-shot, decaying tail, 1.4 s, tonal, dull/low, falling pitch/brightness |

### K — fly-by / air strike (12)

| id | s | shape |
|---|---|---|
| K01 | 10.0 | varying, 10.0 s, tonal, mid |
| K02 | 15.6 | one-shot, decaying tail, 15.6 s, mixed, mid |
| K03 | 15.6 | one-shot, decaying tail, 15.6 s, mixed, mid, rising pitch/brightness |
| K04 | 15.6 | sustained / loop-like, 15.6 s, mixed, mid |
| K05 | 30.0 | one-shot, decaying tail, 30.0 s, tonal, mid, falling pitch/brightness |
| K06 | 15.6 | one-shot, decaying tail, 15.6 s, noisy, bright, rising pitch/brightness |
| K07 | 5.1 | rising / charge-up, 5.1 s, tonal, dull/low, repeating / rattling |
| K08 | 2.5 | sustained / loop-like, 2.5 s, tonal, dull/low, repeating / rattling |
| K09 | 5.1 | one-shot impact, 5.1 s, tonal, dull/low, repeating / rattling |
| K10 | 27.9 | sustained / loop-like, 27.9 s, tonal, mid, repeating / rattling |
| K11 | 2.7 | one-shot impact, 2.7 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| K12 | 2.1 | sustained / loop-like, 2.1 s, mixed, bright, repeating / rattling |

### CC — Contra-style effect (11)

| id | s | shape |
|---|---|---|
| CC01 | 2.3 | one-shot, decaying tail, 2.3 s, mixed, mid |
| CC02 | 0.9 | one-shot impact, 0.9 s, tonal, mid, repeating / rattling |
| CC03 | 1.8 | one-shot impact, 1.8 s, mixed, bright, rising pitch/brightness |
| CC04 | 1.7 | one-shot impact, 1.7 s, mixed, bright, rising pitch/brightness |
| CC05 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, bright, rising pitch/brightness |
| CC06 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, mid |
| CC07 | 5.2 | sustained / loop-like, 5.2 s, tonal, mid |
| CC08 | 110.7 | sustained / loop-like, 110.7 s, tonal, mid, repeating / rattling |
| CC09 | 3.9 | one-shot, decaying tail, 3.9 s, tonal, mid |
| CC10 | 2.8 | one-shot impact, 2.8 s, tonal, mid |
| CC11 | 5.8 | varying, 5.8 s, tonal, mid, repeating / rattling |

### JA — music / sting (10)

| id | s | shape |
|---|---|---|
| JA0 | 8.5 | sustained / loop-like, 8.5 s, tonal, mid |
| JA1 | 8.3 | sustained / loop-like, 8.3 s, tonal, mid, repeating / rattling |
| JA2 | 9.5 | rising / charge-up, 9.5 s, tonal, mid, falling pitch/brightness |
| JA3 | 21.4 | sustained / loop-like, 21.4 s, tonal, mid, repeating / rattling |
| JA4 | 20.0 | varying, 20.0 s, tonal, mid, repeating / rattling |
| JA5 | 21.9 | varying, 21.9 s, tonal, mid |
| JA6 | 3.4 | one-shot, decaying tail, 3.4 s, tonal, dull/low, falling pitch/brightness |
| JA7 | 6.0 | sustained / loop-like, 6.0 s, tonal, mid, repeating / rattling |
| JA8 | 6.3 | rising / charge-up, 6.3 s, tonal, mid, repeating / rattling |
| JA9 | 5.7 | sustained / loop-like, 5.7 s, tonal, mid, repeating / rattling, falling pitch/brightness |

### Y — odd sci-fi effect (10)

| id | s | shape |
|---|---|---|
| Y01 | 1.0 | one-shot, decaying tail, 1.0 s, noisy, mid, repeating / rattling, falling pitch/brightness |
| Y02 | 1.0 | one-shot impact, 1.0 s, noisy, mid, repeating / rattling |
| Y03 | 1.0 | one-shot impact, 1.0 s, noisy, mid, repeating / rattling, falling pitch/brightness |
| Y04 | 0.9 | one-shot impact, 0.9 s, mixed, mid |
| Y05 | 0.2 | sustained / loop-like, 0.2 s, tonal, bright |
| Y06 | 3.7 | one-shot impact, 3.7 s, noisy, bright, repeating / rattling |
| Y07 | 3.6 | sustained / loop-like, 3.6 s, mixed, bright |
| Y08 | 1.8 | sustained / loop-like, 1.8 s, mixed, bright |
| Y09 | 0.9 | sustained / loop-like, 0.9 s, mixed, bright |
| Y10 | 1.7 | one-shot impact, 1.7 s, mixed, bright |

### HM — hit / impact (melee?) (9)

| id | s | shape |
|---|---|---|
| HM10 | 1.9 | one-shot impact, 1.9 s, noisy, mid |
| HM11 | 2.1 | one-shot impact, 2.1 s, noisy, bright, repeating / rattling |
| HM12 | 2.0 | one-shot impact, 2.0 s, noisy, bright, repeating / rattling |
| HM13 | 0.7 | one-shot impact, 0.7 s, mixed, bright |
| HM14 | 0.9 | one-shot impact, 0.9 s, mixed, bright, repeating / rattling |
| HM1B | 2.2 | one-shot, decaying tail, 2.2 s, mixed, mid, repeating / rattling |
| HM1F | 1.1 | one-shot, decaying tail, 1.1 s, tonal, dull/low |
| HM1O | 2.0 | one-shot impact, 2.0 s, mixed, bright |
| HM25 | 2.4 | one-shot, decaying tail, 2.4 s, mixed, mid |

### TK — misc effect (TK) (9)

| id | s | shape |
|---|---|---|
| TK0W | 1.0 | one-shot impact, 1.0 s, mixed, bright, repeating / rattling |
| TK0Z | 9.5 | varying, 9.5 s, mixed, mid, repeating / rattling |
| TK14 | 0.8 | one-shot, decaying tail, 0.8 s, noisy, bright, repeating / rattling |
| TK15 | 0.6 | one-shot, decaying tail, 0.6 s, noisy, bright |
| TK19 | 4.7 | varying, 4.7 s, mixed, bright, repeating / rattling |
| TK1R | 10.4 | varying, 10.4 s, mixed, mid |
| TK2R | 0.1 | one-shot, decaying tail, 0.1 s, mixed, bright, falling pitch/brightness |
| TK2V | 8.7 | varying, 8.7 s, mixed, mid |
| TK2W | 2.6 | one-shot impact, 2.6 s, tonal, mid |

### L — electrical (7)

| id | s | shape |
|---|---|---|
| L01 | 1.5 | sustained / loop-like, 1.5 s, mixed, bright, repeating / rattling |
| L02 | 1.5 | sustained / loop-like, 1.5 s, mixed, mid, repeating / rattling |
| L03 | 1.0 | one-shot impact, 1.0 s, noisy, bright |
| L04 | 0.4 | rising / charge-up, 0.4 s, noisy, bright |
| L05 | 4.5 | sustained / loop-like, 4.5 s, mixed, mid, repeating / rattling |
| L06 | 0.6 | one-shot, decaying tail, 0.6 s, noisy, bright |
| L07 | 0.4 | rising / charge-up, 0.4 s, noisy, bright |

### Q — silenced shot (7)

| id | s | shape |
|---|---|---|
| Q01 | 0.3 | one-shot, decaying tail, 0.3 s, mixed, mid, falling pitch/brightness |
| Q02 | 0.3 | one-shot, decaying tail, 0.3 s, noisy, bright |
| Q03 | 0.2 | one-shot, decaying tail, 0.2 s, mixed, mid |
| Q04 | 0.2 | one-shot, decaying tail, 0.2 s, mixed, mid, falling pitch/brightness |
| Q05 | 0.3 | one-shot, decaying tail, 0.3 s, mixed, mid, rising pitch/brightness |
| Q06 | 0.5 | one-shot impact, 0.5 s, tonal, mid, falling pitch/brightness |
| Q07 | 0.9 | one-shot impact, 0.9 s, mixed, mid, repeating / rattling, falling pitch/brightness |

### O — big gun / ordnance (6)

| id | s | shape |
|---|---|---|
| O01 | 1.4 | one-shot, decaying tail, 1.4 s, mixed, mid, falling pitch/brightness |
| O02 | 1.7 | one-shot impact, 1.7 s, mixed, mid |
| O03 | 2.5 | one-shot impact, 2.5 s, mixed, mid, falling pitch/brightness |
| O04 | 1.8 | one-shot impact, 1.8 s, mixed, mid |
| O05 | 1.5 | one-shot impact, 1.5 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| O06 | 1.8 | one-shot impact, 1.8 s, mixed, mid |

### Z — creature splat (5)

| id | s | shape |
|---|---|---|
| Z04 | 1.1 | one-shot, decaying tail, 1.1 s, noisy, bright |
| Z05 | 0.9 | one-shot impact, 0.9 s, noisy, bright, repeating / rattling |
| Z06 | 0.5 | one-shot, decaying tail, 0.5 s, noisy, mid |
| Z07 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, mid, falling pitch/brightness |
| Z11 | 1.2 | one-shot impact, 1.2 s, mixed, mid, repeating / rattling, falling pitch/brightness |

### JAA — music / sting (1)

| id | s | shape |
|---|---|---|
| JAA | 4.3 | one-shot, decaying tail, 4.3 s, tonal, dull/low, falling pitch/brightness |

### JAB — JAB family (1)

| id | s | shape |
|---|---|---|
| JAB | 4.2 | one-shot, decaying tail, 4.2 s, tonal, dull/low, falling pitch/brightness |

### JAC — JAC family (1)

| id | s | shape |
|---|---|---|
| JAC | 1.6 | one-shot, decaying tail, 1.6 s, tonal, mid, falling pitch/brightness |

### JAD — JAD family (1)

| id | s | shape |
|---|---|---|
| JAD | 3.5 | one-shot, decaying tail, 3.5 s, tonal, mid, falling pitch/brightness |

### JAE — JAE family (1)

| id | s | shape |
|---|---|---|
| JAE | 1.8 | one-shot, decaying tail, 1.8 s, tonal, dull/low, falling pitch/brightness |

### JAF — JAF family (1)

| id | s | shape |
|---|---|---|
| JAF | 2.1 | one-shot, decaying tail, 2.1 s, tonal, mid, falling pitch/brightness |

### JAG — JAG family (1)

| id | s | shape |
|---|---|---|
| JAG | 1.7 | one-shot, decaying tail, 1.7 s, tonal, mid, falling pitch/brightness |

### JAH — JAH family (1)

| id | s | shape |
|---|---|---|
| JAH | 2.1 | one-shot, decaying tail, 2.1 s, tonal, dull/low, steady pitch ~60 Hz, falling pitch/brightness |

### JAI — JAI family (1)

| id | s | shape |
|---|---|---|
| JAI | 1.9 | one-shot, decaying tail, 1.9 s, tonal, mid, falling pitch/brightness |

### JAJ — JAJ family (1)

| id | s | shape |
|---|---|---|
| JAJ | 2.4 | one-shot, decaying tail, 2.4 s, tonal, mid, falling pitch/brightness |

### JAK — JAK family (1)

| id | s | shape |
|---|---|---|
| JAK | 2.4 | one-shot, decaying tail, 2.4 s, tonal, mid, falling pitch/brightness |

### JAL — JAL family (1)

| id | s | shape |
|---|---|---|
| JAL | 1.9 | one-shot, decaying tail, 1.9 s, tonal, mid, falling pitch/brightness |

### JAM — JAM family (1)

| id | s | shape |
|---|---|---|
| JAM | 3.0 | one-shot, decaying tail, 3.0 s, tonal, mid, falling pitch/brightness |

### JAN — JAN family (1)

| id | s | shape |
|---|---|---|
| JAN | 60.1 | rising / charge-up, 60.1 s, tonal, mid |

### JAO — JAO family (1)

| id | s | shape |
|---|---|---|
| JAO | 53.7 | rising / charge-up, 53.7 s, tonal, mid, repeating / rattling, rising pitch/brightness |

### JAP — JAP family (1)

| id | s | shape |
|---|---|---|
| JAP | 50.9 | varying, 50.9 s, tonal, mid |

### JAQ — JAQ family (1)

| id | s | shape |
|---|---|---|
| JAQ | 11.1 | sustained / loop-like, 11.1 s, tonal, mid |

### JAR — JAR family (1)

| id | s | shape |
|---|---|---|
| JAR | 11.3 | varying, 11.3 s, tonal, mid, repeating / rattling |

### JAS — JAS family (1)

| id | s | shape |
|---|---|---|
| JAS | 10.7 | sustained / loop-like, 10.7 s, tonal, mid, repeating / rattling |

### JAT — JAT family (1)

| id | s | shape |
|---|---|---|
| JAT | 3.8 | one-shot, decaying tail, 3.8 s, tonal, mid, falling pitch/brightness |

### JAU — JAU family (1)

| id | s | shape |
|---|---|---|
| JAU | 3.0 | one-shot, decaying tail, 3.0 s, tonal, mid, falling pitch/brightness |

### JAV — JAV family (1)

| id | s | shape |
|---|---|---|
| JAV | 4.3 | one-shot, decaying tail, 4.3 s, tonal, mid |

### JAW — JAW family (1)

| id | s | shape |
|---|---|---|
| JAW | 8.1 | sustained / loop-like, 8.1 s, tonal, mid |

### JAX — JAX family (1)

| id | s | shape |
|---|---|---|
| JAX | 8.8 | sustained / loop-like, 8.8 s, tonal, mid, repeating / rattling |

### JAY — JAY family (1)

| id | s | shape |
|---|---|---|
| JAY | 5.7 | rising / charge-up, 5.7 s, tonal, mid, falling pitch/brightness |

### MC — MC family (1)

| id | s | shape |
|---|---|---|
| MC2J | 1.6 | one-shot, decaying tail, 1.6 s, noisy, bright, repeating / rattling, rising pitch/brightness |

### MM — MM family (1)

| id | s | shape |
|---|---|---|
| MM0A | 1.5 | one-shot impact, 1.5 s, noisy, bright, repeating / rattling |

### NA — NA family (1)

| id | s | shape |
|---|---|---|
| NA0 | 4.0 | one-shot, decaying tail, 4.0 s, tonal, mid, repeating / rattling |

## App-listed ids that are NOT on the gun

E_J10, E_J11, E_J12, E_J13, E_J14, E_J15, E_J17, E_J18, E_J19, E_J1W, E_J1X, E_J1Y, E_K01, E_K02, E_K03, E_K04, E_K05, E_K06, E_K07, E_K08, E_K09, E_K10, E_K11, E_K12, E_N35, E_N66, E_N67, E_N68, E_N69, E_N70, E_N71, E_N72, E_N73, E_N86, E_VA1H, E_VA1I, E_VA21, E_VA22, E_VA23, E_VA2E, E_VA33, E_VA3R, E_VA3S, E_VA4P, E_VA4R, E_VA61, E_VA6L, E_VA72, E_VA78, E_VA7H, E_VA7I, E_VA80, E_VA81, E_VA82, E_VA83, E_VA84, E_VA85, E_VB01, E_VB02, E_VB03, E_VB04, E_VB05, E_VB06, E_VB07, E_VB08, E_VB0C, E_VB0D, E_VB0E, E_VB0F, E_VB0G, E_VB0H, E_VB0I, E_VB0J, E_VB0K, E_VB0L, E_VB0M, E_VB0N, E_VB0O, E_VB0P, E_VB0Q, E_VB0R, E_VB0S, E_VB0T, E_VB0U, E_VB0V, E_VB0W, E_VB0X, E_VB0Y, E_VB0Z, E_VB10, E_VB11, E_VB12, E_VB13, E_VB14, E_VB15, E_VB16, E_VB17, E_VB18, E_VB19, E_VB1A, E_VB1B, E_VB1C, E_VB1D, E_VB1E, E_VB1F, E_VB1G, E_VB1H, E_VB1I, E_VB1J, E_VB1K, E_VB1M, E_VB1N, E_VB1O, E_VB1P, E_VB1Q, E_VB1R, E_VB1S, E_VB1T, E_VB1U, E_VB1V, E_VB1W, E_VS6, E_VSA, E_VSB, E_VSC, E_VSD, E_X21, E_X22, E_X23, E_X24, E_X25, E_X26, E_X27, E_X28, E_X29, E_X30, V00, V10, V20, V30, V40, V50, V60, V70, V80, V90, VA0, Z01, Z02, Z03, Z08, Z09, Z10, Z12, Z13, Z14, Z15
