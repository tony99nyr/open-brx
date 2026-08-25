# M-NET — field LAN transport (node ↔ Mission Control)

- **Status:** Draft (Wave 1), updated to contracts **A4–A6**. Binds to [`contracts.md`](contracts.md) §4/§5
  (events + protocol), §7 (clock sync), §9 (versioning/constants); realizes [ADR-0002](../adr/0002-laptop-mission-control-host.md)
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
  (LAN dead). Owning the queue in the node is simpler and stronger than leaning on broker delivery. Only the
  **persisted facts** (`hit_taken`/`death`/`respawn`/`team_change`) ride the queue; `status` is **live-only** — no `seq`,
  never queued (contracts A4.4) — so a broker's retained-message model would be actively wrong for it.

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

**The LAN covers the base, not the match (contracts A4.8, README §3 "coverage honesty").** The venue is a
large park. A travel router reaches tens of metres; players spread over hundreds. So the design point is
**not** "a node blips out for a few seconds" — it is **"most nodes are offline for most of the match, for
minutes at a time, and come back at a base or at recap."** Everything in this doc that mentions an outage
means that. Config, sync, and `start` happen in the lobby *because* it is the last moment everyone is in
range; the socket is expected to be dead at T-0 and to reconnect only at sync points. A **second battery
mesh AP at a far base** (same SSID, router mesh mode) is the cheap way to add a coverage zone so a death
there becomes a sync point (optional, M4); M-NET needs no change for it — it is one LAN.

**Addressing & client cap.** Nodes are DHCP clients on the LAN subnet; MC discovers its own bound IP at
startup (all interfaces, pick the LAN one) and advertises *that*. **Do not hard-code or cache an MC IP**
across sessions — router DHCP reassigns, and (per contracts §1) address formats differ by OS. Practical
ceiling: **travel-router LANs comfortably do 16-32 clients; a phone/Mac hotspot ~5-10.** Above the
hotspot cap, degradation is join failures, not corruption — surface it on the readiness board (from
`status.preflight`, contracts A4.9), don't paper over it. One WS per node; MC holds N sockets, one per
connected node (contracts `MAX_PLAYERS = 63`).

## 3. Discovery

MC advertises; nodes join by **QR** (the field default), by mDNS (the convenience), or by typing
(the mandatory floor) — contracts §5:

1. **QR join (required for M2).** MC renders its `ws://<ip>:<port><ws_path>` (+ `session_id`) as a QR on
   the Network screen; the node scans it with the phone camera and connects. This is the path you actually
   use with 16 phones on a field — typing IPs into 16 handsets is the fallback you hit first if this is
   missing. Treat it as M2 scope, not polish.
2. **mDNS/Bonjour.** MC publishes `_openbrx._tcp` on the LAN with TXT records
   `{ ver, session_id, ws_path, server_name }` on its WS port. Bonjour is native on macOS/iOS; Android
   uses NSD; browsers can't do raw mDNS, so the Capacitor node uses a small native NSD/Bonjour plugin.
   Node browses `_openbrx._tcp`, reads the TXT, opens `ws://<resolved-ip>:<port><ws_path>`. iOS requires
   the `NSBonjourServices` `Info.plist` key (not an entitlement) or the browse silently returns nothing (§8 gates).
3. **Manual IP entry (mandatory fallback).** mDNS fails on hostile/guest Wi-Fi, some Android OEM stacks,
   and locked-down routers; a camera can be cracked. The node UI always offers **"Enter Mission Control
   address"** — host reads the IP:port off MC's screen (displayed prominently) and types it. Never make the
   game un-startable because Bonjour is filtered or a camera is dead.

Discovery yields a URL; from there §5's lifecycle takes over. Discovery is *only* used to find MC the
first time and after a full address change — a warm socket is never re-discovered, and a node that walks
back into range reconnects to the cached URL without re-scanning.

## 4. Store-and-forward

**The gun loop NEVER blocks on the WS** (README §2 invariant; ADR-0002 §3). This is the load-bearing
rule of the whole module. The node's engine writes to the gun over BLE and emits `Event`s into an
**in-process outbox**; the WS layer drains the outbox asynchronously. If the socket is down, slow, or
buffering, the engine does not notice and does not wait.

