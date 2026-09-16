# `ack_config` -- what each gun echoed (F207, F201)

`gun_echo` is the gun's answer to the head. Compare its 4th token (reserve) against the
`$WEAP,0` t17 in `heads.md`, then against that frame's t40. Every row: t17/2 == the echo.

| t_recv | node | config_id | ok | gun_echo |
|---|---|---|---|---|
| 1789338936787 | `node-008a563e38` | `84672599` | True | `$ALCD,8,100,0,24,0,*` |
| 1789338936841 | `node-daeed47068` | `84672599` | True | `$ALCD,8,100,0,24,0,*` |
| 1789339463282 | `node-008a563e38` | `50daa4d3` | True | `$ALCD,14,100,0,28,0,*` |
| 1789339463340 | `node-daeed47068` | `50daa4d3` | True | `$ALCD,36,100,0,108,0,*` |
| 1789339585589 | `node-daeed47068` | `08c808f4` | True | `$ALCD,36,100,0,108,0,*` |
| 1789339585779 | `node-008a563e38` | `08c808f4` | True | `$ALCD,14,100,0,28,0,*` |
