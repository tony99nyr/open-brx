// ARCH-4: what each MC message writes to or erases from the Stick's saved state, and in what order
// (station_controller.h). Every expected trace below was read off mc_link_glue.h's mcHandleFrame and
// mcClearSavedLock / mcSaveLockIfDue as they stood before the move (85373b0b), so these tests pin the
// behaviour the Stick had, not a new one. FakeStation writes the same "brxmc" keys the glue's mc*
// functions write, into a FakePrefs, and records every call in order.
// Build + run: g++ -std=c++17 -I.. test_controller.cpp -o /tmp/tctl && /tmp/tctl
#include <cstdio>
#include <string>
#include <vector>

#include "json_lite.h"
#include "station_controller.h"
#include "station_link.h"
#include "station_persistence.h"
#include "fake_prefs.h"

static int failures = 0;
#define CHECK(c)                                                  \
  do {                                                            \
    if (!(c)) {                                                   \
      std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c);    \
      failures++;                                                 \
    }                                                             \
  } while (0)

using namespace brx;
using Trace = std::vector<std::string>;

// The host adapter: the glue's mc* functions, with FakePrefs in place of Preferences.
struct FakeStation final : StationEffects {
  FakePrefs p;
  NvsFailures nvs;
  Trace trace;
  bool feeding = false;  // what the claim scan was doing when paused

  void write_config(const std::string& body, const std::string& sid) override {
    trace.push_back("write_config");
    nvs_put_str(p, nvs, "station_cfg", body.c_str());
    nvs_put_str(p, nvs, "station_sid", sid.c_str());
  }
  void erase_config() override {
    trace.push_back("erase_config");
    p.remove("station_cfg");
    p.remove("station_sid");
  }
  void erase_hill() override {
    trace.push_back("erase_hill");
    for (const char* k : {"hill_v1", "hill_owner", "hill_game", "hill_id", "hill_sid", "hill_hold"}) p.remove(k);
  }
  void erase_clock() override {
    trace.push_back("erase_clock");
    for (const char* k : {"hclk_game", "hclk_id", "hclk_sid", "hclk_rem"}) p.remove(k);
  }
  bool write_lock(uint32_t seconds, uint8_t game) override {
    trace.push_back("write_lock " + std::to_string(seconds) + " " + std::to_string(game));
    return nvs_put_u32(p, nvs, "lock_s", seconds) && nvs_put_u8(p, nvs, "lock_game", game);
  }
  bool clear_lock() override {
    trace.push_back("clear_lock");
    return (!p.isKey("lock_s") || p.remove("lock_s")) && (!p.isKey("lock_game") || p.remove("lock_game"));
  }
  void save_node_key(const std::string& key) override {
    trace.push_back("save_node_key " + key);
    nvs_put_str(p, nvs, "node_key", key.c_str());
  }
  void save_range_if_changed() override { trace.push_back("save_range"); }
  bool pause_claim_feed(bool discard) override {
    trace.push_back(discard ? "pause discard" : "pause keep");
    const bool was = feeding;
    feeding = false;
    return was;
  }
  void resume_claim_feed(bool was) override {
    trace.push_back(was ? "resume on" : "resume off");
    if (was) feeding = true;
  }
  void muster_drop() override { trace.push_back("muster_drop"); }
  void dial_succeeded() override { trace.push_back("dial_succeeded"); }
  void wake_screen() override { trace.push_back("wake"); }
  void log(const std::string& text) override { trace.push_back("log " + text); }

  Trace take() {
    Trace t = trace;
    trace.clear();
    return t;
  }
  bool has_config() { return p.isKey("station_cfg") || p.isKey("station_sid"); }
  bool has_lock() { return p.isKey("lock_s") || p.isKey("lock_game"); }
  bool has_hill() { return p.isKey("hill_v1") || p.isKey("hill_owner") || p.isKey("hill_hold"); }
  bool has_clock() { return p.isKey("hclk_rem") || p.isKey("hclk_sid"); }
};

static bool same(const Trace& got, const Trace& want) {
  if (got == want) return true;
  std::printf("  trace was:\n");
  for (const auto& s : got) std::printf("    %s\n", s.c_str());
  std::printf("  wanted:\n");
  for (const auto& s : want) std::printf("    %s\n", s.c_str());
  return false;
}