**Two kinds of uplink (contracts A4.4).**
- **Persisted facts** — `hit_taken`, `death`, `respawn`, `team_change`. Each gets the node's next monotonic `seq`
  (`Envelope.seq`) at enqueue time, is appended to the ring, and is replayed until MC `ack`s it.
- **Live-only** — `status` (the heartbeat + counters) and the other `NodeMessage`s. `status` carries **no
  `seq`, is never queued, never persisted**: if the socket is down it is simply not sent; the next one
  carries the current truth (`shots`, `hp`, `arm_state`, `preflight`, `dropped`). Queuing a heartbeat is
  worse than useless — it would flush minutes of stale snapshots at reconnect.

**Outbox = a bounded, persisted ring (facts only).**
- Persisted (IndexedDB / SQLite / a capped file) so it survives the app being backgrounded or killed
  mid-match, and survives the **minutes-long** outages of §2.
- **Bounded:** cap by count *and* age — recommend **~500 facts or 2 h**, whichever first. Sizing: a
  kill is ~13 `hit_taken` + 1 `death` + 1 `respawn`; ten deaths in a match is ~150 facts, so 500 covers a
  long match plus a late recap with margin, and it is small enough to flush in three `event_batch`es. The
  old 20-minute age cap is gone — a phone may not see MC until well after the match. On overflow, **drop
  oldest** and increment `dropped` (reported in the next `status`).
- **`match_id` is stamped on every fact** (contracts A4.3). The ring may legitimately hold facts from
  match N when match N+1 starts (a phone that never got back in range); MC **parks** foreign-match facts
  into that match's recap and never scores them into the current one. The node does not filter — it
  flushes everything un-acked, oldest first.
- **Never queue `feedback`/`start`/`assign`/`config` (MC→node) in the outbox ring** — the ring holds only the
  node's own outbound facts. The node *does* persist its current context (player/team/roster/config/bundle/
  pending `start`) separately (node.md §3.7), and `welcome` re-hydrates it anyway (§5).

**Flush on reconnect.** On (re)establishing the socket and completing `hello`/`welcome`, the node sends
all un-acked facts as one or more `event_batch` messages (`{ events: Event[] }`, contracts §5), oldest
first, chunked (≤200 events/batch, well under the §8 size cap). Live facts emitted during a healthy
connection go as single `event` messages; the batch path is purely the backlog drain. `status` resumes
on its own cadence the moment the socket is `bound`.

**Idempotent dedup at MC.** MC keeps, per `node_id`, the highest `seq` applied (and a small recent-set
to tolerate reordering). An arriving fact with `seq ≤ last_applied` is a **replay → dropped silently**.
This makes reconnect-flush, at-least-once delivery, and duplicate sockets all safe (contracts §4:
"idempotent by `(node_id, seq)`"). MC ACKs progress (`ack {seq_hi}`, §6) so the node can prune its ring;
un-ACKed facts are retained and re-sent next flush. The one hole in a high-water-mark dedup — a node
whose storage was wiped restarting at `seq = 0` and having every real fact silently dropped — is closed
by the `hello.seq_next` / `welcome.seq_hi` exchange in §5.

## 5. Connection lifecycle

```
resolve(§3) → CONNECTING → OPEN → hello ─────► welcome(hydrate) → BOUND(bind) → LIVE
     ▲                                  │                                          │
     └──── backoff ◄── CLOSED/ERROR ◄───┴──── heartbeat lost / socket drop ◄───────┘
```

