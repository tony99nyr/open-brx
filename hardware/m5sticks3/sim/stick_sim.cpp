// sim/stick_sim.cpp - the Stick's screen simulator. Drives the REAL state machines (StationLink,
// ControlPoint, PlayerPresence, StationButtons, HomeNav, ForceRestart, the JSON parsers) through
// realistic message sequences, maps each result through the REAL build_stick_state() (stick_state.h,
// shared with m5sticks3.ino) and compute_screen() (station_screen.h), and prints one JSON line per
// scenario. Built with -DBRX_SIM_RENDER it also draws each ScreenSpec with the REAL station_render.h
// into an LGFX sprite (sim/shim/M5Unified.h) and writes a PNG, plus the ink box of every string.
//
// What is mirrored here rather than shared: the glue's frame handling (mc_link_glue.h mcHandleFrame,
// mcTickPlayers) and the .ino's pollButtons() are Arduino-only, so SimStick copies their few lines of
// sequencing. The decisions they call (apply_welcome, apply_station_config, on_long_press, ...) are
// the real ones. Run it through sim/stick_sim.py, not by hand.
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <string>
#include <vector>

#include "json_lite.h"
#include "stick_state.h"

#ifdef BRX_SIM_RENDER
#include <M5Unified.h>  // sim/shim/M5Unified.h
#include "station_render.h"
#endif

using namespace brx;