static json::Value body(const std::string& text) {
  bool ok = false;
  json::Value v = json::parse(text, &ok);
  CHECK(ok);
  return v;
}

static std::string control_body(int game, int lock_s) {
  return R"({"kind":"control","team":255,"id":9,"game":)" + std::to_string(game) + R"(,"lock_s":)" +
         std::to_string(lock_s) + "}";
}

static std::string armed_line(const char* kind, int team, int id, int game, int lock_s) {
  return std::string("log MC-ARMED kind=") + kind + " team=" + std::to_string(team) + " id=" + std::to_string(id) +
         " game=" + std::to_string(game) + " threshold=" + std::to_string(stick_default_threshold_dbm(kind)) +
         " lock_s=" + std::to_string(lock_s) + "\n";
}

static const uint32_t HOLD[4] = {0, 4000, 0, 0};

// Seed flash and the mirrors with a control station saved in `sid`, held by team 1, with a running clock
// and a lock snapshot, as a Stick that rebooted mid-match would have them.
static void seed_saved_match(StationController& c, FakeStation& fx, StationLink& link, const std::string& sid) {
  StationAssignment a = parse_station_config(body(control_body(3, 600)));
  CHECK(c.config.note_applied(a, sid));
  fx.p.putString("station_cfg", c.config.stored().c_str());
  fx.p.putString("station_sid", sid.c_str());
  c.hill.loaded(true, 1, 3, 9, sid, HOLD);
  CHECK(save_hill(fx.p, fx.nvs, 1, 3, 9, HOLD, sid));
  c.clock.loaded(true, 3, 9, sid, 60000);
  fx.p.putUChar("hclk_game", 3);
  fx.p.putUShort("hclk_id", 9);
  fx.p.putString("hclk_sid", sid.c_str());
  fx.p.putInt("hclk_rem", 60000);
  fx.p.putUInt("lock_s", 120);
  fx.p.putUChar("lock_game", 3);
  c.lock_restored(120, 3);
  if (link.restore_station_config(c.config.restore())) link.restore_lock(120, 0);
}

static void welcome(StationController& c, StationLink& link, FakeStation& fx, const std::string& sid) {
  c.on_message(link, "welcome", body(R"({"session_id":")" + sid + R"("})"), 0, fx);
}

// A WELCOME from a new MC session: the restored station is an old match's. Everything saved goes, the
// claim feed pauses first, and the link drops to UNASSIGNED.
static void test_a_welcome_from_a_new_session_erases_the_old_match() {
  StationController c;
  FakeStation fx;
  StationLink link;
  link.set_mode(AssocMode::HELD);
  seed_saved_match(c, fx, link, "old");
  CHECK(link.restored() && link.assignment().present);
  c.on_message(link, "welcome", body(R"({"session_id":"new","node_key":"wk-2"})"), 0, fx);
  CHECK(same(fx.take(), {"dial_succeeded", "wake", "save_node_key wk-2", "log WELCOME session=new\n", "pause discard",
                         "erase_config", "clear_lock", "log STALE restored config (new MC session): UNASSIGNED\r\n",
                         "erase_hill", "erase_clock"}));
  CHECK(!fx.has_config() && !fx.has_lock() && !fx.has_hill() && !fx.has_clock());
  CHECK(fx.p.getString("node_key", "") == "wk-2");
  CHECK(!link.assignment().present && !link.restored());
  CHECK(!c.config.has() && !c.hill.has() && !c.clock.has());
  CHECK(c.lock.last_saved_seconds == 0 && c.lock.last_saved_game == 255 && !c.lock.clear_pending);
}

// The same session answering again (MC still running the match): nothing saved is touched.
static void test_a_welcome_from_the_same_session_keeps_everything() {
  StationController c;
  FakeStation fx;
  StationLink link;
  link.set_mode(AssocMode::HELD);
  seed_saved_match(c, fx, link, "s1");
  welcome(c, link, fx, "s1");
  CHECK(same(fx.take(), {"dial_succeeded", "wake", "log WELCOME session=s1\n"}));
  CHECK(fx.has_config() && fx.has_lock() && fx.has_hill() && fx.has_clock());
  CHECK(link.restored() && link.assignment().present);
}

