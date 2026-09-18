# BRX sound catalog (derived)

Every sound on a v4.32 tagger, read off the gun's own `AUDIO` folder on 2026-09-03 and analysed with `mcp/tools/soundbank_analyze.py` (transcripts by Whisper, shapes by librosa), then labelled by `soundbank_classify.py`. **Restated, derived data only: no audio and no Battle Company files live in this repo.** Machine-readable copy: `mcp/brx_mcp/data/sound_catalog.json`.

- **2634 ids**: 2477 on the gun, 157 listed by the app but NOT on the gun (they play the fallback), 468 on the gun but unknown to the app.
- Format on the gun: headerless raw PCM, signed 16-bit little-endian, mono, 44 100 Hz, one `<ID>.LTP` per id.
- Transcripts are Whisper's; a word-level slip is possible on a single line (e.g. "Flight captured" for "Flag captured"). Where a family repeats a line three times (kill confirms), the majority reading is right.
- **Community labels** (credit LaserTagMods' community-run BRX Audio sheet, shared by Jay): 158 new, 622 agree with ours, 224 differ, 20 flagged NOISE since firmware v4.30, 347 sheet ids not on our gun. Unconfirmed by us; see [Community labels](#community-labels) below.

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
| VB01 | 1.2 | objective_other | base captured. · community label (agrees, unconfirmed): Base Captured |
| VB02 | 1.5 | objective_other | BASE DESTROYED · community label (agrees, unconfirmed): Base Destroyed |
| VB03 | 2.5 | game_over | Blue team is closing in on victory. · community label (agrees, unconfirmed): Blue team is closing in on victory |
| VB04 | 1.6 | objective_flag | Blue flag captured. · community label (agrees, unconfirmed): Blue flag has been captured; BLUE FLAG CAPTURED |
| VB05 | 1.7 | objective_flag | Blue flag returned. · community label (agrees, unconfirmed): Blue flag has been returned; BLUE FLAG RETURNED |
| VB06 | 1.7 | objective_flag | Blue flag taken. · community label (agrees, unconfirmed): Blue flag has been taken; BLUE FLAG TAKEN |
| VB07 | 2.0 | lead | Blue team takes the lead. · community label (agrees, unconfirmed): Blue team gained the lead; BLUE TEAM TAKES THE LEAD |
| VB08 | 2.6 | clock | Blue team has one player remaining. · community label (agrees, unconfirmed): Blue team has one player remaining |
| VB09 | 1.1 | objective_codes | Code's captured! · community label (differs, unconfirmed): Codes Captured |
| VB0A | 1.4 | objective_codes | Code's compromised. · community label (differs, unconfirmed): Codes compromised |
| VB0B | 1.4 | objective_codes | Codes returned. · community label (agrees, unconfirmed): Codes returned |
| VB0C | 1.3 | objective_flag | Flag captured. · community label (agrees, unconfirmed): Flag has been captured |
| VB0D | 1.6 | objective_flag | Flag returned. · community label (agrees, unconfirmed): The flag has been returned |
| VB0E | 1.7 | objective_flag | flag taken · community label (agrees, unconfirmed): The flag has been taken |
| VB0F | 1.4 | objective_other | Fortress Captured. · community label (agrees, unconfirmed): Fortress Captured |
| VB0G | 1.4 | objective_other | Fortress Lost. · community label (agrees, unconfirmed): Fortress Lost |
| VB0H | 2.7 | game_over | Green team is closing in on victory. · community label (agrees, unconfirmed): Green team is closing in on victory |
| VB0I | 1.5 | objective_flag | Green flag captured. · community label (agrees, unconfirmed): Green flag has been captured; GREEN FLAG CAPTURED |
| VB0J | 1.8 | objective_flag | Green flag returned. · community label (agrees, unconfirmed): Green flag has been returned; GREEN FLAG RETURNED |
| VB0K | 1.5 | objective_flag | Green flag taken. · community label (agrees, unconfirmed): Green flag has been taken; GREEN FLAG TAKEN |
| VB0L | 2.0 | lead | Green Team takes the lead. · community label (agrees, unconfirmed): Green team gained the lead; GREEN TEAM TAKES THE LEAD |
| VB0M | 2.8 | clock | Green Team has one player remaining. · community label (agrees, unconfirmed): Green team has one player remaining |
| VB0N | 1.9 | objective_hill | Hill Captured · community label (agrees, unconfirmed): Hill Captured |
| VB0O | 2.1 | objective_hill | Hill Contested · community label (agrees, unconfirmed): Hill Contested |
| VB0P | 3.0 | objective_hill | Hill Lost! · community label (differs, unconfirmed): Hill Controlled; HILL LOST |
| VB0Q | 2.4 | objective_hill | Hill Moved · community label (agrees, unconfirmed): Hill Moved |
| VB0R | 2.6 | game_over | Pink Team is closing in on victory. · community label (agrees, unconfirmed): Pink Team is closing in on victory |
| VB0S | 1.5 | objective_flag | Pink flag captured. · community label (agrees, unconfirmed): Pink flag has been captured; PINK FLAG CAPTURED |
| VB0T | 1.7 | objective_flag | Pink Flag Returns! · community label (agrees, unconfirmed): Pink flag has been returned; PINK FLAG RETURNED |
| VB0U | 1.5 | objective_flag | Pink Flag Taken. · community label (agrees, unconfirmed): Pink flag has been taken; PINK FLAG TAKEN |
| VB0V | 1.9 | lead | Pink Team takes the lead. · community label (agrees, unconfirmed): Pink team gained the lead; PINK TEAM TAKES THE LEAD |
| VB0W | 2.5 | clock | Think Team has one player remaining. · community label (agrees, unconfirmed): Pink team has one player remaining |
| VB0X | 2.7 | game_over | Purple team is closing in on victory. · community label (agrees, unconfirmed): Purple team is closing in on victory |
| VB0Y | 1.5 | objective_flag | Purple flag captured. · community label (agrees, unconfirmed): Purple flag has been captured; PURPLE FLAG CAPTURED |
| VB0Z | 1.9 | objective_flag | Purple Flag Returns. · community label (differs, unconfirmed): Purple flag has been returned; PRPLE FLAG RETURNED |
| VB10 | 1.7 | objective_flag | Purple flag taken. · community label (agrees, unconfirmed): Purple flag has been taken; PURPLE FLAG TAKEN |
| VB11 | 1.8 | lead | Purple team takes the lead. · community label (agrees, unconfirmed): Purple team gained the lead; PURPLE TEAM TAKES THE LEAD |
| VB12 | 2.7 | clock | Purple team has one player remaining. · community label (agrees, unconfirmed): Purple team has one player remaining; PURMPLE TEAM HAS ONE PLAYER REMAINING |
| VB13 | 2.6 | game_over | Red team is closing in on victory. · community label (agrees, unconfirmed): Red team is closing in on victory |
| VB14 | 1.7 | objective_flag | Red flag captured. · community label (agrees, unconfirmed): Red flag has been captured; RED FLAG CAPTURED |
| VB15 | 1.8 | objective_flag | Red flag returned. · community label (agrees, unconfirmed): Red flag has been returned; RED FLAG RETURNED |
| VB16 | 1.5 | objective_flag | Red Flag Ticken · community label (agrees, unconfirmed): Red flag has been taken; RED FLAG TAKEN |
| VB17 | 1.9 | lead | Red team takes the lead. · community label (agrees, unconfirmed): Red team gained the lead; RED TEAM TAKES THE LEAD |
| VB18 | 2.8 | clock | Red team has one player remaining. · community label (agrees, unconfirmed): Red team has one player remaining; RED TEAM HAS ONE LAYER REMAINING |
| VB19 | 2.9 | game_over | SCIEN TEAM IS CLOSING IN ON VICTORY! · community label (agrees, unconfirmed): White team is closing in on victory; CYAN TEAM IS CLOSING IN ON VICTORY |
| VB1A | 1.7 | objective_flag | Scion flag captured! · community label (agrees, unconfirmed): White flag has been captured; CYAN FLAG CAPTURED |
| VB1B | 1.9 | objective_flag | Cyan Flag returned. · community label (agrees, unconfirmed): White flag has been returned; CYAN FLAG RETURNED |
| VB1C | 1.9 | objective_flag | Sion Flag Ticken · community label (differs, unconfirmed): White flag has been taken; CYAN FLAG TAKEN |
| VB1D | 2.4 | lead | SCIEN TEAM TAKES THE LEAD · community label (agrees, unconfirmed): White team gained the lead; CYAN TEAM TAKES THE LEAD |
| VB1E | 2.8 | clock | Sion Team has one player remaining. · community label (agrees, unconfirmed): White team has one player remaining; CYAN TEAM HAS ONE PLAYER REMAINING |
| VB1F | 2.6 | game_over | Yellow team is closing in on victory. · community label (agrees, unconfirmed): Yellow team is closing in on victory |
| VB1G | 1.6 | objective_flag | Yellow flag captured. · community label (agrees, unconfirmed): Yellow flag has been captured; YELLOW FLAG CAPTURED |
| VB1H | 2.0 | objective_flag | Yellow flag returned. · community label (agrees, unconfirmed): Yellow flag has been returned; YELLOW FLAG RETURNED |
| VB1I | 1.5 | objective_flag | Yellow flag taken. · community label (agrees, unconfirmed): Yellow flag has been taken; YELLOW FLAG TAKEN |
| VB1J | 2.0 | lead | Yellow team takes the lead. · community label (agrees, unconfirmed): Yellow team gained the lead; YELLOW TEAM TAKES THE LEAD |
| VB1K | 2.6 | clock | Yellow team has one player remaining. · community label (agrees, unconfirmed): Yellow team has one player remaining |
| VB1L | 1.5 | line | you control the battlefield. · community label (agrees, unconfirmed): You control the battlefield |
| VB1M | 1.6 | objective_other | The infection is spread. · community label (agrees, unconfirmed): The infection has spread |
| VB1N | 1.9 | game_over | Grame Team wins! · community label (agrees, unconfirmed): Green team wins |
| VB1O | 1.8 | game_over | Bravo Team wins! · community label (agrees, unconfirmed): Bravo team wins |
| VB1P | 1.9 | game_over | Blue Team wins! · community label (agrees, unconfirmed): Blue team wins |
| VB1Q | 1.8 | game_over | Alpha Team wins! · community label (agrees, unconfirmed): Alpha team wins |
| VB1R | 2.0 | game_over | Yellow Team wins! · community label (agrees, unconfirmed): Yellow team wins |
| VB1S | 2.3 | game_over | SCIENTEAM WINS! · community label (differs, unconfirmed): White team wins; CYAN TEAM WINS |
| VB1T | 2.2 | line | The survivors have held their ground. · community label (agrees, unconfirmed): Survivors have held their ground |
| VB1U | 1.9 | game_over | Red team wins. · community label (agrees, unconfirmed): Red team wins |
| VB1V | 2.1 | game_over | Purple Team wins! · community label (agrees, unconfirmed): Purple team wins |
| VB1W | 1.8 | game_over | Pink Team wins! · community label (agrees, unconfirmed): Pink team wins |

### Announcer (game callouts) (34)

| id | s | category | words |
|---|---|---|---|
| V100 | 1.6 | grunt | AHHHHHHHHH! · community label (differs, unconfirmed): Yell |
| V108 | 12.0 | objective_hill | King of the hill. Control the hill to earn points. · community label (agrees, unconfirmed): (Halo) King of the hill - Control the hill to earn points |
| V109 | 13.3 | objective_flag | Capture the flag! · community label (agrees, unconfirmed): (Halo) Capture the flag |
| V110 | 12.3 | team | Slayer Pro. Eliminate the enemy team. · community label (agrees, unconfirmed): (Halo) Slayer Pro, Eliminate the enemy team |
| V111 | 1.5 | game_over | Game over! · community label (agrees, unconfirmed): (Halo) Game Over |
| V112 | 2.3 | clock | 30 seconds left. · community label (agrees, unconfirmed): (Halo) 30 Seconds left |
| V113 | 2.1 | clock | One minute left. · community label (agrees, unconfirmed): (Halo) 1 minute left |
| V114 | 1.1 | clock | 10 seconds! · community label (agrees, unconfirmed): (Halo) 10 Seconds |
| V115 | 2.9 | game_over | NEXT KILL WINS! · community label (agrees, unconfirmed): (Halo) Next kill wins |
| V116 | 1.3 | line | gained the lead · community label (agrees, unconfirmed): (Halo) Gained the lead |
| V117 | 1.1 | lead | lost the lead. · community label (agrees, unconfirmed): (Halo) Lost the lead |
| V118 | 1.6 | game_over | Victory! · community label (agrees, unconfirmed): (Halo) Victory |
| V119 | 2.1 | game_over | Closing in on victory! · community label (agrees, unconfirmed): (Halo) Closing in on victory |
| V120 | 2.4 | clock | Five minutes remain. · community label (agrees, unconfirmed): (Halo) 5 minutes remain |
| V121 | 1.4 | killstreak | Ordinance ready! · community label (agrees, unconfirmed): Ordinance ready |
| V122 | 1.5 | medal | Double kill! · community label (agrees, unconfirmed): (Halo) Double kill |
| V123 | 1.3 | medal | Triple kill · community label (agrees, unconfirmed): (Halo) Triple kill |
| V124 | 1.9 | medal | KILL TACULAR! · community label (agrees, unconfirmed): (Halo) Kill-tacular |
| V125 | 1.5 | medal | Killing spree · community label (agrees, unconfirmed): (Halo) Killing spree |
| V130 | 1.8 | line | Overshield · community label (agrees, unconfirmed): (Halo) Overshield |
| V131 | 1.9 | objective_flag | Flag Defense! · community label (agrees, unconfirmed): (Halo) Flag Defense |
| V132 | 1.7 | objective_flag | Flag champion! · community label (agrees, unconfirmed): (Halo) Flag Champion |
| V133 | 1.4 | objective_flag | Flight Captured! · community label (differs, unconfirmed): (Halo) Flag Captured |
| V134 | 2.1 | lead | Enemy team scored. · community label (agrees, unconfirmed): (Halo) Enemy team scored |
| V135 | 1.5 | objective_flag | Carrying flag · community label (agrees, unconfirmed): (Halo) Carrying flag |
| V136 | 1.4 | objective_flag | Carrier kill! · community label (agrees, unconfirmed): (Halo) Carrier Kill |
| V137 | 1.7 | objective_flag | Your flag taken. · community label (agrees, unconfirmed): (Halo) Your flag taken |
| V138 | 2.2 | objective_flag | Protect your flag · community label (agrees, unconfirmed): (Halo) Protect your flag |
| V139 | 1.7 | kill_confirm | Kill their carrier! · community label (agrees, unconfirmed): (Halo)Killed their carrier |
| V140 | 2.2 | objective_flag | flight assassination · community label (differs, unconfirmed): (Halo) Flag-sasination |
| V141 | 1.3 | objective_flag | Flight Runner! · community label (differs, unconfirmed): (Halo) Flag Runner |
| V142 | 1.6 | objective_flag | flag reset. · community label (agrees, unconfirmed): (Halo) Flag reset |
| V143 | 1.3 | objective_flag | Flag kill. · community label (agrees, unconfirmed): (Halo) Flag kill |
| V144 | 2.1 | objective_flag | FLAG JOST! · community label (differs, unconfirmed): (Halo) Flag joust |

### Announcer (lives) (8)

| id | s | category | words |
|---|---|---|---|
| VT00 | 1.5 | status_health | for lives remaining. · community label (agrees, unconfirmed): 4 LIVES REMAINING |
| VT01 | 1.8 | status_health | Three lives remaining. · community label (agrees, unconfirmed): 3 LIVES REMAINING |
| VT02 | 1.6 | status_health | Two lives remaining. · community label (agrees, unconfirmed): 2 LIVES REMAINING |
| VT03 | 1.4 | clock | One life remaining. · community label (agrees, unconfirmed): ONE LIFE REMAINING |
| VT0U | 1.3 | status_battery | Battery low. · community label (agrees, unconfirmed): BATTERY LOW |
| VT1Q | 0.5 | menu | deaths. · community label (agrees, unconfirmed): DEATHS |
| VT1T | 0.6 | kill_confirm | kills · community label (agrees, unconfirmed): KILLS |
| VT1U | 0.5 | grunt | No. · community label (agrees, unconfirmed): NO |

### Announcer (male) (354)

| id | s | category | words |
|---|---|---|---|
| VA01 | 0.7 | grunt | one. · community label (differs, unconfirmed): 1.0 |
| VA02 | 0.5 | number | 2. · community label (agrees, unconfirmed): 2.0 |
| VA03 | 0.5 | number | 3. · community label (agrees, unconfirmed): 3.0 |
| VA04 | 0.7 | number | Four. · community label (differs, unconfirmed): 4.0 |
| VA05 | 0.7 | number | Five. · community label (differs, unconfirmed): 5.0 |
| VA06 | 1.0 | number | Six. · community label (differs, unconfirmed): 6.0 |
| VA07 | 0.8 | number | seven · community label (differs, unconfirmed): 7.0 |
| VA08 | 0.6 | number | 8. · community label (agrees, unconfirmed): 8.0 |
| VA09 | 0.7 | grunt | Nine. · community label (differs, unconfirmed): 9.0 |
| VA0A | 0.5 | number | 10 · community label (agrees, unconfirmed): 10.0 |
| VA0B | 0.9 | number | 11 · community label (agrees, unconfirmed): 11.0 |
| VA0C | 0.8 | number | 12 · community label (agrees, unconfirmed): 12.0 |
| VA0D | 0.9 | number | 13 · community label (agrees, unconfirmed): 13.0 |
| VA0E | 1.1 | number | 14 · community label (agrees, unconfirmed): 14.0 |
| VA0F | 0.8 | number | 15 · community label (agrees, unconfirmed): 15.0 |
| VA0G | 1.0 | number | 16. · community label (agrees, unconfirmed): 16.0 |
| VA0H | 1.0 | number | Seventeen. · community label (differs, unconfirmed): 17.0 |
| VA0I | 0.7 | number | 18. · community label (agrees, unconfirmed): 18.0 |
| VA0J | 0.9 | number | 19. · community label (agrees, unconfirmed): 19.0 |
| VA0K | 0.5 | number | 20. · community label (agrees, unconfirmed): 20.0 |
| VA0L | 0.9 | number | 21. · community label (agrees, unconfirmed): 21.0 |
| VA0M | 0.8 | number | 22. · community label (agrees, unconfirmed): 22.0 |
| VA0N | 1.0 | number | 23 · community label (agrees, unconfirmed): 23.0 |
| VA0O | 0.9 | number | 24. · community label (agrees, unconfirmed): 24.0 |
| VA0P | 1.3 | number | 25 · community label (agrees, unconfirmed): 25.0 |
| VA0Q | 1.2 | clock | Seven minutes. · community label (differs, unconfirmed): 30 Minutes; 30 min; 7 MINUTES |
| VA0R | 1.1 | clock | 30 seconds. · community label (agrees, unconfirmed): 30 Seconds |
| VA0S | 2.1 | clock | 45 seconds ramp up · community label (agrees, unconfirmed): Ramp 45; 45 SECONDS RAMP UP |
| VA0T | 1.8 | clock | 45 seconds. · community label (agrees, unconfirmed): 45 Seconds |
| VA0U | 1.4 | line | Ramp 60. · community label (agrees, unconfirmed): Ramp 60 |
| VA0V | 1.3 | clock | 60 seconds. · community label (agrees, unconfirmed): 60 Seconds |
| VA0W | 2.0 | clock | 90 seconds ramp up. · community label (agrees, unconfirmed): Ramp 90; 90 SECONDS RAMP UP |
| VA0X | 1.5 | clock | 90 seconds. · community label (agrees, unconfirmed): 90 Seconds |
| VA0Y | 1.8 | line | Advanced Communications. · community label (agrees, unconfirmed): Advanced Communications |
| VA0Z | 1.9 | killstreak | Advanced UAV detected. · community label (agrees, unconfirmed): Advanced UAV Detected |
| VA1 | 1.1 | line | Watch this. · community label (agrees, unconfirmed): Watch This |
| VA10 | 1.5 | killstreak | Advanced UAV. · community label (agrees, unconfirmed): Advanced UAV |
| VA11 | 0.9 | killstreak | Air Raid · community label (agrees, unconfirmed): Air Raid |
| VA12 | 1.4 | killstreak | Airstrike detected. · community label (differs, unconfirmed): Air Strike Detected |
| VA13 | 1.1 | team | Alpha Team. · community label (agrees, unconfirmed): Alpha Team; Alpha |
| VA14 | 1.1 | menu | ammo pouch. · community label (agrees, unconfirmed): Ammo Pouch |
| VA15 | 1.6 | weapon_name | Armor Piercing Rounds · community label (agrees, unconfirmed): Armor Piercing Rounds |
| VA16 | 0.9 | menu | armor suit. · community label (agrees, unconfirmed): Armor Suit |
| VA17 | 1.0 | menu | awareness. · community label (agrees, unconfirmed): Awareness |
| VA18 | 0.7 | weapon_name | Baton · community label (differs, unconfirmed): Batton |
| VA19 | 1.1 | weapon_name | Battle Axe. · community label (agrees, unconfirmed): Battle Axe |
| VA1A | 1.9 | greeting | Let the battle begin. · community label (agrees, unconfirmed): Let the Battle Begin |
| VA1B | 1.9 | game_mode | Welcome to Battle Reality. · community label (agrees, unconfirmed): Welcome to Battle Reality |
| VA1C | 1.8 | killstreak | Black Hawk inbound. · community label (differs, unconfirmed): Blackhawk Inbound |
| VA1D | 1.0 | killstreak | Blackhawk. · community label (agrees, unconfirmed): Blackhawk |
| VA1E | 1.0 | line | Blind Eye. · community label (differs, unconfirmed): BlindEye |
| VA1F | 1.1 | killstreak | Blockade. · community label (agrees, unconfirmed): Blockade |
| VA1G | 1.2 | menu | Body Armor. · community label (agrees, unconfirmed): Body Armor |
| VA1H | 2.4 | objective_other | BOMB DEFUSED · community label (differs, unconfirmed): The Bomb has been diffused; BOMB DIFUSED |
| VA1I | 3.0 | objective_other | Bomb Planted · community label (agrees, unconfirmed): Bomb has been planted; BOMB PLANTED |
| VA1J | 1.2 | weapon_name | Bow staff. · community label (differs, unconfirmed): Bo Staff |
| VA1K | 1.2 | line | BOO · community label (differs, unconfirmed): Bow |
| VA1L | 1.1 | team | Bravo team! · community label (agrees, unconfirmed): Bravo Team; Bravo |
| VA1M | 1.2 | weapon_name | Burst Glock. · community label (agrees, unconfirmed): Burst Glock |
| VA1N | 1.8 | killstreak | enemy care package detected. · community label (agrees, unconfirmed): Enemy care package detected |
| VA1O | 1.8 | killstreak | enemy care package underway. · community label (agrees, unconfirmed): Enemy care package underway |
| VA1P | 1.6 | killstreak | Incoming Care Package. · community label (agrees, unconfirmed): Incoming care package |
| VA1Q | 1.1 | killstreak | Care Package. · community label (agrees, unconfirmed): Care Package |
| VA1R | 1.2 | team | Charlie team. · community label (agrees, unconfirmed): Charlie Team; Charlie |
| VA1S | 1.6 | killstreak | enemy chopper detected. · community label (agrees, unconfirmed): Enemy chopper detected |
| VA1T | 1.9 | killstreak | enemy chopper in your vicinity. · community label (agrees, unconfirmed): Enemy chopper in your vacinity |
| VA1U | 1.3 | killstreak | Incoming Chopper. · community label (agrees, unconfirmed): Incoming chopper |
| VA1V | 1.0 | weapon_name | Claymore. · community label (agrees, unconfirmed): Claymore |
| VA1W | 1.3 | menu | Cluster Grenade. · community label (agrees, unconfirmed): Cluster grenade |
| VA1X | 1.1 | weapon_name | Combat Axe. · community label (agrees, unconfirmed): Combat Axe |
| VA1Y | 1.2 | game_mode | Commanders! · community label (agrees, unconfirmed): Commanders |
| VA1Z | 1.5 | weapon_name | Concussion Grenades · community label (agrees, unconfirmed): Concussion Grenades |
| VA2 | 6.0 | line | Ehehhehehehhehheheheh h! ehehheheheeh ruler ugh · community label (differs, unconfirmed): Coughing |
| VA20 | 1.3 | system | Connection established. · community label (agrees, unconfirmed): Connection Established |
| VA21 | 1.6 | objective_other | Control Point Contested. · community label (agrees, unconfirmed): Control Point Contested |
| VA22 | 1.8 | objective_other | Control Point Lost. · community label (agrees, unconfirmed): Control point lost |
| VA23 | 1.6 | objective_other | Control Point Captured. · community label (agrees, unconfirmed): Control point captured |
| VA24 | 1.2 | killstreak | Critical Strike. · community label (agrees, unconfirmed): Critical Strike |
| VA25 | 1.1 | menu | dead eye. · community label (differs, unconfirmed): Deadeye |
| VA26 | 1.0 | game_mode | Deathmatch · community label (differs, unconfirmed): DeathMatch; DEATH MATCH |
| VA27 | 1.3 | team | Delta Team. · community label (agrees, unconfirmed): Delta Team; Delta |
| VA28 | 1.0 | killstreak | Deployment. · community label (agrees, unconfirmed): Deployment |
| VA29 | 1.0 | weapon_name | Desert Eagle. · community label (agrees, unconfirmed): Desert Eagle |
| VA2A | 0.9 | system | device paired. · community label (agrees, unconfirmed): Device Paired |
| VA2B | 1.1 | system | device removed. · community label (agrees, unconfirmed): Device Removed |
| VA2C | 1.3 | menu | double mags. · community label (agrees, unconfirmed): Double Mags |
| VA2D | 1.0 | menu | Double Trigger. · community label (agrees, unconfirmed): Double Trigger |
| VA2E | 3.0 | grunt | Raw Game! · community label (differs, unconfirmed): This games a draw; DRAW GAME |
| VA2F | 1.2 | line | Do a wheeled. · community label (differs, unconfirmed): Dual Wield |
| VA2G | 0.9 | team | Echo Team. · community label (agrees, unconfirmed): Echo Team |
| VA2H | 1.0 | killstreak | EMP · community label (agrees, unconfirmed): EMP |
| VA2I | 2.5 | line | Enemy flank has been lost. · community label (agrees, unconfirmed): Enemy flag has been lost |
| VA2J | 1.8 | objective_flag | Enemy team has our flag! · community label (agrees, unconfirmed): Enemy team has our flag |
| VA2K | 2.2 | objective_flag | Enemy flag has been captured. · community label (agrees, unconfirmed): Ememy flag has been captured |
| VA2L | 1.7 | killstreak | enemy sentry detected. · community label (agrees, unconfirmed): Enemy sentry detected |
| VA2M | 1.5 | weapon_name | Explosive Rounds. · community label (agrees, unconfirmed): Explosive rounds |
| VA2N | 1.6 | menu | Extended Mags · community label (agrees, unconfirmed): Extended Mags |
| VA2O | 1.1 | menu | Fast track. · community label (agrees, unconfirmed): Fast track |
| VA2P | 1.2 | clock | 15 minutes. · community label (agrees, unconfirmed): 15 Minutes; 15 min |
| VA2Q | 1.3 | clock | 15 seconds. · community label (agrees, unconfirmed): 15 Seconds |
| VA2R | 1.0 | menu | First Aid. · community label (agrees, unconfirmed): First aid |
| VA2S | 1.1 | clock | Five minutes. · community label (differs, unconfirmed): 5 minutes; 5 min; FIVE MINUTES |
| VA2T | 1.1 | menu | Flak jacket. · community label (agrees, unconfirmed): Flak Jacket |
| VA2U | 1.1 | weapon_name | Flashbang! · community label (differs, unconfirmed): Flash Bang |
| VA2V | 1.0 | weapon_name | FMJ. · community label (agrees, unconfirmed): FMJ |
| VA2W | 1.1 | menu | laser sight · community label (differs, unconfirmed): Focus; LASER SIGHT |
| VA2X | 0.9 | menu | Accuracy. · community label (differs, unconfirmed): Fore grip; ACCURACY |
| VA2Y | 1.4 | team | Foxtrot Team. · community label (agrees, unconfirmed): Foxtrot Team |
| VA2Z | 0.8 | weapon_name | FRAG · community label (agrees, unconfirmed): Frag |
| VA3 | 1.3 | grunt | AHHHHHH · community label (differs, unconfirmed): Scream |
| VA30 | 1.4 | game_mode | Free for all. · community label (agrees, unconfirmed): Free for All |
| VA31 | 1.6 | menu | Friendly fire off. · community label (agrees, unconfirmed): Friendly Fire Off |
| VA32 | 1.4 | menu | Friendly fire on. · community label (agrees, unconfirmed): Friendly Fire On |
| VA33 | 1.9 | game_over | Game over. · community label (agrees, unconfirmed): Game Over (deep/slow); GAME OVER |
| VA34 | 1.1 | clock | Game time. · community label (agrees, unconfirmed): Game Time |
| VA35 | 0.9 | line | General. · community label (agrees, unconfirmed): General; GENERALS |
| VA36 | 1.2 | game_mode | Generals. · community label (agrees, unconfirmed): Generals |
| VA37 | 0.7 | line | Ghost. · community label (agrees, unconfirmed): Ghost |
| VA38 | 1.4 | menu | Grenade Launcher · community label (agrees, unconfirmed): Grenade Launcher |
| VA39 | 1.0 | menu | Grenade type. · community label (agrees, unconfirmed): Grenade Type |
| VA3A | 1.6 | killstreak | guided missile detected. · community label (agrees, unconfirmed): Guided Missile detected |
| VA3B | 1.8 | killstreak | Goddid missile inbound. · community label (agrees, unconfirmed): Guided Missile inbound |
| VA3C | 1.2 | killstreak | guided missile. · community label (agrees, unconfirmed): Guided Missile |
| VA3D | 1.1 | status_battery | Gun battery low. · community label (agrees, unconfirmed): Gun battery low |
| VA3E | 1.3 | system | Headset connected. · community label (agrees, unconfirmed): Headset Connected |
| VA3F | 1.6 | system | headset disconnected. · community label (differs, unconfirmed): Headset Removed; HEADSET DISCONNECTED |
| VA3G | 1.0 | menu | Healing Kit. · community label (agrees, unconfirmed): Healing Kit |
| VA3H | 1.3 | killstreak | Hellstorm missile. · community label (agrees, unconfirmed): HellStorm Missile |
| VA3I | 0.6 | grunt | Hi. · community label (agrees, unconfirmed): High |
| VA3J | 1.3 | killstreak | Hijack complete. · community label (agrees, unconfirmed): HiJack Complete |
| VA3K | 1.3 | killstreak | hijack enabled. · community label (agrees, unconfirmed): HiJack Enabled |
| VA3L | 2.0 | line | the enemy has hijacked your equipment. · community label (agrees, unconfirmed): The enemy has hijacked your equipment |
| VA3M | 1.0 | killstreak | Hijack. · community label (agrees, unconfirmed): HiJack |
| VA3N | 1.1 | weapon_name | Hallow Point. · community label (differs, unconfirmed): Hollow Point |
| VA3O | 1.2 | grunt | Woo-hoo! · community label (differs, unconfirmed): WHUUHOOO |
| VA3P | 1.2 | grunt | Woo! · community label (differs, unconfirmed): WHUU |
| VA3Q | 1.4 | grunt | Yeah! · community label (differs, unconfirmed): YEEAAAHH |
| VA3R | 1.3 | objective_other | Hostage down. · community label (differs, unconfirmed): Hostage Died; HOSTAGE DOWN |
| VA3S | 1.4 | objective_other | Hostage Rescued. · community label (agrees, unconfirmed): Hostage Rescued |
| VA3T | 0.9 | grunt | Human · community label (agrees, unconfirmed): Human |
| VA3U | 2.3 | killstreak | Incoming air raid, find cover. · community label (agrees, unconfirmed): Incoming air raid, find cover |
| VA3V | 1.4 | killstreak | Incoming Air Raid · community label (agrees, unconfirmed): Incoming air raid |
| VA3W | 1.2 | menu | Indoor mode. · community label (agrees, unconfirmed): Indoor Mode |
| VA3X | 0.7 | menu | indoor. · community label (agrees, unconfirmed): Indoor |
| VA3Y | 1.1 | objective_other | Infected. · community label (agrees, unconfirmed): Infected |
| VA3Z | 1.0 | menu | fairing mode · community label (differs, unconfirmed): Install Accessory; PAIRING MODE |
| VA4 | 1.5 | grunt | HUUUUUUUUUUUUUUUUU · community label (differs, unconfirmed): Pain sound |
| VA40 | 1.4 | greeting | Join a faction. · community label (agrees, unconfirmed): Join a faction |
| VA41 | 1.5 | greeting | Join the ranks! · community label (agrees, unconfirmed): Join the ranks |
| VA42 | 0.8 | weapon_name | knife. · community label (agrees, unconfirmed): Knife |
| VA43 | 1.1 | game_mode | Last Stand. · community label (agrees, unconfirmed): Last Stand |
| VA44 | 0.8 | menu | Lethal · community label (agrees, unconfirmed): Lethal |
| VA45 | 0.9 | line | Lights out. · community label (agrees, unconfirmed): Lights out |
| VA46 | 1.5 | status_health | Life's depleted. · community label (differs, unconfirmed): Lives depleted |
| VA47 | 1.1 | status_health | lives · community label (agrees, unconfirmed): Lives |
| VA48 | 1.2 | menu | long barrel. · community label (agrees, unconfirmed): Long barrel |
| VA49 | 0.8 | menu | long. · community label (agrees, unconfirmed): Long |
| VA4A | 0.9 | menu | Low. · community label (agrees, unconfirmed): Low |
| VA4B | 1.1 | weapon_name | M4. · community label (agrees, unconfirmed): M4 |
| VA4C | 0.8 | line | Mall. · community label (differs, unconfirmed): Maul |
| VA4D | 1.0 | menu | Medkit. · community label (differs, unconfirmed): Medkit; Med kit |
| VA4E | 0.8 | menu | medium. · community label (agrees, unconfirmed): Medium |
| VA4F | 1.1 | weapon_name | MG7. · community label (agrees, unconfirmed): MG7 |
| VA4G | 1.2 | grunt | MGR. · community label (agrees, unconfirmed): MGR |
| VA4H | 1.5 | killstreak | incoming missile strike. · community label (agrees, unconfirmed): Incoming Missile Strike |
| VA4I | 1.8 | killstreak | enemy missile strike detected. · community label (agrees, unconfirmed): Enemy Missile Strike Detected |
| VA4J | 1.0 | killstreak | missile strike. · community label (agrees, unconfirmed): Missile Strike |
| VA4K | 1.7 | objective_other | missile swarm detected. · community label (agrees, unconfirmed): Missile Swarm Detected |
| VA4L | 1.2 | killstreak | Incoming mortar. · community label (agrees, unconfirmed): Incoming Mortar |
| VA4M | 1.1 | killstreak | Mortar round. · community label (agrees, unconfirmed): Mortar Round |
| VA4N | 1.1 | line | NEXUS · community label (agrees, unconfirmed): Nexus |
| VA4O | 1.2 | weapon_name | 9mm. · community label (agrees, unconfirmed): 9MM |
| VA4P | 1.9 | killstreak | Nuclear launch detected. · community label (agrees, unconfirmed): Nuclear launch detected |
| VA4Q | 2.1 | killstreak | Enemy nuclear launch detected. · community label (agrees, unconfirmed): Enemy nuclear launch detected |
| VA4R | 1.7 | killstreak | incoming nuclear missile. · community label (agrees, unconfirmed): Incoming nuclear missile |
| VA4S | 0.7 | killstreak | Nuke. · community label (agrees, unconfirmed): Nuke |
| VA4T | 0.7 | menu | off. · community label (agrees, unconfirmed): Off |
| VA4U | 1.1 | line | offhand equipped. · community label (agrees, unconfirmed): Offhand equipped |
| VA4V | 0.6 | grunt | on. · community label (agrees, unconfirmed): On |
| VA4W | 1.1 | menu | Outdoor mode. · community label (agrees, unconfirmed): Outdoor Mode |
| VA4X | 0.8 | menu | Outdoor · community label (agrees, unconfirmed): Outdoor |
| VA4Y | 0.9 | weapon_name | pepper spray. · community label (agrees, unconfirmed): Pepper Spray |
| VA4Z | 0.9 | killstreak | Phoenix. · community label (agrees, unconfirmed): Phoenix |
| VA5 | 1.3 | grunt | HAAA! · community label (differs, unconfirmed): another yell |
| VA50 | 0.8 | weapon_name | Pistol · community label (agrees, unconfirmed): Pistol |
| VA51 | 1.1 | menu | Quick hands. · community label (agrees, unconfirmed): Quick hands |
| VA52 | 0.8 | line | Recon. · community label (agrees, unconfirmed): Recon |
| VA53 | 1.0 | grunt | region. · community label (differs, unconfirmed): Regen |
| VA54 | 1.4 | menu | Respawn Time. · community label (agrees, unconfirmed): Respawn Time |
| VA55 | 1.4 | menu | Respawn Type. · community label (agrees, unconfirmed): Respawn Type |
| VA56 | 1.3 | weapon_name | Rocket Launcher! · community label (agrees, unconfirmed): Rocket Launcher |
| VA57 | 0.8 | weapon_name | Saber. · community label (agrees, unconfirmed): Saber |
| VA58 | 1.0 | menu | Scavenger · community label (agrees, unconfirmed): Scavenger |
| VA59 | 1.3 | clock | Second Life. · community label (agrees, unconfirmed): Second Life |
| VA5A | 1.3 | menu | Choose a class. · community label (agrees, unconfirmed): Choose a Class |
| VA5B | 1.1 | menu | Select fire. · community label (agrees, unconfirmed): Select Fire |
| VA5C | 1.4 | menu | Select a game. · community label (agrees, unconfirmed): Select a Game |
| VA5D | 1.2 | menu | Select a perk. · community label (agrees, unconfirmed): Select a Perk |
| VA5E | 1.4 | team | Select a team. · community label (agrees, unconfirmed): Select a Team |
| VA5F | 1.5 | menu | Select a weapon. · community label (agrees, unconfirmed): Select a Weapon |
| VA5G | 1.6 | killstreak | Self-Destruct initiated. · community label (agrees, unconfirmed): Self destruct initiated |
| VA5H | 1.4 | status_battery | Sensor battery low. · community label (agrees, unconfirmed): Sensor battery low |
| VA5I | 1.6 | killstreak | Century Deployed. · community label (differs, unconfirmed): Sentry deployed |
| VA5J | 0.8 | killstreak | Century. · community label (differs, unconfirmed): Sentry |
| VA5K | 1.0 | status_shield | Shield equipped. · community label (differs, unconfirmed): Shield equiped |
| VA5L | 0.8 | status_shield | SHIELD · community label (agrees, unconfirmed): Shield |
| VA5M | 0.7 | menu | Short. · community label (agrees, unconfirmed): Short |
| VA5N | 1.0 | game_mode | Siege · community label (differs, unconfirmed): Seige |
| VA5O | 0.9 | menu | Silencer. · community label (agrees, unconfirmed): Silencer |
| VA5P | 1.0 | clock | Six minutes. · community label (differs, unconfirmed): 6 Minutes |
| VA5Q | 1.3 | weapon_name | Slug round. · community label (agrees, unconfirmed): Slug Round |
| VA5R | 1.7 | weapon_name | SMG X3. · community label (agrees, unconfirmed): SMG X3 |
| VA5S | 1.4 | weapon_name | Sniper R50. · community label (agrees, unconfirmed): Sniper R50 |
| VA5T | 1.2 | menu | Speed boost. · community label (agrees, unconfirmed): Speed Boost |
| VA5U | 0.9 | line | Spy. · community label (agrees, unconfirmed): Spy |
| VA5V | 1.6 | menu | Squad leader off. · community label (agrees, unconfirmed): Squad Leader Off |
| VA5W | 1.5 | menu | Squad Leader on! · community label (agrees, unconfirmed): Squad Leader On |
| VA5X | 0.9 | line | Squad leader. · community label (agrees, unconfirmed): Squad Leader |
| VA5Y | 1.3 | weapon_name | SR 100. · community label (differs, unconfirmed): SR100; Sr-100 |
| VA5Z | 1.4 | system | Admin Unlocked. · community label (differs, unconfirmed): Standard; ADMIN UNLOCKED |
| VA6 | 6.0 | grunt | Ah. Ah. Ah. · community label (differs, unconfirmed): ouch heavy breathing; Breathing |
| VA60 | 1.1 | menu | Night Mode. · community label (differs, unconfirmed): Stealth; Stealth outdoor; NIGHT MODE |
| VA61 | 1.2 | clock | Sudden death. · community label (agrees, unconfirmed): Sudden Death |
| VA62 | 1.2 | game_mode | Supremacy! · community label (differs, unconfirmed): Supremecy; Supremacy |
| VA63 | 0.9 | menu | Suppressor · community label (differs, unconfirmed): Supressor |
| VA64 | 1.1 | game_mode | Survival. · community label (agrees, unconfirmed): Survival |
| VA65 | 1.1 | objective_other | Survivor · community label (agrees, unconfirmed): Survivor |
| VA66 | 1.0 | menu | Swap Lift. · community label (agrees, unconfirmed): Swap lift |
| VA67 | 1.0 | weapon_name | Sword · community label (agrees, unconfirmed): Sword |
| VA68 | 1.5 | killstreak | System hack initiated. · community label (agrees, unconfirmed): System Hack Initiated |
| VA69 | 1.0 | killstreak | System hack. · community label (agrees, unconfirmed): System Hack |
| VA6A | 1.4 | weapon_name | TAC 87. · community label (differs, unconfirmed): Tac87; Tac-87 |
| VA6B | 1.3 | weapon_name | TAR 33. · community label (differs, unconfirmed): Tar33 |
| VA6C | 0.8 | weapon_name | Taser · community label (agrees, unconfirmed): Taser |
| VA6D | 1.9 | lead | Your team takes the lead. · community label (agrees, unconfirmed): Your team takes the lead |
| VA6E | 2.7 | lead | Your team has lost the lead. · community label (agrees, unconfirmed): Your team has lost the lead |
| VA6F | 1.0 | menu | Tactical. · community label (agrees, unconfirmed): Team Tactical; TACTICAL |
| VA6G | 1.1 | line | Tier Gas · community label (differs, unconfirmed): Tear Gas |
| VA6H | 1.1 | clock | 10 minutes. · community label (agrees, unconfirmed): 10 Minutes; 10 min |
| VA6I | 1.6 | objective_other | The Hive · community label (agrees, unconfirmed): The Hive |
| VA6J | 1.2 | objective_other | The Swarm. · community label (agrees, unconfirmed): The Swarm |
| VA6K | 1.0 | menu | thick skin. · community label (agrees, unconfirmed): Thick Skin |
| VA6L | 3.0 | countdown | Three, two, one. · community label (differs, unconfirmed): Three, Two, One; 36952.0 |
| VA6M | 0.9 | menu | Toughness. · community label (agrees, unconfirmed): Toughness |
| VA6N | 1.2 | menu | Tracker Rounds · community label (agrees, unconfirmed): Tracker Rounds |
| VA6O | 0.7 | weapon_name | TRIP MINE! · community label (agrees, unconfirmed): Trip mine |
| VA6P | 1.2 | clock | 25 minutes. · community label (agrees, unconfirmed): 25 Minutes |
| VA6Q | 1.0 | clock | 20 minutes. · community label (agrees, unconfirmed): 20 Minutes; 20 min |
| VA6R | 1.8 | killstreak | enemy UAV detected. · community label (agrees, unconfirmed): Enemy UAV detected |
| VA6S | 1.5 | killstreak | incoming UAV. · community label (agrees, unconfirmed): Incoming UAV |
| VA6T | 1.1 | killstreak | UAB · community label (differs, unconfirmed): UAV |
| VA6U | 1.0 | line | Undercover. · community label (differs, unconfirmed): Under Cover |
| VA6V | 1.0 | menu | Unlimited. · community label (agrees, unconfirmed): Unlimited |
| VA6W | 1.1 | menu | Upgrade complete. · community label (agrees, unconfirmed): Upgrade Complete |
| VA6X | 2.0 | status_shield | Shields Depleted · community label (agrees, unconfirmed): Shields Depleted |
| VA6Y | 2.0 | status_shield | Shields Online · community label (agrees, unconfirmed): Shields Online |
| VA6Z | 1.6 | kill_confirm | Kill! · community label (agrees, unconfirmed): Kill |
| VA7 | 2.1 | line | Ugh, that's better. · community label (agrees, unconfirmed): ugh thats better |
| VA70 | 1.0 | menu | Target Mode. · community label (agrees, unconfirmed): Target Mode |
| VA71 | 1.4 | line | Vanguard. · community label (agrees, unconfirmed): Vanguard |
| VA72 | 2.7 | line | The VIT has been killed! · community label (agrees, unconfirmed): The VIP has been killed |
| VA73 | 1.1 | menu | water cooling. · community label (agrees, unconfirmed): Water Cooling |
| VA74 | 1.5 | killstreak | Weapons Box Delivered. · community label (agrees, unconfirmed): Weapons box delivered |
| VA75 | 1.5 | killstreak | weapons box detected. · community label (agrees, unconfirmed): Weapons box detected |
| VA76 | 1.7 | killstreak | Incoming Weapon Box. · community label (agrees, unconfirmed): Incoming weapon box |
| VA77 | 1.1 | killstreak | Weapons Box. · community label (agrees, unconfirmed): Weapons box |
| VA78 | 2.4 | greeting | Welcome to Battle Company! · community label (differs, unconfirmed): Welcome to Lasertag Pro |
| VA79 | 1.9 | line | A flank has been returned. · community label (agrees, unconfirmed): Our flag has been returned |
| VA7A | 3.3 | objective_flag | Our flag has been captured! · community label (agrees, unconfirmed): Our flag has been captured |
| VA7B | 1.8 | objective_flag | Our team has the flag! · community label (agrees, unconfirmed): Our team has the flag |
| VA7C | 2.0 | game_mode | Welcome to Battle 360! · community label (agrees, unconfirmed): Welcome to Battle 360 |
| VA7D | 1.7 | menu | Choose your destiny! · community label (agrees, unconfirmed): Choose your destiny |
| VA7E | 1.8 | medal | Double Kill · community label (agrees, unconfirmed): Double Kill |
| VA7F | 1.9 | medal | FATALITY · community label (agrees, unconfirmed): Fatality |
| VA7G | 1.0 | line | Finish him! · community label (agrees, unconfirmed): Finish Him |
| VA7H | 2.5 | medal | First Blood · community label (agrees, unconfirmed): First Blood |
| VA7I | 1.7 | medal | Flawless victory! · community label (agrees, unconfirmed): Flawless Victory |
| VA7J | 1.9 | kill_confirm | Kill them in Juro! · community label (differs, unconfirmed): Killamanjaro; KILLAMENJARO |
| VA7K | 1.9 | medal | Killing spree · community label (agrees, unconfirmed): Killing Spree |
| VA7L | 1.9 | kill_confirm | Killian Air · community label (differs, unconfirmed): Killionaire |
| VA7M | 1.9 | medal | GO TACULAR! · community label (differs, unconfirmed): Killtacular; KILL TACULAR |
| VA7N | 1.9 | line | Joltastrophe · community label (differs, unconfirmed): Killtastrophy; KILL TASTRIFY |
| VA7O | 1.9 | line | CULTURUSITY · community label (differs, unconfirmed): Killtrosity; KILL TROSITY |
| VA7P | 1.5 | line | Test your might. · community label (agrees, unconfirmed): Test your might |
| VA7Q | 1.9 | medal | Triple Kill! · community label (differs, unconfirmed): Triple Kill; TRIPPLE KILL |
| VA8 | 1.0 | kill_confirm | Kill! · community label (agrees, unconfirmed): Kill |
| VA80 | 3.0 | countdown | Three, two, one. · community label (agrees, unconfirmed): Three, Two, One |
| VA81 | 3.0 | countdown | Three, two, one. · community label (differs, unconfirmed): Three, Two, One; 3, 2, 1, WITH MUSIC |
| VA82 | 3.0 | countdown | Three, two, one. · community label (agrees, unconfirmed): Three, Two, One |
| VA83 | 10.7 | countdown | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. · community label (differs, unconfirmed): Countdown from 10; 10, 9, ..., 0 |
| VA84 | 11.1 | countdown | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. · community label (differs, unconfirmed): Countdown from 10; 10, 9, ... 0 W MUSIC |
| VA85 | 10.0 | countdown | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. · community label (differs, unconfirmed): Countdown from 10; 10, 9, ..., 0 |
| VA86 | 2.0 | status_health | Health Critical. · community label (agrees, unconfirmed): Health Critical |
| VA87 | 2.9 | status_health | health low. · community label (agrees, unconfirmed): Health Low |
| VA88 | 1.1 | status_armor | Armored depleted. · community label (differs, unconfirmed): Armor Depleated |
| VA89 | 1.1 | status_armor | Armor critical. · community label (agrees, unconfirmed): Armor Critical |
| VA8A | 1.1 | status_armor | Armor low. · community label (agrees, unconfirmed): Armor Low |
| VA8B | 1.2 | status_shield | Shields depleted. · community label (agrees, unconfirmed): Shields Depleted |
| VA8C | 1.5 | status_shield | SHIELD ONLINE · community label (differs, unconfirmed): Shields Online |
| VA8D | 2.3 | clock | Overtime · community label (agrees, unconfirmed): Overtime |
| VA8E | 2.1 | kill_confirm | Kill confirmed. · community label (agrees, unconfirmed): Kill Confirmed |
| VA8F | 1.4 | status_health | Shared lives. · community label (differs, unconfirmed): "Assault"; SHARED LIVES |
| VA8G | 1.0 | line | auto detection. · community label (agrees, unconfirmed): "Auto detection" |
| VA8H | 2.0 | system | Battle Company Systems Online. · community label (agrees, unconfirmed): "Battle company systems online" |
| VA8I | 1.2 | game_mode | Battle Lines. · community label (agrees, unconfirmed): "Battle lines" |
| VA8J | 1.6 | game_mode | Battle Royale · community label (agrees, unconfirmed): "Battle Royale"; BATTLE ROYALE |
| VA8K | 1.3 | killstreak | battle strike · community label (agrees, unconfirmed): "Battle Strike" |
| VA8L | 1.1 | game_mode | battle watch. · community label (agrees, unconfirmed): "Battle Watch" |
| VA8M | 1.4 | game_mode | Battle World. · community label (agrees, unconfirmed): "Battle World" |
| VA8N | 1.5 | game_mode | Borderlands · community label (agrees, unconfirmed): "Borderlands" |
| VA8O | 1.2 | grunt | GUN GAME! · community label (differs, unconfirmed): "Brawl"; GUN GAME |
| VA8P | 1.6 | objective_flag | Capture the flag. · community label (agrees, unconfirmed): "Capture the Flag"; CAPTURE THE FLAG |
| VA8Q | 1.3 | system | Connection accepted. · community label (agrees, unconfirmed): "Connection Accepted" |
| VA8R | 1.3 | system | Connection lost. · community label (agrees, unconfirmed): "Connection Lost" |
| VA8S | 1.2 | system | Connection rejected. · community label (agrees, unconfirmed): "Connection rejected" |
| VA8T | 1.2 | system | Debug Mode. · community label (agrees, unconfirmed): "Debug mode"; DEBUG MODE |
| VA8U | 1.2 | system | demo mode. · community label (agrees, unconfirmed): "Demo mode" |
| VA8V | 1.2 | system | pairing cleared · community label (differs, unconfirmed): "Devices cleared"; PAIRING CLEARED |
| VA8W | 1.1 | line | enemy detected. · community label (agrees, unconfirmed): "Enemy detected" |
| VA8X | 0.8 | system | Fail. · community label (agrees, unconfirmed): "Fail" |
| VA8Y | 1.4 | system | Game found. · community label (agrees, unconfirmed): "Game Found" |
| VA8Z | 1.2 | system | HUD Connected. · community label (agrees, unconfirmed): "Hud connected" |
| VA9 | 1.2 | kill_confirm | Kill. · community label (agrees, unconfirmed): Kill |
| VA90 | 1.5 | system | How Disconnected. · community label (differs, unconfirmed): "HUD Disconnected" |
| VA91 | 2.0 | system | incoming HUD connection request. · community label (agrees, unconfirmed): "Incoming HUD Connectino Request" |
| VA92 | 2.1 | system | incoming phone connection request. · community label (agrees, unconfirmed): "Incoming Phone Connection Request" |
| VA93 | 1.2 | objective_hill | King of the hill! · community label (agrees, unconfirmed): "King of the Hill"; KING OF THE HILL |
| VA94 | 1.4 | system | laser calibration. · community label (agrees, unconfirmed): "Laser Calibration" |
| VA95 | 0.8 | system | loading. · community label (agrees, unconfirmed): "Loading" |
| VA96 | 1.3 | line | motion detected. · community label (agrees, unconfirmed): "Motion Detected" |
| VA97 | 1.4 | line | Motion Sensor · community label (agrees, unconfirmed): "Motion Sensor"; MOTION SENSOR |
| VA98 | 0.8 | system | Pass. · community label (agrees, unconfirmed): "Pass" |
| VA99 | 1.1 | system | Phone connected. · community label (agrees, unconfirmed): "Phone Connected"; PHONE CONNECTED |
| VA9A | 1.3 | system | Phone disconnected. · community label (agrees, unconfirmed): "Phone disconnected"; PHONE DISCONNECTED |
| VA9B | 1.9 | menu | Please confirm with the select key. · community label (agrees, unconfirmed): "Please confirm with the select key" |
| VA9C | 1.6 | system | Primary bootloader. · community label (differs, unconfirmed): "Primary boot loader"; PRIMARY BOOT LOADER |
| VA9D | 1.5 | system | primary device. · community label (agrees, unconfirmed): "Primary Device" |
| VA9E | 1.2 | system | Admin locked. · community label (differs, unconfirmed): "Primary"; ADMIN LOCKED |
| VA9F | 1.4 | killstreak | Proximity Mind. · community label (differs, unconfirmed): "Proximity mine" |
| VA9G | 1.0 | line | Replicant. · community label (agrees, unconfirmed): "Replicant" |
| VA9H | 1.5 | line | RESPONSE STATION · community label (differs, unconfirmed): "Respawn Station"; Respawn Station |
| VA9I | 1.5 | system | Scanning for device. · community label (agrees, unconfirmed): "Scanning for Device" |
| VA9J | 0.7 | system | Searching. · community label (agrees, unconfirmed): "Searching" |
| VA9K | 1.9 | system | Secondary bootloader. · community label (differs, unconfirmed): "Secondary Boot Loader"; SECONDARY BOOT LOADER |
| VA9L | 1.7 | system | secondary device. · community label (agrees, unconfirmed): "Secondary Device" |
| VA9M | 1.4 | system | Admin full arc. · community label (differs, unconfirmed): "Secondary"; ADMIN FULL LOCKED |
| VA9N | 1.5 | system | Sensors offline · community label (agrees, unconfirmed): "Sensors Offline" |
| VA9O | 1.3 | line | Silence, they are · community label (differs, unconfirmed): "Silenced AR"; Silenced AR |
| VA9P | 1.4 | game_mode | Survival Games. · community label (agrees, unconfirmed): "Survival Games" |
| VA9Q | 1.2 | line | Testing complete. · community label (agrees, unconfirmed): "Testing Complete"; TESTING COMPLETE |
| VA9R | 1.0 | system | Test mode. · community label (differs, unconfirmed): "Testing initiated"; TEST MODE |
| VA9S | 0.9 | system | Volume. · community label (agrees, unconfirmed): "Volume"; VOLUME |
| VA9T | 1.8 | system | One more weapon ready for duty. · community label (agrees, unconfirmed): "One more weapon ready for duty" |
| VA9U | 2.4 | greeting | Welcome to Battle Company! · community label (agrees, unconfirmed): "Welcome to Battle Company"; WELCOME TO BATTLE COMPANY |

### Announcer (numbers / menu) (133)

| id | s | category | words |
|---|---|---|---|
| VX01 | 0.5 | grunt | ONE. · community label (differs, unconfirmed): 1.0 |
| VX02 | 0.4 | number | too. · community label (differs, unconfirmed): 2.0 |
| VX03 | 0.5 | number | 3 · community label (agrees, unconfirmed): 3.0 |
| VX04 | 0.6 | number | Four. · community label (differs, unconfirmed): 4.0 |
| VX05 | 0.5 | number | 5 · community label (agrees, unconfirmed): 5.0 |
| VX06 | 0.5 | number | 6 · community label (agrees, unconfirmed): 6.0 |
| VX07 | 0.5 | number | 7 · community label (agrees, unconfirmed): 7.0 |
| VX08 | 0.4 | number | 8. · community label (agrees, unconfirmed): 8.0 |
| VX09 | 0.5 | number | 9 · community label (agrees, unconfirmed): 9.0 |
| VX0A | 1.2 | menu | dual wheeled · community label (differs, unconfirmed): DUAL WIELD |
| VX0B | 1.1 | system | Field ID. · community label (agrees, unconfirmed): FIELD ID |
| VX0C | 1.2 | system | Game found. · community label (agrees, unconfirmed): GAME FOUND |
| VX0D | 1.2 | system | Game host. · community label (agrees, unconfirmed): GAME HOST |
| VX0E | 1.0 | system | Game joined! · community label (agrees, unconfirmed): GAME JOINED |
| VX0F | 1.3 | system | Initiating game. · community label (agrees, unconfirmed): INITIATING GAME |
| VX0G | 1.3 | system | No update found. · community label (agrees, unconfirmed): NO UPDATE FOUND |
| VX0H | 1.6 | menu | Select Game Rules. · community label (agrees, unconfirmed): SELECT GAME RULES |
| VX0I | 1.0 | system | Update complete. · community label (agrees, unconfirmed): UPDATE COMPLETE |
| VX0J | 1.1 | system | Update found. · community label (agrees, unconfirmed): UPDATE FOUND |
| VX0K | 0.9 | system | Update Mode. · community label (agrees, unconfirmed): UPDATE MODE |
| VX0L | 1.0 | system | Update started. · community label (agrees, unconfirmed): UPDATE STARTED |
| VX0M | 0.7 | system | version. · community label (agrees, unconfirmed): VERSION |
| VX0N | 1.5 | status_health | lives remaining. · community label (agrees, unconfirmed): LIVES REMAINING |
| VX0O | 1.0 | system | Browse · community label (differs, unconfirmed): BRAWL |
| VX0P | 1.2 | team | Blue Team · community label (agrees, unconfirmed): BLUE TEAM |
| VX0Q | 0.9 | killstreak | Airstrike · community label (differs, unconfirmed): AIR STRIKE |
| VX0R | 1.8 | clock | 10 Seconds Remain. · community label (agrees, unconfirmed): 10 SECONDS REMAIN |
| VX0S | 1.0 | menu | Weapon Swap · community label (agrees, unconfirmed): WEAPON SWAP |
| VX0T | 0.9 | line | depleted · community label (agrees, unconfirmed): DEPLETED |
| VX0U | 1.2 | game_mode | Domination. · community label (agrees, unconfirmed): DOMINATION |
| VX0V | 1.6 | killstreak | EMP Pulse · community label (differs, unconfirmed): EMP PULES |
| VX0W | 0.8 | grunt | Error! · community label (agrees, unconfirmed): ERROR |
| VX0X | 1.6 | medal | first blood. · community label (agrees, unconfirmed): FIRST BLOOD |
| VX0Y | 1.3 | objective_flag | Flag codes! · community label (agrees, unconfirmed): FLAG CODES |
| VX0Z | 1.0 | menu | Focus. · community label (agrees, unconfirmed): FOCUS |
| VX10 | 0.5 | number | 10. · community label (agrees, unconfirmed): 10.0 |
| VX11 | 0.6 | number | 11 · community label (agrees, unconfirmed): 11.0 |
| VX12 | 0.5 | number | well. · community label (differs, unconfirmed): 12.0 |
| VX13 | 0.5 | number | 13. · community label (agrees, unconfirmed): 13.0 |
| VX14 | 0.6 | number | 14 · community label (agrees, unconfirmed): 14.0 |
| VX15 | 0.7 | number | 15 · community label (agrees, unconfirmed): 15.0 |
| VX16 | 0.8 | number | 16 · community label (agrees, unconfirmed): 16.0 |
| VX17 | 0.8 | number | 17 · community label (agrees, unconfirmed): 17.0 |
| VX18 | 0.6 | number | 18 · community label (agrees, unconfirmed): 18.0 |
| VX19 | 0.8 | number | 19 · community label (agrees, unconfirmed): 19.0 |
| VX1A | 0.8 | menu | For grip. · community label (differs, unconfirmed): FOREGRIP |
| VX1B | 0.9 | line | button · community label (agrees, unconfirmed): BUTTON |
| VX1C | 1.2 | killstreak | Share Package! · community label (differs, unconfirmed): CARE PACKAGE |
| VX1D | 0.8 | objective_other | Checkpoint · community label (agrees, unconfirmed): CHECKPOINT |
| VX1E | 2.4 | status_health | Deathmatch. Lives pooled. · community label (agrees, unconfirmed): DEATHMATCH LIVES POOL |
| VX1F | 1.6 | game_mode | Deathmatch timed. · community label (agrees, unconfirmed): DEATHMATCH TIMED |
| VX1G | 1.0 | menu | Defense. · community label (agrees, unconfirmed): DEFENSE |
| VX1H | 1.5 | medal | Killstreak Ready! · community label (differs, unconfirmed): KILL STREAK READY |
| VX20 | 0.5 | number | 20. · community label (agrees, unconfirmed): 20.0 |
| VX21 | 0.7 | number | 21 · community label (agrees, unconfirmed): 21.0 |
| VX22 | 0.7 | number | 22. · community label (agrees, unconfirmed): 22.0 |
| VX23 | 0.7 | number | 23 · community label (agrees, unconfirmed): 23.0 |
| VX24 | 0.8 | number | 24. · community label (agrees, unconfirmed): 24.0 |
| VX25 | 0.7 | number | 25 · community label (agrees, unconfirmed): 25.0 |
| VX26 | 0.7 | number | 26 · community label (agrees, unconfirmed): 26.0 |
| VX27 | 0.7 | number | 27. · community label (agrees, unconfirmed): 27.0 |
| VX28 | 0.6 | number | 28 · community label (agrees, unconfirmed): 28.0 |
| VX29 | 0.7 | number | 29. · community label (agrees, unconfirmed): 29.0 |
| VX30 | 0.6 | number | 30 · community label (agrees, unconfirmed): 30.0 |
| VX31 | 0.7 | number | 31 · community label (agrees, unconfirmed): 31.0 |
| VX32 | 0.7 | number | 32 · community label (agrees, unconfirmed): 32.0 |
| VX33 | 0.7 | number | 33 · community label (agrees, unconfirmed): 33.0 |
| VX34 | 0.7 | number | 34 · community label (agrees, unconfirmed): 34.0 |
| VX35 | 0.6 | number | 35 · community label (agrees, unconfirmed): 35.0 |
| VX36 | 0.7 | number | 36 · community label (agrees, unconfirmed): 36.0 |
| VX37 | 0.7 | number | 37. · community label (agrees, unconfirmed): 37.0 |
| VX38 | 0.6 | number | 38 · community label (agrees, unconfirmed): 38.0 |
| VX39 | 0.7 | number | 39 · community label (agrees, unconfirmed): 39.0 |
| VX40 | 0.4 | number | 40. · community label (agrees, unconfirmed): 40.0 |
| VX41 | 0.7 | number | 41. · community label (agrees, unconfirmed): 41.0 |
| VX42 | 0.6 | number | 42. · community label (agrees, unconfirmed): 42.0 |
| VX43 | 0.7 | number | 43 · community label (agrees, unconfirmed): 43.0 |
| VX44 | 0.7 | number | 44 · community label (agrees, unconfirmed): 44.0 |
| VX45 | 0.6 | number | 45. · community label (agrees, unconfirmed): 45.0 |
| VX46 | 0.7 | number | 46 · community label (agrees, unconfirmed): 46.0 |
| VX47 | 0.6 | number | 47 · community label (agrees, unconfirmed): 47.0 |
| VX48 | 0.6 | number | 48 · community label (agrees, unconfirmed): 48.0 |
| VX49 | 0.7 | number | 49 · community label (agrees, unconfirmed): 49.0 |
| VX50 | 0.5 | number | 50 · community label (agrees, unconfirmed): 50.0 |
| VX51 | 1.3 | system | Standard headset. · community label (agrees, unconfirmed): STANDARD HEADSET |
| VX52 | 1.4 | system | Scoring headset. · community label (agrees, unconfirmed): SCORING HEADSET |
| VX53 | 0.8 | system | Scanning! · community label (agrees, unconfirmed): SCANNING |
| VX54 | 1.8 | menu | Respawn Point Enabled. · community label (agrees, unconfirmed): RESPAWN POINT ENABLED |
| VX55 | 2.0 | menu | Respawn Point Disabled. · community label (agrees, unconfirmed): RESPAWN POINT DISABLED |
| VX56 | 1.7 | menu | Respawn Station. · community label (agrees, unconfirmed): RESPAWN STATION |
| VX57 | 0.8 | menu | Assault! · community label (agrees, unconfirmed): ASSAULT |
| VX58 | 0.8 | weapon_name | FRAG · community label (agrees, unconfirmed): FRAG |
| VX59 | 1.2 | objective_other | Storm Enabled. · community label (agrees, unconfirmed): STORM ENABLED |
| VX60 | 1.0 | menu | Ticket Mode · community label (agrees, unconfirmed): TICKET MODE |
| VX61 | 2.2 | line | The survivors have held their ground. · community label (agrees, unconfirmed): THE SURVIVORS HAVE HELD THEIR GROUND |
| VX62 | 1.6 | objective_other | The infection is spread. · community label (agrees, unconfirmed): THE INFECTION HAS SPREAD |
| VX63 | 0.5 | menu | Tank! · community label (agrees, unconfirmed): TANK |
| VX64 | 0.9 | menu | SUPPORT! · community label (agrees, unconfirmed): SUPPORT |
| VX65 | 1.5 | system | Stress Test Mode. · community label (agrees, unconfirmed): STRESS TEST MODE |
| VX66 | 1.5 | objective_other | Storm Disabled. · community label (agrees, unconfirmed): STORM DISABLED |
| VX67 | 1.0 | menu | Stimpak! · community label (differs, unconfirmed): STEM PACK |
| VX68 | 1.8 | menu | Sticky Grenade Launcher · community label (agrees, unconfirmed): STICKY GRENADE LAUNCHER |
| VX69 | 1.3 | status_shield | SHIELD PULSE · community label (agrees, unconfirmed): SHIELD PULSE |
| VX70 | 0.9 | line | SAFE · community label (agrees, unconfirmed): SAFE |
| VX71 | 1.7 | line | Revive at Squad Leader. · community label (agrees, unconfirmed): REVIVE AT SQUAD |
| VX72 | 1.7 | menu | Revive at Respawn Point. · community label (agrees, unconfirmed): REVIVE AT RESPAWN |
| VX73 | 1.0 | menu | Reload · community label (agrees, unconfirmed): RELOAD |
| VX74 | 1.7 | menu | READ GENERATION ROUNDS · community label (differs, unconfirmed): REGENERATION ROUNDS |
| VX75 | 1.1 | team | Red Team. · community label (agrees, unconfirmed): RED TEAM |
| VX76 | 0.9 | menu | random · community label (agrees, unconfirmed): RANDOM |
| VX77 | 0.9 | menu | Rally · community label (agrees, unconfirmed): RALLY |
| VX78 | 1.4 | killstreak | Proximity Mine. · community label (agrees, unconfirmed): PROXIMITY MINE |
| VX79 | 1.3 | menu | Poison Grenades · community label (agrees, unconfirmed): POISON GRENADES |
| VX80 | 0.9 | menu | Offense. · community label (agrees, unconfirmed): OFFENSE |
| VX81 | 1.3 | line | Motion detected. · community label (agrees, unconfirmed): MOTION DETECTED |
| VX82 | 1.0 | killstreak | Mortar Strike. · community label (agrees, unconfirmed): MORTAR STRIKE |
| VX83 | 1.2 | killstreak | Many Rockets! · community label (differs, unconfirmed): MINI ROCKETS |
| VX84 | 1.2 | menu | melee attack · community label (agrees, unconfirmed): MELEE ATTACK |
| VX85 | 1.1 | menu | Medigel. · community label (agrees, unconfirmed): MEDIGEL |
| VX86 | 1.2 | medal | Lucky shot! · community label (agrees, unconfirmed): LUCKY SHOT |
| VX87 | 0.9 | system | Loading. · community label (agrees, unconfirmed): LOADING |
| VX88 | 1.2 | menu | Lifesteal · community label (differs, unconfirmed): LIFE STEAL |
| VX89 | 1.6 | medal | Killstrike ready! · community label (differs, unconfirmed): KILL STRIKE READY |
| VX90 | 1.0 | menu | Kids Mode · community label (agrees, unconfirmed): KIDS MODE |
| VX91 | 1.7 | menu | Hold Trigger to Charge. · community label (agrees, unconfirmed): HOLD TRIGGER TO CHARGE |
| VX92 | 2.2 | menu | Hold Reload to fully reload. · community label (agrees, unconfirmed): HOLD RELOAD TO FULLY RELOAD |
| VX93 | 1.3 | greeting | Hello Kitty! · community label (agrees, unconfirmed): HELLO KITTY |
| VX94 | 1.3 | menu | Healing Tracker Dart. · community label (agrees, unconfirmed): HEALING TRACKER DART |
| VX95 | 1.6 | system | Grenade Disconnected. · community label (agrees, unconfirmed): GRENADE DISCONNECTED |
| VX96 | 1.3 | system | Grenade connected. · community label (agrees, unconfirmed): GRENADE CONNECTED |
| VX97 | 1.4 | team | Green Team. · community label (agrees, unconfirmed): GREEN TEAM |
| VX98 | 0.9 | system | Gesture! · community label (agrees, unconfirmed): GESTURE |
| VX99 | 1.4 | menu | Frost Grenades. · community label (agrees, unconfirmed): FROST GRENADES |

### Announcer (upgrades) (66)

| id | s | category | words |
|---|---|---|---|
| VZ01 | 1.9 | weapon_name | two-shot sniper rifle. · community label (agrees, unconfirmed): TWO SHOT SNIPER RIFLE |
| VZ02 | 1.8 | weapon_name | Two Shot Steam Rifle · community label (agrees, unconfirmed): TWO SHOT STEAM RIFLE |
| VZ03 | 1.3 | weapon_name | 8-Bit Rifle · community label (agrees, unconfirmed): 8 BIT RIFLE |
| VZ04 | 2.3 | weapon_name | Armor Piercing Sniper Rifle · community label (agrees, unconfirmed): ARMOR PIERCING SNIPER RIFLE |
| VZ05 | 1.8 | menu | Automatic Assault Rifle · community label (agrees, unconfirmed): AUTOMATIC ASSAULT RIFLE |
| VZ06 | 1.8 | weapon_name | Automatic Shotgun · community label (agrees, unconfirmed): AUTOMATIC SHOTGUN |
| VZ07 | 2.6 | weapon_name | BFG 9000 Charge Gun · community label (agrees, unconfirmed): BFG 9000 CHARGE RIFLE |
| VZ08 | 1.6 | menu | Burst Assault Rifle. · community label (agrees, unconfirmed): BURST ASSAULT RIFLE |
| VZ09 | 2.0 | weapon_name | Burst Submachine Gun · community label (agrees, unconfirmed): BURST SUB MACHINE GUN |
| VZ0A | 2.4 | menu | Burst Sticky Grenade Launcher · community label (agrees, unconfirmed): BURST STICKY GRENADE LAUNCHER |
| VZ0B | 1.8 | weapon_name | Charge Pulse Rifle. · community label (agrees, unconfirmed): CHARGE PULSE RIFLE |
| VZ0C | 1.5 | menu | Choose and upgrade. · community label (agrees, unconfirmed): CHOOSE AN UPGRADE |
| VZ0D | 1.2 | weapon_name | Crossbow! · community label (differs, unconfirmed): CROSS BOW |
| VZ0E | 0.8 | menu | Damage! · community label (agrees, unconfirmed): DAMAGE |
| VZ0F | 2.1 | weapon_name | Double Barrel Shotgun. · community label (agrees, unconfirmed): DOUBLE BARREL SHOT GUN |
| VZ0G | 1.8 | line | DROID AUTOBLASTER · community label (differs, unconfirmed): DROID AUTO BLASTER |
| VZ0H | 1.9 | menu | Energy Assault Rifle · community label (agrees, unconfirmed): ENERGY ASSAULT RIFLE |
| VZ0I | 2.0 | weapon_name | Energy Automatic Rifle · community label (agrees, unconfirmed): ENERGY AUTOMATIC RIFLE |
| VZ0J | 1.8 | weapon_name | Energy Burst Rifle. · community label (agrees, unconfirmed): ENERGY BURST RIFLE |
| VZ0K | 2.2 | weapon_name | Energy Charge Sniper Rifle. · community label (agrees, unconfirmed): ENERGY CHARGED SNIPER RIFLE |
| VZ0L | 1.9 | weapon_name | Energy Guttling Gun. · community label (agrees, unconfirmed): ENERGY GATLING GUN |
| VZ0M | 1.5 | weapon_name | energy laser. · community label (agrees, unconfirmed): ENERGY LASER |
| VZ0N | 1.6 | weapon_name | Energy Shotgun. · community label (differs, unconfirmed): ENERGY SHOT GUN |
| VZ0O | 1.8 | weapon_name | Energy Sniper Rifle. · community label (agrees, unconfirmed): ENERGY SNIPER RIFLE |
| VZ0P | 0.9 | menu | Finesse. · community label (agrees, unconfirmed): FINESS |
| VZ0Q | 1.5 | weapon_name | Flamethrower · community label (differs, unconfirmed): FLAME THROWER |
| VZ0R | 1.7 | menu | Frost Burst Rifle · community label (agrees, unconfirmed): FROST BURST RIFLE |
| VZ0S | 1.4 | menu | Frost laser. · community label (agrees, unconfirmed): FROST LASER |
| VZ0T | 2.4 | menu | Frost Semi-Automatic Rifle · community label (agrees, unconfirmed): FROST SEMI-AUTOMATIC RIFLE |
| VZ0U | 1.2 | weapon_name | Gatling gun! · community label (differs, unconfirmed): GATTLING GUN |
| VZ0V | 1.5 | weapon_name | Heavy Machine Gun. · community label (agrees, unconfirmed): HEAVY MACHINE GUN |
| VZ0W | 1.6 | weapon_name | Incendiary Rifle · community label (differs, unconfirmed): INCINDIARY RIFLE |
| VZ0X | 1.9 | objective_other | Infected spray attack. · community label (agrees, unconfirmed): INFECTED SPRAY ATTACK |
| VZ0Y | 2.1 | weapon_name | M4 Automatic Rifle · community label (agrees, unconfirmed): M4 AUTOMATIC RIFLE |
| VZ0Z | 2.1 | weapon_name | Magnet Semi-Auto Rifle · community label (agrees, unconfirmed): MAGNET SEMI-AUTO RIFLE |
| VZ10 | 1.7 | weapon_name | Mini Rocket Launcher · community label (agrees, unconfirmed): MINI ROCKET LAUNCHER |
| VZ11 | 1.6 | weapon_name | Newbie Cannon! · community label (agrees, unconfirmed): NEWBIE CANNON |
| VZ12 | 0.7 | menu | off. · community label (agrees, unconfirmed): OFF |
| VZ13 | 0.7 | grunt | on. · community label (agrees, unconfirmed): ON |
| VZ14 | 1.7 | menu | Poison Burst Rifle · community label (agrees, unconfirmed): POISON BURST RIFLE |
| VZ15 | 1.8 | menu | Poison Gas Launcher · community label (agrees, unconfirmed): POISON GAS LAUNCHER |
| VZ16 | 1.8 | menu | Poison submachine gun. · community label (agrees, unconfirmed): POISON SUB MACHINE GUN |
| VZ17 | 1.8 | objective_other | Randomize Infection. · community label (agrees, unconfirmed): RANDOMIZE INFECTION |
| VZ18 | 1.1 | menu | RANK 1 · community label (agrees, unconfirmed): RANK 1 |
| VZ19 | 1.1 | menu | RANK 2 · community label (agrees, unconfirmed): RANK 2 |
| VZ1A | 1.3 | menu | Rank 3! · community label (agrees, unconfirmed): RANK 3 |
| VZ1B | 2.1 | weapon_name | Rapid Fire Sniper Rifle · community label (agrees, unconfirmed): RAPID FIRE SNIPER RIFLE |
| VZ1C | 1.0 | menu | Recovery! · community label (agrees, unconfirmed): RECOVERY |
| VZ1D | 2.1 | menu | Semi-auto Assault Rifle · community label (agrees, unconfirmed): SEMI-AUTO ASSAULT RIFLE |
| VZ1E | 2.1 | weapon_name | Semi Auto Sniper Rifle · community label (agrees, unconfirmed): SEMI-AUTO SNIPER RIFLE |
| VZ1F | 1.2 | weapon_name | Shotgun! · community label (agrees, unconfirmed): SHOTGUN |
| VZ1G | 2.1 | weapon_name | silenced submachine gun. · community label (agrees, unconfirmed): SILENCED SUB MACHINE GUN |
| VZ1H | 1.9 | weapon_name | Silence Sniper Rifle · community label (agrees, unconfirmed): SILENCED SNIPER RIFLE |
| VZ1I | 1.5 | weapon_name | Submachine gun. · community label (differs, unconfirmed): SUB MACHINE GUN |
| VZ1J | 1.3 | weapon_name | Sniper Rifle · community label (agrees, unconfirmed): SNIPER RIFLE |
| VZ1K | 1.3 | menu | Specialists · community label (agrees, unconfirmed): SPECIALIST |
| VZ1L | 0.9 | menu | speed · community label (agrees, unconfirmed): SPEED |
| VZ1M | 1.0 | menu | Stealth · community label (agrees, unconfirmed): STEALTH |
| VZ1N | 2.2 | weapon_name | Steambolt submachine gun. · community label (differs, unconfirmed): STEAM BOLT SUB MACHINE GUN |
| VZ1O | 1.7 | weapon_name | Stormtrooper Rifle · community label (differs, unconfirmed): STORM TROOPER RIFLE |
| VZ1P | 2.4 | weapon_name | Sustain Fire Submachine Gun. · community label (differs, unconfirmed): SUSTAINED FIRE SUB MACHINE GUN |
| VZ1Q | 1.3 | weapon_name | Taser Rifle · community label (differs, unconfirmed): TAISER RIFLE |
| VZ1R | 2.0 | weapon_name | Thumper submachine gun. · community label (agrees, unconfirmed): THUMPER SUB MACHINE GUN |
| VZ1S | 0.9 | menu | Toughness · community label (agrees, unconfirmed): TOUGHNESS |
| VZ1T | 1.8 | menu | Upgrade available! · community label (agrees, unconfirmed): UPGRADE AVAILABLE |
| VZ1U | 1.0 | menu | Upgrade mode. · community label (agrees, unconfirmed): UPGRADE MODE |

### Creature (25)

| id | s | category | words |
|---|---|---|---|
| V51 | 1.6 | intro | HMMMMMMMMMMMMMMMMMMM · community label (differs, unconfirmed): RWAR? So much audio bad |
| V52 | 6.0 | idle_loop | The End · community label (differs, unconfirmed): infected struggling; Zombie/Beast noises |
| V53 | 3.5 | death_scream | R-r-r-rrrrrrrr · community label (differs, unconfirmed): Zombie/Beast noises |
| V54 | 3.0 | death_scream | HELLO! · community label (differs, unconfirmed): Zombie/Beast noises |
| V55 | 3.3 | death_scream | HELLO! · community label (differs, unconfirmed): Zombie/Beast noises |
| V56 | 6.2 | line | A bug! A bug! A bug... · community label (differs, unconfirmed): infected russling around and grunting; Zombie/Beast noises |
| V57 | 2.1 | healed | GRR! · community label (differs, unconfirmed): Zombie/Beast noises |
| V58 | 1.8 | kill_confirm | THANKS FOR WATCHING! · community label (differs, unconfirmed): Zombie/Beast noises |
| V59 | 1.7 | kill_confirm | THANKS FOR WATCHING!! · community label (differs, unconfirmed): Zombie/Beast noises |
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
| VM2 | 6.0 | line | IT'S HOTTEN TO BE THE GUN · community label (differs, unconfirmed): female coughing |
| VM3 | 1.5 | death_scream | AHHHHHHHHH |
| VM4 | 1.4 | death_scream | AHHHHHH! |
| VM5 | 2.0 | death_scream | AHHHHHHHHH |
| VM6 | 6.0 | hurt_loop |  · community label (differs, unconfirmed): guy catching breath |
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
| V02 | 6.0 | idle_loop | Ah! Ah! Ah! Ah! Ah! · community label (differs, unconfirmed): Vanguard gassed |
| V03 | 1.6 | death_scream | UGH! |
| V04 | 2.1 | death_scream | AHHHHHHHHH |
| V05 | 1.8 | death_scream | UGH! |
| V06 | 6.0 | hurt_loop |  · community label (differs, unconfirmed): Man recovering |
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
| V11 | 1.6 | intro | Power Surge. · community label (agrees, unconfirmed): Power surge |
| V12 | 6.0 | idle_loop |  · community label (differs, unconfirmed): Nexus gassed; Vanguard pain? |
| V13 | 2.3 | death_scream | AHHHHHHHHHH · community label (differs, unconfirmed): more |
| V14 | 2.1 | death_scream | AHHHHHHHHH · community label (differs, unconfirmed): again |
| V15 | 1.9 | death_scream | HELLO! · community label (differs, unconfirmed): still pain |
| V16 | 6.1 | hurt_loop |  · community label (differs, unconfirmed): infected grunting and breathing; again, maybe recovery |
| V17 | 1.4 | healed | systems repaired. · community label (agrees, unconfirmed): Systems repaired |
| V18 | 1.0 | kill_confirm | Get ready! |
| V19 | 1.2 | kill_confirm | terminated · community label (agrees, unconfirmed): Terminated |
| V1A | 0.9 | kill_confirm | Germany did · community label (differs, unconfirmed): Terminated |
| V1B | 2.2 | defeat_taunt | This cannot be. · community label (agrees, unconfirmed): This can not be |
| V1C | 0.6 | pain | Mm-hmm · community label (differs, unconfirmed): Hurt |
| V1D | 0.6 | pain | NGH! · community label (differs, unconfirmed): hurt again |
| V1E | 1.1 | pain | Oh · community label (differs, unconfirmed): more hurt |
| V1F | 0.8 | pain |  · community label (differs, unconfirmed): Again |
| V1G | 0.4 | pain | Oh · community label (differs, unconfirmed): still hurt |
| V1H | 0.4 | pain | MWAH! · community label (differs, unconfirmed): more |
| V1I | 2.5 | boast | Obliteration awaits. · community label (agrees, unconfirmed): Obliteration Awaits |
| V1J | 6.0 | long_death |  · community label (differs, unconfirmed): vanguard electruction? |
| V1K | 2.1 | taunt | You will break. · community label (agrees, unconfirmed): You will break |
| V1L | 2.5 | taunt | Their will is broken. · community label (agrees, unconfirmed): Their will is broken |
| V1M | 1.1 | name | Grenadier · community label (agrees, unconfirmed): Grenadier |

### Guardian (22)

| id | s | category | words |
|---|---|---|---|
| V21 | 1.6 | intro | Shields over a mile mean. · community label (differs, unconfirmed): Shields Overwhelming |
| V22 | 6.1 | idle_loop |  · community label (differs, unconfirmed): vanguard coughing |
| V23 | 2.7 | death_scream | AHHHHHHHHHHHHHHHHH |
| V24 | 2.5 | death_scream | AHHHHHH!! |
| V25 | 2.4 | death_scream | AHHHHHHHHH |
| V26 | 6.1 | hurt_loop | Oh · community label (differs, unconfirmed): more infected breathing |
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
| V2K | 4.0 | taunt | Ha ha ha ha, nexus shield, never fail. · community label (agrees, unconfirmed): Nexus Shield never fails |
| V2L | 3.0 | taunt | My shields are unstoppable. Ha ha ha! |
| V2M | 0.8 | name | Guardian · community label (agrees, unconfirmed): Guardian |

### Heavy (22)

| id | s | category | words |
|---|---|---|---|
| V31 | 1.3 | intro | Charge! · community label (agrees, unconfirmed): Charge |
| V32 | 6.0 | idle_loop | Oh |
| V33 | 2.2 | death_scream | AHHHHHHHHH |
| V34 | 2.4 | death_scream | AHHHHHHHHHH |
| V35 | 2.7 | death_scream | AHHHHHHHHH! |
| V36 | 6.0 | hurt_loop | Hmm. Hmm. Hmm. · community label (differs, unconfirmed): Recovery |
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
| V3M | 0.8 | name | heavy · community label (agrees, unconfirmed): Heavy |

### Hive Queen (32)

| id | s | category | words |
|---|---|---|---|
| V41 | 1.1 | intro | BLOOD! · community label (agrees, unconfirmed): Blood |
| V42 | 6.0 | idle_loop |  |
| V43 | 2.2 | death_scream | AHHHHHHHHH |
| V44 | 1.9 | death_scream | AHHHHHHHHH! |
| V45 | 2.4 | death_scream | AHHHHHHHHH |
| V46 | 6.0 | hurt_loop | Uhhh! Uhhhh! Uhhhh! · community label (differs, unconfirmed): animal recovering |
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
| V4M | 1.9 | name | The Hive Queen · community label (agrees, unconfirmed): Hive Queen |
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
| V61 | 1.3 | intro | FIRGE! · community label (differs, unconfirmed): Surge |
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
| V6J | 6.0 | long_death |  · community label (differs, unconfirmed): infected getting electricuted |
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
| VPJ | 6.0 | long_death | Uuughhhhhh! · community label (differs, unconfirmed): man being electricuted |
| VPK | 1.3 | taunt | Watch and learn. |
| VPL | 1.0 | taunt | Who's next? |

### Male player (18)

| id | s | category | words |
|---|---|---|---|
| VAA | 0.6 | kill_confirm | Kill. · community label (agrees, unconfirmed): Kill |
| VAB | 1.5 | defeat_taunt | Everybody dies. · community label (agrees, unconfirmed): Everybody Dies |
| VAC | 0.8 | pain | HAH! · community label (differs, unconfirmed): Another yell |
| VAD | 0.6 | pain | HOO! · community label (agrees, unconfirmed): HOOO |
| VAE | 1.2 | pain | AHHHHH! · community label (differs, unconfirmed): Cough pain |
| VAF | 1.2 | pain | Aargh! · community label (differs, unconfirmed): more pain |
| VAG | 0.6 | pain | Huh! · community label (differs, unconfirmed): more hurt |
| VAH | 0.4 | pain | HUH! · community label (differs, unconfirmed): another hurt |
| VAI | 1.8 | boast | There's nowhere for you to hide. · community label (agrees, unconfirmed): Theres nowhere for you to hide |
| VAJ | 6.0 | long_death | NONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONON... · community label (differs, unconfirmed): Ummmmm electruction? |
| VAK | 0.7 | taunt | Take that! · community label (agrees, unconfirmed): Take That |
| VAL | 1.4 | taunt | No mercy. · community label (agrees, unconfirmed): No Mercy |
| VAM | 0.7 | name | Reaper · community label (agrees, unconfirmed): Reaper |
| VAN | 0.8 | line | Hoorah! · community label (differs, unconfirmed): HuRah |
| VAO | 0.8 | line | Good to go. · community label (agrees, unconfirmed): Good to Go |
| VAP | 1.2 | objective_other | Let's head back to base. · community label (agrees, unconfirmed): Lets head back to base |
| VAQ | 1.0 | line | Let's move out. · community label (agrees, unconfirmed): Lets move out |
| VAR | 1.1 | team | Good job, team. · community label (agrees, unconfirmed): Good job team |

### Marauder (22)

| id | s | category | words |
|---|---|---|---|
| V71 | 2.1 | intro | Ultra charged! · community label (agrees, unconfirmed): Ultra Charged? |
| V72 | 6.0 | idle_loop | The poor. · community label (differs, unconfirmed): Nexus being gassed; Cough |
| V73 | 1.5 | death_scream | Arrrrggggggghhh! · community label (differs, unconfirmed): pain |
| V74 | 2.6 | death_scream | OWWWWWWWW · community label (differs, unconfirmed): yell |
| V75 | 2.3 | death_scream |  · community label (differs, unconfirmed): more yell |
| V76 | 6.0 | hurt_loop |  · community label (differs, unconfirmed): Infected struggling; recovery |
| V77 | 0.9 | healed | Top · community label (differs, unconfirmed): Amped up |
| V78 | 1.4 | kill_confirm | ROAR! · community label (agrees, unconfirmed): Roared? |
| V79 | 1.2 | kill_confirm | BYE! · community label (differs, unconfirmed): Forward |
| V7A | 1.3 | kill_confirm | BYE! |
| V7B | 1.9 | defeat_taunt | Not enough power! |
| V7C | 1.2 | pain | Yeah! |
| V7D | 1.1 | pain | Rrroar! |
| V7E | 1.2 | pain | Oh |
| V7F | 1.4 | pain |  |
| V7G | 0.6 | pain | Aargh! |
| V7H | 0.7 | pain | BOOM! |
| V7I | 1.9 | boast | We're charged and ready! |
| V7J | 7.0 | line | NoooooooooOOOOoooooOoOoOooOoOoOд Woooohoooo www. Level 4 W O W · community label (differs, unconfirmed): ticked of infected |
| V7K | 2.4 | taunt | I have the power! |
| V7L | 2.7 | taunt | Now you know my power! |
| V7M | 1.3 | name | the hotter. · community label (differs, unconfirmed): Maurader |

### Medic (34)

| id | s | category | words |
|---|---|---|---|
| V81 | 0.8 | intro | Med's here. · community label (differs, unconfirmed): Meds Here |
| V82 | 6.0 | idle_loop | Ahem. Ahem. · community label (differs, unconfirmed): cough |
| V83 | 0.9 | death_scream | Ah! · community label (differs, unconfirmed): pain |
| V84 | 1.2 | death_scream | AHHHHH! · community label (differs, unconfirmed): yell |
| V85 | 1.1 | death_scream | AHHHHHH! · community label (differs, unconfirmed): more yell |
| V86 | 6.0 | hurt_loop | HMM! HMM! HMM! HMM! · community label (differs, unconfirmed): Female catching breath; Recovery? |
| V87 | 1.0 | healed | Bleeding stopped. · community label (agrees, unconfirmed): Bleeding Stopped |
| V88 | 1.1 | kill_confirm | Sterilized. · community label (differs, unconfirmed): Steralized |
| V89 | 1.2 | kill_confirm | sterilized. · community label (differs, unconfirmed): Steralized |
| V8A | 1.1 | kill_confirm | sterilized. |
| V8B | 1.4 | defeat_taunt | Medavek, on route. |
| V8C | 0.5 | pain | Huh! |
| V8D | 0.8 | pain | Oh |
| V8E | 1.0 | pain | Oh |
| V8F | 1.6 | pain | Oh |
| V8G | 0.5 | pain | Ahem. |
| V8H | 0.6 | pain | Oh |
| V8I | 1.1 | boast | The doctor is in. |
| V8J | 6.1 | line | Mmm, mmm, mmm, mmm握握,丨握握握 grams I'm out! · community label (differs, unconfirmed): being electricuted |
| V8K | 1.4 | taunt | Need a bandage for that? |
| V8L | 2.1 | taunt | I love the smell of metagel. |
| V8M | 0.6 | name | Medic. · community label (agrees, unconfirmed): Medic |
| V8N | 1.0 | line | Target locked. |
| V8O | 0.7 | line | patched up |
| V8P | 1.0 | kill_confirm | Kill confirmed. |
| V8Q | 1.2 | kill_confirm | Kill Confirmed |
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
| VN1 | 0.9 | intro | Target locked. · community label (agrees, unconfirmed): Target Locked |
| VN2 | 6.0 | idle_loop | Ah! Ah! Ah! Ah! Ah! Ah! · community label (differs, unconfirmed): Ouch and lots of coughing; man gassed |
| VN3 | 1.6 | death_scream | UGH! · community label (differs, unconfirmed): argh |
| VN4 | 2.1 | death_scream | DAAAAAAA · community label (differs, unconfirmed): Scream |
| VN5 | 1.8 | death_scream | URGH! · community label (differs, unconfirmed): hurt |
| VN6 | 6.0 | hurt_loop |  · community label (differs, unconfirmed): deep breaths; Man recovering |
| VN7 | 0.8 | healed | Restocked. · community label (agrees, unconfirmed): Restocked |
| VN8 | 1.0 | kill_confirm | Co-confirmed · community label (differs, unconfirmed): Kill Confirmed |
| VN9 | 1.2 | kill_confirm | Kill confirmed. · community label (agrees, unconfirmed): Kill Confirmed |
| VNA | 1.0 | kill_confirm | Kill confirmed. · community label (agrees, unconfirmed): Kill Confirmed |
| VNB | 1.4 | defeat_taunt | the target is lost. · community label (agrees, unconfirmed): The target is lost |
| VNC | 0.4 | pain | HA! · community label (agrees, unconfirmed): HA |
| VND | 0.3 | pain | Ha! · community label (differs, unconfirmed): HU |
| VNE | 0.8 | pain | UGH! · community label (differs, unconfirmed): AHH |
| VNF | 1.1 | pain | Oh · community label (differs, unconfirmed): another hurt |
| VNG | 0.4 | pain | Huh! · community label (differs, unconfirmed): more hurt |
| VNH | 0.4 | pain | UGH! · community label (differs, unconfirmed): hurt again |
| VNI | 2.1 | boast | The battle begins. · community label (agrees, unconfirmed): The Battle Begins |
| VNJ | 6.0 | long_death | HUUUUUUUUUUUUUUUUUUUUUUUUUUUUU UGH UGH · community label (differs, unconfirmed): UMMM long hurt; guy pushing out a poop |
| VNK | 1.1 | taunt | Bullseye! · community label (agrees, unconfirmed): Bullseye |
| VNL | 1.9 | taunt | No one will stand in my way. · community label (agrees, unconfirmed): No one will stand in my way |
| VNM | 1.1 | name | Mercenary · community label (agrees, unconfirmed): Mercenary |

### Nexus commander (19)

| id | s | category | words |
|---|---|---|---|
| VQ1 | 1.4 | line | Commander! · community label (agrees, unconfirmed): Nexus Commander |
| VQ2 | 1.3 | unknown |  |
| VQ3 | 2.2 | objective_codes | And the codes have been captured! |
| VQ4 | 2.5 | line | and go to the worst. |
| VQ5 | 2.5 | objective_codes | Everything has our codes. |
| VQ6 | 2.3 | game_over | Game Over! |
| VQ7 | 1.0 | line | NEXUS · community label (agrees, unconfirmed): NEXUS |
| VQ8 | 1.8 | game_over | Objective complete! |
| VQ9 | 1.1 | menu | random |
| VQA | 2.6 | clock | Sixty seconds remaining. |
| VQB | 10.9 | countdown | Ten, nine, eight, seven, six, five, four, three, two, one. · community label (differs, unconfirmed): infected 10 second count down |
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
| V91 | 1.0 | intro | Turn up the heat! · community label (agrees, unconfirmed): Turn up the heat |
| V92 | 6.1 | idle_loop | Cough. · community label (agrees, unconfirmed): male coughing; cough |
| V93 | 1.4 | death_scream | Agh! · community label (differs, unconfirmed): pain |
| V94 | 1.5 | death_scream | Uggggggggggggggggggggggg · community label (differs, unconfirmed): Pain |
| V95 | 1.4 | death_scream | URGH! · community label (differs, unconfirmed): Pain |
| V96 | 6.0 | hurt_loop | Ah · community label (differs, unconfirmed): Animal recovering; Recovery? |
| V97 | 1.4 | healed | REFUELED! · community label (agrees, unconfirmed): Refueled |
| V98 | 1.1 | kill_confirm | Toasted! · community label (agrees, unconfirmed): Toasted |
| V99 | 1.2 | kill_confirm | Coasted! · community label (differs, unconfirmed): Toasted |
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
| VS1 | 1.0 | line | Commander! · community label (agrees, unconfirmed): Resistance Commander; Commander |
| VS2 | 1.7 | game_over | DEFEAT! · community label (agrees, unconfirmed): Defeat |
| VS3 | 2.5 | objective_codes | Enemy codes have been lost. · community label (agrees, unconfirmed): Enemy Codes have been lost |
| VS4 | 2.2 | objective_codes | Enemy codes have been captured. · community label (agrees, unconfirmed): Enemy Code have been captured |
| VS5 | 1.9 | objective_codes | Enemy team has our codes. · community label (agrees, unconfirmed): Enemy team has our codes |
| VS6 | 2.4 | game_over | Game over. · community label (agrees, unconfirmed): Game Over |
| VS7 | 1.3 | game_over | Objective Complete! · community label (agrees, unconfirmed): Objective Complete |
| VS8 | 0.8 | menu | random. · community label (agrees, unconfirmed): Random |
| VS9 | 1.2 | line | The resistance. · community label (agrees, unconfirmed): Resistance; The Resistance |
| VSA | 1.8 | clock | 60 seconds remain. · community label (agrees, unconfirmed): 60 seconds remaining; 60 SECONDS REMAIN |
| VSB | 10.5 | countdown | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. · community label (differs, unconfirmed): ten second count down; Countdown from 10; 10-0 COUNT DOWN W MUSIC |
| VSC | 1.8 | clock | 30 seconds remain. · community label (agrees, unconfirmed): 30 seconds remaining; 30 SECONDS REMAIN |
| VSD | 1.6 | clock | Two minutes remain. · community label (differs, unconfirmed): 2 minutes remaining; 2 MINUTES REMAIN |
| VSE | 1.8 | menu | Upgrade available. · community label (agrees, unconfirmed): Upgrade available |
| VSF | 1.9 | game_over | Victory! · community label (agrees, unconfirmed): Victory |
| VSG | 3.3 | objective_codes | Our codes have been captured. · community label (agrees, unconfirmed): Our code have been captured |
| VSH | 1.8 | objective_codes | Our team has the codes. · community label (agrees, unconfirmed): OUr team has the codes |
| VSI | 1.9 | objective_codes | Our codes have been returned. · community label (agrees, unconfirmed): Our code have been returned |

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
| VB1 | 1.4 | intro | Go, go, go! · community label (agrees, unconfirmed): go go go |
| VB2 | 6.0 | idle_loop |  · community label (differs, unconfirmed): coughing; Female gassed |
| VB3 | 2.7 | death_scream | Ah! Ah! Ah! · community label (differs, unconfirmed): hurt |
| VB4 | 1.7 | death_scream | AHHHHH! · community label (differs, unconfirmed): yell |
| VB5 | 1.7 | death_scream | Uuugh! · community label (differs, unconfirmed): more hurt |
| VB6 | 6.0 | hurt_loop | Ah · community label (differs, unconfirmed): heavy breathing; female recovering |
| VB7 | 1.0 | healed | All set! · community label (agrees, unconfirmed): All Set |
| VB8 | 1.0 | kill_confirm | Target down. · community label (agrees, unconfirmed): Target Down |
| VB9 | 1.2 | kill_confirm | Target down. · community label (agrees, unconfirmed): Target Down |
| VBA | 0.9 | kill_confirm | Target down. · community label (agrees, unconfirmed): Target Down |
| VBB | 1.6 | defeat_taunt | Gotta lose some time. · community label (agrees, unconfirmed): Gotta lose sometime |
| VBC | 0.7 | pain | HUH! · community label (differs, unconfirmed): yell |
| VBD | 0.7 | pain | HUH · community label (differs, unconfirmed): yell |
| VBE | 1.3 | pain | Uwaaah! · community label (differs, unconfirmed): hurt |
| VBF | 1.0 | pain | UGH! · community label (differs, unconfirmed): more hurt |
| VBG | 0.6 | pain | Ugh! · community label (differs, unconfirmed): hurt agin |
| VBH | 0.4 | pain | Uh! · community label (differs, unconfirmed): ouch |
| VBI | 1.2 | boast | Let's move! · community label (differs, unconfirmed): Lets Move |
| VBJ | 5.9 | long_death | Wheeeeeelllllllllllllll · community label (differs, unconfirmed): uh electrocution? |
| VBK | 1.6 | taunt | Dead man walking. · community label (agrees, unconfirmed): Dead man walking |
| VBL | 1.7 | taunt | too easy · community label (differs, unconfirmed): Hmf to easy |
| VBM | 1.0 | name | Scout · community label (differs, unconfirmed): Stout |

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
| VCM | 1.8 | name | SET NO! · community label (differs, unconfirmed): Sentinel |

### Sniper (female) (22)

| id | s | category | words |
|---|---|---|---|
| VD1 | 1.1 | intro | Target locked. |
| VD2 | 6.0 | line | Cough, cough, cough, cough, cough, cough, cough, cough, cough, coug... · community label (differs, unconfirmed): female coughing |
| VD3 | 1.5 | death_scream | AHHHHHHHHH |
| VD4 | 1.4 | death_scream | AHHHHHHHHH |
| VD5 | 2.0 | death_scream | AHHHHHHHHH |
| VD6 | 6.0 | line | Sigh... Sigh... Sigh... · community label (differs, unconfirmed): technician catching breath |
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
| VDM | 1.0 | name | Sniper · community label (agrees, unconfirmed): Sniper |

### Soldier (22)

| id | s | category | words |
|---|---|---|---|
| VE1 | 1.0 | intro | Hoorah! |
| VE2 | 6.0 | idle_loop | Ah. Oh. Ah. Oh. Oh. Oh. Oh. · community label (differs, unconfirmed): guy being gassed |
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
| VEM | 0.9 | name | Soldier · community label (agrees, unconfirmed): Soldier |

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
| VFJ | 6.0 | long_death | BOOM! · community label (differs, unconfirmed): nexus suffering or gassed |
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
| VGJ | 6.0 | line | boop boop boop boop doop boop boop · community label (differs, unconfirmed): sniper or technician being electricuted |
| VGK | 4.1 | taunt | Even I can't fix my name. And I can fix everything. · community label (agrees, unconfirmed): I can fix everything - technician |
| VGL | 4.1 | taunt | Ooh, I'm glad my meta gel didn't explode in the allies this time! H... · community label (differs, unconfirmed): Good thing the medigel capsules didnt explode in the allies this time |
| VGM | 0.9 | name | Technician! · community label (agrees, unconfirmed): Technician |

### Valkyrie (31)

| id | s | category | words |
|---|---|---|---|
| VH1 | 1.1 | intro | Load up. |
| VH2 | 6.0 | idle_loop | Ahem Ahem · community label (differs, unconfirmed): Male gassed |
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
| VHJ | 6.0 | long_death | HUUUUUUUM · community label (differs, unconfirmed): guy veing electricuted |
| VHK | 1.8 | taunt | Watch and learn, noob. |
| VHL | 1.8 | taunt | Barely broke a sweat. |
| VHM | 1.1 | name | Valkyrie. · community label (agrees, unconfirmed): Valkyrie |
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
| VR1 | 0.8 | line | Commander · community label (agrees, unconfirmed): Vanguard Commander |
| VR2 | 1.3 | line | You piece of shit! |
| VR3 | 2.6 | objective_codes | enemy codes captured. |
| VR4 | 2.5 | line | And it will return. |
| VR5 | 1.7 | objective_codes | And the machine has codes. |
| VR6 | 2.3 | game_over | Game Over! |
| VR7 | 1.2 | game_over | Objective complete. |
| VR8 | 0.7 | menu | Random |
| VR9 | 1.7 | clock | Sixty seconds remain. |
| VRA | 10.8 | countdown | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. · community label (differs, unconfirmed): vanguard ten second countdown |
| VRB | 1.5 | clock | 30 Second Remaining |
| VRC | 1.3 | clock | Two minutes remaining. |
| VRD | 1.5 | menu | Upgrade available. |
| VRE | 1.0 | line | Vanguard · community label (agrees, unconfirmed): VANGUARD |
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
| VJ6 | 6.3 | hurt_loop | No... No... No... · community label (differs, unconfirmed): man recovering from injury |
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
| VJM | 1.0 | name | Viper · community label (agrees, unconfirmed): Viper |

### Voice (1)

| id | s | category | words |
|---|---|---|---|
| VIP | 1.3 | objective_other | VIP · community label (agrees, unconfirmed): VIP |

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
| VKM | 0.9 | name | Drayf · community label (differs, unconfirmed): Wraith |

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
| N100 | 3.4 | rising / charge-up, 3.4 s, tonal, mid · community label (NEW, unconfirmed): (Halo) Respawn |
| N101 | 2.6 | one-shot, decaying tail, 2.6 s, tonal, mid, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): (Halo) Shields Down |
| N102 | 2.1 | rising / charge-up, 2.1 s, tonal, dull/low, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): (Halo) Shields Recharge |
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
| N25 | 2.5 | one-shot, decaying tail, 2.5 s, tonal, dull/low, repeating / rattling, rising pitch/brightness · community label (NEW, unconfirmed): Heart beat |
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
| N78 | 1.6 | sustained / loop-like, 1.6 s, tonal, bright, repeating / rattling · community label (NEW, unconfirmed): Zelda Secret Passage |
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
| H01 | 2.1 | one-shot impact, 2.1 s, noisy, bright, repeating / rattling · community label (NEW, unconfirmed): Acid |
| H02 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, mid, falling pitch/brightness · community label (NEW, unconfirmed): Armor Piercing |
| H03 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, mid, falling pitch/brightness · community label (NEW, unconfirmed): Armor Piercing |
| H04 | 1.5 | sustained / loop-like, 1.5 s, mixed, mid, repeating / rattling · community label (NEW, unconfirmed): Male Gassed |
| H05 | 2.2 | varying, 2.2 s, tonal, mid, repeating / rattling · community label (NEW, unconfirmed): Miss, Ricochet |
| H06 | 0.4 | one-shot, decaying tail, 0.4 s, noisy, bright, rising pitch/brightness · community label (NEW, unconfirmed): Miss, Ricochet |
| H07 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid · community label (NEW, unconfirmed): Miss, Ricochet |
| H08 | 0.5 | one-shot, decaying tail, 0.5 s, noisy, bright · community label (NEW, unconfirmed): broom brushing |
| H09 | 0.5 | one-shot, decaying tail, 0.5 s, noisy, bright · community label (NEW, unconfirmed): broom brushing |
| H10 | 0.7 | one-shot, decaying tail, 0.7 s, noisy, bright · community label (NEW, unconfirmed): poison |
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
| H11 | 0.6 | one-shot, decaying tail, 0.6 s, noisy, bright · community label (NEW, unconfirmed): Arrow |
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
| H12 | 1.9 | one-shot impact, 1.9 s, noisy, bright, rising pitch/brightness · community label (NEW, unconfirmed): Bubble Acid |
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
| H13 | 0.8 | one-shot impact, 0.8 s, tonal, mid, falling pitch/brightness · community label (NEW, unconfirmed): Pistol hit |
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
| H14 | 0.4 | one-shot, decaying tail, 0.4 s, tonal, mid · community label (NEW, unconfirmed): bullet hit |
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
| H15 | 0.5 | one-shot impact, 0.5 s, mixed, mid · community label (NEW, unconfirmed): Armor Hit |
| H150 | 2.1 | one-shot, decaying tail, 2.1 s, tonal, mid |
| H151 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, bright, repeating / rattling |
| H152 | 1.9 | one-shot, decaying tail, 1.9 s, tonal, mid |
| H153 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, bright, repeating / rattling |
| H154 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, bright |
| H155 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, bright, rising pitch/brightness |
| H16 | 6.3 | one-shot impact, 6.3 s, mixed, bright, rising pitch/brightness · community label (NEW, unconfirmed): squishy cut noise |
| H17 | 2.2 | one-shot impact, 2.2 s, mixed, mid · community label (NEW, unconfirmed): Energy long hit |
| H18 | 4.9 | one-shot, decaying tail, 4.9 s, tonal, mid, falling pitch/brightness · community label (NEW, unconfirmed): futuristic fly by with heart beat maybe regen |
| H19 | 3.3 | one-shot impact, 3.3 s, noisy, bright, repeating / rattling · community label (NEW, unconfirmed): many smal burning hits |
| H20 | 0.9 | one-shot impact, 0.9 s, mixed, bright, repeating / rattling, rising pitch/brightness · community label (NEW, unconfirmed): Electric shock |
| H21 | 0.7 | one-shot impact, 0.7 s, mixed, mid, falling pitch/brightness · community label (NEW, unconfirmed): Hit on Shield |
| H22 | 0.6 | one-shot impact, 0.6 s, mixed, mid, falling pitch/brightness · community label (NEW, unconfirmed): Hit on Shield |
| H23 | 1.4 | one-shot impact, 1.4 s, mixed, mid, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): poison blaster hit... infected |
| H24 | 1.2 | one-shot impact, 1.2 s, noisy, bright, repeating / rattling · community label (NEW, unconfirmed): metal and glass shatter hit |
| H25 | 1.2 | one-shot impact, 1.2 s, noisy, bright, repeating / rattling · community label (NEW, unconfirmed): metal and glass shatter hit |
| H26 | 0.6 | one-shot impact, 0.6 s, noisy, bright · community label (NEW, unconfirmed): knife swipe |
| H27 | 1.2 | one-shot impact, 1.2 s, noisy, bright, repeating / rattling · community label (NEW, unconfirmed): bloody knife swipe |
| H28 | 1.0 | one-shot impact, 1.0 s, tonal, bright, repeating / rattling · community label (NEW, unconfirmed): blades klinging |
| H29 | 1.2 | one-shot, decaying tail, 1.2 s, mixed, bright, repeating / rattling, rising pitch/brightness · community label (NEW, unconfirmed): Medic capsule healing |
| H30 | 1.2 | one-shot impact, 1.2 s, mixed, bright, rising pitch/brightness · community label (NEW, unconfirmed): small blast impact |
| H31 | 0.6 | one-shot impact, 0.6 s, mixed, mid, rising pitch/brightness · community label (NEW, unconfirmed): squishy bubbles |
| H32 | 0.6 | one-shot impact, 0.6 s, mixed, bright, rising pitch/brightness · community label (NEW, unconfirmed): squishy bubbles |
| H33 | 0.4 | one-shot, decaying tail, 0.4 s, noisy, bright · community label (NEW, unconfirmed): Ray Gun short |
| H34 | 0.9 | one-shot, decaying tail, 0.9 s, mixed, bright, repeating / rattling · community label (NEW, unconfirmed): Stab with blood |
| H35 | 0.6 | one-shot impact, 0.6 s, mixed, mid, falling pitch/brightness · community label (NEW, unconfirmed): hitting armor |
| H36 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid, falling pitch/brightness · community label (NEW, unconfirmed): hitting armor |
| H37 | 0.7 | one-shot impact, 0.7 s, mixed, mid, falling pitch/brightness · community label (NEW, unconfirmed): hitting armor |
| H39 | 1.0 | one-shot, decaying tail, 1.0 s, noisy, bright, rising pitch/brightness · community label (NEW, unconfirmed): Metal hit with blood |
| H40 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, mid, repeating / rattling · community label (NEW, unconfirmed): Sword against shield with squishy |
| H41 | 1.6 | one-shot impact, 1.6 s, noisy, bright · community label (NEW, unconfirmed): shocking or acid frying |
| H42 | 0.7 | one-shot impact, 0.7 s, noisy, bright · community label (NEW, unconfirmed): small hit with frying sound |
| H43 | 0.6 | one-shot impact, 0.6 s, noisy, bright · community label (NEW, unconfirmed): stab with whiping sound |
| H44 | 1.4 | one-shot impact, 1.4 s, tonal, mid, repeating / rattling, rising pitch/brightness · community label (NEW, unconfirmed): several thuds |
| H45 | 1.6 | one-shot impact, 1.6 s, mixed, mid, repeating / rattling · community label (NEW, unconfirmed): ??? |
| H46 | 3.1 | one-shot impact, 3.1 s, mixed, bright · community label (NEW, unconfirmed): Electric Burning long |
| H47 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, bright, repeating / rattling · community label (NEW, unconfirmed): Gory Squish splatter |
| H48 | 1.2 | one-shot impact, 1.2 s, noisy, mid, repeating / rattling, falling pitch/brightness |
| H49 | 1.2 | one-shot impact, 1.2 s, mixed, mid, repeating / rattling · community label (NEW, unconfirmed): Gory Squish splatter |
| H50 | 1.0 | one-shot impact, 1.0 s, noisy, bright · community label (NEW, unconfirmed): Electric shock |
| H51 | 1.0 | one-shot impact, 1.0 s, noisy, bright · community label (NEW, unconfirmed): Electric shock |
| H52 | 0.9 | one-shot, decaying tail, 0.9 s, mixed, mid, repeating / rattling · community label (NEW, unconfirmed): melee hit with a gong |
| H53 | 1.1 | one-shot, decaying tail, 1.1 s, mixed, mid · community label (NEW, unconfirmed): melee hit with a gong |
| H54 | 0.8 | one-shot impact, 0.8 s, mixed, mid, falling pitch/brightness · community label (NEW, unconfirmed): loud hit |
| H55 | 0.4 | one-shot, decaying tail, 0.4 s, tonal, mid, rising pitch/brightness · community label (NEW, unconfirmed): thud-punch |
| H56 | 0.5 | one-shot, decaying tail, 0.5 s, mixed, mid, rising pitch/brightness · community label (NEW, unconfirmed): thud-punch |
| H57 | 0.8 | one-shot, decaying tail, 0.8 s, mixed, mid, rising pitch/brightness · community label (NEW, unconfirmed): Melee hit with gun stock |
| H58 | 1.1 | one-shot, decaying tail, 1.1 s, tonal, mid, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): Melee hit with gun stock |

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
| M05 | 3.4 | one-shot, decaying tail, 3.4 s, tonal, mid, repeating / rattling · community label (NEW, unconfirmed): Shokahn laugh |
| M06 | 1.6 | varying, 1.6 s, tonal, mid, repeating / rattling · community label (NEW, unconfirmed): Flawless victory |
| M07 | 1.7 | one-shot, decaying tail, 1.7 s, mixed, mid, repeating / rattling · community label (NEW, unconfirmed): Flawless victory2 |
| M08 | 1.3 | one-shot, decaying tail, 1.3 s, tonal, mid, repeating / rattling · community label (NEW, unconfirmed): Fatality |
| M09 | 1.4 | one-shot, decaying tail, 1.4 s, mixed, mid, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): Fatality |
| M10 | 1.2 | sustained / loop-like, 1.2 s, mixed, mid, repeating / rattling · community label (NEW, unconfirmed): Fatality |
| M100 | 1.7 | one-shot, decaying tail, 1.7 s, noisy, bright |
| M101 | 2.8 | one-shot, decaying tail, 2.8 s, tonal, dull/low, falling pitch/brightness |
| M11 | 2.0 | one-shot, decaying tail, 2.0 s, tonal, mid, falling pitch/brightness · community label (NEW, unconfirmed): Choose ur destiny |
| M12 | 0.3 | one-shot, decaying tail, 0.3 s, tonal, mid · community label (NEW, unconfirmed): Swipe |
| M13 | 0.7 | one-shot, decaying tail, 0.7 s, mixed, mid, rising pitch/brightness · community label (NEW, unconfirmed): Hard hit |
| M14 | 0.5 | one-shot, decaying tail, 0.5 s, tonal, mid · community label (NEW, unconfirmed): Swing |
| M15 | 1.3 | one-shot, decaying tail, 1.3 s, tonal, mid, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): Hit and smash |
| M16 | 1.6 | one-shot, decaying tail, 1.6 s, mixed, mid, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): Another hit |
| M17 | 0.7 | one-shot, decaying tail, 0.7 s, tonal, dull/low · community label (NEW, unconfirmed): Another hit |
| M18 | 0.7 | one-shot, decaying tail, 0.7 s, tonal, mid · community label (NEW, unconfirmed): Knife slice |
| M19 | 1.3 | one-shot, decaying tail, 1.3 s, mixed, mid, repeating / rattling, rising pitch/brightness · community label (NEW, unconfirmed): Knife hit |
| M20 | 1.1 | one-shot, decaying tail, 1.1 s, tonal, dull/low, falling pitch/brightness · community label (NEW, unconfirmed): Another hit |
| M21 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, mid · community label (NEW, unconfirmed): Another hit |
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
| A103 | 24.1 | one-shot impact, 24.1 s, tonal, mid · community label (NEW, unconfirmed): (Halo) buble shield |
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
| A31 | 1.7 | sustained / loop-like, 1.7 s, noisy, mid, repeating / rattling · community label (NEW, unconfirmed): Medical Tape |
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
| X13 | 1.5 | one-shot impact, 1.5 s, tonal, dull/low, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): small explode |
| X14 | 1.2 | one-shot impact, 1.2 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| X15 | 1.2 | one-shot impact, 1.2 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| X16 | 1.3 | one-shot impact, 1.3 s, mixed, mid |
| X17 | 7.9 | one-shot impact, 7.9 s, tonal, mid, repeating / rattling · community label (NEW, unconfirmed): concussion grenade |
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
| X28 | 6.7 | one-shot impact, 6.7 s, tonal, mid · community label (NEW, unconfirmed): explode with echo |
| X29 | 4.0 | one-shot impact, 4.0 s, tonal, mid, falling pitch/brightness |
| X30 | 8.1 | one-shot impact, 8.1 s, tonal, dull/low, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): bomb |
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
| R02 | 2.2 | one-shot impact, 2.2 s, tonal, mid, repeating / rattling · community label (NEW, unconfirmed): Definitely the m4 |
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
| R102 | 2.0 | one-shot impact, 2.0 s, mixed, mid, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): Halo 4 sniper |
| R103 | 1.9 | one-shot impact, 1.9 s, mixed, mid, repeating / rattling, rising pitch/brightness · community label (NEW, unconfirmed): Halo 4 shotgun |
| R104 | 1.0 | one-shot impact, 1.0 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| R105 | 1.3 | one-shot, decaying tail, 1.3 s, tonal, mid, repeating / rattling, rising pitch/brightness |
| R106 | 0.8 | one-shot impact, 0.8 s, mixed, mid, repeating / rattling |
| R107 | 2.4 | one-shot impact, 2.4 s, tonal, dull/low, falling pitch/brightness |
| R108 | 1.7 | one-shot impact, 1.7 s, tonal, mid, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): Halo 4 Beam Rifle |
| R109 | 1.0 | one-shot, decaying tail, 1.0 s, tonal, mid |
| R11 | 2.0 | one-shot impact, 2.0 s, tonal, dull/low |
| R110 | 1.0 | one-shot impact, 1.0 s, tonal, mid, falling pitch/brightness · community label (NEW, unconfirmed): Halo 4 Plasma Pistol standard shot |
| R111 | 1.2 | one-shot impact, 1.2 s, tonal, mid · community label (NEW, unconfirmed): Halo 4 plasma Pistol charge ramp up |
| R112 | 5.0 | sustained / loop-like, 5.0 s, tonal, mid, repeating / rattling · community label (NEW, unconfirmed): Halo 4 plasma Pistol charge max |
| R113 | 1.3 | one-shot impact, 1.3 s, mixed, mid · community label (NEW, unconfirmed): Halo 4 plasma Pistol charge shot |
| R114 | 1.2 | rising / charge-up, 1.2 s, mixed, bright, repeating / rattling |
| R115 | 3.0 | one-shot impact, 3.0 s, tonal, mid, repeating / rattling |
| R116 | 2.6 | one-shot impact, 2.6 s, tonal, mid, repeating / rattling |
| R117 | 1.7 | one-shot impact, 1.7 s, tonal, mid, falling pitch/brightness |
| R118 | 2.0 | one-shot impact, 2.0 s, mixed, mid, repeating / rattling |
| R119 | 1.9 | one-shot impact, 1.9 s, mixed, mid, falling pitch/brightness |
| R12 | 1.9 | one-shot impact, 1.9 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| R120 | 2.5 | rising / charge-up, 2.5 s, mixed, mid · community label (NEW, unconfirmed): Halo Spartan Lazer Charge |
| R121 | 3.0 | one-shot impact, 3.0 s, tonal, mid, repeating / rattling · community label (NEW, unconfirmed): Halo Spartan Lazer Shot |
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
| J02 | 1.8 | one-shot impact, 1.8 s, tonal, mid, repeating / rattling · community label (NEW, unconfirmed): offline grenade launcher? |
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
| SW00 | 10.1 | one-shot, decaying tail, 10.1 s, tonal, mid, falling pitch/brightness · community label (NEW, unconfirmed): Trumpets star wars |
| SW01 | 1.7 | one-shot impact, 1.7 s, mixed, mid, falling pitch/brightness · community label (NEW, unconfirmed): Light Saber start up |
| SW02 | 28.3 | one-shot, decaying tail, 28.3 s, tonal, dull/low, repeating / rattling, steady pitch ~91 Hz · community label (NEW, unconfirmed): Light saber on |
| SW03 | 93.1 | varying, 93.1 s, tonal, mid · community label (NEW, unconfirmed): Star Wars intro theme song |
| SW04 | 94.0 | varying, 94.0 s, tonal, mid · community label (NEW, unconfirmed): Star Wars theme song |
| SW05 | 1.3 | rising / charge-up, 1.3 s, mixed, mid, rising pitch/brightness · community label (NEW, unconfirmed): Retracting light sabre |
| SW06 | 1.0 | one-shot impact, 1.0 s, mixed, mid, repeating / rattling · community label (NEW, unconfirmed): Saber hit |
| SW07 | 1.0 | one-shot, decaying tail, 1.0 s, mixed, mid, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): Sabers clash |
| SW08 | 0.8 | one-shot, decaying tail, 0.8 s, mixed, mid, falling pitch/brightness · community label (NEW, unconfirmed): Saber clash |
| SW10 | 0.6 | sustained / loop-like, 0.6 s, tonal, dull/low, steady pitch ~98 Hz · community label (NEW, unconfirmed): Saber swing |
| SW11 | 0.5 | one-shot, decaying tail, 0.5 s, tonal, dull/low, steady pitch ~94 Hz · community label (NEW, unconfirmed): Saber swing |
| SW13 | 1.4 | one-shot, decaying tail, 1.4 s, tonal, dull/low, repeating / rattling, steady pitch ~93 Hz · community label (NEW, unconfirmed): Swinging saber |
| SW14 | 1.3 | one-shot, decaying tail, 1.3 s, tonal, dull/low, repeating / rattling, steady pitch ~98 Hz · community label (NEW, unconfirmed): Swinging saber |
| SW15 | 0.3 | sustained / loop-like, 0.3 s, tonal, dull/low, steady pitch ~97 Hz · community label (NEW, unconfirmed): Short saber swing |
| SW16 | 0.3 | one-shot, decaying tail, 0.3 s, tonal, dull/low, steady pitch ~94 Hz · community label (NEW, unconfirmed): Humming |
| SW17 | 0.8 | sustained / loop-like, 0.8 s, tonal, dull/low, repeating / rattling · community label (NEW, unconfirmed): Swing saber |
| SW18 | 0.8 | sustained / loop-like, 0.8 s, tonal, dull/low, repeating / rattling · community label (NEW, unconfirmed): Dual saber |
| SW19 | 1.2 | sustained / loop-like, 1.2 s, tonal, dull/low, repeating / rattling, steady pitch ~97 Hz, rising pitch/brightness · community label (NEW, unconfirmed): Multiple saber swings |
| SW20 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, dull/low · community label (NEW, unconfirmed): Saber swing |
| SW21 | 0.7 | one-shot, decaying tail, 0.7 s, tonal, dull/low, steady pitch ~92 Hz · community label (NEW, unconfirmed): Saber swing |
| SW23 | 0.9 | one-shot impact, 0.9 s, mixed, mid, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): Blaster saber |
| SW24 | 0.7 | one-shot impact, 0.7 s, mixed, mid, falling pitch/brightness · community label (NEW, unconfirmed): Saber hit |
| SW25 | 0.9 | one-shot impact, 0.9 s, mixed, mid, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): Blaster blocked w saber |
| SW26 | 2.2 | one-shot, decaying tail, 2.2 s, tonal, mid, repeating / rattling · community label (NEW, unconfirmed): Weird blaster with follow up bang |
| SW28 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, mid, falling pitch/brightness · community label (NEW, unconfirmed): Swish |
| SW29 | 2.3 | one-shot, decaying tail, 2.3 s, tonal, mid, falling pitch/brightness · community label (NEW, unconfirmed): Explosion |
| SW30 | 1.9 | one-shot impact, 1.9 s, tonal, dull/low, falling pitch/brightness · community label (NEW, unconfirmed): Big blaster cannon? |
| SW31 | 60.8 | sustained / loop-like, 60.8 s, tonal, mid · community label (NEW, unconfirmed): Hall choir star wars song |
| SW32 | 1.4 | one-shot, decaying tail, 1.4 s, mixed, mid · community label (NEW, unconfirmed): Saber burning or slicing something |
| SW33 | 1.4 | one-shot, decaying tail, 1.4 s, mixed, bright · community label (NEW, unconfirmed): Saber burning or slicing something |
| SW34 | 1.4 | one-shot impact, 1.4 s, tonal, mid, falling pitch/brightness · community label (NEW, unconfirmed): Blaster shot rifle style |
| SW35 | 1.0 | one-shot impact, 1.0 s, tonal, mid, falling pitch/brightness · community label (NEW, unconfirmed): Blaster |
| SW36 | 0.7 | one-shot impact, 0.7 s, mixed, mid · community label (NEW, unconfirmed): Blaster |
| SW37 | 1.0 | one-shot impact, 1.0 s, mixed, mid, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): Blaster turret |
| SW38 | 0.9 | one-shot impact, 0.9 s, mixed, mid, falling pitch/brightness · community label (NEW, unconfirmed): Standard blaster |
| SW39 | 1.5 | one-shot impact, 1.5 s, tonal, dull/low, falling pitch/brightness · community label (NEW, unconfirmed): Rifle blaster |
| SW40 | 0.9 | one-shot impact, 0.9 s, mixed, mid, falling pitch/brightness · community label (NEW, unconfirmed): Blaster |

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
| G12 | 1.6 | one-shot impact, 1.6 s, mixed, mid · community label (NEW, unconfirmed): possible m4? |
| G13 | 0.9 | one-shot impact, 0.9 s, mixed, mid, repeating / rattling |
| G14 | 1.3 | one-shot impact, 1.3 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| G15 | 1.1 | one-shot impact, 1.1 s, tonal, mid, repeating / rattling |
| G16 | 1.6 | one-shot impact, 1.6 s, tonal, mid, repeating / rattling, rising pitch/brightness |
| G17 | 1.4 | one-shot impact, 1.4 s, tonal, dull/low, falling pitch/brightness |
| G18 | 1.3 | one-shot impact, 1.3 s, tonal, mid, falling pitch/brightness · community label (NEW, unconfirmed): possible m4 or smg x3? |
| G19 | 1.9 | one-shot impact, 1.9 s, tonal, mid, falling pitch/brightness · community label (NEW, unconfirmed): possible smg x3? |
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
| S07 | 1.1 | one-shot impact, 1.1 s, tonal, dull/low, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): Offline Deathmatch Tar 33 ? |
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
| F08 | 3.6 | one-shot, decaying tail, 3.6 s, mixed, mid · community label (NEW, unconfirmed): Chainsaw |
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
| T14 | 0.9 | one-shot impact, 0.9 s, tonal, dull/low, repeating / rattling · community label (NEW, unconfirmed): grenade launcher? |
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
| CC01 | 2.3 | one-shot, decaying tail, 2.3 s, mixed, mid · community label (NEW, unconfirmed): DEATH |
| CC02 | 0.9 | one-shot impact, 0.9 s, tonal, mid, repeating / rattling · community label (NEW, unconfirmed): SPAWN |
| CC03 | 1.8 | one-shot impact, 1.8 s, mixed, bright, rising pitch/brightness · community label (NEW, unconfirmed): AR |
| CC04 | 1.7 | one-shot impact, 1.7 s, mixed, bright, rising pitch/brightness · community label (NEW, unconfirmed): SPRAY GUN |
| CC05 | 0.4 | one-shot, decaying tail, 0.4 s, mixed, bright, rising pitch/brightness · community label (NEW, unconfirmed): TAKE HIT |
| CC06 | 0.6 | one-shot, decaying tail, 0.6 s, tonal, mid · community label (NEW, unconfirmed): BEEP |
| CC07 | 5.2 | sustained / loop-like, 5.2 s, tonal, mid · community label (NEW, unconfirmed): sELECT GAME MODE |
| CC08 | 110.7 | sustained / loop-like, 110.7 s, tonal, mid, repeating / rattling · community label (NEW, unconfirmed): GAME MUSIC |
| CC09 | 3.9 | one-shot, decaying tail, 3.9 s, tonal, mid · community label (NEW, unconfirmed): gAME OVER |
| CC10 | 2.8 | one-shot impact, 2.8 s, tonal, mid · community label (NEW, unconfirmed): EXPLODE HIT |
| CC11 | 5.8 | varying, 5.8 s, tonal, mid, repeating / rattling · community label (NEW, unconfirmed): LIVES DEPLETED |

