# M-NET — field LAN transport (node ↔ Mission Control)

- **Status:** Draft (Wave 1). Binds to [`contracts.md`](contracts.md) §5 (protocol), §7 (clock sync),
  §9 (versioning/constants); realizes [ADR-0002](../adr/0002-laptop-mission-control-host.md)
  (local-first, store-and-forward, no cloud). Module role: [`README.md`](README.md) §4 (M-NET).
- **Owns:** the wire between each player node (phone now, Companion later) and the MC server — discovery,
  the WebSocket, heartbeat, store-and-forward queue, the clock-sync handshake, reconnect/backoff.
- **Does NOT own:** the message *shapes* (M-CONTRACTS), the gun loop (M-NODE), the schedule math of the
  start (M-START), or scoring (M-MC). M-NET moves envelopes; it never interprets an `Event` body.

This doc elaborates the frozen protocol; it does not re-freeze it. Where a shape or constant is named
here it is quoted from `contracts.md` — the contract is the ground truth, this is the mechanism.

---

## 1. Transport choice — WebSocket, not MQTT

**Decision: one persistent WebSocket per node to the MC server** (`contracts.md` §5). JSON envelopes,
bidirectional, ordered, framed. Rationale:

- **Bidirectional over one socket.** Node→MC (`event`, `bind`, `time_req`) and MC→Node (`assign`,
  `start`, `feedback`, `control`) share a single warm connection with no broker in between. The traffic
  is a **request/command channel to one known server**, not a fan-out bus.
- **The server is the authority anyway.** MC *is* the backend (ADR-0002 §4). There is exactly one
  subscriber that matters (MC) and one publisher per node. A pub/sub broker's topic-routing buys us
  nothing when the topology is a star with MC at the center.
- **Zero extra infrastructure.** MQTT needs a broker process (Mosquitto/EMQX) running *somewhere* on the
  field — one more thing to host, port, discover, and debug on a travel router or the MacBook. A WS
  server is just a listener inside the MC process. Fewer moving parts on match day (a non-negotiable —
  README §7).
- **Cross-platform, first-class in every client.** Browser/Capacitor nodes get `WebSocket` natively (no
  library); Python MC gets `websockets`/`starlette`; a later ESP32 Companion has mature WS clients. No
  MQTT client to vendor onto three runtimes (README env rule: macOS/iOS/Android/Windows).
- **Store-and-forward is ours, not the broker's.** We need a *bounded, persisted, replayable* node-side
  queue with `(node_id, seq)` dedup at MC (§4 below). QoS-1/retained-message semantics from a broker
  don't match this — the queue must survive the node app being backgrounded and the broker being *gone*
  (LAN dead). Owning the queue in the node is simpler and stronger than leaning on broker delivery.

**Why MQTT is still on the roadmap.** MQTT earns its keep for **inter-Companion** traffic later (README
M6): a mesh of ESP32 nodes that gossip peer state (nearby-player presence, IR-decoded shooter-ids,
proximity) is genuinely pub/sub and benefits from a broker + topic tree. That is a **different link**
(node↔node), out of M-NET's scope, and does not change the node↔MC contract — a Companion still speaks
the same WS Envelope to MC. Node↔MC = WS (this doc); node↔node telemetry = MQTT (deferred). Keeping them
separate means the MC protocol never depends on a broker being alive.

## 2. The field LAN

M-NET assumes an IP LAN with no internet (ADR-0002 §2). Two ways it gets stood up:

- **Primary — travel router hosts the LAN** (ADR-0002 decision; README §6). A battery travel router is
  the AP; the MacBook joins it **as a client**, nodes join it as clients, MC binds its WS listener to the
  router-assigned LAN IP. MC is **not** the AP and must never assume it is (README §6 invariant). This is
  the target for any field bigger than a few guns: dedicated radio, better range/antennas than a laptop,
  the laptop keeps its Wi-Fi free.
- **Fallback — Mac-hosted hotspot** (macOS Internet Sharing / "hotspot"). Works for a small bench game
  but is **weak by design**: macOS AP mode caps low (roughly a handful of clients), has no channel/QoS
  control, drops when the Mac sleeps, and shares one radio (so the Mac is off any other Wi-Fi). Document
  it as *small-game only*; the router is the real answer. M-NET code must not care which is in use — it
  binds to whatever LAN IP it's given.