// ---- JSON output --------------------------------------------------------------------------------
static std::string jstr(const std::string& s) {
  std::string o = "\"";
  for (char c : s) {
    if (c == '"' || c == '\\') { o += '\\'; o += c; }
    else if ((unsigned char)c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += c;
  }
  return o + "\"";
}

static const char* kind_name(ScreenKind k) {
  switch (k) {
    case ScreenKind::HILL_NEUTRAL: return "HILL_NEUTRAL";
    case ScreenKind::SCR_NO_WIFI: return "SCR_NO_WIFI";
    case ScreenKind::RESPAWN_REDEPLOY: return "RESPAWN_REDEPLOY";
    case ScreenKind::BRIDGE_WAITING: return "BRIDGE_WAITING";
    case ScreenKind::HILL_HELD: return "HILL_HELD";
    case ScreenKind::HILL_CAPTURING: return "HILL_CAPTURING";
    case ScreenKind::HILL_CONTESTED: return "HILL_CONTESTED";
    case ScreenKind::PICKUP_READY: return "PICKUP_READY";
    case ScreenKind::PICKUP_TAKEN: return "PICKUP_TAKEN";
    case ScreenKind::PICKUP_EMPTY: return "PICKUP_EMPTY";
    case ScreenKind::RESPAWN_OWNED: return "RESPAWN_OWNED";
    case ScreenKind::RESPAWN_IDLE: return "RESPAWN_IDLE";
    case ScreenKind::SCR_DIAGNOSTICS: return "SCR_DIAGNOSTICS";
    case ScreenKind::SCR_SETTINGS: return "SCR_SETTINGS";
    case ScreenKind::SCR_ASSIGNED: return "SCR_ASSIGNED";
    case ScreenKind::SCR_JOINING: return "SCR_JOINING";
    case ScreenKind::SCR_LINKED_WAITING: return "SCR_LINKED_WAITING";
    case ScreenKind::SCR_LOW_BATTERY: return "SCR_LOW_BATTERY";
    case ScreenKind::SCR_STATS: return "SCR_STATS";
    case ScreenKind::SCR_RESET_CONFIRM: return "SCR_RESET_CONFIRM";
    case ScreenKind::SCR_RESET_SENT: return "SCR_RESET_SENT";
    case ScreenKind::SCR_RESET_NEEDS_MC: return "SCR_RESET_NEEDS_MC";
    case ScreenKind::SCR_RESET_LOCKED: return "SCR_RESET_LOCKED";
    case ScreenKind::SCR_FORCE_RESTART: return "SCR_FORCE_RESTART";
    case ScreenKind::SCR_RANGE: return "SCR_RANGE";
  }
  return "?";
}

// The fields a reviewer reads; enough to tell every screen apart without the PNG.
static std::string spec_json(const ScreenSpec& s) {
  std::string o = "{";
  o += "\"kind\":" + jstr(kind_name(s.kind));
  o += ",\"hint\":" + jstr(s.hint);
  o += ",\"hill_kicker\":" + jstr(s.hill_kicker);
  o += ",\"hill_team\":" + std::to_string(s.hill_team);
  o += ",\"hill_verb\":" + jstr(s.hill_verb);
  o += ",\"hill_note\":" + jstr(s.hill_note);
  o += ",\"hill_pct\":" + std::to_string(s.hill_pct);
  o += ",\"hold_time\":" + jstr(s.hold_time);
  o += ",\"item_name\":" + jstr(s.item_name);
  o += ",\"taken_by\":" + jstr(s.taken_by);
  o += ",\"next_spawn\":" + jstr(s.next_spawn);
  o += ",\"respawn_team\":" + std::to_string(s.respawn_team);
  o += ",\"revives\":" + std::to_string(s.revives);
  o += ",\"respawn_note\":" + jstr(s.respawn_note);
  o += ",\"assigned_role\":" + jstr(s.assigned_role);
  o += ",\"stats_kind\":" + jstr(s.stats_kind);
  o += ",\"stats_mc_link\":" + jstr(s.stats_mc_link);
  o += ",\"station_id_for_reset\":" + std::to_string(s.station_id_for_reset);
  o += ",\"lock_remaining\":" + jstr(s.lock_remaining);
  o += ",\"restart_in_s\":" + std::to_string(s.restart_in_s);
  o += ",\"strip\":{\"mc\":" + std::string(s.strip.mc_connected ? "true" : "false") +
       ",\"ir\":" + (s.strip.ir_active ? "true" : "false") +
       ",\"battery\":" + std::to_string(s.strip.battery_pct) +
       ",\"station_id\":" + std::to_string(s.strip.station_id) +
       ",\"locked\":" + (s.strip.locked ? "true" : "false") + "}";
  return o + "}";
}

// ---- a Stick on the host --------------------------------------------------------------------------
struct SimPlayer {
  uint16_t id;
  uint8_t team;
  bool alive;
  int rssi;
};

struct SimStick {
  StationLink link;
  SavedStationConfig saved;
  ControlPoint point;
  PlayerPresence presence;
  StationButtons buttons;
  HomeNav home;
  ForceRestart force;
  HeldClock held;
  std::vector<SimPlayer> at_station;  // players whose adverts the scan hears each tick
  uint32_t now = 1000;
  bool socket_up = false;
  bool advert_fails = false;
  uint32_t revive_flash_until = 0;
  uint32_t last_word_at = 0;
  Word last_word;
  uint32_t words = 0, sent = 0;
  std::string selftest = "-";
  uint32_t confirm_armed_at = 0;
  bool ro_active = false, ro_ok = false, ro_locked = false;
  uint32_t ro_at = 0;
  uint32_t last_epoch = 0;
  uint32_t last_play_tick = 0;
  int battery_override = -1;  // no battery reading is wired up yet (README); a scenario may inject one

  // currentAdvertView()'s `active` plus publishAdvert() succeeding
  bool advertising() const {
    if (advert_fails) return false;
    if (!link.assignment().present) return point.view(now).active;
    return true;
  }

  // ---- Wi-Fi / MC link (mc_link_glue.h) ----
  void wifi_set() { link.wifi_configured(); }
  void wifi_up() { link.wifi_up(); }
  void connect_mc() {
    link.mc_address_known();
    link.ws_open_hello_sent();
    socket_up = true;
  }
  void frame(const std::string& kind, const std::string& body_json) {  // mcHandleFrame
    bool ok = false;
    json::Value body = json::parse(body_json, &ok);
    if (!ok) { std::fprintf(stderr, "bad JSON in scenario: %s\n", body_json.c_str()); std::exit(2); }
    if (kind == "welcome") {
      WelcomeMsg w = parse_welcome(body);
      link.apply_welcome(w);
      if (w.ok) apply_welcome_to_saved(link, saved, w.session_id);
    } else if (kind == "station_config") {
      StationAssignment a = parse_station_config(body);
      if (a.present) {
        link.apply_station_config(a, now);
        saved.note_applied(a, link.session_id());
        if (link.take_muster_drop(now)) muster_drop();
      }
    } else if (kind == "station_update") {
      StationUpdateMsg u = parse_station_update(body);
      if (link.apply_station_update(u, now) && link.take_muster_drop(now)) muster_drop();
    } else if (kind == "control") {
      if (parse_control_cmd(body) == "release_utility") {
        link.apply_release();
        saved.note_released();
      }
    }
  }
  void muster_drop() {  // mcPerformMusterDrop
    socket_up = false;
    link.wifi_down();
  }

  // ---- time: loop() at the station tick ----
  void advance(uint32_t ms) {
    uint32_t end = now + ms;
    while (now < end) {
      now += 50;
      if (now - last_play_tick >= STATION_TICK_MS) { last_play_tick = now; tick_players(); }
      if (link.has_powerup_assignment()) link.tick_powerup(now);
      link.poll_lock(now);
      buttons.poll_timeout(now);
      home.poll_idle(now);
      force.update(false, false, now);
      if (range.active() && range_must_close(link.assignment().present, battery_override)) range.close();
      range.poll_idle(now);
      if (ro_active && now - ro_at >= 2500) ro_active = false;  // RESET_OUTCOME_SHOW_MS
      if (now % 250 == 0) state();  // loop() repaints at least every 250 ms; the paint runs the HELD clock
    }
  }
  void tick_players() {  // mcTickPlayers
    if (!link.has_control_assignment() && !(REVIVE_FEEDBACK_ENABLED && link.has_respawn_assignment())) return;
    const StationAssignment& a = link.assignment();
    presence.default_threshold = link.threshold_dbm();  // as the firmware: MC's value or a younger edit
    presence.game = (uint8_t)a.game;
    if (link.assignment_epoch() != last_epoch) { last_epoch = link.assignment_epoch(); presence.clear(); }
    for (const SimPlayer& p : at_station) {
      Advert d;
      d.role = ROLE_PLAYER;
      d.id = p.id;
      d.team = p.team;
      d.state = p.alive ? PLAYER_ALIVE : 0;
      d.game = (uint8_t)a.game;
      presence.observe(d, p.rssi, now);
    }
    presence.tick(now);
    const uint32_t before = link.revives().revives;
    link.tick_players(presence, now);
    if (link.revives().revives != before) revive_flash_until = now + 1500;  // REVIVE_FLASH_MS
  }
  void arrive(uint16_t id, uint8_t team, bool alive = true, int rssi = -45) { at_station.push_back({id, team, alive, rssi}); }
  void leave(uint16_t id) {
    for (size_t i = 0; i < at_station.size(); i++) if (at_station[i].id == id) { at_station.erase(at_station.begin() + i); return; }
  }
  void set_alive(uint16_t id, bool alive) { for (auto& p : at_station) if (p.id == id) p.alive = alive; }

  // ---- bench IR ----
  void ir_word(const Word& w) {
    point.on_word(w, now);
    words++;
    last_word = w;
    last_word_at = now;
  }

  // ---- buttons (m5sticks3.ino pollButtons, same order) ----
  // ---- A: one gesture (station_ui.h AHoldGesture), as pollButtons() reads it ----
  AHoldGesture ahold;
  RangeEditor range;
  bool range_allowed() const {
    return link.state() != LinkState::NOT_CONFIGURED && !home.at_home() && link.assignment().present && !range.active() &&
           buttons.phase() == ButtonPhase::NORMAL;
  }
  void on_a_event(AHoldEvent ev) {
    if (range.active()) {  // in RANGE: A click steps (closer / weaker), an A hold switches the field
      if (ev == AHoldEvent::CLICK) range_step(true);
      else if (ev == AHoldEvent::HOME) range.switch_field(now);
      home.note_activity(now);
      return;
    }
    if (ev == AHoldEvent::RANGE) {
      range.open(now);
      home.note_activity(now);
    } else if (ev == AHoldEvent::CLICK) {
      ButtonPhase before = buttons.phase();
      buttons.on_short_press();
      if (before == ButtonPhase::CONFIRM_ARMED) home.note_activity(now); else home.leave_home(now);
    } else if (ev == AHoldEvent::HOME) {
      if (buttons.phase() == ButtonPhase::CONFIRM_ARMED) buttons.on_short_press();
      home.go_home(now);
    }
  }
  // Press A for `ms`; with release=false it is left held (the cue shows in the next state()).
  void press_a(uint32_t ms, bool release = true) {
    on_a_event(ahold.update(true, now, range_allowed()));
    for (uint32_t t = 0; t < ms; t += 50) {
      now += 50;
      on_a_event(ahold.update(true, now, range_allowed()));
    }
    if (release) on_a_event(ahold.update(false, now, range_allowed()));
  }
  void range_step(bool a_click) {
    int step = RangeEditor::step_for(range.field(), a_click);
    if (range.field() == RangeField::RADIUS) link.edit_threshold(step, now);
    else link.edit_tx_power(step, now);
    range.touch(now);
  }
  void b_click() {
    if (range.active()) { range_step(false); home.note_activity(now); }
  }
  void a_click() {
    if (link.state() == LinkState::NOT_CONFIGURED) {
      if (home.at_home()) home.leave_home(now); else home.go_home(now);
      return;
    }
    press_a(100);
  }
  void b_hold() {
    if (range.active()) {  // saves (every step already applied) and exits
      range.close();
      home.note_activity(now);
      return;
    }
    if (link.state() == LinkState::NOT_CONFIGURED) {
      point.mode = point.mode == Mode::HILL ? Mode::BRIDGE : Mode::HILL;  // setMode
      point.reset();
      return;
    }
    bool locked = link.lock().locked(now);
    if (locked && buttons.phase() == ButtonPhase::CONFIRM_ARMED) buttons.on_short_press();
    if (locked) {
      ro_active = true; ro_locked = true; ro_ok = false; ro_at = now;
      home.note_activity(now);
      return;
    }
    if (!link.assignment().present) {  // no station assigned: nothing to reset
      home.note_activity(now);
      return;
    }
    if (buttons.on_long_press(now)) {
      bool sent_ok = !maybe_build_reset_action(link, 0).empty() && socket_up;  // mcSendResetAction
      ro_active = true; ro_locked = false; ro_ok = sent_ok; ro_at = now;
    } else {
      confirm_armed_at = now;
    }
    home.note_activity(now);
  }
  void hold_a_and_b(uint32_t ms) {
    force.update(true, true, now);
    for (uint32_t t = 0; t < ms; t += 50) { now += 50; force.update(true, true, now); }
  }

  StickState state() {
    StickInputs in;
    in.now_ms = now;
    in.link = &link;
    in.point = &point;
    in.advertising = advertising();
    in.revive_flash_until_ms = revive_flash_until;
    in.last_word_at_ms = last_word_at;
    in.last_word = last_word;
    in.word_count = words;
    in.sent_word_count = sent;
    in.selftest_result = selftest;
    in.tx_pin = 46;
    in.button_phase = buttons.phase();
    in.confirm_armed_at_ms = confirm_armed_at;
    in.reset_outcome_active = ro_active;
    in.reset_outcome_ok = ro_ok;
    in.reset_outcome_locked = ro_locked;
    in.force_restart_countdown_s = force.countdown_s();
    in.at_home = home.at_home();
    in.range_active = range.active();
    in.range_edit_strength = range.field() == RangeField::STRENGTH;
    in.range_cue_pct = ahold.range_cue_pct();
    StickState st = build_stick_state(in, held);
    if (battery_override >= 0) st.battery_pct = battery_override;
    return st;
  }
};

// ---- canned MC traffic ------------------------------------------------------------------------------
static void linked(SimStick& s, bool held_mode = false) {
  if (held_mode) s.link.set_mode(AssocMode::HELD);
  s.wifi_set();
  s.wifi_up();
  s.connect_mc();
  s.frame("welcome", R"({"session_id":"s-1","node_key":"k-1"})");
}
static std::string cfg(const std::string& kind, int team, int id, const std::string& extra = "") {
  return "{\"kind\":\"" + kind + "\",\"team\":" + std::to_string(team) + ",\"id\":" + std::to_string(id) +
         ",\"game\":7" + extra + "}";
}
static const char* ROCKETS = R"(,"item":{"kind":"weapon","weapon_id":"rockets","spawn_every_s":90,"first_at_s":0,"name":"Rockets","color":"#ff7a1a"})";
static const char* SHIELD = R"(,"item":{"kind":"overshield","amount":50,"spawn_every_s":60,"first_at_s":0,"name":"Overshield","color":""})";
static const char* LONGNAME = R"(,"item":{"kind":"weapon","weapon_id":"plasma","spawn_every_s":45,"first_at_s":0,"name":"Plasma Rifle","color":"#b35cff"})";

static Word shot(int team, int dmg) { Word w; w.proto = PROTO_SHOT; w.player = 5; w.team = team; w.mag = dmg; return w; }
static Word beacon(int team) { Word w; w.proto = PROTO_BEACON; w.team = team; w.mag = BEACON_HILL; return w; }

struct Scenario {
  const char* name;
  const char* group;
  const char* story;
  std::function<void(SimStick&)> run;
};

static std::vector<Scenario> scenarios() {
  std::vector<Scenario> v;
  // ---------------- bench (no Wi-Fi set) ----------------
  v.push_back({"bench_hill", "bench", "No Wi-Fi set, bench mode HILL (boot default after HOLD B once).", [](SimStick& s) {
    s.b_hold();  // BRIDGE -> HILL
  }});
  v.push_back({"bench_bridge", "bench", "No Wi-Fi set, bench mode BRIDGE (the boot default).", [](SimStick&) {}});
  v.push_back({"bench_hill_shot", "bench", "Bench HILL, a red shot just heard (IR dot lit).", [](SimStick& s) {
    s.b_hold();
    s.ir_word(shot(0, 20));
  }});
  v.push_back({"bench_bridge_beacon", "bench", "Bench BRIDGE repeating a live blue grenade beacon.", [](SimStick& s) {
    s.ir_word(beacon(1));
    s.advance(400);
  }});
  v.push_back({"bench_diagnostics", "bench", "Bench mode, A pressed: the DIAGNOSTICS page.", [](SimStick& s) {
    s.ir_word(shot(1, 12));
    s.selftest = "PASS";
    s.a_click();
    s.advance(1000);
  }});
  // ---------------- joining / linked ----------------
  v.push_back({"wifi_joining", "link", "Wi-Fi credentials set, still associating.", [](SimStick& s) {
    s.wifi_set();
  }});
  v.push_back({"looking_for_mc", "link", "Wi-Fi up, browsing mDNS for Mission Control.", [](SimStick& s) {
    s.wifi_set(); s.wifi_up(); s.advance(600);
  }});
  v.push_back({"hello_sent", "link", "Socket open, hello sent, waiting for the welcome.", [](SimStick& s) {
    s.wifi_set(); s.wifi_up(); s.connect_mc(); s.advance(1100);
  }});
  v.push_back({"welcomed_unassigned", "link", "Welcomed by MC, no station assigned yet.", [](SimStick& s) {
    linked(s);
  }});
  v.push_back({"welcomed_stats", "link", "Welcomed and unassigned, A pressed: the STATS page.", [](SimStick& s) {
    linked(s); s.a_click();
  }});
  v.push_back({"released", "link", "Armed as a hill, then MC sent release_utility.", [](SimStick& s) {
    linked(s, true);
    s.frame("station_config", cfg("control", 255, 3));
    s.frame("control", R"({"cmd":"release_utility"})");
  }});
  v.push_back({"assigned_extraction", "link", "Armed as a kind this firmware shows but does not run.", [](SimStick& s) {
    linked(s, true);
    s.frame("station_config", cfg("extraction", 1, 5));
  }});
  // ---------------- respawn ----------------
  v.push_back({"respawn_any", "respawn", "Armed as a respawn for any team (team 255).", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("respawn", 255, 1));
  }});
  v.push_back({"respawn_yellow", "respawn", "Armed as team 2's (YELLOW) respawn.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("respawn", 2, 2));
  }});
  v.push_back({"respawn_red", "respawn", "Armed as team 0's (RED) respawn.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("respawn", 0, 1));
  }});
  v.push_back({"respawn_red_player_revived", "respawn", "Red respawn: a down player walks in and comes up alive "
               "(revive feedback is post-MVP: no count, no REDEPLOY flash).", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("respawn", 0, 1));
    s.arrive(7, 0, false);
    s.advance(1500);
    s.set_alive(7, true);
    s.advance(300);
  }});
  v.push_back({"respawn_advert_down", "respawn", "Armed respawn whose BLE advert failed to start.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("respawn", 1, 1));
    s.advert_fails = true;
  }});
  // ---------------- pickup ----------------
  v.push_back({"pickup_ready", "pickup", "Armed pickup, ROCKETS available.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("powerup", 255, 4, ROCKETS));
  }});
  v.push_back({"pickup_ready_shield", "pickup", "Armed pickup, OVERSHIELD (no colour from MC).", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("powerup", 255, 6, SHIELD));
  }});
  v.push_back({"pickup_ready_long_name", "pickup", "A 12-character item name (MC's limit).", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("powerup", 255, 8, LONGNAME));
  }});
  v.push_back({"pickup_taken", "pickup", "Player 7 just claimed the ROCKETS.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("powerup", 255, 4, ROCKETS));
    ClaimWinner w; w.won = true; w.player_num = 7;
    s.link.award_claim(w, s.now);
    s.advance(200);
  }});
  v.push_back({"pickup_countdown", "pickup", "One minute after the claim: 0:30 to the next spawn.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("powerup", 255, 4, ROCKETS));
    ClaimWinner w; w.won = true; w.player_num = 7;
    s.link.award_claim(w, s.now);
    s.advance(60000);
  }});
  v.push_back({"pickup_respawned", "pickup", "The spawn time passed: available again.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("powerup", 255, 4, ROCKETS));
    ClaimWinner w; w.won = true; w.player_num = 7;
    s.link.award_claim(w, s.now);
    s.advance(91000);
  }});
  v.push_back({"pickup_stats_long_name", "pickup", "A 12-character item on the STATS page.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("powerup", 255, 8, LONGNAME));
    s.a_click();
  }});
  v.push_back({"pickup_stats", "pickup", "Pickup taken, A pressed: the STATS page.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("powerup", 255, 4, ROCKETS));
    ClaimWinner w; w.won = true; w.player_num = 7;
    s.link.award_claim(w, s.now);
    s.advance(5000);
    s.a_click();
  }});
  // ---------------- hill (MC-armed Bluetooth hill) ----------------
  v.push_back({"hill_neutral", "hill", "Armed hill, nobody on it.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
  }});
  v.push_back({"hill_capturing_blue", "hill", "One blue player on the point for 5 s.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.arrive(11, 1); s.advance(5000);
  }});
  v.push_back({"hill_stalled_blue", "hill", "Blue built part of the bar and walked off.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.arrive(11, 1); s.advance(5000);
    s.leave(11); s.advance(9000);
  }});
  v.push_back({"hill_held_red", "hill", "Red captured it 15 s ago.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.arrive(3, 0); s.advance(26000);
  }});
  v.push_back({"hill_held_blue", "hill", "Blue captured it 15 s ago.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.arrive(11, 1); s.advance(26000);
  }});
  v.push_back({"hill_held_green", "hill", "Green (tid 3) captured it 15 s ago.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.arrive(21, 3); s.advance(26000);
  }});
  v.push_back({"hill_yellow_refused", "hill", "A yellow (tid 2) player on the point: F82, never claims.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.arrive(15, 2); s.advance(12000);
  }});
  v.push_back({"hill_contested", "hill", "Blue holds; a red player joins the blue one.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.arrive(11, 1); s.advance(12000);
    s.arrive(3, 0); s.advance(2000);
  }});
  v.push_back({"hill_losing_blue", "hill", "Blue holds; blue leaves and red drains the bar.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.arrive(11, 1); s.advance(12000);
    s.leave(11); s.advance(9000);
    s.arrive(3, 0); s.advance(3000);
  }});
  v.push_back({"hill_locked", "hill", "Red holds, MC locked the operator controls for 10 min.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3, ",\"lock_s\":600"));
    s.arrive(3, 0); s.advance(14000);
  }});
  v.push_back({"hill_restored", "hill", "Restarted mid-match: red's saved hold restored, MC not yet back.", [](SimStick& s) {
    s.wifi_set();
    StationAssignment a = parse_station_config(json::parse(cfg("control", 255, 3)));
    s.link.restore_station_config(a);
    s.link.hill().restore_held(0);
    s.advance(500);
  }});
  // ---------------- operator: reset, lock, restart, battery ----------------
  v.push_back({"reset_confirm", "operator", "Pickup #4, B held once: the confirm prompt, 1 s in.", [](SimStick& s) {
    linked(s, true); s.frame("station_config", cfg("powerup", 255, 4, ROCKETS));
    s.b_hold(); s.advance(1000);
  }});
  v.push_back({"reset_confirm_unassigned", "operator", "Welcomed but unassigned, B held once: nothing to reset, no prompt.", [](SimStick& s) {
    linked(s); s.b_hold(); s.advance(500);
  }});
  v.push_back({"reset_sent", "operator", "Held-mode pickup, B held twice with MC connected.", [](SimStick& s) {
    linked(s, true); s.frame("station_config", cfg("powerup", 255, 4, ROCKETS));
    s.b_hold(); s.advance(1000); s.b_hold(); s.advance(200);
  }});
  v.push_back({"reset_needs_mc", "operator", "Muster pickup (Wi-Fi dropped for the match), B held twice.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("powerup", 255, 4, ROCKETS));
    s.b_hold(); s.advance(1000); s.b_hold(); s.advance(200);
  }});
  v.push_back({"reset_refused_locked", "operator", "Locked hill, B held: refused.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3, ",\"lock_s\":600"));
    s.advance(1000); s.b_hold(); s.advance(200);
  }});
  v.push_back({"force_restart", "operator", "A and B held together for 3 s.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.hold_a_and_b(3000);
  }});
  v.push_back({"low_battery", "operator", "Pickup at 9 % battery (injected: no battery reading is wired up yet).", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("powerup", 255, 4, ROCKETS));
    s.battery_override = 9;
  }});
  v.push_back({"battery_ok_strip", "operator", "Pickup #4 at 76 % (injected), locked: a full status strip.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("powerup", 255, 4, std::string(ROCKETS) + ",\"lock_s\":300"));
    s.battery_override = 76;
  }});
  v.push_back({"hill_stats", "operator", "Armed hill, A pressed: the STATS page.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.a_click();
  }});
  // ---------------- F365: the RANGE editor ----------------
  v.push_back({"stats_range_cue", "range", "Hill #3 STATS page, A held 3 s: the HOLD FOR RANGE cue.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.a_click(); s.press_a(3000, false);
  }});
  v.push_back({"range_radius_default", "range", "A held 5 s on STATS: RANGE, radius at MC's default -57.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.a_click(); s.press_a(5200);
  }});
  v.push_back({"range_radius_closer", "range", "In RANGE, A clicked once: closer, -54 (edited).", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.a_click(); s.press_a(5200); s.press_a(100);
  }});
  v.push_back({"range_radius_farther", "range", "In RANGE, B clicked three times: farther, -66.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("respawn", 1, 2));
    s.a_click(); s.press_a(5200); s.b_click(); s.b_click(); s.b_click();
  }});
  v.push_back({"range_strength", "range", "In RANGE, A held 1.5 s (switch to STRENGTH), then A: weaker, MEDIUM.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.a_click(); s.press_a(5200); s.press_a(1500); s.press_a(100);
  }});
  v.push_back({"range_strength_ultra_low", "range", "STRENGTH stepped down to ULTRA LOW.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("powerup", 255, 4, ROCKETS));
    s.a_click(); s.press_a(5200); s.press_a(1500); s.press_a(100); s.press_a(100); s.press_a(100);
  }});
  v.push_back({"range_locked", "range", "Hill under the A58 match lock: RANGE still opens and edits (padlock shown).", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3, ",\"lock_s\":600"));
    s.a_click(); s.press_a(5200); s.b_click();
  }});
  v.push_back({"range_mc_value", "range", "MC set -66 and TX low; RANGE shows MC's values.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3, ",\"threshold\":-66,\"tx_power\":\"low\""));
    s.a_click(); s.press_a(5200);
  }});
  v.push_back({"range_released", "range", "In RANGE, MC sent release_utility: RANGE closes, LINKED.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.a_click(); s.press_a(5200);
    s.frame("control", R"({"cmd":"release_utility"})");
    s.advance(100);
  }});
  v.push_back({"range_refused_during_confirm", "range", "STATS, B held (RESET confirm open), then A held 5 s: no RANGE; the "
               "release cancels the confirm and goes home.", [](SimStick& s) {
    linked(s, true); s.frame("station_config", cfg("control", 255, 3));
    s.a_click(); s.b_hold(); s.press_a(5200);
  }});
  v.push_back({"range_idle_exit", "range", "RANGE left alone for 10 s: saved, back on STATS.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.a_click(); s.press_a(5200); s.press_a(100); s.advance(10500);
  }});
  v.push_back({"stats_idle_home", "operator", "The STATS page left alone for 20 s returns home.", [](SimStick& s) {
    linked(s); s.frame("station_config", cfg("control", 255, 3));
    s.a_click(); s.advance(20500);
  }});
  return v;
}