### JA — music / sting (10)

| id | s | shape |
|---|---|---|
| JA0 | 8.5 | sustained / loop-like, 8.5 s, tonal, mid |
| JA1 | 8.3 | sustained / loop-like, 8.3 s, tonal, mid, repeating / rattling |
| JA2 | 9.5 | rising / charge-up, 9.5 s, tonal, mid, falling pitch/brightness |
| JA3 | 21.4 | sustained / loop-like, 21.4 s, tonal, mid, repeating / rattling |
| JA4 | 20.0 | varying, 20.0 s, tonal, mid, repeating / rattling |
| JA5 | 21.9 | varying, 21.9 s, tonal, mid · community label (NEW, unconfirmed): Captured flag song |
| JA6 | 3.4 | one-shot, decaying tail, 3.4 s, tonal, dull/low, falling pitch/brightness |
| JA7 | 6.0 | sustained / loop-like, 6.0 s, tonal, mid, repeating / rattling |
| JA8 | 6.3 | rising / charge-up, 6.3 s, tonal, mid, repeating / rattling |
| JA9 | 5.7 | sustained / loop-like, 5.7 s, tonal, mid, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): Battle company start musig |

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
| HM10 | 1.9 | one-shot impact, 1.9 s, noisy, mid (community: reported NOISE since v4.30) |
| HM11 | 2.1 | one-shot impact, 2.1 s, noisy, bright, repeating / rattling (community: reported NOISE since v4.30) |
| HM12 | 2.0 | one-shot impact, 2.0 s, noisy, bright, repeating / rattling (community: reported NOISE since v4.30) |
| HM13 | 0.7 | one-shot impact, 0.7 s, mixed, bright (community: reported NOISE since v4.30) |
| HM14 | 0.9 | one-shot impact, 0.9 s, mixed, bright, repeating / rattling (community: reported NOISE since v4.30) |
| HM1B | 2.2 | one-shot, decaying tail, 2.2 s, mixed, mid, repeating / rattling (community: reported NOISE since v4.30) |
| HM1F | 1.1 | one-shot, decaying tail, 1.1 s, tonal, dull/low (community: reported NOISE since v4.30) |
| HM1O | 2.0 | one-shot impact, 2.0 s, mixed, bright (community: reported NOISE since v4.30) |
| HM25 | 2.4 | one-shot, decaying tail, 2.4 s, mixed, mid (community: reported NOISE since v4.30) |