**Addressing & client cap.** Nodes are DHCP clients on the LAN subnet; MC discovers its own bound IP at
startup (all interfaces, pick the LAN one) and advertises *that*. **Do not hard-code or cache an MC IP**
across sessions — router DHCP reassigns, and (per contracts §1) address formats differ by OS. Practical
ceiling: **travel-router LANs comfortably do 16-32 clients; a phone/Mac hotspot ~5-10.** Above the
hotspot cap, degradation is join failures, not corruption — surface it in readiness (M-ARMORY), don't
paper over it. One WS per node; MC holds N sockets, one per connected node.

## 3. Discovery

MC advertises, nodes resolve, with a manual fallback (`contracts.md` §5):

1. **mDNS/Bonjour.** MC publishes `_openbrx._tcp` on the LAN with TXT records
   `{ ver, session_id, ws_path, server_name }` on its WS port. Bonjour is native on macOS/iOS; Android
   uses NSD; browsers can't do raw mDNS, so the Capacitor node uses a small native NSD/Bonjour plugin
   (shared with M-ARMORY's discovery needs). Node browses `_openbrx._tcp`, reads the TXT, opens
   `ws://<resolved-ip>:<port><ws_path>`.
2. **Manual IP entry (mandatory fallback).** mDNS fails on hostile/guest Wi-Fi, some Android OEM stacks,
   and locked-down routers. The node UI always offers **"Enter Mission Control address"** — host reads
   the IP:port off MC's screen (MC displays its bound LAN address prominently) and types it. This path
   must be as first-class as mDNS; never make the game un-startable because Bonjour is filtered.
3. **QR convenience (optional).** MC may render its `ws://ip:port` as a QR the node scans — same manual
   path, less typing. Nice-to-have, not required for M2.

Discovery yields a URL; from there §5's lifecycle takes over. Discovery is *only* used to find MC the
first time and after a full address change — a warm socket is never re-discovered.

## 4. Store-and-forward

**The gun loop NEVER blocks on the WS** (README §2 invariant; ADR-0002 §3). This is the load-bearing
rule of the whole module. The node's engine writes to the gun over BLE and emits `Event`s into an
**in-process outbox**; the WS layer drains the outbox asynchronously. If the socket is down, slow, or
buffering, the engine does not notice and does not wait.

**Outbox = a bounded, persisted ring.**
- Every `Event` gets the node's next monotonic `seq` (`Envelope.seq`, contracts §5) at enqueue time and
  is appended to a ring buffer that is **persisted** (e.g. IndexedDB / SQLite / a capped file) so it
  survives the app being backgrounded or killed mid-match.
- **Bounded:** cap by count *and* age (recommend **~2000 events or 20 min**, whichever first). On
  overflow, **drop oldest** and increment a `dropped` counter reported in the next `status`. A match is
  minutes long; the cap only bites during a very long outage, and old status frames are the least
  valuable thing to lose.
- **Never** persist `feedback`/`start`/`assign` (MC→node) — those are best-effort and re-derivable; only
  the node's own outbound `Event` facts are precious.

**Flush on reconnect.** On (re)establishing the socket and completing `hello`/`welcome`, the node sends
all un-acked events as one or more `event_batch` messages (`{ events: Event[] }`, contracts §5), oldest
first, chunked (recommend ≤200 events/batch to stay under §7 size limits). Live events emitted during a
healthy connection go as single `event` messages; the batch path is purely the backlog drain.

**Idempotent dedup at MC.** MC keeps, per `node_id`, the highest `seq` applied (and a small recent-set
to tolerate reordering). An arriving event with `seq ≤ last_applied` is a **replay → dropped silently**.
This makes reconnect-flush, at-least-once delivery, and duplicate sockets all safe (contracts §4:
"Events are idempotent by `(node_id, seq)`"). MC ACKs progress (see §6 `ack` / high-water) so the node
can prune its ring; un-ACKed events are retained and re-sent next flush.

## 5. Connection lifecycle

```
resolve(§3) → CONNECTING → OPEN → hello ─────► welcome → BOUND(bind/assign) → LIVE
     ▲                                  │                                        │
     └──── backoff ◄── CLOSED/ERROR ◄───┴──── heartbeat lost / socket drop ◄─────┘
```

- **Handshake.** On OPEN the node sends `hello { node_id, node_type, app_ver, gun? }` (contracts §5). MC
  replies `welcome { session_id, server_t, config? }`. `server_t` seeds the first clock estimate (§7);
  `config` lets a reconnecting node re-hydrate an in-progress match without a fresh push. Node must not
  send `event`s before `welcome` (they queue in the outbox regardless, so this is free).
- **Bind.** After `welcome` the node sends `bind { node_id, player_id?, gun_tail }` claiming its gun and
  (if known) player. MC maps `node_id ↔ player_id ↔ gun`. Re-`bind` on reconnect is idempotent —
  rebinding the same node updates the mapping in place; a node whose gun_tail changed (hot-swap, README
  §7) just rebinds and MC re-associates. This is how "any node clips to any gun" stays true on the wire.
- **Heartbeat.** The node's periodic `status` event (contracts §4, every `STATUS_HEARTBEAT_MS = 2000`)
  doubles as the liveness heartbeat — no separate ping needed for node→MC liveness. MC treats any frame
  as proof-of-life. If a node is alive but idle (no game events), the `status` cadence keeps the socket
  warm and NAT/router idle-timeouts from reaping it. MC→node liveness rides WS ping/pong at the same
  cadence.
- **Staleness.** If MC sees no frame from a node for `STALE_AFTER_MS = 8000` (4 missed heartbeats), it
  marks the node **stale, not gone** (contracts §5): scoreboard shows last-known state + a staleness age
  badge (M-MC). The node is never dropped from the roster on staleness alone — it's expected to walk back
  into range. A node only leaves the roster on explicit host removal or session end.
- **Reconnect / backoff.** On any drop the node re-enters CONNECTING and retries with **exponential
  backoff + jitter**: base 500 ms, ×2, cap 10 s, ±20% jitter (jitter prevents a thundering herd when the
  AP blips and 20 nodes reconnect at once). Backoff resets on a successful `welcome`. The node keeps
  playing throughout (§4). After a long outage the node re-resolves via §3 only if the cached URL fails
  to connect several times (address may have changed); otherwise it reuses the last URL.
- **Graceful degradation.** A vanished node degrades to *local-only*: full gun loop, HUD shows an
  "offline — will sync" indicator, outbox grows. On return it flushes and MC reconciles. Nothing about
  the match outcome depends on the node being online during play (ADR-0002 §3) — only the *shared*
  scoreboard lags.

## 6. Interfaces

Node-type-agnostic (phone or Companion behind the same surface). Signatures are the contract M-NODE and
M-MC bind to; language-idiomatic equivalents are fine (async/await, callbacks, or an event emitter).

**Client (consumed by a node — M-NODE):**
```ts
interface Transport {
  connect(discovery: { mdns?: boolean; url?: string }): Promise<void>; // resolve+open+hello+welcome
  bind(b: { node_id: string; player_id?: string; gun_tail: string }): void;
  send(ev: Event): void;          // enqueue an Event to outbox; NEVER blocks, NEVER throws on offline
  report(msg: NodeMessage): void; // non-Event uplink — ready|ack_config|log_offer|log_data (also store-and-forward queued)
  syncedNow(): number;            // §7 — local_now() + smoothed offset
  onMessage(cb: (msg: MCMessage) => void): void; // assign|config|tutorial|start|feedback|control|time_res|pull_log (ack consumed internally, §4)
  onState(cb: (s: LinkState) => void): void;     // 'connecting'|'open'|'bound'|'offline'
  close(): void;
}
```
`send()` is fire-and-forget into the persisted ring; delivery is the Transport's problem, not the
caller's. The Transport **consumes `ack {seq_hi}`** itself (contracts A1) — it prunes the store-and-forward
ring up to the durably-ingested `seq_hi` and does **not** surface `ack` to the caller. `onMessage` delivers
the remaining MC→node envelopes already validated (§8) and version-gated; bodies are passed through
untouched for M-NODE/M-START to interpret.

`NodeMessage` = the **non-Event** Node→MC envelopes — `ready`, `ack_config`, `log_offer`, `log_data`
(contracts §5). Events go via `send()`/`onEvent`; everything else goes via `report()`/`onNodeMessage`.
This is the surface M-NODE uses to ack a config, toggle lobby-ready, and hand up its log — and M-MC uses
to gate start on `ack_config`, set `Player.ready`, and ingest logs at recap.

**Server (consumed by MC — M-MC):**
```ts
interface NetServer {
  start(bind: { host: string; port: number; wsPath: string }): void;     // binds LAN IP + advertises mDNS
  onNode(cb: (n: { node_id: string; node_type: string; player_id?: string; gun_tail?: string }) => void): void; // hello+bind (gun_tail from bind, contracts §5 — MC maps node↔gun & reconciles vs armory)
  onEvent(cb: (node_id: string, ev: Event) => void): void;   // post-dedup, monotonic per node
  onNodeMessage(cb: (node_id: string, msg: NodeMessage) => void): void; // non-Event uplink: ready|ack_config|log_offer|log_data
  onStale(cb: (node_id: string, ageMs: number) => void): void;
  onReturn(cb: (node_id: string) => void): void;             // stale → live again
  push(node_id: string, msg: MCMessage): void;               // assign|config|tutorial|start|feedback|control|time_res|pull_log|ack
  broadcast(msg: MCMessage): void;                           // e.g. start to all bound nodes
  timeService(): void;                                       // answers time_req with time_res (§7)
}
```
`onEvent` fires **only for events that passed dedup** — M-MC never sees a replay. `push`/`broadcast` are
best-effort (contracts §5): they return without waiting for delivery; a node offline at push time gets
`config` re-hydrated on its next `welcome` instead.

## 7. Clock sync (contracts §7)

Load-bearing for the dispersed start (M-START): a pre-shared `go_live_t` must fire together on every
node with **no T-0 signal**.

- **NTP-lite handshake.** Node sends `time_req { t_node }`; MC replies `time_res { t_node, server_t }`.
  Node computes `rtt = local_now() - t_node`, `offset = server_t - (t_node + rtt/2)` — assuming a
  symmetric path (contracts §7). `welcome.server_t` gives a zeroth estimate before the first round-trip.
- **Offset smoothing.** Don't trust a single sample (Wi-Fi RTT is spiky). Take a **burst of ~5 `time_req`
  on connect**, keep the sample with the **smallest rtt** (least queuing noise), and thereafter feed an
  **EWMA** (α≈0.2). Reject any sample whose rtt is > 3× the running median (a buffered outlier).
- **Re-sync cadence.** Full burst at connect and **at lobby** (contracts §7: "re-sync at lobby is
  enough"). During LIVE, a lightweight single `time_req` every **~30 s** keeps the EWMA fresh; phone
  clocks drift <<1 s over a match so this is belt-and-suspenders. Re-burst after any reconnect.
- **`syncedNow() = local_now() + offset`.** All `go_live_t` and `deadline_s` math uses synced time, never
  raw local time (contracts §7). M-START reads only `syncedNow()`.
- **Degraded fallback.** A node that **never completed a sync** (e.g. joined the LAN after `start`
  already went out, or mDNS + manual both failed until late) falls back to counting `now + duration` from
  the instant it *received* `start` — correct to within one one-way latency, logged as `degraded_start`
  so recap can flag it. This keeps a late/re-joining player in the game rather than dead-on-arrival.

## 8. Security & robustness on an open field LAN

The field LAN is **untrusted** — anyone in Wi-Fi range can open a socket. M-NET assumes no transport
encryption (plain `ws://` on a private LAN; TLS on the field is out of scope for M2) and defends at the
message layer:

- **Version gate (`Envelope.v`).** Every envelope carries `v` (contracts §5, currently `1`). MC rejects
  an envelope whose `v` it can't speak with a `control{cmd:"end", reason:"version"}`-style close and a
  log line; the node shows "update required." Additive fields are non-breaking (contracts §9) — unknown
  fields are ignored, never fatal. Only a `v` bump is a hard gate.
- **Message validation.** Every inbound envelope is schema-checked before dispatch: known `kind`,
  required fields present, `t` a plausible number, `body` matching the `kind`'s shape. Malformed →
  dropped + counted, connection **not** killed (one bad frame shouldn't drop a player). Repeated malformed
  frames from one socket (> ~20/s) → close that socket (likely a bad or hostile client).
- **Size limits.** Hard cap per envelope (recommend **64 KB**; a `status` is a few hundred bytes, a max
  `event_batch` of 200 events stays well under). Oversized frame → reject the frame, don't buffer it.
  This caps memory and defuses a trivial flood.
- **Rogue-client handling.** A socket that never sends a valid `hello`, or sends `hello` then floods, is
  **quarantined**: no `onNode`/`onEvent` fires for it, it's rate-limited, and dropped after a grace
  window. A node claiming a `node_id`/`gun_tail` already bound to a *live* socket is treated as a
  **takeover** (hot-swap / app restart) — newest wins, old socket closed — because that's the legitimate
  common case; MC logs it so a genuine collision is visible in recap. Player identity is by `node_id` +
  host-confirmed `bind`, never by IP.
- **No trust in event content for safety.** Events are *facts a node observed*; MC's scoring already
  treats them as claims to reconcile (contracts §4), so a lying node corrupts only its own score line,
  not the match engine or other players' nodes. There is no wire command that lets one node write another
  node's gun — MC→node commands are the only downlink and they originate at MC.

## 9. Failure matrix

| When | LAN event | What happens | Recovery |
|---|---|---|---|
| **Lobby** | LAN down before ready-up | No config push; host can't see nodes ready. Game **cannot start synced** yet — nodes have no `go_live_t`. | Stand up the LAN (router primary, hotspot fallback §2); nodes auto-connect (§5), the `config` message pushes the game, ready-up proceeds. Bench-local single-gun play still works with no LAN at all. |
| **Lobby** | One node can't discover MC | That player is un-kitted; rest proceed. | Manual IP entry (§3.2); or host reads MC address to the player. |
| **Mid-game** | LAN blips / node walks out of range | Node keeps playing (§4); events queue in the persisted ring; MC marks it **stale** after `STALE_AFTER_MS`, scoreboard shows last-known + age. | On return, socket reconnects (backoff §5), `event_batch` flushes, MC dedups + reconciles. No lost facts unless the ring overflowed (counted). |
| **Mid-game** | Whole LAN dies (router off) | **Every** node goes local-only; the match runs to completion on nodes alone (ADR-0002 §3). Live scoreboard freezes. | Restore any LAN; all nodes flush backlog; MC reconciles to correct end-state. Start already fired locally (`go_live_t` was pre-shared, §7), so the match itself is unaffected. |
| **Mid-game** | Node app killed / phone dies | Persisted ring survives an app kill → relaunch flushes. A dead battery loses only that player's un-flushed tail; their gun still holds last BRX state until re-driven. | Relaunch → reconnect → flush. Hot-swap the node to a charged unit (README §7); it `bind`s the same gun_tail and resumes. |
| **Recap** | LAN down at return | MC can't reconcile finals; recap shows partial + "waiting for N nodes." | Bring nodes into range on any LAN; each flushes its ring; MC recomputes finals as batches land (eventual consistency). Recap is explicitly allowed to complete late. |
| **Recap** | A node never returns | MC finalizes with that player's **last-known** line, flagged incomplete. | Node's log can be side-loaded later (contracts `log_offer`/`pull_log`) to backfill if it matters. |

## 10. Task breakdown

1. **Envelope + validation core** — encode/decode, `v` gate, schema check, size cap (§8). Shared by
   client & server. Ships with a fuzz/malformed-frame test.
2. **Persisted outbox** — bounded ring with `seq` assignment, age/count cap, overflow-drop counter,
   survives background/kill. Platform storage behind one interface (IndexedDB/SQLite/file).
3. **Client Transport** — connect/hello/bind, async drain, `event_batch` chunking, backoff+jitter,
   reconnect, `onState`/`onMessage` (§6). Builds against a **mock MC** (README §5 rule 3).
4. **Server NetServer** — WS listener bound to LAN IP, per-node `seq` high-water + dedup, `onEvent`/
   `onStale`/`onReturn`, `push`/`broadcast`, quarantine/rate-limit (§6, §8).
5. **Discovery** — MC mDNS advertiser (`_openbrx._tcp` + TXT) and node browser (native NSD/Bonjour
   plugin), manual-IP path, optional QR (§3).
6. **Clock service** — server `time_res` responder; client burst + EWMA + re-sync cadence + degraded
   fallback; `syncedNow()` (§7). Test with injected asymmetric latency.
7. **Staleness/heartbeat wiring** — hook `STATUS_HEARTBEAT_MS`/`STALE_AFTER_MS` to `onStale`/`onReturn`
   and the M-MC badge (§5).
8. **Failure-matrix test harness** — scripted LAN-drop/kill/late-join scenarios (§9) as integration tests
   both sides run in CI without hardware.

## 11. Open questions

- **mDNS on Capacitor Android/iOS** — which NSD/Bonjour plugin, and does it survive app-background? May
  force manual-IP as the *default* on some OEMs. (Prototype in M2, feeds §3.)
- **Outbox sizing** — is 2000 events / 20 min right for a worst-case long-outage 12-gun game? Tune once
  real event rates are measured (M-NODE).
- ~~**`ack`/high-water shape**~~ — **RESOLVED (contracts A1):** the amendment landed as MC→node
  `ack {seq_hi}`, so the node prunes its ring precisely on durable ingest rather than on flush-sent (which
  risked dropping un-applied events). Consumed by the Transport (§4, §6); the ready-up message this raised
  alongside also ratified as Node→MC `ready` in the same amendment.
- **Multi-network safety** — if a phone is on the field Wi-Fi *and* cellular, ensure the WS binds to the
  LAN route (nodes must not try to reach MC's private IP over cell). Platform routing hint needed.
- **TLS on the field** — deferred. Is a self-signed `wss://` + pinned cert worth it later, or is a
  private LAN + message-layer validation (§8) sufficient? Revisit if untrusted-venue play appears.
- **Companion parity** — confirm the ESP32 WS client can hold the same warm socket + persisted ring under
  RAM limits (M6); may need a smaller ring and tighter batch cap. No contract change expected.
