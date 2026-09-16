# The compiled heads MC pushed, 2026-09-13 session 3782dc77

Straight out of `matches.config`. This is what each gun was actually told, byte for byte -- not
what the compiler would emit today. Player ids: 6748d5e1 = ROCCO (player 1), 002803e7 = TONY (2).

## fba981640d -- ffa / indoor

```json
{
 "config_id": "84672599",
 "environment": "indoor",
 "health": {
  "max_armor": 0,
  "max_hp": 50
 },
 "loadout_policy": {
  "hud_select": false,
  "perk": {
   "choice": "fixed",
   "exclude_ids": [],
   "exclude_tags": [],
   "fixed_id": "extended_mags",
   "kinds": [
    "perk"
   ],
   "only_ids": []
  },
  "preset": "custom",
  "primary": {
   "choice": "fixed",
   "exclude_ids": [],
   "exclude_tags": [
    "heavy"
   ],
   "fixed_id": "sniper_rifle",
   "kinds": [
    "weapon"
   ],
   "only_ids": []
  },
  "secondary": {
   "choice": "off",
   "exclude_ids": [],
   "exclude_tags": [
    "heavy"
   ],
   "fixed_id": null,
   "kinds": [
    "weapon"
   ],
   "only_ids": []
  }
 },
 "mode": "ffa",
 "night": false,
 "presentation": {
  "announcer": true,
  "blackout": false,
  "events": {},
  "gun": {
   "in_play": "team",
   "pregame": "team"
  },
  "gun_flash": true,
  "headset": {
   "death": "native",
   "hit": null,
   "in_play": "dark",
   "pregame": "team",
   "respawn_flash": true,
   "role": true,
   "start_flash": true
  },
  "headset_team": true,
  "hud_events": true,
  "mc_confidence": true,
  "mc_events": true,
  "preset": "standard",
  "sight_flash": true,
  "voice": "on"
 },
 "respawn": {
  "delay_s": 5,
  "type": "auto"
 },
 "scoring": {
  "frag_limit": 25,
  "win_by": "kills"
 },
 "teams": [
  {
   "color": "#e8eef5",
   "name": "FREE-FOR-ALL",
   "team_id": "ffa",
   "tid": 1
  }
 ],
 "time_limit_s": 600
}
```

### head -> 6748d5e1

```
$VOL,80,0,*
$CLEAR,*
$START,*
$GSET,1,0,1,0,1,0,50,1,*
$PSET,1,0,50,0,70,50,,H44,JAD,VH5,,,,,VH7,H06,,H02,H22,X49,U15,W71,A10,*
$WEAP,0,,100,0,1,60,0,,,,,,,,1500,850,8,48,1700,0,7,100,100,,0,,,S16,D20,D19,,D04,D03,D02,D18,,,,,8,24,75,*
$WEAP,4,1,90,13,1,90,0,,,,,,,,1000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*
$SIR,0,0,,28,0,0,1,,*
$SIR,0,1,,28,0,0,1,,*
$SIR,0,3,,28,0,0,1,,*
$SIR,8,0,,28,0,0,1,,*
$SIR,9,3,,28,0,0,1,,*
$SIR,10,0,,28,0,0,1,,*
$SIR,6,0,,28,0,0,1,,*
$SIR,13,1,,28,0,0,1,,*
$SIR,13,0,,28,0,0,1,,*
$SIR,13,3,,28,0,0,1,,*
$BMAP,0,0,,,,,*
$BMAP,1,100,0,0,99,99,*
$BMAP,2,97,,,,,*
$BMAP,3,98,,,,,*
$BMAP,4,98,,,,,*
$BMAP,5,98,,,,,*
$BMAP,8,4,,,,,*
$HLED,6,0,,,10,,*
$GLED,6,6,6,0,10,,*
$TID,1,*
```

### head -> 002803e7