### TK — misc effect (TK) (9)

| id | s | shape |
|---|---|---|
| TK0W | 1.0 | one-shot impact, 1.0 s, mixed, bright, repeating / rattling (community: reported NOISE since v4.30) |
| TK0Z | 9.5 | varying, 9.5 s, mixed, mid, repeating / rattling (community: reported NOISE since v4.30) |
| TK14 | 0.8 | one-shot, decaying tail, 0.8 s, noisy, bright, repeating / rattling (community: reported NOISE since v4.30) |
| TK15 | 0.6 | one-shot, decaying tail, 0.6 s, noisy, bright (community: reported NOISE since v4.30) |
| TK19 | 4.7 | varying, 4.7 s, mixed, bright, repeating / rattling (community: reported NOISE since v4.30) |
| TK1R | 10.4 | varying, 10.4 s, mixed, mid (community: reported NOISE since v4.30) |
| TK2R | 0.1 | one-shot, decaying tail, 0.1 s, mixed, bright, falling pitch/brightness (community: reported NOISE since v4.30) |
| TK2V | 8.7 | varying, 8.7 s, mixed, mid (community: reported NOISE since v4.30) |
| TK2W | 2.6 | one-shot impact, 2.6 s, tonal, mid (community: reported NOISE since v4.30) |

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
| Z11 | 1.2 | one-shot impact, 1.2 s, mixed, mid, repeating / rattling, falling pitch/brightness · community label (NEW, unconfirmed): infected blaster |