// FLAGGED, pinned as it stands (ARCH-4 report): a welcome from a new session while a config MC sent THIS
// boot is live erases the saved config and the lock snapshot, but the station stays armed and locked in
// RAM. A reboot before MC re-arms comes back unassigned.
static void test_a_new_session_welcome_erases_a_live_config_from_flash_only() {
  StationController c;
  FakeStation fx;
  StationLink link;
  link.set_mode(AssocMode::HELD);
  welcome(c, link, fx, "s1");
  c.on_message(link, "station_config", body(control_body(3, 600)), 1000, fx);
  fx.take();
  welcome(c, link, fx, "s2");
  CHECK(same(fx.take(), {"dial_succeeded", "wake", "log WELCOME session=s2\n", "erase_config", "clear_lock"}));
  CHECK(!fx.has_config() && !fx.has_lock());
  CHECK(link.assignment().present && link.lock().locked(2000));
}

// A welcome with no session id is not ok: it says nothing about staleness, so it erases nothing.
static void test_a_welcome_without_a_session_erases_nothing() {
  StationController c;
  FakeStation fx;
  StationLink link;
  seed_saved_match(c, fx, link, "s1");
  c.on_message(link, "welcome", body("{}"), 0, fx);
  CHECK(same(fx.take(), {"wake", "log WELCOME session=\n"}));
  CHECK(fx.has_config() && fx.has_lock() && fx.has_hill() && fx.has_clock());
}

// station_config with a new lock writes the snapshot and the config; a same re-push (MC's mid-match
// lock carrier) writes neither; a re-arm with a new game writes both again; lock_s 0 clears the snapshot.
static void test_a_config_with_a_new_lock_then_a_rearm() {
  StationController c;
  FakeStation fx;
  StationLink link;
  link.set_mode(AssocMode::HELD);
  welcome(c, link, fx, "s1");
  fx.take();
  c.on_message(link, "station_config", body(control_body(3, 600)), 1000, fx);
  CHECK(same(fx.take(), {"pause discard", "write_lock 600 3", "save_range", "write_config", "wake",
                         armed_line("control", 255, 9, 3, 600)}));
  CHECK(fx.p.num["lock_s"] == 600 && fx.p.num["lock_game"] == 3);
  CHECK(fx.p.str["station_cfg"] == c.config.stored() && fx.p.str["station_sid"] == "s1");
  CHECK(c.lock.last_saved_ms == 1000 && c.lock.last_saved_seconds == 600 && c.lock.last_saved_game == 3);

  // The same config again: the lock restarts in RAM, flash is left alone.
  c.on_message(link, "station_config", body(control_body(3, 600)), 5000, fx);
  CHECK(same(fx.take(), {"pause discard", "save_range", "wake", armed_line("control", 255, 9, 3, 600)}));
  CHECK(c.lock.last_saved_ms == 5000);
  CHECK(link.lock().remaining_s(5000) == 600);

  // A re-arm for the next game, with a longer lock.
  c.on_message(link, "station_config", body(control_body(4, 900)), 9000, fx);
  CHECK(same(fx.take(), {"pause discard", "write_lock 900 4", "save_range", "write_config", "wake",
                         armed_line("control", 255, 9, 4, 900)}));
  CHECK(fx.p.num["lock_s"] == 900 && fx.p.num["lock_game"] == 4);

  // The same lock length under a new game still writes: the snapshot is game-bound.
  c.on_message(link, "station_config", body(control_body(5, 900)), 9500, fx);
  CHECK(same(fx.take(), {"pause discard", "write_lock 900 5", "save_range", "write_config", "wake",
                         armed_line("control", 255, 9, 5, 900)}));

  // lock_s 0: the snapshot is cleared; the config body (which excludes lock_s) is unchanged, so no write.
  c.on_message(link, "station_config", body(control_body(5, 0)), 10000, fx);
  CHECK(same(fx.take(), {"pause discard", "clear_lock", "save_range", "wake", armed_line("control", 255, 9, 5, 0)}));
  CHECK(!fx.has_lock() && c.lock.last_saved_game == 255 && c.lock.last_saved_seconds == 0);
}