```
$VOL,80,0,*
$CLEAR,*
$START,*
$GSET,1,0,1,0,1,0,50,1,*
$PSET,2,0,50,0,70,50,,H44,JAD,V94,,,,,V97,H06,,H02,H22,X49,U15,W71,A10,*
$WEAP,0,,100,0,1,60,0,,,,,,,,1500,850,8,48,1700,0,7,100,100,,0,,,S16,D20,D19,,D04,D03,D02,D18,,,,,8,24,75,*
$WEAP,4,1,90,13,1,90,0,,,,,,,,1000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*
$SIR,0,0,,28,0,0,1,,*
$SIR,0,1,,28,0,0,1,,*
$SIR,0,3,,28,0,0,1,,*
$SIR,8,0,,28,0,0,1,,*
$SIR,9,3,,28,0,0,1,,*
$SIR,10,0,,28,0,0,1,,*
$SIR,6,0,,28,0,0,1,,*
$SIR,13,1,,28,0,0,1,,*
$SIR,13,0,,28,0,0,1,,*
$SIR,13,3,,28,0,0,1,,*
$BMAP,0,0,,,,,*
$BMAP,1,100,0,0,99,99,*
$BMAP,2,97,,,,,*
$BMAP,3,98,,,,,*
$BMAP,4,98,,,,,*
$BMAP,5,98,,,,,*
$BMAP,8,4,,,,,*
$HLED,6,0,,,10,,*
$GLED,6,6,6,0,10,,*
$TID,1,*
```

## a1003b7ae7 -- tdm / outdoor

```json
{
 "config_id": "50daa4d3",
 "environment": "outdoor",
 "health": {
  "max_armor": 70,
  "max_hp": 45
 },
 "loadout_policy": {
  "hud_select": true,
  "perk": {
   "choice": "player",
   "exclude_ids": [],
   "exclude_tags": [],
   "fixed_id": null,
   "kinds": [
    "perk"
   ],
   "only_ids": []
  },
  "preset": "open",
  "primary": {
   "choice": "player",
   "exclude_ids": [],
   "exclude_tags": [],
   "fixed_id": null,
   "kinds": [
    "weapon"
   ],
   "only_ids": []
  },
  "secondary": {
   "choice": "player",
   "exclude_ids": [],
   "exclude_tags": [],
   "fixed_id": null,
   "kinds": [
    "weapon"
   ],
   "only_ids": []
  }
 },
 "mode": "tdm",
 "night": false,
 "presentation": {
  "announcer": true,
  "blackout": false,
  "events": {},
  "gun": {
   "in_play": "team",
   "pregame": "team"
  },
  "gun_flash": true,
  "headset": {
   "death": "native",
   "hit": null,
   "in_play": "dark",
   "pregame": "team",
   "respawn_flash": true,
   "role": true,
   "start_flash": true
  },
  "headset_team": true,
  "hud_events": true,
  "mc_confidence": true,
  "mc_events": true,
  "preset": "standard",
  "sight_flash": true,
  "voice": "on"
 },
 "respawn": {
  "delay_s": 15,
  "type": "auto"
 },
 "scoring": {
  "frag_limit": 25,
  "win_by": "kills"
 },
 "teams": [
  {
   "color": "#3a86ff",
   "name": "BLUE TEAM",
   "team_id": "blue",
   "tid": 1
  },
  {
   "color": "#ffd23f",
   "name": "YELLOW TEAM",
   "team_id": "yellow",
   "tid": 2
  }
 ],
 "time_limit_s": 600
}
```

### head -> 6748d5e1