### JAA — music / sting (1)

| id | s | shape |
|---|---|---|
| JAA | 4.3 | one-shot, decaying tail, 4.3 s, tonal, dull/low, falling pitch/brightness |

### JAB — JAB family (1)

| id | s | shape |
|---|---|---|
| JAB | 4.2 | one-shot, decaying tail, 4.2 s, tonal, dull/low, falling pitch/brightness · community label (NEW, unconfirmed): Starting callsign |

### JAC — JAC family (1)

| id | s | shape |
|---|---|---|
| JAC | 1.6 | one-shot, decaying tail, 1.6 s, tonal, mid, falling pitch/brightness |

### JAD — JAD family (1)

| id | s | shape |
|---|---|---|
| JAD | 3.5 | one-shot, decaying tail, 3.5 s, tonal, mid, falling pitch/brightness · community label (NEW, unconfirmed): Death music |

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
| JAN | 60.1 | rising / charge-up, 60.1 s, tonal, mid · community label (NEW, unconfirmed): Halo music |

### JAO — JAO family (1)

| id | s | shape |
|---|---|---|
| JAO | 53.7 | rising / charge-up, 53.7 s, tonal, mid, repeating / rattling, rising pitch/brightness · community label (NEW, unconfirmed): Halo music |

### JAP — JAP family (1)

