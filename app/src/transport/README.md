# `app/src/transport/` — the node-side wire (M-NET client)

Dependency-free ESM implementing `Transport` from the retired `docs/spec/net.md` §6 (now `docs/archive/spec-net.md`; the wire is `docs/spec/contracts.md` §5) against the real MC server
(`mcp/brx_mcp/mc/net.py`). Mirrors `mcp/brx_mcp/mc/mock_node.py` — the Python reference node.

```js
import { Transport } from './transport/transport.js';

const t = new Transport({ node: { app_ver: 'hud-0.1' }, gun: { name: advertName, tail: advertTail, fw } }); // name/tail from the BLE advert, never deviceId
t.setStatusProvider(() => ({ hp, armor, ammo, alive, shots, battery, arm_state, t_minus_ms, synced: t.synced() }));
t.setPreflight({ ssid_ok, mc_reachable: true, phone_batt, screen_on, foreground, gun_linked, headset_ok });
t.onHydrate(node => applyContext(node));      // welcome.node: player/team/roster/config/frames/start/score (also on reconnect)
t.onMessage(({ kind, body }) => { /* assign|config|tutorial|start|feedback|control|apply|time_res|pull_log */ });
t.onState(s => hud.link(s));                   // connecting|open|bound|offline
const welcome = await t.connect({ url: qrUrl });  // resolves with the first welcome
t.send({ type: 'death', shooter_num, shooter_team });   // persisted fact: queued offline, flushed + acked later
t.report('ack_config', { config_id, ok: true, gun_echo });  // non-fact uplink
t.armedOrLive = true;                          // reconnect is unbounded anyway; flag is informational for now
const now = t.syncedNow();                     // all go_live_t / expiry / respawn math uses this
```

The app still owns: the gun engine and frame writes (`frames.*` verbatim + `$SFLASH`/`$PLAYX,0` + the
probe set), the HUD, BLE plumbing, the §3.10 resync protocol, `match_id`/`arm_state` bookkeeping fed to
`status()`, and running `report('ready', …)`. Storage: `localStorage` (falls back to memory); keys
`brx.node_id`, `brx.outbox`, `brx.clock`. Tests: `cd app && node --test test/*.test.mjs` (the `MODULE_TYPELESS` warning goes away if `"type": "module"` is added to app/package.json — not done here).
