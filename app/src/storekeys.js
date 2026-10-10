// Every localStorage key the phone app writes (M4, maintainability review 2026-10-10). Documentation only: each owner keeps
// its own key constant, so this list is the index, not the source. Add a row here when you add a key.
//
// Prefix: the HUD uses `brx.`; the utility (station) page uses `brxu.` for the transport keys (transport.js `keyPrefix`).
//
//   key                      owner                  holds                                                     versioned
//   brx.engine               engine.js              the match context a restart must survive (`_save`/`_load`)   yes, `v` (ENGINE_STORE_V)
//   brx.night                engine.js              HUD skin, '1' or '0' (outside brx.engine: no TTL)             no
//   brx.night_choice         engine.js              the night-skin choice, JSON                                   no
//   brx.outbox               transport/ring.js      the persisted fact outbox (`Ring`); utility: `brxu.outbox`    yes, `v` (RING_STORE_V)
//   brx.clock                transport/clock.js     the MC clock offset, last sync, sample count; `brxu.clock`    no
//   brx.node_id              transport/transport.js this node's id; `brxu.node_id`                                no
//   brx.node_key             transport/transport.js the node's wire key; `brxu.node_key`                          no
//   brx.pub / brx.secret     transport/transport.js the node's signing pair; `brxu.pub`, `brxu.secret`            no
//   brx.session_id           transport/transport.js the MC session id; `brxu.session_id`                          no
//   brx.pub_url              transport/transport.js the backhaul (public) MC URL; `brxu.pub_url`                  no
//   brx.mc_trust             transport/transport.js trust keys per MC install (at most TRUST_KEYS_MAX)            no
//   brx.mc_enroll_nonce      transport/transport.js the pending enrolment nonce; `brxu.mc_enroll_nonce`           no
//   brx.prior_utility        transport/transport.js, utility.js, app.js  the station-to-HUD handoff, stamped      no
//   brx.mc_url               app.js, utility.js     the MC address the operator typed or scanned                  no
//   brx.role                 app.js, utility.js     'hud' or 'utility', the page the app opens on                 no
//   brx.history              app.js                 finished matches, newest last (HISTORY_MAX)                   no
//   brx.utility              utility.js             the station operator settings, JSON                           no
//   brx.station.control      utility.js             the control point's snapshot and advert seq                   no
//   brx.station.powerup      utility.js             the powerup station's snapshot                                no
//   brx.station.range        rangeedit.js (RANGE_KEY) the on-station range edit, synced to MC                     no
//   brx.utility.players      utility.js             '1' when the station shows the player list                   no
//
// A versioned blob: no `v` means version 1 (older builds), so an upgrade restores it as it was. An unknown `v` is not
// restored: the owner starts clean and logs one line naming the key and the `v`.
export {};