| id | s | shape |
|---|---|---|
| JAP | 50.9 | varying, 50.9 s, tonal, mid · community label (NEW, unconfirmed): Halo music |

### JAQ — JAQ family (1)

| id | s | shape |
|---|---|---|
| JAQ | 11.1 | sustained / loop-like, 11.1 s, tonal, mid · community label (NEW, unconfirmed): Time running out |

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
| MC2J | 1.6 | one-shot, decaying tail, 1.6 s, noisy, bright, repeating / rattling, rising pitch/brightness (community: reported NOISE since v4.30) |

### MM — MM family (1)

| id | s | shape |
|---|---|---|
| MM0A | 1.5 | one-shot impact, 1.5 s, noisy, bright, repeating / rattling (community: reported NOISE since v4.30) |

### NA — NA family (1)

| id | s | shape |
|---|---|---|
| NA0 | 4.0 | one-shot, decaying tail, 4.0 s, tonal, mid, repeating / rattling |

## App-listed ids that are NOT on the gun

E_J10, E_J11, E_J12, E_J13, E_J14, E_J15, E_J17, E_J18, E_J19, E_J1W, E_J1X, E_J1Y, E_K01, E_K02, E_K03, E_K04, E_K05, E_K06, E_K07, E_K08, E_K09, E_K10, E_K11, E_K12, E_N35, E_N66, E_N67, E_N68, E_N69, E_N70, E_N71, E_N72, E_N73, E_N86, E_VA1H, E_VA1I, E_VA21, E_VA22, E_VA23, E_VA2E, E_VA33, E_VA3R, E_VA3S, E_VA4P, E_VA4R, E_VA61, E_VA6L, E_VA72, E_VA78, E_VA7H, E_VA7I, E_VA80, E_VA81, E_VA82, E_VA83, E_VA84, E_VA85, E_VB01, E_VB02, E_VB03, E_VB04, E_VB05, E_VB06, E_VB07, E_VB08, E_VB0C, E_VB0D, E_VB0E, E_VB0F, E_VB0G, E_VB0H, E_VB0I, E_VB0J, E_VB0K, E_VB0L, E_VB0M, E_VB0N, E_VB0O, E_VB0P, E_VB0Q, E_VB0R, E_VB0S, E_VB0T, E_VB0U, E_VB0V, E_VB0W, E_VB0X, E_VB0Y, E_VB0Z, E_VB10, E_VB11, E_VB12, E_VB13, E_VB14, E_VB15, E_VB16, E_VB17, E_VB18, E_VB19, E_VB1A, E_VB1B, E_VB1C, E_VB1D, E_VB1E, E_VB1F, E_VB1G, E_VB1H, E_VB1I, E_VB1J, E_VB1K, E_VB1M, E_VB1N, E_VB1O, E_VB1P, E_VB1Q, E_VB1R, E_VB1S, E_VB1T, E_VB1U, E_VB1V, E_VB1W, E_VS6, E_VSA, E_VSB, E_VSC, E_VSD, E_X21, E_X22, E_X23, E_X24, E_X25, E_X26, E_X27, E_X28, E_X29, E_X30, V00, V10, V20, V30, V40, V50, V60, V70, V80, V90, VA0, Z01, Z02, Z03, Z08, Z09, Z10, Z12, Z13, Z14, Z15

