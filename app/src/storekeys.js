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
//   brx.node_key             transport/transport.js the takeover key MC issues in the welcome; `brxu.node_key`     no
//   brx.pub                  transport/transport.js the backhaul (tunnel) URL, session- and URL-scoped; `brxu.pub`  no
//   brx.secret               transport/transport.js the QR join secret, session- and URL-scoped; `brxu.secret`    no
//   brx.session_id           transport/transport.js the MC session id; `brxu.session_id`                          no
//   brx.pub_url              transport/transport.js the LAN URL that brx.pub / brx.secret belong to; `brxu.pub_url`  no
//   brx.mc_trust             transport/transport.js trust keys per MC install (at most TRUST_KEYS_MAX)            no
//   brxu.mc_trust            transport/transport.js the same, under the utility prefix                            no
//   brx.mc_enroll_nonce      transport/transport.js the pending enrolment nonce; `brxu.mc_enroll_nonce`           no
//   brx.prior_utility        transport.js (PRIOR_UTILITY_KEY); utility.js writes, app.js reads, transport.js removes once consumed  the station-to-HUD handoff, stamped  no
//   brx.mc_url               mcurl.js (MC_URL_KEY); app.js writes and reads, utility.js reads  the MC address the operator typed or scanned  no
//   brx.role                 transport.js (ROLE_KEY); app.js, utility.js both write  'hud' or 'utility', the page the app opens on         no
//   brx.history              history.js (HISTORY_KEY); app.js  finished matches, newest last (HISTORY_MAX)                   no
//   brx.utility              utility.js             the station operator settings, JSON                           no
//   brx.station.control      utility.js             the control point's snapshot and advert seq                   no
//   brx.station.powerup      utility.js             the powerup station's snapshot                                no
//   brx.station.range        utility.js (reads and writes); rangeedit.js owns the RANGE_KEY name  the on-station range edit, synced to MC  no
//   brx.utility.players      utility.js             '1' when the station shows the player list                   no
//
// A versioned blob: no `v` means version 1 (older builds), so an upgrade restores it as it was. An unknown `v` is not
// restored: the owner starts clean and logs one line naming the key and the `v`.
export {};