- **Handshake + re-hydration (contracts A4.5, A5.5).** On OPEN the node sends
  `hello { node_id, node_type, app_ver, gun?: {name, tail, fw?}, seq_next }`. `gun.name` is the **full advert
  name** (`<sticker>-<tail>`); `tail` is parsed from that name — **never from the platform deviceId** (iOS
  gives per-device UUIDs, so a UUID-derived tail would never match MC's armory). MC replies
  `welcome { session_id, server_t, seq_hi, node?: { player, team, roster, config, frames, start?, match_id?, score? } }`
  — **everything this node needs to resume its current phase**, not just the config. **MC resolves the
  context by the gun first** (`hello.gun` sticker/tail → the player bound to that gun), **`node_id` second** —
  so a hot-swapped phone with a brand-new `node_id` is hydrated on its **first** `hello`, before `bind`, with
  no post-bind push. `score?` is that player's current `ScoreRow`, so a swapped phone's HUD deaths/kills start
  right. A relaunched, reinstalled, or hot-swapped phone rebuilds KITTED/LOBBY/ARMED/LIVE from `welcome`
  alone; MC never has to remember to "re-push". M-NET gets this from M-MC's `hydrate(hello)` hook (§6) and
  passes the object through untouched. `server_t` seeds the first clock estimate (§7). Node must not send
  facts before `welcome` (they queue in the outbox regardless, so this is free).
- **`seq_next` / `seq_hi`.** The node reports the seq it will stamp next; MC returns the highest seq it has
  durably ingested from this `node_id`. The node then sets **`next_seq = max(own, seq_hi + 1)`**. This is
  what makes a **wiped install** safe: a fresh app on the same `node_id` would otherwise restart at 0 and
  every real fact would land below MC's high-water mark and be dropped as a replay. MC also logs a
  `seq_next < seq_hi` hello as "node storage reset" so recap can explain a gap.
- **Bind.** After `welcome` the node sends `bind { node_id, player_id?, gun_name, gun_tail }` (both from the
  advert name, A5.5) claiming its gun and (if known) player. MC maps `node_id ↔ player_id ↔ gun`. Re-`bind`
  on reconnect is idempotent — rebinding the same node updates the mapping in place. Because `welcome`
  already hydrated by gun, a hot-swap needs nothing more; **only if the gun in `hello` was unknown to MC**
  (unenrolled, or not yet assigned to a player) does MC fall back to pushing `assign`/`config` after `bind`.
  This is how "any node clips to any gun" stays true on the wire.
- **Heartbeat.** The node's `status` message (contracts §4, every `STATUS_HEARTBEAT_MS = 2000`, live-only)
  doubles as the liveness heartbeat — no separate ping needed for node→MC liveness. MC treats any frame
  as proof-of-life. The cadence also keeps the socket warm against router idle-timeouts. MC→node liveness
  rides server-initiated WS ping/pong at the same cadence (browser JS cannot see pongs; the server side
  does the checking).
- **Staleness.** If MC sees no frame from a node for `STALE_AFTER_MS = 8000` (4 missed heartbeats), it
  marks the node **stale, not gone** (contracts §5): scoreboard shows last-known state + a staleness age
  badge (M-MC). On a large field *most* nodes are stale *most* of the match — the board must read that as
  normal, not as an alarm. A node only leaves the roster on explicit host removal or session end.
- **Reconnect / backoff.** On any drop the node re-enters CONNECTING and retries with **exponential
  backoff + jitter**: base 500 ms, ×2, cap 10 s, ±20% jitter (jitter prevents a thundering herd when the
  AP blips and 20 nodes reconnect at once). Backoff resets on a successful `welcome`. **While the node is
  ARMED or LIVE the retry is unbounded** — it never gives up mid-match; a 15-minute walk out of range is
  ~90 quiet attempts at the 10 s cap, which is the intended behaviour. After `end`/`recall` the node may
  stop retrying once its ring is empty. After a long outage the node re-resolves via §3 only if the cached
  URL fails to connect several times *while `ssid_ok`* (address may have changed); otherwise it reuses
  the last URL.
- **Auto-rejoin is the OS's job and it may refuse.** A phone that walked out of range has, from the OS's
  point of view, *lost* a Wi-Fi network with no internet — Android may decline to auto-rejoin it and iOS
  may have Auto-Join off. The socket layer cannot fix that; the §8 gates + preflight (`ssid_ok`) make it
  visible, and the operator checklist makes it not happen.
- **Graceful degradation.** A vanished node degrades to *local-only*: full gun loop, HUD shows an
  "offline — will sync" indicator, outbox grows. On return it flushes and MC reconciles. Nothing about
  the match outcome depends on the node being online during play (ADR-0002 §3) — only the *shared*
  scoreboard and MC-driven feedback lag (README §3).

## 6. Interfaces

Node-type-agnostic (phone or Companion behind the same surface). Signatures are the contract M-NODE and
M-MC bind to; language-idiomatic equivalents are fine (async/await, callbacks, or an event emitter).

**Client (consumed by a node — M-NODE):**
```ts
interface Transport {
  connect(discovery: { qr?: string; mdns?: boolean; url?: string }): Promise<Welcome>; // resolve+open+hello+welcome; returns welcome.node (player/team/roster/config/frames/start?/match_id?/score?) for hydration
  bind(b: { node_id: string; player_id?: string; gun_name: string; gun_tail: string }): void; // gun_name/gun_tail from the advert name, never the deviceId
  send(ev: Event): void;            // PERSISTED facts only (hit_taken|death|respawn): enqueue to ring; NEVER blocks, NEVER throws offline
  status(body: StatusBody): void;   // live-only heartbeat: sent iff bound, else dropped (no seq, no queue)
  report(msg: NodeMessage): void;   // ready|ack_config|log_offer|log_data — sent iff bound; ack_config/ready are retried by M-NODE on hydrate, not queued here
  syncedNow(): number;              // §7 — local_now() + smoothed offset
  synced(): boolean;                // §7 — offset fresh within SYNC_FRESH_MS (what M-NODE puts in status.synced)
  onMessage(cb: (msg: MCMessage) => void): void; // assign|config|tutorial|start|feedback|control|time_res|pull_log (welcome + ack consumed internally)
  onState(cb: (s: LinkState) => void): void;     // 'connecting'|'open'|'bound'|'offline'
  close(): void;
}
```
`send()` is fire-and-forget into the persisted ring; delivery is the Transport's problem, not the
caller's. The Transport **consumes `welcome`** (it hands `welcome.node` back from `connect()` / an
`onHydrate` callback and applies `seq_hi`) and **consumes `ack {seq_hi}`** (prunes the ring) — neither
is surfaced through `onMessage`. `onMessage` delivers the remaining MC→node envelopes already validated
(§8) and version-gated; bodies pass through untouched for M-NODE/M-START to interpret.