## Community labels

The LaserTagMods BRX Audio sheet, an open community sheet shared by Jay of LaserTagMods, names sounds by ear. A community label is a guess by a listener, not a transcript or a bench finding: it never replaces our own `description`, `transcript` or `verified_by_ear`, and shows beside them instead.

- **158 ids** had no real label of ours (our `description` was only a machine acoustic-shape guess); the community label is shown first, below, marked **NEW**.
- **224 ids** have a community label that disagrees with our own description; both are shown.
- **622 ids** have a community label that agrees with our own description.
- **347 ids** named in the sheet are not on our gun and are left out of this catalog.

### 158 ids with a new community label (ours was a machine guess)

| id | community label | our description |
|---|---|---|
| A103 | **NEW:** (Halo) buble shield | sci-fi effect; one-shot impact, 24.1 s, tonal, mid |
| A31 | **NEW:** Medical Tape | sci-fi effect; sustained / loop-like, 1.7 s, noisy, mid, repeating / rattling |
| CC01 | **NEW:** DEATH | Contra-style effect; one-shot, decaying tail, 2.3 s, mixed, mid |
| CC02 | **NEW:** SPAWN | Contra-style effect; one-shot impact, 0.9 s, tonal, mid, repeating / rattling |
| CC03 | **NEW:** AR | Contra-style effect; one-shot impact, 1.8 s, mixed, bright, rising pitch/brightness |
| CC04 | **NEW:** SPRAY GUN | Contra-style effect; one-shot impact, 1.7 s, mixed, bright, rising pitch/brightness |
| CC05 | **NEW:** TAKE HIT | Contra-style effect; one-shot, decaying tail, 0.4 s, mixed, bright, rising pitch/brightness |
| CC06 | **NEW:** BEEP | Contra-style effect; one-shot, decaying tail, 0.6 s, tonal, mid |
| CC07 | **NEW:** sELECT GAME MODE | Contra-style effect; sustained / loop-like, 5.2 s, tonal, mid |
| CC08 | **NEW:** GAME MUSIC | Contra-style effect; sustained / loop-like, 110.7 s, tonal, mid, repeating / rattling |
| CC09 | **NEW:** gAME OVER | Contra-style effect; one-shot, decaying tail, 3.9 s, tonal, mid |
| CC10 | **NEW:** EXPLODE HIT | Contra-style effect; one-shot impact, 2.8 s, tonal, mid |
| CC11 | **NEW:** LIVES DEPLETED | Contra-style effect; varying, 5.8 s, tonal, mid, repeating / rattling |
| F08 | **NEW:** Chainsaw | fire / novelty; one-shot, decaying tail, 3.6 s, mixed, mid |
| G12 | **NEW:** possible m4? | gunshot; one-shot impact, 1.6 s, mixed, mid |
| G18 | **NEW:** possible m4 or smg x3? | gunshot; one-shot impact, 1.3 s, tonal, mid, falling pitch/brightness |
| G19 | **NEW:** possible smg x3? | gunshot; one-shot impact, 1.9 s, tonal, mid, falling pitch/brightness |
| H01 | **NEW:** Acid | hit / impact; one-shot impact, 2.1 s, noisy, bright, repeating / rattling |
| H02 | **NEW:** Armor Piercing | hit / impact; one-shot, decaying tail, 0.4 s, mixed, mid, falling pitch/brightness |
| H03 | **NEW:** Armor Piercing | hit / impact; one-shot, decaying tail, 0.4 s, mixed, mid, falling pitch/brightness |
| H04 | **NEW:** Male Gassed | hit / impact; sustained / loop-like, 1.5 s, mixed, mid, repeating / rattling |
| H05 | **NEW:** Miss, Ricochet | hit / impact; varying, 2.2 s, tonal, mid, repeating / rattling |
| H06 | **NEW:** Miss, Ricochet | hit / impact; one-shot, decaying tail, 0.4 s, noisy, bright, rising pitch/brightness |
| H07 | **NEW:** Miss, Ricochet | hit / impact; one-shot, decaying tail, 0.5 s, mixed, mid |
| H08 | **NEW:** broom brushing | hit / impact; one-shot, decaying tail, 0.5 s, noisy, bright |
| H09 | **NEW:** broom brushing | hit / impact; one-shot, decaying tail, 0.5 s, noisy, bright |
| H10 | **NEW:** poison | hit / impact; one-shot, decaying tail, 0.7 s, noisy, bright |
| H11 | **NEW:** Arrow | hit / impact; one-shot, decaying tail, 0.6 s, noisy, bright |
| H12 | **NEW:** Bubble Acid | hit / impact; one-shot impact, 1.9 s, noisy, bright, rising pitch/brightness |
| H13 | **NEW:** Pistol hit | hit / impact; one-shot impact, 0.8 s, tonal, mid, falling pitch/brightness |
| H14 | **NEW:** bullet hit | hit / impact; one-shot, decaying tail, 0.4 s, tonal, mid |
| H15 | **NEW:** Armor Hit | hit / impact; one-shot impact, 0.5 s, mixed, mid |
| H16 | **NEW:** squishy cut noise | hit / impact; one-shot impact, 6.3 s, mixed, bright, rising pitch/brightness |
| H17 | **NEW:** Energy long hit | hit / impact; one-shot impact, 2.2 s, mixed, mid |
| H18 | **NEW:** futuristic fly by with heart beat maybe regen | hit / impact; one-shot, decaying tail, 4.9 s, tonal, mid, falling pitch/brightness |
| H19 | **NEW:** many smal burning hits | hit / impact; one-shot impact, 3.3 s, noisy, bright, repeating / rattling |
| H20 | **NEW:** Electric shock | hit / impact; one-shot impact, 0.9 s, mixed, bright, repeating / rattling, rising pitch/brightness |
| H21 | **NEW:** Hit on Shield | hit / impact; one-shot impact, 0.7 s, mixed, mid, falling pitch/brightness |
| H22 | **NEW:** Hit on Shield | hit / impact; one-shot impact, 0.6 s, mixed, mid, falling pitch/brightness |
| H23 | **NEW:** poison blaster hit... infected | hit / impact; one-shot impact, 1.4 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| H24 | **NEW:** metal and glass shatter hit | hit / impact; one-shot impact, 1.2 s, noisy, bright, repeating / rattling |
| H25 | **NEW:** metal and glass shatter hit | hit / impact; one-shot impact, 1.2 s, noisy, bright, repeating / rattling |
| H26 | **NEW:** knife swipe | hit / impact; one-shot impact, 0.6 s, noisy, bright |
| H27 | **NEW:** bloody knife swipe | hit / impact; one-shot impact, 1.2 s, noisy, bright, repeating / rattling |
| H28 | **NEW:** blades klinging | hit / impact; one-shot impact, 1.0 s, tonal, bright, repeating / rattling |
| H29 | **NEW:** Medic capsule healing | hit / impact; one-shot, decaying tail, 1.2 s, mixed, bright, repeating / rattling, rising pitch/brightness |
| H30 | **NEW:** small blast impact | hit / impact; one-shot impact, 1.2 s, mixed, bright, rising pitch/brightness |
| H31 | **NEW:** squishy bubbles | hit / impact; one-shot impact, 0.6 s, mixed, mid, rising pitch/brightness |
| H32 | **NEW:** squishy bubbles | hit / impact; one-shot impact, 0.6 s, mixed, bright, rising pitch/brightness |
| H33 | **NEW:** Ray Gun short | hit / impact; one-shot, decaying tail, 0.4 s, noisy, bright |
| H34 | **NEW:** Stab with blood | hit / impact; one-shot, decaying tail, 0.9 s, mixed, bright, repeating / rattling |
| H35 | **NEW:** hitting armor | hit / impact; one-shot impact, 0.6 s, mixed, mid, falling pitch/brightness |
| H36 | **NEW:** hitting armor | hit / impact; one-shot, decaying tail, 0.5 s, mixed, mid, falling pitch/brightness |
| H37 | **NEW:** hitting armor | hit / impact; one-shot impact, 0.7 s, mixed, mid, falling pitch/brightness |
| H39 | **NEW:** Metal hit with blood | hit / impact; one-shot, decaying tail, 1.0 s, noisy, bright, rising pitch/brightness |
| H40 | **NEW:** Sword against shield with squishy | hit / impact; one-shot, decaying tail, 1.0 s, mixed, mid, repeating / rattling |
| H41 | **NEW:** shocking or acid frying | hit / impact; one-shot impact, 1.6 s, noisy, bright |
| H42 | **NEW:** small hit with frying sound | hit / impact; one-shot impact, 0.7 s, noisy, bright |
| H43 | **NEW:** stab with whiping sound | hit / impact; one-shot impact, 0.6 s, noisy, bright |
| H44 | **NEW:** several thuds | hit / impact; one-shot impact, 1.4 s, tonal, mid, repeating / rattling, rising pitch/brightness |
| H45 | **NEW:** ??? | hit / impact; one-shot impact, 1.6 s, mixed, mid, repeating / rattling |
| H46 | **NEW:** Electric Burning long | hit / impact; one-shot impact, 3.1 s, mixed, bright |
| H47 | **NEW:** Gory Squish splatter | hit / impact; one-shot, decaying tail, 1.0 s, mixed, bright, repeating / rattling |
| H49 | **NEW:** Gory Squish splatter | hit / impact; one-shot impact, 1.2 s, mixed, mid, repeating / rattling |
| H50 | **NEW:** Electric shock | hit / impact; one-shot impact, 1.0 s, noisy, bright |
| H51 | **NEW:** Electric shock | hit / impact; one-shot impact, 1.0 s, noisy, bright |
| H52 | **NEW:** melee hit with a gong | hit / impact; one-shot, decaying tail, 0.9 s, mixed, mid, repeating / rattling |
| H53 | **NEW:** melee hit with a gong | hit / impact; one-shot, decaying tail, 1.1 s, mixed, mid |
| H54 | **NEW:** loud hit | hit / impact; one-shot impact, 0.8 s, mixed, mid, falling pitch/brightness |
| H55 | **NEW:** thud-punch | hit / impact; one-shot, decaying tail, 0.4 s, tonal, mid, rising pitch/brightness |
| H56 | **NEW:** thud-punch | hit / impact; one-shot, decaying tail, 0.5 s, mixed, mid, rising pitch/brightness |
| H57 | **NEW:** Melee hit with gun stock | hit / impact; one-shot, decaying tail, 0.8 s, mixed, mid, rising pitch/brightness |
| H58 | **NEW:** Melee hit with gun stock | hit / impact; one-shot, decaying tail, 1.1 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| J02 | **NEW:** offline grenade launcher? | music / sting; one-shot impact, 1.8 s, tonal, mid, repeating / rattling |
| JA5 | **NEW:** Captured flag song | music / sting; varying, 21.9 s, tonal, mid |
| JA9 | **NEW:** Battle company start musig | music / sting; sustained / loop-like, 5.7 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| JAB | **NEW:** Starting callsign | effect (JAB family); one-shot, decaying tail, 4.2 s, tonal, dull/low, falling pitch/brightness |
| JAD | **NEW:** Death music | effect (JAD family); one-shot, decaying tail, 3.5 s, tonal, mid, falling pitch/brightness |
| JAN | **NEW:** Halo music | effect (JAN family); rising / charge-up, 60.1 s, tonal, mid |
| JAO | **NEW:** Halo music | effect (JAO family); rising / charge-up, 53.7 s, tonal, mid, repeating / rattling, rising pitch/brightness |
| JAP | **NEW:** Halo music | effect (JAP family); varying, 50.9 s, tonal, mid |
| JAQ | **NEW:** Time running out | effect (JAQ family); sustained / loop-like, 11.1 s, tonal, mid |
| M05 | **NEW:** Shokahn laugh | Mortal-Kombat-style effect; one-shot, decaying tail, 3.4 s, tonal, mid, repeating / rattling |
| M06 | **NEW:** Flawless victory | Mortal-Kombat-style effect; varying, 1.6 s, tonal, mid, repeating / rattling |
| M07 | **NEW:** Flawless victory2 | Mortal-Kombat-style effect; one-shot, decaying tail, 1.7 s, mixed, mid, repeating / rattling |
| M08 | **NEW:** Fatality | Mortal-Kombat-style effect; one-shot, decaying tail, 1.3 s, tonal, mid, repeating / rattling |
| M09 | **NEW:** Fatality | Mortal-Kombat-style effect; one-shot, decaying tail, 1.4 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| M10 | **NEW:** Fatality | Mortal-Kombat-style effect; sustained / loop-like, 1.2 s, mixed, mid, repeating / rattling |
| M11 | **NEW:** Choose ur destiny | Mortal-Kombat-style effect; one-shot, decaying tail, 2.0 s, tonal, mid, falling pitch/brightness |
| M12 | **NEW:** Swipe | Mortal-Kombat-style effect; one-shot, decaying tail, 0.3 s, tonal, mid |
| M13 | **NEW:** Hard hit | Mortal-Kombat-style effect; one-shot, decaying tail, 0.7 s, mixed, mid, rising pitch/brightness |
| M14 | **NEW:** Swing | Mortal-Kombat-style effect; one-shot, decaying tail, 0.5 s, tonal, mid |
| M15 | **NEW:** Hit and smash | Mortal-Kombat-style effect; one-shot, decaying tail, 1.3 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| M16 | **NEW:** Another hit | Mortal-Kombat-style effect; one-shot, decaying tail, 1.6 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| M17 | **NEW:** Another hit | Mortal-Kombat-style effect; one-shot, decaying tail, 0.7 s, tonal, dull/low |
| M18 | **NEW:** Knife slice | Mortal-Kombat-style effect; one-shot, decaying tail, 0.7 s, tonal, mid |
| M19 | **NEW:** Knife hit | Mortal-Kombat-style effect; one-shot, decaying tail, 1.3 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| M20 | **NEW:** Another hit | Mortal-Kombat-style effect; one-shot, decaying tail, 1.1 s, tonal, dull/low, falling pitch/brightness |
| M21 | **NEW:** Another hit | Mortal-Kombat-style effect; one-shot, decaying tail, 0.6 s, tonal, mid |
| N100 | **NEW:** (Halo) Respawn | misc effect; rising / charge-up, 3.4 s, tonal, mid |
| N101 | **NEW:** (Halo) Shields Down | misc effect; one-shot, decaying tail, 2.6 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| N102 | **NEW:** (Halo) Shields Recharge | misc effect; rising / charge-up, 2.1 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| N25 | **NEW:** Heart beat | misc effect; one-shot, decaying tail, 2.5 s, tonal, dull/low, repeating / rattling, rising pitch/brightness |
| N78 | **NEW:** Zelda Secret Passage | misc effect; sustained / loop-like, 1.6 s, tonal, bright, repeating / rattling |
| R02 | **NEW:** Definitely the m4 | gunshot; one-shot impact, 2.2 s, tonal, mid, repeating / rattling |
| R102 | **NEW:** Halo 4 sniper | gunshot; one-shot impact, 2.0 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| R103 | **NEW:** Halo 4 shotgun | gunshot; one-shot impact, 1.9 s, mixed, mid, repeating / rattling, rising pitch/brightness |
| R108 | **NEW:** Halo 4 Beam Rifle | gunshot; one-shot impact, 1.7 s, tonal, mid, repeating / rattling, falling pitch/brightness |
| R110 | **NEW:** Halo 4 Plasma Pistol standard shot | gunshot; one-shot impact, 1.0 s, tonal, mid, falling pitch/brightness |
| R111 | **NEW:** Halo 4 plasma Pistol charge ramp up | gunshot; one-shot impact, 1.2 s, tonal, mid |
| R112 | **NEW:** Halo 4 plasma Pistol charge max | gunshot; sustained / loop-like, 5.0 s, tonal, mid, repeating / rattling |
| R113 | **NEW:** Halo 4 plasma Pistol charge shot | gunshot; one-shot impact, 1.3 s, mixed, mid |
| R120 | **NEW:** Halo Spartan Lazer Charge | gunshot; rising / charge-up, 2.5 s, mixed, mid |
| R121 | **NEW:** Halo Spartan Lazer Shot | gunshot; one-shot impact, 3.0 s, tonal, mid, repeating / rattling |
| S07 | **NEW:** Offline Deathmatch Tar 33 ? | gunshot; one-shot impact, 1.1 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| SW00 | **NEW:** Trumpets star wars | Star-Wars-style effect; one-shot, decaying tail, 10.1 s, tonal, mid, falling pitch/brightness |
| SW01 | **NEW:** Light Saber start up | Star-Wars-style effect; one-shot impact, 1.7 s, mixed, mid, falling pitch/brightness |
| SW02 | **NEW:** Light saber on | Star-Wars-style effect; one-shot, decaying tail, 28.3 s, tonal, dull/low, repeating / rattling, steady pitch ~91 Hz |
| SW03 | **NEW:** Star Wars intro theme song | Star-Wars-style effect; varying, 93.1 s, tonal, mid |
| SW04 | **NEW:** Star Wars theme song | Star-Wars-style effect; varying, 94.0 s, tonal, mid |
| SW05 | **NEW:** Retracting light sabre | Star-Wars-style effect; rising / charge-up, 1.3 s, mixed, mid, rising pitch/brightness |
| SW06 | **NEW:** Saber hit | Star-Wars-style effect; one-shot impact, 1.0 s, mixed, mid, repeating / rattling |
| SW07 | **NEW:** Sabers clash | Star-Wars-style effect; one-shot, decaying tail, 1.0 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| SW08 | **NEW:** Saber clash | Star-Wars-style effect; one-shot, decaying tail, 0.8 s, mixed, mid, falling pitch/brightness |
| SW10 | **NEW:** Saber swing | Star-Wars-style effect; sustained / loop-like, 0.6 s, tonal, dull/low, steady pitch ~98 Hz |
| SW11 | **NEW:** Saber swing | Star-Wars-style effect; one-shot, decaying tail, 0.5 s, tonal, dull/low, steady pitch ~94 Hz |
| SW13 | **NEW:** Swinging saber | Star-Wars-style effect; one-shot, decaying tail, 1.4 s, tonal, dull/low, repeating / rattling, steady pitch ~93 Hz |
| SW14 | **NEW:** Swinging saber | Star-Wars-style effect; one-shot, decaying tail, 1.3 s, tonal, dull/low, repeating / rattling, steady pitch ~98 Hz |
| SW15 | **NEW:** Short saber swing | Star-Wars-style effect; sustained / loop-like, 0.3 s, tonal, dull/low, steady pitch ~97 Hz |
| SW16 | **NEW:** Humming | Star-Wars-style effect; one-shot, decaying tail, 0.3 s, tonal, dull/low, steady pitch ~94 Hz |
| SW17 | **NEW:** Swing saber | Star-Wars-style effect; sustained / loop-like, 0.8 s, tonal, dull/low, repeating / rattling |
| SW18 | **NEW:** Dual saber | Star-Wars-style effect; sustained / loop-like, 0.8 s, tonal, dull/low, repeating / rattling |
| SW19 | **NEW:** Multiple saber swings | Star-Wars-style effect; sustained / loop-like, 1.2 s, tonal, dull/low, repeating / rattling, steady pitch ~97 Hz, rising pitch/brightness |
| SW20 | **NEW:** Saber swing | Star-Wars-style effect; one-shot, decaying tail, 0.6 s, tonal, dull/low |
| SW21 | **NEW:** Saber swing | Star-Wars-style effect; one-shot, decaying tail, 0.7 s, tonal, dull/low, steady pitch ~92 Hz |
| SW23 | **NEW:** Blaster saber | Star-Wars-style effect; one-shot impact, 0.9 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| SW24 | **NEW:** Saber hit | Star-Wars-style effect; one-shot impact, 0.7 s, mixed, mid, falling pitch/brightness |
| SW25 | **NEW:** Blaster blocked w saber | Star-Wars-style effect; one-shot impact, 0.9 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| SW26 | **NEW:** Weird blaster with follow up bang | Star-Wars-style effect; one-shot, decaying tail, 2.2 s, tonal, mid, repeating / rattling |
| SW28 | **NEW:** Swish | Star-Wars-style effect; one-shot, decaying tail, 0.6 s, tonal, mid, falling pitch/brightness |
| SW29 | **NEW:** Explosion | Star-Wars-style effect; one-shot, decaying tail, 2.3 s, tonal, mid, falling pitch/brightness |
| SW30 | **NEW:** Big blaster cannon? | Star-Wars-style effect; one-shot impact, 1.9 s, tonal, dull/low, falling pitch/brightness |
| SW31 | **NEW:** Hall choir star wars song | Star-Wars-style effect; sustained / loop-like, 60.8 s, tonal, mid |
| SW32 | **NEW:** Saber burning or slicing something | Star-Wars-style effect; one-shot, decaying tail, 1.4 s, mixed, mid |
| SW33 | **NEW:** Saber burning or slicing something | Star-Wars-style effect; one-shot, decaying tail, 1.4 s, mixed, bright |
| SW34 | **NEW:** Blaster shot rifle style | Star-Wars-style effect; one-shot impact, 1.4 s, tonal, mid, falling pitch/brightness |
| SW35 | **NEW:** Blaster | Star-Wars-style effect; one-shot impact, 1.0 s, tonal, mid, falling pitch/brightness |
| SW36 | **NEW:** Blaster | Star-Wars-style effect; one-shot impact, 0.7 s, mixed, mid |
| SW37 | **NEW:** Blaster turret | Star-Wars-style effect; one-shot impact, 1.0 s, mixed, mid, repeating / rattling, falling pitch/brightness |
| SW38 | **NEW:** Standard blaster | Star-Wars-style effect; one-shot impact, 0.9 s, mixed, mid, falling pitch/brightness |
| SW39 | **NEW:** Rifle blaster | Star-Wars-style effect; one-shot impact, 1.5 s, tonal, dull/low, falling pitch/brightness |
| SW40 | **NEW:** Blaster | Star-Wars-style effect; one-shot impact, 0.9 s, mixed, mid, falling pitch/brightness |
| T14 | **NEW:** grenade launcher? | gunshot; one-shot impact, 0.9 s, tonal, dull/low, repeating / rattling |
| X13 | **NEW:** small explode | grenade / explosion; one-shot impact, 1.5 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| X17 | **NEW:** concussion grenade | grenade / explosion; one-shot impact, 7.9 s, tonal, mid, repeating / rattling |
| X28 | **NEW:** explode with echo | grenade / explosion; one-shot impact, 6.7 s, tonal, mid |
| X30 | **NEW:** bomb | grenade / explosion; one-shot impact, 8.1 s, tonal, dull/low, repeating / rattling, falling pitch/brightness |
| Z11 | **NEW:** infected blaster | creature splat; one-shot impact, 1.2 s, mixed, mid, repeating / rattling, falling pitch/brightness |