// A lock write that fails stays owed; the next loop writes the time left, regardless of the interval.
static void test_a_failed_lock_write_is_retried_by_the_loop() {
  StationController c;
  FakeStation fx;
  StationLink link;
  link.set_mode(AssocMode::HELD);
  welcome(c, link, fx, "s1");
  fx.p.bad.insert("lock_s");
  c.on_message(link, "station_config", body(control_body(3, 600)), 1000, fx);
  CHECK(c.lock.save_pending && c.lock.last_saved_seconds == 0 && c.lock.last_saved_game == 255);
  CHECK(!fx.has_lock());
  fx.p.bad.clear();
  fx.take();
  c.tick_lock(link, 2000, fx);
  CHECK(same(fx.take(), {"write_lock 599 3"}));
  CHECK(!c.lock.save_pending && c.lock.last_saved_ms == 2000 && c.lock.last_saved_seconds == 599);
  c.tick_lock(link, 3000, fx);  // not due again for five minutes
  CHECK(fx.take().empty());
}

// A clear that fails stays owed: the loop retries it, and a config arriving first rewrites the snapshot
// even when its seconds and game match what was last saved.
static void test_a_failed_lock_clear_is_retried_and_forces_the_next_write() {
  StationController c;
  FakeStation fx;
  StationLink link;
  link.set_mode(AssocMode::HELD);
  welcome(c, link, fx, "s1");
  c.on_message(link, "station_config", body(control_body(3, 600)), 1000, fx);
  fx.p.bad_remove.insert("lock_s");
  c.on_message(link, "station_config", body(control_body(3, 0)), 2000, fx);
  CHECK(c.lock.clear_pending && fx.has_lock());
  fx.p.bad_remove.clear();
  fx.take();
  c.on_message(link, "station_config", body(control_body(3, 600)), 3000, fx);
  CHECK(same(fx.take(), {"pause discard", "write_lock 600 3", "save_range", "wake",
                         armed_line("control", 255, 9, 3, 600)}));
  CHECK(!c.lock.clear_pending);

  // And without a config: the next loop retries the clear itself.
  fx.p.bad_remove.insert("lock_s");
  CHECK(!c.clear_lock(fx));
  fx.p.bad_remove.clear();
  fx.take();
  c.tick_lock(link, 4000, fx);
  CHECK(same(fx.take(), {"clear_lock"}));
  CHECK(!c.lock.clear_pending && !fx.has_lock());
}

// control{release_utility}: config, lock, hill and clock all go, in that order, after the claim feed pauses.
static void test_a_release_clears_all_four() {
  StationController c;
  FakeStation fx;
  StationLink link;
  link.set_mode(AssocMode::HELD);
  welcome(c, link, fx, "s1");
  c.on_message(link, "station_config", body(control_body(3, 600)), 1000, fx);
  c.hill.loaded(true, 1, 3, 9, "s1", HOLD);
  CHECK(save_hill(fx.p, fx.nvs, 1, 3, 9, HOLD, "s1"));
  c.clock.loaded(true, 3, 9, "s1", 60000);
  fx.p.putInt("hclk_rem", 60000);
  fx.p.putString("hclk_sid", "s1");
  fx.take();
  c.on_message(link, "control", body(R"({"cmd":"release_utility"})"), 2000, fx);
  CHECK(same(fx.take(), {"pause discard", "clear_lock", "save_range", "erase_config", "erase_hill", "erase_clock", "wake",
                         "log RELEASED (control.release_utility): back to UNASSIGNED\r\n"}));
  CHECK(!fx.has_config() && !fx.has_lock() && !fx.has_hill() && !fx.has_clock());
  CHECK(!link.assignment().present && !link.lock().locked(2000));

  // Another control command is not a release: nothing happens.
  c.on_message(link, "control", body(R"({"cmd":"something_else"})"), 2100, fx);
  CHECK(fx.take().empty());

  // A second release with nothing saved still asks NVS to clear the lock (clear_lock never checks first).
  c.on_message(link, "control", body(R"({"cmd":"release_utility"})"), 2200, fx);
  CHECK(same(fx.take(), {"pause discard", "clear_lock", "save_range", "wake",
                         "log RELEASED (control.release_utility): back to UNASSIGNED\r\n"}));
}