`NodeMessage` = the **non-fact** Node→MC envelopes — `ready`, `ack_config`, `log_offer`, `log_data`.
Facts go via `send()`/`onEvent`; the heartbeat via `status()`/`onStatus`; everything else via
`report()`/`onNodeMessage`.

**Server (consumed by MC — M-MC):**
```ts
interface NetServer {
  start(bind: { host: string; port: number; wsPath: string }): void;     // binds LAN IP + advertises mDNS + exposes the QR payload
  joinInfo(): { url: string; session_id: string; qr: string };           // what the Network screen renders (§3)
  hydrate(cb: (hello: Hello) => WelcomeNode | undefined): void; // MC supplies welcome.node (A4.5/A5.5): resolve by hello.gun (sticker/tail → bound player) FIRST, node_id second; M-NET adds session_id/server_t/seq_hi
  onNode(cb: (n: { node_id: string; node_type: string; player_id?: string; gun_tail?: string }) => void): void; // hello+bind
  onEvent(cb: (node_id: string, ev: Event, t_recv: number) => void): void;    // post-dedup persisted facts, monotonic per node
  onStatus(cb: (node_id: string, s: StatusBody, t_recv: number) => void): void; // live-only heartbeat (never dedup'd — latest wins)
  onNodeMessage(cb: (node_id: string, msg: NodeMessage, t_recv: number) => void): void; // ready|ack_config|log_offer|log_data
  onStale(cb: (node_id: string, ageMs: number) => void): void;
  onReturn(cb: (node_id: string) => void): void;             // stale → live again
  push(node_id: string, msg: MCMessage): void;               // assign|config|tutorial|start|feedback|control|time_res|pull_log|ack
  broadcast(msg: MCMessage): void;                           // e.g. start to all bound nodes
  timeService(): void;                                       // answers time_req with time_res (§7)
}
```
`onEvent` fires **only for facts that passed dedup** — M-MC never sees a replay. `ack_config`/`ready` are not
queued by the Transport; M-NODE re-sends them after a hydrate if its state says they are owed. Every callback carries
**`t_recv`** (MC's receive clock, contracts A4.7) so scoring can fall back to it for a node whose latest
`status.synced` is false. `push`/`broadcast` are best-effort (contracts §5): they return without waiting
for delivery; a node offline at push time gets the current context re-hydrated on its next `welcome`
instead — which is why M-MC's `hydrate` hook must always answer with the *current* player/config/frames/
start, never a cached copy.

## 7. Clock sync (contracts §7)

Load-bearing for the dispersed start **and the dispersed end** (M-START / M-NODE §3.9): a pre-shared
`go_live_t` must fire together on every node with **no T-0 signal**, and `go_live_t + time_limit_s` must
end the match with no end signal.

- **NTP-lite handshake.** Node sends `time_req { t_node }`; MC replies `time_res { t_node, server_t }`.
  Node computes `rtt = local_now() - t_node`, `offset = server_t - (t_node + rtt/2)` — assuming a
  symmetric path (contracts §7). `welcome.server_t` gives a zeroth estimate before the first round-trip.
- **Offset smoothing.** Don't trust a single sample (Wi-Fi RTT is spiky). Take a **burst of ~5 `time_req`
  on connect**, keep the sample with the **smallest rtt** (least queuing noise), and thereafter feed an
  **EWMA** (α≈0.2). Reject any sample whose rtt is > 3× the running median (a buffered outlier).
- **Re-sync cadence.** Full burst at connect and **at lobby** (contracts §7: "re-sync at lobby is
  enough"). While connected, a lightweight single `time_req` every **~30 s** keeps the EWMA fresh; phone
  clocks drift <<1 s over a match so this is belt-and-suspenders. Re-burst after any reconnect.
- **`syncedNow() = local_now() + offset`; `synced()` = a sample fresher than `SYNC_FRESH_MS`.** All
  `go_live_t`, expiry, respawn, and fact-`t` math uses synced time, never raw local time. M-NODE copies
  `synced()` into `status.synced`. **Time base at MC (contracts A4.7/A5.7):** a node that was synced at the
  lobby keeps its own `t` for the whole match (drift ≪1 s). For a **never-synced** node, live `event`s use
  `t_recv`; an `event_batch` is re-based **once per flush** (`offset = t_recv − t_newest`, applied to every
  fact in the batch, order preserved), and MC **suppresses window awards** (multi-kill, first blood) derived
  from those facts — a batch must never collapse ten deaths onto one instant.
- **Degraded fallback.** A node that **never completed a sync** (e.g. joined the LAN after `start`
  already went out, or QR/mDNS/manual all failed until late) falls back to counting `now + duration` from
  the instant it *received* `start` — correct to within one one-way latency, logged as `degraded_start`
  and reported `synced=false` so recap can flag it. This keeps a late/re-joining player in the game rather
  than dead-on-arrival.

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
  `event_batch` of 200 facts stays well under; **`log_data` chunks are ≤ 48 KB** so a chunk plus envelope
  never trips the cap). Oversized frame → reject the frame, don't buffer it.
- **Rogue-client handling.** A socket that never sends a valid `hello`, or sends `hello` then floods, is
  **quarantined**: no `onNode`/`onEvent` fires for it, it's rate-limited, and dropped after a grace
  window. A node claiming a `node_id`/`gun_tail` already bound to a *live* socket is treated as a
  **takeover** (hot-swap / app restart) — newest wins, old socket closed — because that's the legitimate
  common case; MC logs it so a genuine collision is visible in recap. Player identity is by `node_id` +
  host-confirmed `bind`, never by IP.
- **No trust in event content for safety.** Facts are *things a node observed*; MC's scoring already
  treats them as claims to reconcile (contracts §4), so a lying node corrupts only its own score line,
  not the match engine or other players' nodes. There is no wire command that lets one node write another
  node's gun — MC→node commands are the only downlink and they originate at MC.

### 8b. Platform network gates (blocking for M2)

None of §1–§7 works until the phone OS *lets* a Capacitor app talk `ws://` to a private IP on a Wi-Fi
that has no internet. These are not polish; each one silently breaks the whole LAN path. They live in
`app/scripts/ios-setup.sh` / `android-setup.sh` (generated platforms are rebuilt — never hand-edit Xcode/
Studio) and the node's preflight (`status.preflight`, contracts A4.9) proves them at muster.

| # | Gate | Symptom if missing | Fix |
|---|---|---|---|
| (a) | **iOS ATS** — App Transport Security does *not* exempt `ws://` to an IP literal (only `localhost`/`.local`). | WebView refuses the socket; no error the player can see. | `NSAppTransportSecurity → NSAllowsLocalNetworking = true` in `Info.plist` via `ios-setup.sh`. |
| (b) | **iOS 14+ Local Network privacy** | App is silently blocked from the LAN and from browsing mDNS; the permission prompt never appears without the keys. | `NSLocalNetworkUsageDescription` + `NSBonjourServices: ["_openbrx._tcp"]` in `Info.plist` via `ios-setup.sh`; expect the one-time system prompt at first connect. |
| (c) | **Android cleartext** | `ws://` blocked on API 28+. Capacitor's `allowMixedContent` is about mixed HTTPS pages, **not** this. | `android:usesCleartextTraffic="true"` or a `network_security_config` that permits cleartext to private ranges, applied by `android-setup.sh`. |
| (d) | **No-internet Wi-Fi is deprioritised** — Android and iOS treat a Wi-Fi with no captive-portal/internet reachability as second-class and may route the default network to **cellular**; the socket to `192.168.x.x` then leaves over LTE and dies. | Node shows "connecting…" forever while the phone has full bars. | Android: a small native plugin calls `ConnectivityManager.requestNetwork(WIFI)` + `bindProcessToNetwork` so the WebView's sockets use Wi-Fi regardless of validation; tap "keep connected / use this network" if the OS asks. iOS: Wi-Fi Assist **off**; the LAN IP is on-link so it routes via Wi-Fi as long as the phone stays joined. Preflight reports `ssid_ok` (joined the expected SSID) and `mc_reachable` (a HEAD/`time_req` round-trip succeeded). |
| (e) | **Auto-rejoin after walking out of range** | Player returns to base, nothing syncs, recap is empty — the phone never rejoined the SSID (Android "no internet" networks may be un-auto-joined; iOS Auto-Join off). | Preflight includes `auto_join_ok` (the network is saved with auto-join on); operator step per OS in the muster checklist: Android — forget other saved networks nearby, set the field SSID "auto-connect", **mobile data off**; iOS — Settings → Wi-Fi → field SSID → Auto-Join on, Wi-Fi Assist off. MC's Network screen shows the SSID it expects. |
| (f) | **Mobile data off** | Even with (d), some OEMs re-route when cellular looks better. | Part of the muster checklist and preflight (`cellular_off` best-effort where readable); MC surfaces amber if unknown. |
| (g) | **Do-Not-Disturb / calls** | An incoming call foregrounds the dialer (iOS regardless of app state) and suspends the webview — countdown, respawn and expiry timers stop (node.md §3.11). | DND on for the match is part of the muster checklist; preflight `dnd_on` (best-effort where readable); the resume→reconcile path is the recovery. |

Any of (a)–(e) failing is a **red** on the readiness board for that node, with the gate named. The
platform-gate task is #1 in §10 — build the transport against a mock, but *prove* the gates on a real
Android and a real iPhone on a no-internet router before anything else in M2.

## 9. Failure matrix

| When | Event | What happens | Recovery |
|---|---|---|---|
| **Muster** | Phone on the wrong SSID / cellular fallback (§8b d) | Node can't reach MC; preflight `ssid_ok`/`mc_reachable` false → **red** on the board with the gate named. | Join the field SSID, mobile data off; node auto-connects (§5) and goes green. |
| **Lobby** | LAN down before ready-up | No config push; host can't see nodes ready. Game **cannot start synced** yet — nodes have no `go_live_t`. | Stand up the LAN (router primary, hotspot fallback §2); nodes auto-connect (§5), the `config` message pushes the game, ready-up proceeds. Bench-local single-gun play still works with no LAN at all. |
| **Lobby** | One node can't discover MC | That player is un-kitted; rest proceed. | QR join (§3.1), then manual IP; or the host reads MC's address to the player. |
| **Mid-game (the norm)** | Node walks out of range for minutes | Node keeps playing (§4) — including its own timed end; facts queue in the persisted ring (`match_id`-stamped); MC marks it **stale** after `STALE_AFTER_MS`, board shows last-known + age (expected, not an error). No feedback reaches it. | On return to a coverage zone or recap, socket reconnects (unbounded backoff §5), `welcome` re-hydrates, `event_batch` flushes, MC dedups + reconciles. No lost facts unless the ring overflowed (`dropped` counted). |
| **Mid-game** | Whole LAN dies (router off) | **Every** node goes local-only; the match runs to completion on nodes alone (ADR-0002 §3), ends on `time_limit_s`. Live board freezes. | Restore any LAN; all nodes flush backlog; MC reconciles to correct end-state. Start already fired locally (`go_live_t` was pre-shared, §7), so the match itself is unaffected. |
| **Mid-game** | Phone returns but did not auto-rejoin the SSID (§8b e) | Node stays offline at the base; nothing flushes; board stays stale. | Player/host taps the SSID; preflight `auto_join_ok` was the muster-time warning. Log it — this is the most likely "recap is empty" cause. |
| **Mid-game** | Screen lock / app backgrounded | JS engine suspended: no countdown, respawn or expiry ticks, no drain (see node.md §3.11). BLE may still be up. | Foreground → node reconciles against `syncedNow()` (missed T-0 → grace/hot-join; missed expiry → end now), then reconnects. Mount + keep-awake make this rare. |
| **Mid-game** | Node app killed / phone dies | Persisted ring survives an app kill → relaunch flushes. A dead battery loses that player's un-flushed tail **and its `status.shots` counter** — MC shows that player's accuracy as "—", not 0 (contracts §4); their gun still holds last BRX state until re-driven. | Relaunch → `hello{seq_next}` → `welcome{seq_hi, node}` re-hydrates phase + frames + pending `start` → flush. Hot-swap to a charged phone: the new phone's **first `hello` carries the gun's advert name, MC hydrates by gun** (A5.5) — full context + `score?` seeds the HUD before `bind`; the dead phone's un-flushed tail arrives whenever it is powered again (dedup + `match_id` parking make that safe). |
| **Recap** | LAN down at return | MC can't reconcile finals; recap shows partial + "waiting for N nodes." **Recap is provisional until every rostered node has flushed** — kills live only in victims' reports, so a missing victim hides other players' kills. | Bring nodes into range on any LAN; each flushes its ring; MC recomputes finals as batches land (eventual consistency). Recap is explicitly allowed to complete late; export is marked provisional until finalized. |
| **Recap** | A node never returns | MC finalizes with that player's **last-known** line, flagged incomplete. | Node's log can be side-loaded later (contracts `log_offer`/`pull_log`) to backfill if it matters. |
| **Next match** | A late flush carries match-N facts during match N+1 | MC **parks** them under match N (contracts A4.3) and updates N's recap; match N+1 is untouched. | Nothing to do — by design. |

## 10. Task breakdown

1. **Platform network gates (§8b) — first.** `ios-setup.sh`/`android-setup.sh` keys, the bind-to-Wi-Fi
   native plugin, preflight probes (`ssid_ok`, `mc_reachable`, `auto_join_ok`, `cellular_off`, `dnd_on`), proven on a
   real Android + iPhone against a no-internet travel router. Nothing else in M2 is testable on a field
   without this.
2. **Envelope + validation core** — encode/decode, `v` gate, schema check, size cap (§8). Shared by
   client & server. Ships with a fuzz/malformed-frame test.
3. **Persisted outbox (facts only)** — bounded ring with `seq` assignment, count/age cap (500 / 2 h),
   overflow-drop counter, `match_id` pass-through, survives background/kill. Platform storage behind one
   interface (IndexedDB/SQLite/file). `status` explicitly bypasses it.
4. **Client Transport** — connect (QR/mDNS/manual) / `hello{seq_next}` / `welcome` hydration + `seq_hi`
   resume / bind, async drain, `event_batch` chunking, `status()`/`report()` paths, backoff + jitter with
   **unbounded retry while ARMED/LIVE**, `onState`/`onMessage`/`synced()` (§5–§7). Builds against a **mock
   MC** (README §5 rule 3).
5. **Server NetServer** — WS listener bound to LAN IP, `joinInfo()` (URL + QR payload), `hydrate` hook
   (**resolve by `hello.gun` first, `node_id` second**; include `score?`),
   per-node `seq` high-water + dedup + `seq_next` reset detection, `onEvent`/`onStatus`/`onNodeMessage`
   with `t_recv`, `onStale`/`onReturn`, `push`/`broadcast`, quarantine/rate-limit (§6, §8).
6. **Discovery** — QR render (MC) + scan (node) as the M2 default; MC mDNS advertiser (`_openbrx._tcp` +
   TXT) and node browser (native NSD/Bonjour plugin, `NSBonjourServices`); manual-IP path (§3).
7. **Clock service** — server `time_res` responder; client burst + EWMA + re-sync cadence + degraded
   fallback; `syncedNow()`/`synced()` (§7). Test with injected asymmetric latency.
8. **Staleness/heartbeat wiring** — hook `STATUS_HEARTBEAT_MS`/`STALE_AFTER_MS` to `onStale`/`onReturn`
   and the M-MC badge (§5), with "stale is normal" defaults for a dispersed board.
9. **Failure-matrix test harness** — scripted scenarios from §9 (minutes-long outage, wiped install with
   `seq_next` reset, hot-swap, late match-N flush during N+1, background/resume) as integration tests both
   sides run in CI without hardware.

## 11. Open questions

- **mDNS on Capacitor Android/iOS** — which NSD/Bonjour plugin, and does it survive app-background? With
  QR as the M2 default this is a convenience question, not a blocker. (Prototype in M2, feeds §3.)
- **Bind-to-Wi-Fi plugin on iOS** — Android has `bindProcessToNetwork`; iOS has no equivalent. Confirm
  that an on-link `192.168.x.x` reliably stays on Wi-Fi with Wi-Fi Assist off, or find a `NWConnection`
  `requiredInterfaceType = .wifi` path via a plugin. (§8b d)
- **Outbox sizing** — 500 facts / 2 h is derived from the damage model (~13 hits per kill); revisit once
  real per-match fact counts are measured (M-NODE), especially for high-ROF weapons that raise hits-per-kill.
- ~~**`ack`/high-water shape**~~ — **RESOLVED (contracts A1):** MC→node `ack {seq_hi}`; the node prunes on
  durable ingest. Consumed by the Transport (§4, §6).
- ~~**Multi-network safety**~~ — **RESOLVED (§8b d/e):** bind the socket to the Wi-Fi network on Android via
  a native plugin, Wi-Fi Assist off on iOS, mobile data off in the muster checklist, and preflight proves it.
- **TLS on the field** — deferred. Is a self-signed `wss://` + pinned cert worth it later, or is a
  private LAN + message-layer validation (§8) sufficient? Revisit if untrusted-venue play appears. (Note:
  `wss://` to an IP literal would *also* need ATS work — §8b a.)
- **Companion parity** — confirm the ESP32 WS client can hold the same warm socket + a 500-fact persisted
  ring under RAM limits (M6); may need a smaller ring and tighter batch cap. The `hello`/`welcome`
  hydration shape (by gun name) is unchanged for it. No contract change expected.