```
$VOL,90,0,*
$CLEAR,*
$START,*
$GSET,0,0,1,0,1,0,50,1,*
$PSET,1,0,45,120,70,50,,H44,JAD,VH5,,,,,VH7,H06,,H02,H22,X49,U15,W71,A10,*
$WEAP,0,,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*
$WEAP,1,2,100,0,0,45,0,,,,,,70,80,800,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*
$WEAP,4,1,90,13,1,90,0,,,,,,,,1000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*
$SIR,0,0,,28,0,0,1,,*
$SIR,0,1,,28,0,0,1,,*
$SIR,0,3,,28,0,0,1,,*
$SIR,8,0,,28,0,0,1,,*
$SIR,9,3,,28,0,0,1,,*
$SIR,10,0,,28,0,0,1,,*
$SIR,6,0,,28,0,0,1,,*
$SIR,13,1,,28,0,0,1,,*
$SIR,13,0,,28,0,0,1,,*
$SIR,13,3,,28,0,0,1,,*
$BMAP,0,0,,,,,*
$BMAP,1,100,0,1,99,99,*
$BMAP,2,97,,,,,*
$BMAP,3,98,,,,,*
$BMAP,4,98,,,,,*
$BMAP,5,98,,,,,*
$BMAP,8,4,,,,,*
$HLED,1,0,,,10,,*
$GLED,1,1,1,0,10,,*
$TID,1,*
```

### head -> 002803e7

```
$VOL,90,0,*
$CLEAR,*
$START,*
$GSET,0,0,1,0,1,0,50,1,*
$PSET,2,0,45,120,70,50,,H44,JAD,V93,,,,,V97,H06,,H02,H22,X49,U15,W71,A10,*
$WEAP,0,,100,0,3,24,0,,,,,,,,400,850,14,56,1400,0,7,100,100,,0,,,S07,D20,D19,,D04,D03,D02,D18,,,,,14,28,75,*
$WEAP,1,2,100,0,0,45,0,,,,,,70,80,800,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*
$WEAP,4,1,90,13,1,90,0,,,,,,,,1000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*
$SIR,0,0,,28,0,0,1,,*
$SIR,0,1,,28,0,0,1,,*
$SIR,0,3,,28,0,0,1,,*
$SIR,8,0,,28,0,0,1,,*
$SIR,9,3,,28,0,0,1,,*
$SIR,10,0,,28,0,0,1,,*
$SIR,6,0,,28,0,0,1,,*
$SIR,13,1,,28,0,0,1,,*
$SIR,13,0,,28,0,0,1,,*
$SIR,13,3,,28,0,0,1,,*
$BMAP,0,0,,,,,*
$BMAP,1,100,0,1,99,99,*
$BMAP,2,97,,,,,*
$BMAP,3,98,,,,,*
$BMAP,4,98,,,,,*
$BMAP,5,98,,,,,*
$BMAP,8,4,,,,,*
$HLED,2,0,,,10,,*
$GLED,2,2,2,0,10,,*
$TID,2,*
```

## f46fdd96e1 -- ffa / outdoor

```json
{
 "config_id": "08c808f4",
 "environment": "outdoor",
 "health": {
  "max_armor": 70,
  "max_hp": 45
 },
 "loadout_policy": {
  "hud_select": true,
  "perk": {
   "choice": "player",
   "exclude_ids": [],
   "exclude_tags": [],
   "fixed_id": null,
   "kinds": [
    "perk"
   ],
   "only_ids": []
  },
  "preset": "no_heavies",
  "primary": {
   "choice": "player",
   "exclude_ids": [],
   "exclude_tags": [
    "heavy"
   ],
   "fixed_id": null,
   "kinds": [
    "weapon"
   ],
   "only_ids": []
  },
  "secondary": {
   "choice": "player",
   "exclude_ids": [],
   "exclude_tags": [
    "heavy"
   ],
   "fixed_id": null,
   "kinds": [
    "weapon"
   ],
   "only_ids": []
  }
 },
 "mode": "ffa",
 "night": false,
 "presentation": {
  "announcer": true,
  "blackout": false,
  "events": {},
  "gun": {
   "in_play": "team",
   "pregame": "team"
  },
  "gun_flash": true,
  "headset": {
   "death": "native",
   "hit": null,
   "in_play": "dark",
   "pregame": "team",
   "respawn_flash": true,
   "role": true,
   "start_flash": true
  },
  "headset_team": true,
  "hud_events": true,
  "mc_confidence": true,
  "mc_events": true,
  "preset": "standard",
  "sight_flash": true,
  "voice": "on"
 },
 "respawn": {
  "delay_s": 15,
  "type": "auto"
 },
 "scoring": {
  "frag_limit": 25,
  "win_by": "kills"
 },
 "teams": [
  {
   "color": "#e8eef5",
   "name": "FREE-FOR-ALL",
   "team_id": "ffa",
   "tid": 1
  }
 ],
 "time_limit_s": 600
}
```