// A release then a welcome (same or new session): nothing is left to erase, and a reboot restores nothing.
static void test_a_release_then_a_welcome() {
  StationController c;
  FakeStation fx;
  StationLink link;
  link.set_mode(AssocMode::HELD);
  welcome(c, link, fx, "s1");
  c.on_message(link, "station_config", body(control_body(3, 600)), 1000, fx);
  c.on_message(link, "control", body(R"({"cmd":"release_utility"})"), 2000, fx);
  fx.take();
  welcome(c, link, fx, "s1");
  CHECK(same(fx.take(), {"dial_succeeded", "wake", "log WELCOME session=s1\n"}));
  welcome(c, link, fx, "s2");
  CHECK(same(fx.take(), {"dial_succeeded", "wake", "log WELCOME session=s2\n"}));
  // The reboot: what mcRestoreSavedConfig would read finds no station.
  SavedStationConfig rebooted;
  rebooted.loaded(fx.p.getString("station_cfg", ""), fx.p.getString("station_sid", ""));
  CHECK(!rebooted.has() && !fx.has_lock());
}

// A new game erases a hill and a clock saved for the old one, after the config write. A same-game re-push
// with no clock running keeps the hill but erases the clock (a lobby or abort re-send).
static void test_a_config_erases_a_hill_and_clock_from_another_game() {
  StationController c;
  FakeStation fx;
  StationLink link;
  link.set_mode(AssocMode::HELD);
  welcome(c, link, fx, "s1");
  c.on_message(link, "station_config", body(control_body(3, 0)), 1000, fx);
  c.hill.loaded(true, 1, 3, 9, "s1", HOLD);
  c.clock.loaded(true, 3, 9, "s1", 60000);
  fx.take();
  c.on_message(link, "station_config", body(control_body(3, 0)), 2000, fx);
  CHECK(same(fx.take(), {"pause discard", "clear_lock", "save_range", "erase_clock", "wake",
                         armed_line("control", 255, 9, 3, 0)}));
  CHECK(c.hill.has() && !c.clock.has());
  c.clock.loaded(true, 3, 9, "s1", 60000);
  c.on_message(link, "station_config", body(control_body(4, 0)), 3000, fx);
  CHECK(same(fx.take(), {"pause discard", "clear_lock", "save_range", "write_config", "erase_hill", "erase_clock",
                         "wake", armed_line("control", 255, 9, 4, 0)}));
  CHECK(!c.hill.has() && !c.clock.has());
}

// MUSTER: the radio drop is the last thing a config does. A respawn drops at once; a hill with no START
// clock waits for one.
static void test_a_muster_config_drops_last() {
  StationController c;
  FakeStation fx;
  StationLink link;
  link.set_mode(AssocMode::MUSTER);
  welcome(c, link, fx, "s1");
  fx.take();
  c.on_message(link, "station_config", body(R"({"kind":"respawn","team":1,"id":2,"game":3})"), 1000, fx);
  CHECK(same(fx.take(), {"pause discard", "clear_lock", "save_range", "write_config", "wake",
                         armed_line("respawn", 1, 2, 3, 0), "muster_drop"}));
  StationLink hill_link;
  hill_link.set_mode(AssocMode::MUSTER);
  StationController h;
  welcome(h, hill_link, fx, "s1");
  fx.take();
  h.on_message(hill_link, "station_config", body(control_body(3, 0)), 1000, fx);
  CHECK(same(fx.take(), {"pause discard", "clear_lock", "save_range", "write_config", "wake",
                         armed_line("control", 255, 9, 3, 0),
                         "log MUSTER: waiting for START or offline fallback\r\n"}));
}