int main(int argc, char** argv) {
  std::string out_dir = argc > 1 ? argv[1] : "";
  for (const Scenario& sc : scenarios()) {
    SimStick s;
    sc.run(s);
    StickState st = s.state();
    ScreenSpec spec = compute_screen(st);
    std::string line = "{\"revive_feedback\":" + std::string(REVIVE_FEEDBACK_ENABLED ? "true" : "false") +
                       ",\"name\":" + jstr(sc.name) + ",\"group\":" + jstr(sc.group) + ",\"story\":" + jstr(sc.story) +
                       ",\"link_state\":" + jstr(link_state_label(st.link_state)) + ",\"spec\":" + spec_json(spec);
#ifdef BRX_SIM_RENDER
    M5Canvas canvas;
    canvas.setColorDepth(16);
    canvas.createSprite(brx_render::SCREEN_W, brx_render::SCREEN_H);
    brx_render::renderScreen(canvas, spec);
    line += ",\"texts\":[";
    for (size_t i = 0; i < canvas.texts.size(); i++) {
      const SimTextRecord& t = canvas.texts[i];
      if (i) line += ",";
      line += "{\"text\":" + jstr(t.text) + ",\"font\":" + jstr(t.font) + ",\"ax\":" + std::to_string(t.anchor_x) +
              ",\"ay\":" + std::to_string(t.anchor_y) + ",\"inked\":" + (t.inked ? "true" : "false") +
              ",\"box\":[" + std::to_string(t.x0) + "," + std::to_string(t.y0) + "," + std::to_string(t.x1) + "," +
              std::to_string(t.y1) + "]}";
    }
    line += "],\"logical\":[";
    for (size_t i = 0; i < canvas.logical.size(); i++) line += (i ? "," : "") + jstr(canvas.logical[i]);
    line += "],\"cuts\":[";
    for (size_t i = 0; i < canvas.cuts.size(); i++) line += (i ? "," : "") + jstr(canvas.cuts[i]);
    line += "]";
    // FNV-1a over the raw pixels: two scenarios that look identical have the same hash.
    const uint8_t* px = (const uint8_t*)canvas.getBuffer();
    size_t n = (size_t)brx_render::SCREEN_W * brx_render::SCREEN_H * 2;
    uint64_t h = 1469598103934665603ULL;
    for (size_t i = 0; i < n; i++) { h ^= px[i]; h *= 1099511628211ULL; }
    char hb[24];
    std::snprintf(hb, sizeof hb, "%016llx", (unsigned long long)h);
    line += ",\"pixels\":" + jstr(hb);
    if (!out_dir.empty()) {
      size_t len = 0;
      void* png = canvas.createPng(&len, 0, 0, brx_render::SCREEN_W, brx_render::SCREEN_H);
      std::string path = out_dir + "/" + sc.name + ".png";
      FILE* f = png ? std::fopen(path.c_str(), "wb") : nullptr;
      if (!f) { std::fprintf(stderr, "cannot write %s\n", path.c_str()); return 3; }
      std::fwrite(png, 1, len, f);
      std::fclose(f);
      free(png);
      line += ",\"png\":" + jstr(std::string(sc.name) + ".png");
    }
#endif
    std::printf("%s}\n", line.c_str());
  }
  return 0;
}
