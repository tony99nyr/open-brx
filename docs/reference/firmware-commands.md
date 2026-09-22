# Stock firmware command inventory

Status: **code-derived vocabulary, not bench proof.** Generated 2026-09-21 for R4/T1 from caller-supplied private
stock images with `python3 mcp/tools/fw_commands.py <image-path>`. No image, disassembly, offset, or surrounding
firmware string is stored here. The source is a community member's post; Battle Company has not licensed the
images for redistribution, so the default remains **do not host them**.

The byte-level scan fixes the first `strings` pass: its four-character floor reported 103 v4.32 names but omitted
short real commands such as `$AS` and `$SP`. The bounded scan finds 111 command-shaped names in v4.32 and 128
across all seven images. “Present” means a bounded ASCII `$WORD` exists in the image; it does **not** prove the
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

The separate v5-to-v6 audio ZIP hashes to
`9d3ea47f33bfb0c9707fa41d6ecf8719bd57bd5d29a62e0af4edb4df1b6391b1`; T4 inventories its contents later.

## How to read the table

- **Protocol:** exact `$COMMAND` token exists in [the protocol reference](../../protocol/brx-protocol.md). A “no”
  gets its own follow-up before anyone sends it.
- **Safety:** `known-safe`, `denied`, and `hang-prone` are exact memberships in
  [`protocol.py`](../../mcp/brx_mcp/protocol.py). `confirm-required` means unknown to that rail, not safe.
- **Bench:** `proven` means our v4.32 hardware showed the effect; `claimed` means a source or inconclusive send
  exists; `never sent` means we have not intentionally sent the exact shape. This column is an evidence ledger,
  not the stale `CommandInfo.proven` flag alone: `$STUN` and `$TMP` are bench-proven despite that old flag.
- Presence on an older image is descriptive only. T3 decides “needs firmware”; this table does not infer it.

| command | present in | protocol | safety | bench |
|---|---|---|---|---|
| `$AD` | 4.32 | yes | confirm-required | never sent |
| `$AMMO` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$AS` | 4.32 | yes | known-safe | claimed |
| `$ASKDLC` | 4.32 | yes | confirm-required | never sent |
| `$ASKSN` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent |
| `$BAT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | confirm-required | never sent |
| `$BHIT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed |
| `$BLINK` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | proven |
| `$BMAP` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$BOOM` | H1.27, H1.34 | yes | denied | never sent |
| `$BTV` | 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$BUMP` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$BURN` | 2.08b, 4.32, H1.27, H1.34 | yes | denied | never sent |
| `$BUT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$CDFU` | 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent |
| `$CHASE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | claimed |
| `$CLEAR` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$CLEARDEVICE` | 2.02c, 2.02e, 2.08b, 4.32 | **no** | denied | never sent |
| `$CONNECT` | 2.08b, 4.32 | yes | known-safe | proven |
| `$DDFU` | 2.02c, 2.02e, 2.08b | yes | denied | never sent |
| `$DEV` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent |
| `$DIE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed |
| `$DISCONNECT` | 2.08b, 4.32 | yes | confirm-required | never sent |
| `$DK` | 4.32 | yes | confirm-required | never sent |
| `$DLC` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$DPLAY` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | hang-prone | proven |
| `$DTYPE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent |
| `$DUTY` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent |
| `$FACTORY` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent |
| `$FIREX` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed |
| `$FL` | 4.32 | yes | confirm-required | never sent |
| `$FLED` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$FREE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | **no** | confirm-required | never sent |
| `$FTST` | 2.08b, 4.32 | yes | denied | never sent |
| `$GAMEPAD` | 2.08b | yes | confirm-required | never sent |
| `$GLED` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$GLOW` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | claimed |
| `$GPAIR` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent |
| `$GPAIRX` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent |
| `$GPING` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | confirm-required | never sent |
| `$GREN` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$GSET` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$HADSK` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | confirm-required | never sent |
| `$HEADDFU` | 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent |
| `$HFIRM` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | confirm-required | never sent |
| `$HIT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | confirm-required | never sent |
| `$HLED` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | proven |
| `$HLOOP` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | proven |
| `$IF` | 4.32 | yes | confirm-required | never sent |
| `$IK` | 4.32 | yes | confirm-required | never sent |
| `$INDOOR` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | confirm-required | never sent |
| `$INIT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | proven |
| `$INQ` | 4.32 | yes | denied | never sent |
| `$INVU` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed |
| `$IRG` | 2.01U | yes | confirm-required | never sent |
| `$IRH` | 2.01U | **no** | confirm-required | never sent |
| `$IRL` | 2.01U | **no** | confirm-required | never sent |
| `$IRLVL` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$IRS` | 2.01U | **no** | confirm-required | never sent |
| `$IRT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent |
| `$IRTX` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | proven |
| `$IT` | 4.32 | yes | known-safe | claimed |
| `$KK` | 4.32 | yes | known-safe | claimed |
| `$LED` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | proven |
| `$LIFE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$LIGHT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$LINK` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$MSHIELD` | 2.01U | yes | confirm-required | never sent |
| `$MUZ` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent |
| `$NAME` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$PAIR` | 2.01U, 2.02c, 2.02e, 2.08b, H1.27, H1.34 | yes | denied | never sent |
| `$PBGAME` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$PBINDOOR` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$PBLIVES` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$PBLOCK` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$PBPERK` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed |
| `$PBSPAWN` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$PBSTART` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$PBTEAM` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed |
| `$PBTIME` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$PBWEAP` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$PHONE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$PHONECONNECT` | 4.32 | yes | confirm-required | never sent |
| `$PHONEDISCONNECT` | 4.32 | yes | confirm-required | never sent |
| `$PID` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed |
| `$PIN` | 2.01U, 2.02c, 2.02e, 2.08b | yes | denied | never sent |
| `$PING` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$PLAY` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$PLAYX` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$PRES` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed |
| `$PSET` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$QFX` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed |
| `$QHIT` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed |
| `$QPLAY` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed |
| `$QUERY` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$RADSK` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | claimed |
| `$RESET` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent |
| `$RV` | 4.32 | yes | confirm-required | never sent |
| `$SER` | H1.27, H1.34 | **no** | confirm-required | never sent |
| `$SFLASH` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$SGREN` | H1.27, H1.34 | yes | confirm-required | never sent |
| `$SHIELD` | 2.01U | yes | confirm-required | never sent |
| `$SHOWNAME` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$SIR` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$SITE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | denied | never sent |
| `$SLO` | 4.32 | yes | confirm-required | never sent |
| `$SOL` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent |
| `$SOLID` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | claimed |
| `$SP` | 4.32 | yes | known-safe | proven |
| `$SPAWN` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$START` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$STOP` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$STUN` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$TEAM` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | claimed |
| `$TID` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$TMP` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$TSTRNAME` | 2.08b, 4.32 | yes | denied | never sent |
| `$UP` | 4.32 | yes | known-safe | claimed |
| `$VERSION` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32, H1.27, H1.34 | yes | known-safe | proven |
| `$VIB` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | confirm-required | never sent |
| `$VIBTOGGLE` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | denied | never sent |
| `$VOL` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$VOLTS` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$WEAP` | 2.01U, 2.02c, 2.02e, 2.08b, 4.32 | yes | known-safe | proven |
| `$ZOFF` | H1.27, H1.34 | yes | denied | never sent |
| `$ZOM` | H1.27, H1.34 | yes | denied | never sent |
| `$ZON` | H1.27, H1.34 | yes | denied | never sent |
| `$ZTOG` | H1.27, H1.34 | yes | denied | never sent |
