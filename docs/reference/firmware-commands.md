# Stock firmware command inventory

Status: **code-derived vocabulary, not bench proof.** Generated 2026-09-21 for R4/T1 and extended 2026-09-22 for
R4/T3 from caller-supplied private stock images with `python3 mcp/tools/fw_commands.py <image-path>`. No image,
disassembly, offset, or surrounding firmware string is stored here. The source is a community member's post;
Battle Company has not licensed the images for redistribution, so the default remains **do not host them**.

The byte-level scan fixes the first `strings` pass: its four-character floor reported 103 v4.32 names but omitted
short real commands such as `$AS` and `$SP`. The bounded scan finds 111 command-shaped names in v4.32 and 128
across all seven images (a different corpus from the ten gun images behind the protocol reference's count of 145). “Present” means a bounded ASCII `$WORD` exists in the image; it does **not** prove the
word is an inbound dispatcher entry or that it is safe to send.

## Sources and integrity

| image | bytes | SHA-256 |
|---|---:|---|
| tagger 2.01U | 193824 | `c5ba9df7b93f3e5cec262269157483f0dc5a53b572c3c3d802606d541d49c889` |
| tagger 2.02c | 190960 | `8772ccdb5cebe86d14a6eaf85e9933f0b17dc18e7286e5cb9a10f9e154b40f37` |
| tagger 2.02e | 191024 | `d95962f121762a0c61b383edb8fb243df5504407c86b1c3ba46ab79e6eeaf110` |
| tagger 2.08b | 170284 | `9a68848a1f77aae7a9d5ecd97e57cd10dc074793f4a8684b171bd708fa421d77` |
| tagger 4.32 | 190372 | `cf92f690325d4bc320e0137a2b153e653cab4648bb5038511f61820c57c050e1` |
| headset 1.27 | 65392 | `9cd08de7257ae97b45f4eac1e8d304bbfebbc0730bc147024ba9507a610903ef` |
| headset 1.34 | 56884 | `3818d52a3c06593e809e2727dd01bfb394fbe9e5061bbddd0bb6f7c7390adf6a` |

The embedded identifiers agree with the filenames: taggers report `v2.01U`, `v2.02c`, `v2.02e`, `v2.08b` and
`v4.32`; H1.27 embeds `MK128V1.27`, while H1.34 embeds `1.34` in its `$HFIRM` response data. Tagger 2.02c and
2.02e have identical 93-name command sets, and headset 1.27 and 1.34 have identical 27-name sets. This corpus
therefore exposes no command-vocabulary gate between either pair.

The separate v5-to-v6 audio ZIP hashes to
`9d3ea47f33bfb0c9707fa41d6ecf8719bd57bd5d29a62e0af4edb4df1b6391b1`. T4 found 211 `.LTP` payloads among
213 ZIP entries: 193 match the off-gun bank byte-for-byte, 18 differ and none introduce a new id.

## How to read the table

- **Protocol:** exact `$COMMAND` token exists in [the protocol reference](../../protocol/brx-protocol.md). A “no”
  gets its own follow-up before anyone sends it.
- **Safety:** `known-safe`, `denied`, and `hang-prone` are exact memberships in
  [`protocol.py`](../../mcp/brx_mcp/protocol.py). `confirm-required` is not automatically sendable: it includes
  four explicit version conflicts plus names otherwise unknown to the safe rail.
- **Bench:** `proven` means our v4.32 hardware showed the effect; `claimed` means a source or inconclusive send
  exists; `never sent` means we have not intentionally sent the exact shape. This column is an evidence ledger,
  not the `CommandInfo.proven` flag alone. A send
  with no observable reply counts as `claimed`. Each command's current status and its evidence live in the protocol
  reference; where this column and a protocol row disagree, the protocol row wins.
- **Needs firmware** is a vocabulary gate over the seven sampled images. “2.02c+ sampled” means first present in
  2.02c and present in every later image we hold; “4.32 only sampled” does not prove the exact introduction was
  4.32. Legacy and headset labels are explicit because upgrading a gun does not restore a removed word or turn a
  headset command into a tagger command. **Presence never overrides the safety column** and never proves a handler.

## Field rule for older taggers

Start with `$VERSION,*`, then `$PING,*`: both are read-only, known-safe vocabulary in every sampled tagger image.
Of the automatically sendable vocabulary, 46 names occur in all sampled tagger images. `$CONNECT` is the only later
known-safe addition before v4.32; gate it at 2.08b+. Five known-safe names occur only in the v4.32 image: `$AS`,
`$IT`, `$KK`, `$SP` and `$UP`. Their presence does not make their unproven native-hosting effects supported.
In particular, the shipped panic tail `$SP,99,*` is v4.32-only vocabulary; `$CLEAR,*` exists in every image but is
not an older-firmware substitute. First use on real older hardware remains a bench check, not proof from a string.

| command | present in | protocol | safety | bench | needs firmware |
|---|---|---|---|---|---|
| `$AD` | 4.32 | yes | confirm-required | never sent | tagger 4.32 only sampled |
| `$AMMO` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$AS` | 4.32 | yes | known-safe | claimed | tagger 4.32 only sampled |
| `$ASKDLC` | 4.32 | yes | confirm-required | never sent | tagger 4.32 only sampled |
| `$ASKSN` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent | all sampled taggers |
| `$BAT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | confirm-required | never sent | all sampled taggers/headsets |
| `$BHIT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | claimed | all sampled taggers |
| `$BLINK` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | proven | all sampled taggers/headsets |
| `$BMAP` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$BOOM` | H1.27, H1.34 | yes | denied | never sent | headset 1.27+ sampled |
| `$BTV` | 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | tagger 2.02c+ sampled |
| `$BUMP` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$BURN` | 2.08b, 4.32, H1.27, H1.34 | yes | denied | never sent | tagger 2.08b+ / headset 1.27+ sampled |
| `$BUT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$CDFU` | 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent | tagger 2.02c+ sampled |
| `$CHASE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | claimed | all sampled taggers/headsets |
| `$CLEAR` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$CLEARDEVICE` | 2.02c, 2.02e, 2.08b, 4.32 | **no** | denied | never sent | tagger 2.02c+ sampled |
| `$CONNECT` | 2.08b, 4.32 | yes | known-safe | claimed | tagger 2.08b+ sampled |
| `$DDFU` | 2.02c, 2.02e, 2.08b | yes | denied | never sent | legacy: tagger 2.02c-2.08b |
| `$DEV` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent | all sampled taggers |
| `$DIE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed | all sampled taggers |
| `$DISCONNECT` | 2.08b, 4.32 | yes | confirm-required | never sent | tagger 2.08b+ sampled |
| `$DK` | 4.32 | yes | confirm-required | never sent | tagger 4.32 only sampled |
| `$DLC` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$DPLAY` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | hang-prone | proven | all sampled taggers |
| `$DTYPE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent | all sampled taggers |
| `$DUTY` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent | all sampled taggers |
| `$FACTORY` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent | all sampled taggers |
| `$FIREX` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | claimed | all sampled taggers |
| `$FL` | 4.32 | yes | confirm-required | never sent | tagger 4.32 only sampled |
| `$FLED` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$FREE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | **no** | confirm-required | never sent | all sampled taggers |
| `$FTST` | 2.08b, 4.32 | yes | denied | never sent | tagger 2.08b+ sampled |
| `$GAMEPAD` | 2.08b | yes | confirm-required | never sent | legacy: tagger 2.08b only |
| `$GLED` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$GLOW` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | claimed | all sampled taggers/headsets |
| `$GPAIR` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent | all sampled taggers |
| `$GPAIRX` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent | all sampled taggers |
| `$GPING` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | confirm-required | never sent | all sampled taggers/headsets |
| `$GREN` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed | all sampled taggers |
| `$GSET` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$HADSK` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | confirm-required | never sent | all sampled taggers/headsets |
| `$HEADDFU` | 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent | tagger 2.02c+ sampled |
| `$HFIRM` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | confirm-required | never sent | all sampled taggers/headsets |
| `$HIT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | confirm-required | never sent | all sampled taggers/headsets |
| `$HLED` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | proven | all sampled taggers/headsets |
| `$HLOOP` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | proven | all sampled taggers/headsets |
| `$IF` | 4.32 | yes | confirm-required | never sent | tagger 4.32 only sampled |
| `$IK` | 4.32 | yes | confirm-required | never sent | tagger 4.32 only sampled |
| `$INDOOR` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | confirm-required | never sent | all sampled taggers/headsets |
| `$INIT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | claimed | all sampled taggers/headsets |
| `$INQ` | 4.32 | yes | denied | never sent | tagger 4.32 only sampled |
| `$INVU` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | claimed | all sampled taggers |
| `$IRG` | 2.01U | yes | confirm-required | never sent | legacy: tagger 2.01U only |
| `$IRH` | 2.01U | **no** | confirm-required | never sent | legacy: tagger 2.01U only |
| `$IRL` | 2.01U | **no** | confirm-required | never sent | legacy: tagger 2.01U only |
| `$IRLVL` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$IRS` | 2.01U | **no** | confirm-required | never sent | legacy: tagger 2.01U only |
| `$IRT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent | all sampled taggers |
| `$IRTX` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | proven | all sampled taggers/headsets |
| `$IT` | 4.32 | yes | known-safe | claimed | tagger 4.32 only sampled |
| `$KK` | 4.32 | yes | known-safe | claimed | tagger 4.32 only sampled |
| `$LED` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | proven | all sampled taggers/headsets |
| `$LIFE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$LIGHT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$LINK` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$MSHIELD` | 2.01U | yes | confirm-required | never sent | legacy: tagger 2.01U only |
| `$MUZ` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent | all sampled taggers |
| `$NAME` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$PAIR` | 2.01U, 2.02c, 2.02e, 2.08b, H1.27, H1.34 | yes | denied | never sent | legacy tagger / headset 1.27+ sampled |
| `$PBGAME` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$PBINDOOR` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$PBLIVES` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$PBLOCK` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$PBPERK` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed | all sampled taggers |
| `$PBSPAWN` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$PBSTART` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$PBTEAM` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed | all sampled taggers |
| `$PBTIME` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$PBWEAP` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$PHONE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$PHONECONNECT` | 4.32 | yes | confirm-required | never sent | tagger 4.32 only sampled |
| `$PHONEDISCONNECT` | 4.32 | yes | confirm-required | never sent | tagger 4.32 only sampled |
| `$PID` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed | all sampled taggers |
| `$PIN` | 2.01U, 2.02c, 2.02e, 2.08b | yes | denied | never sent | legacy: tagger through 2.08b |
| `$PING` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$PLAY` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$PLAYX` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$PRES` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | claimed | all sampled taggers |
| `$PSET` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$QFX` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed | all sampled taggers |
| `$QHIT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed | all sampled taggers |
| `$QPLAY` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed | all sampled taggers |
| `$QUERY` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$RADSK` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | claimed | all sampled taggers/headsets |
| `$RESET` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent | all sampled taggers |
| `$RV` | 4.32 | yes | confirm-required | never sent | tagger 4.32 only sampled |
| `$SER` | H1.27, H1.34 | **no** | confirm-required | never sent | headset 1.27+ sampled |
| `$SFLASH` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$SGREN` | H1.27, H1.34 | yes | confirm-required | never sent | headset 1.27+ sampled |
| `$SHIELD` | 2.01U | yes | confirm-required | never sent | legacy: tagger 2.01U only |
| `$SHOWNAME` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$SIR` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$SITE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | denied | never sent | all sampled taggers/headsets |
| `$SLO` | 4.32 | yes | confirm-required | never sent | tagger 4.32 only sampled |
| `$SOL` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent | all sampled taggers |
| `$SOLID` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | claimed | all sampled taggers/headsets |
| `$SP` | 4.32 | yes | known-safe | proven | tagger 4.32 only sampled |
| `$SPAWN` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$START` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$STOP` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$STUN` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$TEAM` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed | all sampled taggers |
| `$TID` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$TMP` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$TSTRNAME` | 2.08b, 4.32 | yes | denied | never sent | tagger 2.08b+ sampled |
| `$UP` | 4.32 | yes | known-safe | claimed | tagger 4.32 only sampled |
| `$VERSION` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | proven | all sampled taggers/headsets |
| `$VIB` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent | all sampled taggers |
| `$VIBTOGGLE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent | all sampled taggers |
| `$VOL` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$VOLTS` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$WEAP` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven | all sampled taggers |
| `$ZOFF` | H1.27, H1.34 | yes | denied | never sent | headset 1.27+ sampled |
| `$ZOM` | H1.27, H1.34 | yes | denied | never sent | headset 1.27+ sampled |
| `$ZON` | H1.27, H1.34 | yes | denied | never sent | headset 1.27+ sampled |
| `$ZTOG` | H1.27, H1.34 | yes | denied | never sent | headset 1.27+ sampled |
