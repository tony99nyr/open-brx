# Mission Control warning-colour audit (2026-09-16)

This is a full list of every amber and red warning, alert or banner the Mission Control web console
(`webapp/mc/src`) can show, as of 2026-09-16. It was built by grepping the theme tokens (`T.warn` =
amber `#ffb020`, `T.bad` = red `#ff5252`, in `webapp/mc/src/tokens.ts`) and reading every call site.
Near-identical variants are merged into one row. The Suggestion column is for Tony: write "keep",
"quieter" or "remove" against each row. Line numbers are as of the NEXT MATCH change the same day, which
removed four items that are not listed: the GAMES recap banner, the GameEditPanel "LOCKED — {phase}" badge
and its recap hint, and the RECAP "KEEP THIS ROSTER?" CTA.

| # | Screen | Colour | Exact text | Shows when | Where (file:line) | Suggestion |
|---|---|---|---|---|---|---|
| 1 | App (crash boundary) | red | "▲ CONSOLE ERROR — {MESSAGE}" | any screen throws while rendering | App.tsx:24-25 | |
| 2 | App (pre-connect) | amber | "OPERATOR TOKEN REQUIRED — open the #tok=… link printed by the MC server, or paste the token above." | no snapshot yet and an operator token is required | App.tsx:38 | |
| 3 | CommandBar | red | "MC OFFLINE — RECONNECTING" + "SHOWING THE LAST SNAPSHOT — CLOCKS ARE FROZEN" / "NO SNAPSHOT YET — IS THE SERVER RUNNING?" | the socket is down and not mock/auth-pending | frame/CommandBar.tsx:28-34 | |
| 4 | CommandBar | amber | "▲ THE MC SERVER PREDATES THIS UI — RESTART IT (python -m brx_mcp.mc)" | the server is missing a feature this build needs | frame/CommandBar.tsx:35-39 | |
| 5 | CommandBar | red | "▲ {state.lan.warning}" | the server reports a bad LAN address (e.g. a WSL2 NAT address) | frame/CommandBar.tsx:45-49 | |
| 6 | CommandBar | red | "▲ INTERNET TUNNEL DOWN — PHONES FELL BACK TO WI-FI" + "{tunnel error or 'no reason given'}" | the internet tunnel drops mid-session | frame/CommandBar.tsx:54-59 | |
| 7 | CommandBar | red | dismissible toast: "▲ {error} ✕" / "▲ {notice.text} ✕" / "▲ {panicked} ✕" | the last API call threw, a notice is flagged bad, or a panic just ran | frame/CommandBar.tsx:97-113 | |
| 8 | CommandBar | amber | "Operator token needed ▸" | an operator token is required | frame/CommandBar.tsx:117-119 | |
| 9 | CommandBar | amber | "BENCH VOL {n}" | MC was started with `--bench-volume` | frame/CommandBar.tsx:126-131 | |
| 10 | CommandBar (panic menu) | red | "Safe every node in range? This clears and stops every gun." | operator taps Panic in the header menu | frame/CommandBar.tsx:151 | |
| 11 | Shared component | red | HazardButton: the PANIC/ABORT/CONFIRM KICK two-tap hazard-striped control, label text varies by caller | any destructive fleet-wide or per-node action | ui/index.tsx:186-196 (generic; called from CommandBar, Armed, EvictButton) | |
| 12 | Shared component | amber | SwitchConfirm — "▲ THIS DROPS YOUR UNSAVED TUNED GAME" / "▲ {split}" + the caller's action line | a tap would move the roster or drop a draft | ui/index.tsx:117-127 (generic; called from Games, Items) | |
| 13 | Armory | amber | "▲ RESTORED FROM {STAMP} · {n} PLAYER(S) CARRIED OVER FROM THE LAST SESSION — CHECK THE ROSTER BEFORE YOU KIT OUT." | a session was restored from disk on launch | screens/Armory.tsx:244-250 | |
| 14 | Armory | amber | "SENDING…" / "HOLDING" | a phone's match-log pull is in flight or stuck | screens/Armory.tsx:65-66 | |
| 15 | Armory | amber/red | AMBER/RED readiness count tiles | always shown, tallying the readiness board | screens/Armory.tsx:167-168 | |
| 16 | Armory / Items | red | battery percentage text | gun or phone battery below 30% | screens/Armory.tsx:267,350,454; screens/Items.tsx:111 | |
| 17 | Armory (gun card) | red/amber | per-gun blocker list: head + sentence-case hint, e.g. "GUN LINK LOST", "IDENTITY REVERTED — RE-STAMP $NAME", "ACKED AN OLDER CONFIG ({id}) — RE-PUSH", "GUN ECHO ≠ CONFIG", "GUN POOL ≠ CONFIG" | the server attaches a fault or advisory to a gun's readiness row | screens/Armory.tsx:375-388 (generic rendering site; server strings from mcp/brx_mcp/mc/state.py:238-240,3990,4003,4032) | |
| 18 | Armory | red/amber | "{IDENTITY}" tag (e.g. REVERTED) | an unclaimed gun's BLE identity check fails | screens/Armory.tsx:219 | |
| 19 | Armory | amber | "▲ WAITING FOR ITS GUN — SET IT ON THE PHONE" | a connected phone has no gun set | screens/Armory.tsx:490 | |
| 20 | Armory | amber | "{sha}{-dirty suffix}" | a phone reports a build stamped `-dirty` | screens/Armory.tsx:470-483 | |
| 21 | Armory | amber | "▲ {claimErr}" | a gamertag claim on a phone card is refused by the server | screens/Armory.tsx:509 | |
| 22 | Armory (Reach) | amber | "▲ THIS MC SERVER PREDATES BACKHAUL — restart it to get an internet join option" | the server has no internet-tunnel support | screens/Armory.tsx:683-685 | |
| 23 | Armory (Reach) | amber | "▲ EVERY PHONE ON THE INTERNET PATH WILL DROP AND MUST RESCAN THE QR. TURN OFF?" | operator is about to turn the tunnel off | screens/Armory.tsx:706-709 | |
| 24 | Armory (Reach) | red | "ERROR {detail}" | the tunnel process reports an error | screens/Armory.tsx:662-668 | |
| 25 | Items | amber | station status colour / border | a station has an attention flag or an arm is pending | screens/Items.tsx:64 | |
| 26 | Items | amber | "▲ {t}" — server-worded attention lines (e.g. phone armed for a different game, arm pending) | the server flags a mismatch between MC, the phone and its report | screens/Items.tsx:113-121 | |
| 27 | Items | amber | "▲ RELEASE SENDS THIS PHONE BACK TO ITS OWN HUD RIGHT NOW, EVEN LIVE — …" | operator taps RELEASE ▸ HUD (first tap) | screens/Items.tsx:139-141 | |
| 28 | Items | amber | "NO SOCKET" tag | a RELEASE send fails | screens/Items.tsx:175 | |
| 29 | Items | amber | "— OUT OF WI-FI" | a station phone has not reported recently | screens/Items.tsx:92 | |
| 30 | Kit | amber | CONTINUE button turns amber; "{names} IS/ARE STILL KITTING AND WILL LOSE THEIR SCREEN — CONTINUE ANYWAY?" | one or more rostered players are not ready | screens/Kit.tsx:178-197 | |
| 31 | Kit | amber/red | server refusal line, e.g. "{server error} — {names} — CONTINUE ANYWAY?", or "MC REFUSED THE OVERRIDE — {error}" | the server's 409 refuses KIT → LOBBY, or refuses the forced tap | screens/Kit.tsx:199-206 | |
| 32 | Kit | amber | "TRYING {WEAPON}" chip | a weapon try-out is running on that player's gun | screens/Kit.tsx:425 | |
| 33 | Kit | amber | "◆ {hp}/{armor} POOL" chip and POOL card | a player has a per-player health/armor override | screens/Kit.tsx:450,909-934 | |
| 34 | Kit | red | gun-link blink / "NO NODE" | the selected gun has no live node | screens/Kit.tsx:527,536 | |
| 35 | Kit | amber | "▲ DROPS {ITEM} — TAP AGAIN" | picking a weapon/perk would drop a conflicting pick | screens/Kit.tsx:605-606,635-636 | |
| 36 | Kit / Catalog | red | "▲" caution triangle, tooltip = the weapon's caution text | a weapon carries a `caution` note | screens/Kit.tsx:615,769; screens/Catalog.tsx:115 | |
| 37 | Kit | amber | "UNPROVEN" / "UNPROVEN ON HARDWARE" | a perk's effect is not yet proven on hardware | screens/Kit.tsx:641,820 | |
| 38 | Kit | amber | padlock icon + "LOCKED" | a slot's rule is fixed or off | screens/Kit.tsx:683,836 | |
| 39 | Kit | red | "A PRIMARY IS REQUIRED" | no primary weapon is selected | screens/Kit.tsx:714 | |
| 40 | Kit | amber | "▲ CHANGED FROM THEIR PHONE — YOURS WAS {LABEL}" + REAPPLY MINE | the phone overwrote the host's pick | screens/Kit.tsx:716-719 | |
| 41 | Kit | amber | "▲ TRYING OUT ON {PLAYER}'S GUN — HAVE THEM FIRE A FEW ROUNDS · POINT AWAY FROM OTHERS" | a weapon try-out is active | screens/Kit.tsx:793 | |
| 42 | Kit | red | "RANGE LOG: {NOTE}" | a range verdict was logged as an issue | screens/Kit.tsx:803 | |
| 43 | Kit | amber | hits-to-kill number | a weapon kills in 2 hits or fewer at the game's pool | screens/Kit.tsx:788 | |
| 44 | Kit | red | "PLAYER NUMBER MUST BE 1–63" | an invalid player number is typed | screens/Kit.tsx:884 | |
| 45 | Designer | amber | "▲ UNSAVED CHANGES — TAP AGAIN TO LEAVE WITHOUT SAVING" | leaving a dirty draft | screens/Designer.tsx:137 | |
| 46 | Designer | amber | "▲ THE MC SERVER PREDATES THIS UI — RULES PREVIEW LOCALLY BUT SAVE / PLAY WILL FAIL UNTIL YOU RESTART IT." | the server has no loadout-rules route | screens/Designer.tsx:200 | |
| 47 | Designer / Games | red | "▲ {BLOCKEDREASON}" — the phase-locked reason for armed/live ("GAME SETTINGS ARE LOCKED — THE MATCH IS {ARMED/LIVE}…") or an empty-pool reason | the config is locked by phase, or a required slot is empty | screens/Designer.tsx:256; screens/Games.tsx:57-58,338 | |
| 48 | Designer | amber | saved-name hint, e.g. name-taken warning | SAVE returns a naming problem | screens/Designer.tsx:262 | |
| 49 | Designer | amber | "▲ TONIGHT'S GAME STILL RUNS THE OLD VERSION" | the active game diverges from its saved preset | screens/Designer.tsx:265 | |
| 50 | Designer | red | "▲ {SLOT}'S FIXED PICK IS NOT IN THIS GAME — CHOOSE A DIFFERENT ONE." / "…ALLOW-LIST NAMES NOTHING THIS GAME HAS…" / "QUICK SWITCH NEEDS A SECONDARY…" / "{WEAPON} CANNOT BE PLAYED…" / "{SLOT}'S CLASS/ID FILTERS EXCLUDE EVERYTHING…" | a loadout slot's rule leaves nothing pickable | screens/Designer.tsx:337-342; screens/gameSummary.ts:122-131 | |
| 51 | Catalog | red | "NOT PLAYABLE · HIT ROW DEALS NO DAMAGE" | a weapon's `$SIR` row is known broken | screens/Catalog.tsx:121-126 | |
| 52 | Games | amber | "IN THE DRAFT BELOW" | the venue toggle is edited while GAMES is open | screens/Games.tsx:196 | |
| 53 | Games | amber | "▲ {WARNING}" (solid amber bar) | a `SETUP:` step or a "loadouts reset" config warning | screens/Games.tsx:212 | |
| 54 | Games | red | "▲ {CONFIG_ERRORS JOINED BY ·}" | the server's `validate()` rejects the config | screens/Games.tsx:218 | |
| 55 | Games | red | "CONFIRM DELETE" | deleting a saved game (second tap) | screens/Games.tsx:252 | |
| 56 | Games / Lobby | red | games-locked / roster-fault banner: "▲ {LOCKEDREASON}" for armed/live, or "▲ {ROSTERFAULT}" (e.g. "ONLY ONE SIDE HAS PLAYERS…") | the config is locked by phase, or the roster cannot play | screens/Games.tsx:336-341; screens/Lobby.tsx:140-145 | |
| 57 | Games / Lobby | amber | "TUNED — NOT SAVED" label | the active game is a tuned, unsaved draft | screens/Games.tsx:350,455 | |
| 58 | Games / Lobby | amber | "RE-PUSH CONFIG OVER {n} BLOCKED ▸" (button turns amber) | a re-push would still leave rows blocked | screens/Games.tsx:367-377; screens/Lobby.tsx:216-224 | |
| 59 | Games / Lobby | amber/red | status sentence, e.g. "No config echo from {guns} — headset off, or gun asleep?", "{n} gun(s) cannot start", the stale-ack sentence | the readiness rail has a wait, fault or stale ack | screens/Games.tsx:387-405; screens/Lobby.tsx:243-266 | |
| 60 | Games / Lobby | red | per-gun fault list: "▲ {head}" + sentence-case hint | a gun carries one or more blockers | screens/Games.tsx:412-421; screens/Lobby.tsx:283-290 | |
| 61 | Lobby | red | host-override risk block: "▲ {n} GUN(S) {HAS/HAVE} NEVER TAKEN THIS CONFIG: {names}" / "…NOT CONFIRMED THIS CONFIG: {names}" | operator is about to arm past an unconfigured or unconfirmed gun | ui/PreArmSummary.tsx:95-150 (rendered) Lobby.tsx:296-303 | |
| 62 | Lobby | red | host-override button label, e.g. "Push anyway, over {n} faults and {n} missing phones ▸" / "Arm anyway — {n} guns will play the head they are still holding: {names}" | operator forces a push or an arm past the gate | screens/Lobby.tsx:319-324 | |
| 63 | Lobby | amber | ready/ack counters ("{n}/{total}") | not everyone is ready or acked yet | screens/Lobby.tsx:194-195 | |
| 64 | Lobby | amber | "UNASSIGNED" column header | one or more players have no team | screens/Lobby.tsx:175 | |
| 65 | Lobby | red/amber | "{counts} — CANNOT PLAY" / "{counts} — UNBALANCED" | the roster is unplayable or lopsided | screens/Lobby.tsx:133-134 | |
| 66 | Lobby | amber | "CANNOT BE OVERRIDDEN — FIX THE ROSTER FIRST" | a roster fault stands and force cannot open it | screens/Lobby.tsx:145 | |
| 67 | GameEditPanel | amber | "▲ THE MATCH IS {PHASE} — MC REFUSES CONFIG EDITS ONCE IT HAS STARTED. RECALL FIRST, THEN EDIT." | the match is armed or live | ui/GameEditPanel.tsx:185-188 | |
| 68 | GameEditPanel | amber | "▲ THIS DISCARDS YOUR UNSAVED CHANGES" / "TAP CANCEL AGAIN TO DISCARD THEM" | cancelling a dirty edit draft | ui/GameEditPanel.tsx:232-235 | |
| 69 | GameEditPanel | amber | "UNSAVED: {FIELDS}" | the edit draft has unsaved fields | ui/GameEditPanel.tsx:245 | |
| 70 | LoadedGame | amber | "{n}/{total} GUNS CONFIRMED ON THIS CONFIG" / "CONFIG CHANGED — RE-PUSHING TO EVERY GUN… {n}/{total} CONFIRMED" / "GAME SENT TO {n}/{total} PHONES — THE REST ARE NOT CONNECTED" | not every gun/phone is caught up yet | ui/LoadedGame.tsx:97-141 | |
| 71 | SetupSteps | amber (solid) | "▲ {STEP}" | the server lists a `SETUP:` physical step | ui/SetupSteps.tsx:22-26 | |
| 72 | McVerify | amber | "▲ {state.notices.mc_verify}" | a game's win is settled at MC and some phones lack backhaul | ui/McVerify.tsx:22-26 | |
| 73 | UnrosteredPhones | amber | "▲ {n} CONNECTED PHONE(S) NOT IN THE ROSTER — CLAIM {IT/THEM} ON ARMORY ▸" | a connected phone's gun is claimed by nobody on the roster | ui/UnrosteredPhones.tsx:16-22 | |
| 74 | Lobby (PRE-ARM CHECK) | amber | verdict line: "{n} OF {total} PLAYER(S) NEED(S) ACTION — SEE BELOW" (amber); "NO GAME LOADED", "WAITING FOR {n} OF {total} GUNS TO CONFIRM", "EVERY PHONE HAS THE GAME — GUNS ARE CONFIGURED AT THE PUSH" are neutral grey | a game is loaded and at least one cell is a real failure | ui/PreArmSummary.tsx:227-236 | |
| 75 | Lobby (PRE-ARM CHECK) | amber + red ✕ cells | row text (only after a LOAD, only for a real failure): "No phone bound — switch it on and bind it, or STAND DOWN"; "Phone was not reachable at LOAD — LOAD again from GAMES"; "Gun has no head yet — PUSH CONFIG below"; "Gun has not confirmed this config — RE-PUSH CONFIG below"; "Gun answered with another weapon — RE-PUSH CONFIG below" | a player row has a failed PHONE, PUSHED, ACKED or ECHO cell (a push in flight is a neutral "…") | ui/PreArmSummary.tsx:281-287,314-319 | |
| 76 | Armed | amber | "RESCHEDULE" / "CONFIRM — RESTART EVERY COUNTDOWN AT {mm:ss}" | operator reschedules the go-live time | screens/Armed.tsx:54-59 | |
| 77 | Armed | red | "ABORT REACHES ONLY NODES IN RANGE ({n}/{total}) — RESCHEDULE INSTEAD?" | operator taps ABORT (first tap) while nodes are out of range | screens/Armed.tsx:62 | |
| 78 | Armed | amber | "GUNS COUNT DOWN ON THEIR OWN — PLAYERS MAY SCATTER OUT OF RANGE. ALL GO LIVE AT T-0. RESCHEDULE FURTHER OUT BEFORE THE WALK; AN ABORT REACHES ONLY NODES IN RANGE." | always shown on the ARMED screen | screens/Armed.tsx:84 | |
| 79 | Armed | amber | node tile turns amber, "RETRYING · LAST SEEN {age}" | a node has not acked the arm yet | screens/Armed.tsx:96,105-107 | |
| 80 | Live | red | "▲ {n} OF {total} HUD(S) {HAS/HAVE} NOT CONFIRMED THE END ({names})" (+ "— RE-DELIVERING" or "— TOLD {n} TIMES, STILL NOTHING…") | one or more HUDs have not confirmed the match end | screens/Live.tsx:145-151; api/derive.ts:97-106 | |
| 81 | Live | red | "FREEZE SCORING NOW? LATER KILLS WON'T COUNT." | operator taps END MATCH EARLY (first tap) | screens/Live.tsx:172 | |
| 82 | Live | amber | "RECALL" / "CONFIRM RECALL — REVIVES & HOLDS EVERYONE IN RANGE" | operator recalls the match | screens/Live.tsx:180-183 | |
| 83 | Live | amber | streak ≥3, sync-age warning | a player is on a hot streak, or a row's sync is stale | screens/Live.tsx:270,277 | |
| 84 | Live | red/amber | feed-entry tag colour: FIRST BLOOD/TEAM KILL red, other tags amber | a tagged event lands in the live feed | screens/Live.tsx:204-205 | |
| 85 | Live | red/amber | "END NOT CONFIRMED" (red) / "LAST KNOWN" (amber) | a row's HUD has not confirmed the end, or is stale | screens/Live.tsx:276 | |
| 86 | Recap | amber | "▲ PROVISIONAL — {n} NODE(S) HAVE NOT FLUSHED ({names}). {instruction}" | the recap is provisional | screens/Recap.tsx:130-135 | |
| 87 | Recap | amber | "▲ {w}" | the scorer flags a replayed hit or an unattributed shooter | screens/Recap.tsx:140-143 | |
| 88 | Recap | amber | "▲ STILL SETTLING — {n} NODE(S) HAVE NOT REPORTED SINCE THE WHISTLE ({names}) · {n}S AGO. THESE TOTALS CAN STILL CHANGE." | a bound node has not reported since the whistle | screens/Recap.tsx:151-156 | |
| 89 | Recap | red | "▲ {n} HUD(S) NEVER CONFIRMED THE END ({names}). THIS IS A DELIVERY FACT — IT SAYS NOTHING ABOUT HOW THEY PLAYED…" | a HUD never confirmed the match end | screens/Recap.tsx:165-172 | |
| 90 | Recap | red | "▲ {csvErr}" | the CSV export fails | screens/Recap.tsx:198 | |
| 91 | Recap | amber/red | data-sync status: "SENDING · {n} LEFT" / "CONNECTED — AWAITING DATA" (amber), "OUT OF RANGE — WILL SYNC ON RETURN" (red) | a player's node has not finished syncing match data | screens/Recap.tsx:273-280 | |
| 92 | Recap | amber | "▲ BEST COVERAGE {..} — A HILL IS ONLY SEEN BY A GUN IN BEACON RANGE, SO THIS IS A FLOOR, NOT A FULL ACCOUNT." | control-point coverage looks thin | screens/Recap.tsx:488 | |
| 93 | Recap | amber | "NEVER HEARD FROM" | a utility station never reported | screens/Recap.tsx:510,515,524 | |
| 94 | Debug | amber | "Operator token required" form | an operator token is needed | screens/Debug.tsx:46-53 | |
| 95 | Debug | amber/red | "MODE: MOCK — no real server" (amber) / "LAST ERROR: {error}" (red) / "UPLINK: DOWN" (red) | running mocked, or the last call errored, or the socket is down | screens/Debug.tsx:61-63 | |
| 96 | Debug | amber/red | node table cells: synced=no, gun link=lost, pending>0 | a node row shows a fault | screens/Debug.tsx:99-102 | |
| 97 | Spectate | red | "FROZEN · MC OFFLINE" | the spectator board's link to MC drops | screens/Spectate.tsx:163-166 | |
| 98 | Spectate | red | "CLOCK FROZEN" | the match clock is not advancing | screens/Spectate.tsx:217 | |
| 99 | Spectate | amber | best-streak ≥3, feed-entry tag colour | a player is on a hot streak, or a tagged event appears | screens/Spectate.tsx:269,293 | |
| 100 | Spectate | amber | "PROVISIONAL — STILL SETTLING" | the final card shows an unsettled result | screens/Spectate.tsx:326 | |
| 101 | AdvancedPresentation | amber | "▲ THE MC SERVER PREDATES THIS UI — IT HAS NO /api/presentation. RESTART IT: python -m brx_mcp.mc" / "▲ COULD NOT LOAD THE PRESENTATION PROFILE — {msg}" | the presentation profile fails to load | screens/AdvancedPresentation.tsx:77-78 | |
| 102 | AdvancedPresentation | amber | "MC NOT CONFIDENT — MC-DRIVEN GLOBAL EVENTS ARE WITHHELD · OFFLINE: {..} · STALE: {..} · UNFLUSHED: {..}" | MC's confidence gate is not satisfied mid-match | screens/AdvancedPresentation.tsx:129,148 | |