// A powerup re-armed with the same item keeps its claim batch and resumes the feed; a station_update for
// this station pauses it before applying; one for another id does nothing; a refused config only logs.
static void test_powerup_claim_feed_and_updates() {
  StationController c;
  FakeStation fx;
  StationLink link;
  link.set_mode(AssocMode::HELD);
  welcome(c, link, fx, "s1");
  const std::string pu =
      R"({"kind":"powerup","team":255,"id":5,"game":3,"item":{"kind":"weapon","weapon_id":"rail","spawn_every_s":45}})";
  c.on_message(link, "station_config", body(pu), 1000, fx);
  fx.take();
  fx.feeding = true;
  c.on_message(link, "station_config", body(pu), 2000, fx);
  CHECK(same(fx.take(), {"pause keep", "clear_lock", "resume on", "save_range", "wake",
                         armed_line("powerup", 255, 5, 3, 0)}));
  CHECK(fx.feeding);
  c.on_message(link, "station_update", body(R"({"id":5,"available":true})"), 3000, fx);
  CHECK(same(fx.take(), {"pause discard", "wake", "log STATION_UPDATE id=5 available=1 next_spawn_in_ms=-1\n"}));
  c.on_message(link, "station_update", body(R"({"id":6,"available":true})"), 3100, fx);
  CHECK(fx.take().empty());
  c.on_message(link, "station_config", body(R"({"kind":"powerup","id":256})"), 3200, fx);
  CHECK(same(fx.take(), {"log station_config REFUSED: powerup station id outside 1..POWERUP_STATION_ID_MAX\n"}));
  CHECK(link.assignment().id == 5);
}

// The status heartbeat body: fill_status reads the link the way the glue's heartbeat block did.
static void test_fill_status_matches_the_glue_heartbeat() {
  StationLink link;
  StationIdentity id;
  id.node_id = "stick-1";
  id.app_ver = "h8-0.2+abc";
  link.set_identity(id);
  link.set_mode(AssocMode::HELD);
  StatusFields idle = fill_status(link, 61500, false, 7, 2);
  CHECK(idle.node_id == "stick-1" && idle.app_ver == "h8-0.2+abc");
  CHECK(idle.kind == "respawn" && idle.team == TEAM_ANY && idle.station_id == 0);
  CHECK(idle.threshold == stick_default_threshold_dbm("respawn") && idle.threshold_src.empty());
  CHECK(!idle.live && !idle.armed && idle.has_health && idle.uptime_s == 61 && idle.boot_count == 7);
  CHECK(idle.nvs_fail == 2 && idle.assoc == "held" && idle.lock_s == 0 && idle.actions_dropped_game == -1);
  CHECK(!idle.has_control && !idle.has_revives);
  CHECK(idle.range_edits_json == link.range_edits().status_json(61500));

  link.apply_welcome({true, "s1", ""});
  link.apply_station_config(parse_station_config(body(control_body(3, 600))), 1000);
  link.hill().owner = 1;
  link.hill().progress = 49.5;
  link.hill().hold_ms[1] = 4000;
  StatusFields armed = fill_status(link, 2000, true, 7, 0);
  StatusFields want;
  want.node_id = "stick-1";
  want.app_ver = "h8-0.2+abc";
  want.kind = "control";
  want.team = 255;
  want.station_id = 9;
  fill_range_status(link, want, 2000);
  want.live = true;
  want.armed = true;
  want.has_health = true;
  want.uptime_s = 2;
  want.boot_count = 7;
  want.assoc = "held";
  want.lock_s = 599;
  want.actions_dropped_game = 3;
  want.has_control = true;
  want.control_owner = 1;
  want.control_progress = 50;  // utility.js rounds half up
  want.control_has_hold = true;
  want.control_hold_ms[1] = 4000;
  CHECK(build_status_body(armed) == build_status_body(want));
  link.set_mode(AssocMode::MUSTER);
  CHECK(fill_status(link, 2000, true, 7, 0).assoc == "muster");
}

int main() {
  test_a_welcome_from_a_new_session_erases_the_old_match();
  test_a_welcome_from_the_same_session_keeps_everything();
  test_a_new_session_welcome_erases_a_live_config_from_flash_only();
  test_a_welcome_without_a_session_erases_nothing();
  test_a_config_with_a_new_lock_then_a_rearm();
  test_a_failed_lock_write_is_retried_by_the_loop();
  test_a_failed_lock_clear_is_retried_and_forces_the_next_write();
  test_a_release_clears_all_four();
  test_a_release_then_a_welcome();
  test_a_config_erases_a_hill_and_clock_from_another_game();
  test_a_muster_config_drops_last();
  test_powerup_claim_feed_and_updates();
  test_fill_status_matches_the_glue_heartbeat();
  if (failures) {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("all checks passed\n");
  return 0;
}