### 224 ids where the community label differs from ours

| id | community label | our description |
|---|---|---|
| V02 | Vanguard gassed | Ah! Ah! Ah! Ah! Ah! |
| V06 | Man recovering | (hurt loop, no words) |
| V100 | Yell | AHHHHHHHHH! |
| V12 | Nexus gassed; Vanguard pain? | (idle loop, no words) |
| V13 | more | AHHHHHHHHHH |
| V133 | (Halo) Flag Captured | Flight Captured! |
| V14 | again | AHHHHHHHHH |
| V140 | (Halo) Flag-sasination | flight assassination |
| V141 | (Halo) Flag Runner | Flight Runner! |
| V144 | (Halo) Flag joust | FLAG JOST! |
| V15 | still pain | HELLO! |
| V16 | infected grunting and breathing; again, maybe recovery | (hurt loop, no words) |
| V1A | Terminated | Germany did |
| V1C | Hurt | Mm-hmm |
| V1D | hurt again | NGH! |
| V1E | more hurt | Oh |
| V1F | Again | (pain, no words) |
| V1G | still hurt | Oh |
| V1H | more | MWAH! |
| V1J | vanguard electruction? | (long death, no words) |
| V21 | Shields Overwhelming | Shields over a mile mean. |
| V22 | vanguard coughing | (idle loop, no words) |
| V26 | more infected breathing | Oh |
| V36 | Recovery | Hmm. Hmm. Hmm. |
| V46 | animal recovering | Uhhh! Uhhhh! Uhhhh! |
| V51 | RWAR? So much audio bad | HMMMMMMMMMMMMMMMMMMM |
| V52 | infected struggling; Zombie/Beast noises | The End |
| V53 | Zombie/Beast noises | R-r-r-rrrrrrrr |
| V54 | Zombie/Beast noises | HELLO! |
| V55 | Zombie/Beast noises | HELLO! |
| V56 | infected russling around and grunting; Zombie/Beast noises | A bug! A bug! A bug... |
| V57 | Zombie/Beast noises | GRR! |
| V58 | Zombie/Beast noises | THANKS FOR WATCHING! |
| V59 | Zombie/Beast noises | THANKS FOR WATCHING!! |
| V61 | Surge | FIRGE! |
| V6J | infected getting electricuted | (long death, no words) |
| V72 | Nexus being gassed; Cough | The poor. |
| V73 | pain | Arrrrggggggghhh! |
| V74 | yell | OWWWWWWWW |
| V75 | more yell | (death scream, no words) |
| V76 | Infected struggling; recovery | (hurt loop, no words) |
| V77 | Amped up | Top |
| V79 | Forward | BYE! |
| V7J | ticked of infected | NoooooooooOOOOoooooOoOoOooOoOoOд Woooohoooo www. Level 4 W O W |
| V7M | Maurader | the hotter. |
| V81 | Meds Here | Med's here. |
| V82 | cough | Ahem. Ahem. |
| V83 | pain | Ah! |
| V84 | yell | AHHHHH! |
| V85 | more yell | AHHHHHH! |
| V86 | Female catching breath; Recovery? | HMM! HMM! HMM! HMM! |
| V88 | Steralized | Sterilized. |
| V89 | Steralized | sterilized. |
| V8J | being electricuted | Mmm, mmm, mmm, mmm握握,丨握握握 grams I'm out! |
| V93 | pain | Agh! |
| V94 | Pain | Uggggggggggggggggggggggg |
| V95 | Pain | URGH! |
| V96 | Animal recovering; Recovery? | Ah |
| V99 | Toasted | Coasted! |
| VA01 | 1.0 | one. |
| VA04 | 4.0 | Four. |
| VA05 | 5.0 | Five. |
| VA06 | 6.0 | Six. |
| VA07 | 7.0 | seven |
| VA09 | 9.0 | Nine. |
| VA0H | 17.0 | Seventeen. |
| VA0Q | 30 Minutes; 30 min; 7 MINUTES | Seven minutes. |
| VA12 | Air Strike Detected | Airstrike detected. |
| VA18 | Batton | Baton |
| VA1C | Blackhawk Inbound | Black Hawk inbound. |
| VA1E | BlindEye | Blind Eye. |
| VA1H | The Bomb has been diffused; BOMB DIFUSED | BOMB DEFUSED |
| VA1J | Bo Staff | Bow staff. |
| VA1K | Bow | BOO |
| VA2 | Coughing | Ehehhehehehhehheheheh h! ehehheheheeh ruler ugh |
| VA25 | Deadeye | dead eye. |
| VA26 | DeathMatch; DEATH MATCH | Deathmatch |
| VA2E | This games a draw; DRAW GAME | Raw Game! |
| VA2F | Dual Wield | Do a wheeled. |
| VA2S | 5 minutes; 5 min; FIVE MINUTES | Five minutes. |
| VA2U | Flash Bang | Flashbang! |
| VA2W | Focus; LASER SIGHT | laser sight |
| VA2X | Fore grip; ACCURACY | Accuracy. |
| VA3 | Scream | AHHHHHH |
| VA3F | Headset Removed; HEADSET DISCONNECTED | headset disconnected. |
| VA3N | Hollow Point | Hallow Point. |
| VA3O | WHUUHOOO | Woo-hoo! |
| VA3P | WHUU | Woo! |
| VA3Q | YEEAAAHH | Yeah! |
| VA3R | Hostage Died; HOSTAGE DOWN | Hostage down. |
| VA3Z | Install Accessory; PAIRING MODE | fairing mode |
| VA4 | Pain sound | HUUUUUUUUUUUUUUUUU |
| VA46 | Lives depleted | Life's depleted. |
| VA4C | Maul | Mall. |
| VA4D | Medkit; Med kit | Medkit. |
| VA5 | another yell | HAAA! |
| VA53 | Regen | region. |
| VA5I | Sentry deployed | Century Deployed. |
| VA5J | Sentry | Century. |
| VA5K | Shield equiped | Shield equipped. |
| VA5N | Seige | Siege |
| VA5P | 6 Minutes | Six minutes. |
| VA5Y | SR100; Sr-100 | SR 100. |
| VA5Z | Standard; ADMIN UNLOCKED | Admin Unlocked. |
| VA6 | ouch heavy breathing; Breathing | Ah. Ah. Ah. |
| VA60 | Stealth; Stealth outdoor; NIGHT MODE | Night Mode. |
| VA62 | Supremecy; Supremacy | Supremacy! |
| VA63 | Supressor | Suppressor |
| VA6A | Tac87; Tac-87 | TAC 87. |
| VA6B | Tar33 | TAR 33. |
| VA6G | Tear Gas | Tier Gas |
| VA6L | Three, Two, One; 36952.0 | Three, two, one. |
| VA6T | UAV | UAB |
| VA6U | Under Cover | Undercover. |
| VA78 | Welcome to Lasertag Pro | Welcome to Battle Company! |
| VA7J | Killamanjaro; KILLAMENJARO | Kill them in Juro! |
| VA7L | Killionaire | Killian Air |
| VA7M | Killtacular; KILL TACULAR | GO TACULAR! |
| VA7N | Killtastrophy; KILL TASTRIFY | Joltastrophe |
| VA7O | Killtrosity; KILL TROSITY | CULTURUSITY |
| VA7Q | Triple Kill; TRIPPLE KILL | Triple Kill! |
| VA81 | Three, Two, One; 3, 2, 1, WITH MUSIC | Three, two, one. |
| VA83 | Countdown from 10; 10, 9, ..., 0 | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. |
| VA84 | Countdown from 10; 10, 9, ... 0 W MUSIC | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. |
| VA85 | Countdown from 10; 10, 9, ..., 0 | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. |
| VA88 | Armor Depleated | Armored depleted. |
| VA8C | Shields Online | SHIELD ONLINE |
| VA8F | "Assault"; SHARED LIVES | Shared lives. |
| VA8O | "Brawl"; GUN GAME | GUN GAME! |
| VA8V | "Devices cleared"; PAIRING CLEARED | pairing cleared |
| VA90 | "HUD Disconnected" | How Disconnected. |
| VA9C | "Primary boot loader"; PRIMARY BOOT LOADER | Primary bootloader. |
| VA9E | "Primary"; ADMIN LOCKED | Admin locked. |
| VA9F | "Proximity mine" | Proximity Mind. |
| VA9H | "Respawn Station"; Respawn Station | RESPONSE STATION |
| VA9K | "Secondary Boot Loader"; SECONDARY BOOT LOADER | Secondary bootloader. |
| VA9M | "Secondary"; ADMIN FULL LOCKED | Admin full arc. |
| VA9O | "Silenced AR"; Silenced AR | Silence, they are |
| VA9R | "Testing initiated"; TEST MODE | Test mode. |
| VAC | Another yell | HAH! |
| VAE | Cough pain | AHHHHH! |
| VAF | more pain | Aargh! |
| VAG | more hurt | Huh! |
| VAH | another hurt | HUH! |
| VAJ | Ummmmm electruction? | NONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONONON |
| VAN | HuRah | Hoorah! |
| VB09 | Codes Captured | Code's captured! |
| VB0A | Codes compromised | Code's compromised. |
| VB0P | Hill Controlled; HILL LOST | Hill Lost! |
| VB0Z | Purple flag has been returned; PRPLE FLAG RETURNED | Purple Flag Returns. |
| VB1C | White flag has been taken; CYAN FLAG TAKEN | Sion Flag Ticken |
| VB1S | White team wins; CYAN TEAM WINS | SCIENTEAM WINS! |
| VB2 | coughing; Female gassed | (idle loop, no words) |
| VB3 | hurt | Ah! Ah! Ah! |
| VB4 | yell | AHHHHH! |
| VB5 | more hurt | Uuugh! |
| VB6 | heavy breathing; female recovering | Ah |
| VBC | yell | HUH! |
| VBD | yell | HUH |
| VBE | hurt | Uwaaah! |
| VBF | more hurt | UGH! |
| VBG | hurt agin | Ugh! |
| VBH | ouch | Uh! |
| VBI | Lets Move | Let's move! |
| VBJ | uh electrocution? | Wheeeeeelllllllllllllll |
| VBL | Hmf to easy | too easy |
| VBM | Stout | Scout |
| VCM | Sentinel | SET NO! |
| VD2 | female coughing | Cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, cough, |
| VD6 | technician catching breath | Sigh... Sigh... Sigh... |
| VE2 | guy being gassed | Ah. Oh. Ah. Oh. Oh. Oh. Oh. |
| VFJ | nexus suffering or gassed | BOOM! |
| VGJ | sniper or technician being electricuted | boop boop boop boop doop boop boop |
| VGL | Good thing the medigel capsules didnt explode in the allies this time | Ooh, I'm glad my meta gel didn't explode in the allies this time! Haha! |
| VH2 | Male gassed | Ahem Ahem |
| VHJ | guy veing electricuted | HUUUUUUUM |
| VJ6 | man recovering from injury | No... No... No... |
| VKM | Wraith | Drayf |
| VM2 | female coughing | IT'S HOTTEN TO BE THE GUN |
| VM6 | guy catching breath | (hurt loop, no words) |
| VN2 | Ouch and lots of coughing; man gassed | Ah! Ah! Ah! Ah! Ah! Ah! |
| VN3 | argh | UGH! |
| VN4 | Scream | DAAAAAAA |
| VN5 | hurt | URGH! |
| VN6 | deep breaths; Man recovering | (hurt loop, no words) |
| VN8 | Kill Confirmed | Co-confirmed |
| VND | HU | Ha! |
| VNE | AHH | UGH! |
| VNF | another hurt | Oh |
| VNG | more hurt | Huh! |
| VNH | hurt again | UGH! |
| VNJ | UMMM long hurt; guy pushing out a poop | HUUUUUUUUUUUUUUUUUUUUUUUUUUUUU UGH UGH |
| VPJ | man being electricuted | Uuughhhhhh! |
| VQB | infected 10 second count down | Ten, nine, eight, seven, six, five, four, three, two, one. |
| VRA | vanguard ten second countdown | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. |
| VSB | ten second count down; Countdown from 10; 10-0 COUNT DOWN W MUSIC | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1. |
| VSD | 2 minutes remaining; 2 MINUTES REMAIN | Two minutes remain. |
| VX01 | 1.0 | ONE. |
| VX02 | 2.0 | too. |
| VX04 | 4.0 | Four. |
| VX0A | DUAL WIELD | dual wheeled |
| VX0O | BRAWL | Browse |
| VX0Q | AIR STRIKE | Airstrike |
| VX0V | EMP PULES | EMP Pulse |
| VX12 | 12.0 | well. |
| VX1A | FOREGRIP | For grip. |
| VX1C | CARE PACKAGE | Share Package! |
| VX1H | KILL STREAK READY | Killstreak Ready! |
| VX67 | STEM PACK | Stimpak! |
| VX74 | REGENERATION ROUNDS | READ GENERATION ROUNDS |
| VX83 | MINI ROCKETS | Many Rockets! |
| VX88 | LIFE STEAL | Lifesteal |
| VX89 | KILL STRIKE READY | Killstrike ready! |
| VZ0D | CROSS BOW | Crossbow! |
| VZ0G | DROID AUTO BLASTER | DROID AUTOBLASTER |
| VZ0N | ENERGY SHOT GUN | Energy Shotgun. |
| VZ0Q | FLAME THROWER | Flamethrower |
| VZ0U | GATTLING GUN | Gatling gun! |
| VZ0W | INCINDIARY RIFLE | Incendiary Rifle |
| VZ1I | SUB MACHINE GUN | Submachine gun. |
| VZ1N | STEAM BOLT SUB MACHINE GUN | Steambolt submachine gun. |
| VZ1O | STORM TROOPER RIFLE | Stormtrooper Rifle |
| VZ1P | SUSTAINED FIRE SUB MACHINE GUN | Sustain Fire Submachine Gun. |
| VZ1Q | TAISER RIFLE | Taser Rifle |

### 20 ids the community reports as broken since firmware v4.30

Reported NOISE on the sheet's "update audio V4_30" tab. Pending our own ear check (S1, `docs/FOLLOWUPS.md`); not shipped in any game config.

`HM10`, `HM11`, `HM12`, `HM13`, `HM14`, `HM1B`, `HM1F`, `HM1O`, `HM25`, `MC2J`, `MM0A`, `TK0W`, `TK0Z`, `TK14`, `TK15`, `TK19`, `TK1R`, `TK2R`, `TK2V`, `TK2W`