### head -> 6748d5e1

```
$VOL,90,0,*
$CLEAR,*
$START,*
$GSET,1,0,1,0,1,0,50,1,*
$PSET,1,0,45,120,70,50,,H44,JAD,VH5,,,,,VH7,H06,,H02,H22,X49,U15,W71,A10,*
$WEAP,0,,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*
$WEAP,1,2,100,0,0,45,0,,,,,,70,80,800,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*
$WEAP,4,1,90,13,1,90,0,,,,,,,,1000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*
$SIR,0,0,,28,0,0,1,,*
$SIR,0,1,,28,0,0,1,,*
$SIR,0,3,,28,0,0,1,,*
$SIR,8,0,,28,0,0,1,,*
$SIR,9,3,,28,0,0,1,,*
$SIR,10,0,,28,0,0,1,,*
$SIR,6,0,,28,0,0,1,,*
$SIR,13,1,,28,0,0,1,,*
$SIR,13,0,,28,0,0,1,,*
$SIR,13,3,,28,0,0,1,,*
$BMAP,0,0,,,,,*
$BMAP,1,100,0,1,99,99,*
$BMAP,2,97,,,,,*
$BMAP,3,98,,,,,*
$BMAP,4,98,,,,,*
$BMAP,5,98,,,,,*
$BMAP,8,4,,,,,*
$HLED,6,0,,,10,,*
$GLED,6,6,6,0,10,,*
$TID,1,*
```

### head -> 002803e7

```
$VOL,90,0,*
$CLEAR,*
$START,*
$GSET,1,0,1,0,1,0,50,1,*
$PSET,2,0,45,120,70,50,,H44,JAD,V95,,,,,V97,H06,,H02,H22,X49,U15,W71,A10,*
$WEAP,0,,100,0,3,24,0,,,,,,,,400,850,14,56,1400,0,7,100,100,,0,,,S07,D20,D19,,D04,D03,D02,D18,,,,,14,28,75,*
$WEAP,1,2,100,0,0,45,0,,,,,,70,80,800,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*
$WEAP,4,1,90,13,1,90,0,,,,,,,,1000,100,1,0,0,10,13,100,100,,0,0,,M92,,,,,,,,,,,,1,0,20,*
$SIR,0,0,,28,0,0,1,,*
$SIR,0,1,,28,0,0,1,,*
$SIR,0,3,,28,0,0,1,,*
$SIR,8,0,,28,0,0,1,,*
$SIR,9,3,,28,0,0,1,,*
$SIR,10,0,,28,0,0,1,,*
$SIR,6,0,,28,0,0,1,,*
$SIR,13,1,,28,0,0,1,,*
$SIR,13,0,,28,0,0,1,,*
$SIR,13,3,,28,0,0,1,,*
$BMAP,0,0,,,,,*
$BMAP,1,100,0,1,99,99,*
$BMAP,2,97,,,,,*
$BMAP,3,98,,,,,*
$BMAP,4,98,,,,,*
$BMAP,5,98,,,,,*
$BMAP,8,4,,,,,*
$HLED,6,0,,,10,,*
$GLED,6,6,6,0,10,,*
$TID,1,*
```
