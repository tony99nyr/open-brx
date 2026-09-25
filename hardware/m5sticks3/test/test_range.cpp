// Host tests for F365 / contract A67 and its addenda: the on-station range edit (station_range.h), its
// place in StationLink (station_link.h), and the A-hold gesture and RANGE editor (station_ui.h). Build + run:
//   g++ -std=c++17 -I.. test_range.cpp -o /tmp/test_range && /tmp/test_range
// mcp/tests/test_sticks3_core.py does exactly that when g++ exists.
#include <cstdio>
#include <string>

#include "json_lite.h"
#include "station_screen.h"  // station_ui.h, LOW_BATTERY_PCT, range_must_close

static int failures = 0;
#define CHECK(cond)                                                    \
  do {                                                                 \
    if (!(cond)) {                                                     \
      std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);      \
      failures++;                                                      \
    }                                                                  \
  } while (0)
#define CHECK_EQ(a, b)                                                             \
  do {                                                                             \
    auto _a = (a);                                                                \
    auto _b = (b);                                                                \
    if (!(_a == _b)) {                                                            \
      std::printf("FAIL %s:%d  %s == %s\n", __FILE__, __LINE__, #a, #b);          \
      failures++;                                                                 \
    }                                                                             \
  } while (0)

using namespace brx;

static StationAssignment cfg(const std::string& json) {
  std::string body = json;
  if (body.find("\"threshold\"") == std::string::npos) {
    const size_t end = body.rfind('}');
    if (end != std::string::npos) body.insert(end, ",\"threshold\":-57");
  }
  return parse_station_config(json::parse(body));
}

static StationLink armed_hill(uint32_t at_ms = 0) {
  StationLink link;
  link.apply_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":7})"), at_ms);
  return link;
}

// ---- the keep/apply rule, per field ------------------------------------------------------------
static void test_rule_keeps_a_younger_edit_and_applies_an_older_or_equal_one() {
  // An edit made at t=10000; MC's config lands at t=15000, so the edit is 5000 ms old.
  for (int64_t mc_age : {4999LL, 5000LL, 5001LL, 100000LL}) {
    StationLink link = armed_hill(0);
    CHECK(link.edit_threshold(-3, 10000));  // -57 -> -60
    CHECK_EQ(link.threshold_dbm(), -60);
    StationAssignment a = cfg(R"({"kind":"control","team":255,"id":3,"game":7,"threshold":-66})");
    a.threshold_age_ms = mc_age;
    link.apply_station_config(a, 15000);
    if (mc_age > 5000) {  // the edit (5000 ms) is YOUNGER than MC's value: it stays
      CHECK_EQ(link.threshold_dbm(), -60);
      CHECK_EQ(std::string(link.threshold_setting().src()), std::string("station"));
    } else {  // equal or older: MC's value applies and the edit is dropped
      CHECK_EQ(link.threshold_dbm(), -66);
      CHECK_EQ(std::string(link.threshold_setting().src()), std::string("mc"));
    }
  }
}

static void test_rule_absent_age_applies_mc_as_before() {
  StationLink link = armed_hill(0);
  link.edit_threshold(-3, 10000);
  link.apply_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":7,"threshold":-66})"), 10001);
  CHECK_EQ(link.threshold_dbm(), -66);  // an older MC: its value, whatever the Stick edited
  CHECK(!link.threshold_setting().from_station());
}

// Polish round 1 (CRITICAL): MC re-sends station_config as the A58 lock carrier and on every hello, with
// no age on today's MC. A re-push of the SAME value must not revert the operator's edit; a CHANGED value
// with no age is MC's new decision and applies. With ages, the contract rule is unchanged.
static void test_absent_age_same_value_keeps_the_edit_changed_value_applies() {
  StationLink link = armed_hill(0);
  link.edit_threshold(-3, 1000);  // -57 -> -60
  link.edit_tx_power(-1, 1000);   // high -> medium
  // The lock carrier / a reconnect: the same config, no ages, a new lock_s.
  link.apply_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":7,"lock_s":600})"), 2000);
  CHECK_EQ(link.threshold_dbm(), -60);
  CHECK(link.threshold_setting().from_station());
  link.apply_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":7,"tx_power":"high"})"), 2100);
  CHECK_EQ(link.tx_power_level(), TX_POWER_MEDIUM);  // MC's tx value unchanged (high): the edit stays
  // MC changes its value (still no age): MC's decision applies.
  link.apply_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":7,"threshold":-66,"tx_power":"low"})"), 3000);
  CHECK_EQ(link.threshold_dbm(), -66);
  CHECK_EQ(link.tx_power_level(), TX_POWER_LOW);
  CHECK(!link.threshold_setting().from_station());
  // A reboot-restored edit survives MC's first (same-value, ageless) config too.
  StationLink after;
  after.restore_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":7})"));
  StationLink before = armed_hill(0);
  before.edit_threshold(-3, 10);
  after.restore_range(before.range_storage_body());
  after.apply_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":7})"), 50);
  CHECK_EQ(after.threshold_dbm(), -60);
}

// A new station identity (kind or id) starts from MC's values. A new GAME is the same station in the same
// place (the next match): the edit stays unless MC's value changed (polish round 3).
static void test_identity_change_resets_both_edits() {
  StationLink link = armed_hill(0);
  link.edit_threshold(-3, 10);
  link.edit_tx_power(-1, 10);
  link.apply_station_config(cfg(R"({"kind":"control","team":255,"id":4,"game":7})"), 20);  // a new id
  CHECK_EQ(link.threshold_dbm(), -57);
  CHECK_EQ(link.tx_power_level(), TX_POWER_HIGH);
  CHECK(!link.threshold_setting().from_station());
  CHECK(!link.tx_power_setting().from_station());
}

static void test_a_new_game_with_the_same_mc_value_keeps_the_edit() {
  StationLink link = armed_hill(0);
  link.edit_threshold(-3, 10);
  link.edit_tx_power(-1, 10);
  link.apply_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":8})"), 20);  // the next match
  CHECK_EQ(link.threshold_dbm(), -60);
  CHECK_EQ(link.tx_power_level(), TX_POWER_MEDIUM);
  CHECK(link.threshold_setting().from_station());
  // ...and a new game whose MC value DID change applies it (no age: a changed value is MC's decision).
  link.apply_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":9,"threshold":-66})"), 30);
  CHECK_EQ(link.threshold_dbm(), -66);
}

static void test_threshold_zero_is_the_stick_default() {
  StationLink link;
  link.apply_station_config(cfg(R"({"kind":"respawn","team":1,"id":2,"threshold":0})"), 0);
  CHECK_EQ(link.threshold_dbm(), STICK_DEFAULT_THRESHOLD_DBM);
  CHECK_EQ(link.threshold_dbm(), -57);
  StationAssignment a = cfg(R"({"kind":"respawn","team":1,"id":2,"threshold":0,"threshold_age_ms":50})");
  CHECK_EQ(a.threshold_age_ms, 50LL);
  link.apply_station_config(a, 10);
  CHECK_EQ(link.threshold_dbm(), -57);
}

static void test_the_clamp_and_the_step() {
  StationLink link = armed_hill();
  for (int i = 0; i < 20; i++) link.edit_threshold(+RANGE_STEP_DB, 100 + i);  // closer, again and again
  CHECK_EQ(link.threshold_dbm(), RANGE_MAX_DBM);
  CHECK(!link.edit_threshold(+3, 200));  // at the clamp: no change, no log entry
  for (int i = 0; i < 40; i++) link.edit_threshold(-RANGE_STEP_DB, 300 + i);
  CHECK_EQ(link.threshold_dbm(), RANGE_MIN_DBM);
  CHECK_EQ(clamp_threshold_dbm(-100), -90);
  CHECK_EQ(clamp_threshold_dbm(-30), -40);
  CHECK_EQ(clamp_threshold_dbm(-57), -57);
  // The RANGE screen's step: A (closer) raises the threshold 3 dB, B (farther) lowers it.
  CHECK_EQ(RangeEditor::step_for(RangeField::RADIUS, true), +3);
  CHECK_EQ(RangeEditor::step_for(RangeField::RADIUS, false), -3);
  CHECK_EQ(RangeEditor::step_for(RangeField::STRENGTH, true), -1);  // A = weaker
  CHECK_EQ(RangeEditor::step_for(RangeField::STRENGTH, false), +1);
}

static void test_no_edit_without_a_station() {
  StationLink link;
  CHECK(!link.edit_threshold(-3, 0));
  CHECK(!link.edit_tx_power(-1, 0));
  CHECK(link.range_edits().edits().empty());
}

// ---- TX power: the mapping, absent = keep, independent of the threshold ----------------------------
static void test_tx_power_mapping_and_parse() {
  CHECK_EQ(tx_power_dbm(TX_POWER_ULTRA_LOW), -18);
  CHECK_EQ(tx_power_dbm(TX_POWER_LOW), -9);
  CHECK_EQ(tx_power_dbm(TX_POWER_MEDIUM), 0);
  CHECK_EQ(tx_power_dbm(TX_POWER_HIGH), 9);
  CHECK_EQ(TX_POWER_DEFAULT, TX_POWER_HIGH);  // unchanged behaviour: +9 dBm
  for (int l = 0; l < 4; l++) CHECK_EQ(parse_tx_power(tx_power_name(l)), l);
  CHECK_EQ(parse_tx_power(""), -1);
  CHECK_EQ(parse_tx_power("loud"), -1);
  StationLink link = armed_hill();
  CHECK_EQ(link.tx_power_level(), TX_POWER_HIGH);
  CHECK(!link.edit_tx_power(+1, 5));  // already at the top
  CHECK(link.edit_tx_power(-1, 6));
  CHECK_EQ(link.tx_power_level(), TX_POWER_MEDIUM);
}

static void test_tx_power_absent_keeps_the_sticks_own_and_fields_are_independent() {
  StationLink link = armed_hill(0);
  link.edit_tx_power(-2, 1000);  // high -> low, on the station
  link.edit_threshold(-3, 1000);
  // MC re-sends with an older-MC threshold (no age) and NO tx_power: the threshold applies, tx stays.
  link.apply_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":7,"threshold":-63})"), 2000);
  CHECK_EQ(link.threshold_dbm(), -63);
  CHECK_EQ(link.tx_power_level(), TX_POWER_LOW);
  CHECK(link.tx_power_setting().from_station());
  // tx_power with an age OLDER than the edit (1000 ms at t=2000 vs 5000): the edit stays.
  link.apply_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":7,"threshold":-63,)"
                                R"("tx_power":"medium","tx_power_age_ms":5000})"), 2000);
  CHECK_EQ(link.tx_power_level(), TX_POWER_LOW);
  // A younger MC value (500 ms) wins.
  link.apply_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":7,"threshold":-63,)"
                                R"("tx_power":"medium","tx_power_age_ms":500})"), 2000);
  CHECK_EQ(link.tx_power_level(), TX_POWER_MEDIUM);
  CHECK(!link.tx_power_setting().from_station());
}

// ---- the status beat -------------------------------------------------------------------------------
static void test_status_fields_edit_age_only_when_src_is_station() {
  StationLink link = armed_hill(0);
  StatusFields f;
  f.node_id = "n";
  fill_range_status(link, f, 100);
  std::string body = build_status_body(f);
  CHECK(body.find("\"threshold\":-57") != std::string::npos);
  CHECK(body.find("\"threshold_src\":\"mc\"") != std::string::npos);
  CHECK(body.find("threshold_edit_age_ms") == std::string::npos);
  CHECK(body.find("\"tx_power\":\"high\"") != std::string::npos);
  CHECK(body.find("tx_power_edit_age_ms") == std::string::npos);
  CHECK(body.find("range_edits") == std::string::npos);  // no edits yet: not sent
  link.edit_threshold(-3, 1000);
  StatusFields g;
  g.node_id = "n";
  fill_range_status(link, g, 1750);
  body = build_status_body(g);
  CHECK(body.find("\"threshold\":-60") != std::string::npos);
  CHECK(body.find("\"threshold_src\":\"station\",\"threshold_edit_age_ms\":750") != std::string::npos);
  CHECK(body.find("tx_power_edit_age_ms") == std::string::npos);  // tx was not edited
  CHECK(body.find("\"range_edits\":[{\"seq\":1,\"field\":\"threshold\",\"from\":-57,\"to\":-60,\"locked\":false,"
                  "\"age_ms\":750}]") != std::string::npos);
  // An unset StatusFields keeps the old body byte for byte (the goldens).
  StatusFields old;
  old.node_id = "n";
  CHECK(build_status_body(old).find("threshold_src") == std::string::npos);
}

static void test_locked_range_edits_are_refused_and_unlocked_edits_are_logged() {
  StationLink link;
  link.apply_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":7,"lock_s":600})"), 0);
  CHECK(link.lock().locked(10));
  CHECK(!link.edit_threshold(-3, 10));
  CHECK(!link.edit_tx_power(-1, 20));
  CHECK_EQ(link.range_edits().edits().size(), (size_t)0);
  link.apply_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":7,"lock_s":0})"), 30);
  CHECK(link.edit_threshold(-3, 40));
  CHECK(link.edit_tx_power(-1, 50));
  const auto& e = link.range_edits().edits();
  CHECK_EQ(e.size(), (size_t)2);
  CHECK(!e[0].locked);
  std::string j = link.range_edits().status_json(60);
  CHECK(j.find("\"field\":\"tx_power\",\"from\":\"high\",\"to\":\"medium\",\"locked\":false") != std::string::npos);
  CHECK(j.find("\"field\":\"threshold\",\"from\":-57,\"to\":-60,\"locked\":false") != std::string::npos);
  for (int i = 0; i < 10; i++) link.edit_threshold(i % 2 ? +3 : -3, 100 + i);
  CHECK_EQ(link.range_edits().edits().size(), RANGE_EDIT_LOG_MAX);
  CHECK_EQ(link.range_edits().edits().front().seq, 5u);
  CHECK_EQ(link.range_edits().edits().back().seq, 12u);
  CHECK_EQ(link.range_edits().next_seq(), 13u);
}

static void test_reboot_restores_value_seq_and_an_unknown_age() {
  StationLink before = armed_hill(0);
  before.edit_threshold(-3, 1000);
  before.edit_threshold(-3, 2000);  // -63
  before.edit_tx_power(-1, 3000);   // medium
  const std::string nvs = before.range_storage_body();

  StationLink after;  // a fresh boot: the saved config comes back first, then the range
  after.wifi_configured();
  after.restore_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":7})"));
  CHECK(after.restore_range(nvs));
  CHECK_EQ(after.threshold_dbm(), -63);
  CHECK_EQ(after.tx_power_level(), TX_POWER_MEDIUM);
  CHECK_EQ(std::string(after.threshold_setting().src()), std::string("station"));
  CHECK_EQ(after.threshold_setting().edit_age_ms(5), EDIT_AGE_UNKNOWN_MS);
  CHECK_EQ(after.range_edits().edits().size(), (size_t)3);
  CHECK_EQ(after.range_edits().next_seq(), 4u);  // seq persists: the next edit is 4, never a reused 1
  CHECK(after.range_edits().status_json(5).find("\"age_ms\":2147483647") != std::string::npos);
  after.edit_threshold(-3, 10);
  CHECK_EQ(after.range_edits().edits().back().seq, 4u);
  // Any MC value with an age wins over the restored edit... (a fresh edit of 10 ms would not)
  StationLink again;
  again.restore_station_config(cfg(R"({"kind":"control","team":255,"id":3,"game":7})"));
  again.restore_range(nvs);
  StationAssignment a = cfg(R"({"kind":"control","team":255,"id":3,"game":7,"threshold":-51,"threshold_age_ms":3600000})");
  again.apply_station_config(a, 100);
  CHECK_EQ(again.threshold_dbm(), -51);
  CHECK_EQ(std::string(again.threshold_setting().src()), std::string("mc"));
  // ...and an edit saved for ANOTHER station id restores the log and seq, but not the value.
  StationLink other;
  other.restore_station_config(cfg(R"({"kind":"control","team":255,"id":9,"game":7})"));
  other.restore_range(nvs);
  CHECK_EQ(other.threshold_dbm(), -57);
  CHECK_EQ(other.range_edits().next_seq(), 4u);
}

// brx3 note 1: status `threshold` is always the dBm applied, never 0 (MC's 0 = the Stick's -57, src "mc"),
// live and after a boot-time restore.
static void test_status_threshold_is_never_zero() {
  StationLink link;
  link.apply_station_config(cfg(R"({"kind":"respawn","team":1,"id":2,"threshold":0})"), 0);
  StatusFields f;
  fill_range_status(link, f, 10);
  std::string body = build_status_body(f);
  CHECK(body.find("\"threshold\":-57,") != std::string::npos);
  CHECK(body.find("\"threshold_src\":\"mc\"") != std::string::npos);
  CHECK(body.find("\"threshold\":0") == std::string::npos);
  StationLink booted;  // the saved copy of that config, restored at boot
  booted.restore_station_config(parse_station_config(json::parse(station_config_storage_body(link.assignment()))));
  StatusFields g;
  fill_range_status(booted, g, 10);
  CHECK_EQ(g.threshold, -57);
}

// brx3 note 2: seq never goes down (MC reads a lower seq as a reset and re-announces every edit).
static void test_seq_never_goes_down() {
  StationLink link = armed_hill(0);
  link.edit_threshold(-3, 10);
  link.edit_threshold(-3, 20);
  CHECK_EQ(link.range_edits().next_seq(), 3u);
  link.apply_release();  // a release keeps the log and its seq
  CHECK_EQ(link.range_edits().next_seq(), 3u);
  link.apply_station_config(cfg(R"({"kind":"respawn","team":1,"id":5,"game":9})"), 30);  // a new identity
  CHECK_EQ(link.range_edits().next_seq(), 3u);
  CHECK(!link.restore_range("not json"));  // an unreadable NVS body changes nothing
  CHECK(!range_body_usable("not json"));  // ...and the glue treats it like an unreadable NVS: no writes
  CHECK(range_body_usable(""));           // absent (a first boot) is fine
  CHECK(range_body_usable(link.range_storage_body()));
  CHECK_EQ(link.range_edits().next_seq(), 3u);
  CHECK(link.restore_range(R"({"id":5,"log":{"next":1,"e":[]}})"));  // a stale, LOWER copy never lowers it
  CHECK_EQ(link.range_edits().next_seq(), 3u);
  link.edit_threshold(-3, 40);
  CHECK_EQ(link.range_edits().edits().back().seq, 3u);
}

static void test_release_drops_the_edit_but_keeps_the_log() {
  StationLink link = armed_hill();
  link.edit_threshold(-3, 10);
  link.apply_release();
  CHECK_EQ(link.threshold_dbm(), -57);
  CHECK(!link.threshold_setting().from_station());
  CHECK_EQ(link.range_edits().edits().size(), (size_t)1);
}

// ---- the A hold (Tony, 2026-09-25): click, home on release, 5 s = RANGE ------------------------------
static AHoldEvent hold_for(AHoldGesture& g, uint32_t ms, bool range_allowed, bool* range_seen = nullptr) {
  uint32_t t = 100000;
  g.update(true, t, range_allowed);
  for (uint32_t d = 50; d <= ms; d += 50) {
    AHoldEvent ev = g.update(true, t + d, range_allowed);
    if (ev == AHoldEvent::RANGE && range_seen) *range_seen = true;
    CHECK(ev == AHoldEvent::NONE || ev == AHoldEvent::RANGE);  // nothing but RANGE fires while held
  }
  return g.update(false, t + ms, range_allowed);
}

static void test_a_hold_timing() {
  {  // A held before STATS must earn the full five seconds after RANGE becomes allowed.
    AHoldGesture g;
    CHECK(g.update(true, 1000, false) == AHoldEvent::NONE);
    CHECK(g.update(true, 4000, true) == AHoldEvent::NONE);
    CHECK(g.update(true, 8999, true) == AHoldEvent::NONE);
    CHECK(g.update(true, 9000, true) == AHoldEvent::RANGE);
  }
  {
    AHoldGesture g;
    CHECK(hold_for(g, 500, true) == AHoldEvent::CLICK);  // 0.5 s: a click
  }
  {
    AHoldGesture g;
    bool range = false;
    CHECK(hold_for(g, 3000, true, &range) == AHoldEvent::HOME);  // 3 s: home, on the release
    CHECK(!range);
  }
  {
    AHoldGesture g;
    bool range = false;
    CHECK(hold_for(g, 5000, true, &range) == AHoldEvent::NONE);  // 5 s: RANGE fired; the release fires nothing
    CHECK(range);
  }
  {
    AHoldGesture g;
    bool range = false;
    CHECK(hold_for(g, 6000, false, &range) == AHoldEvent::HOME);  // not on STATS: a long hold is just home
    CHECK(!range);
  }
  {  // the edges: 999 ms is a click, 1000 ms is home; 4999 ms is home, 5000 ms is RANGE
    AHoldGesture a, b, c, d;
    bool r = false;
    CHECK(hold_for(a, 999, true) == AHoldEvent::CLICK);
    CHECK(hold_for(b, 1000, true) == AHoldEvent::HOME);
    CHECK(hold_for(c, 4999, true, &r) == AHoldEvent::HOME);
    CHECK(!r);
    CHECK(hold_for(d, 5000, true, &r) == AHoldEvent::NONE);
    CHECK(r);
  }
  {  // the cue: none before 1 s, filling from 1 s, only where RANGE is allowed
    AHoldGesture g;
    g.update(true, 0, true);
    g.update(true, 900, true);
    CHECK_EQ(g.range_cue_pct(), -1);
    g.update(true, 3000, true);
    CHECK_EQ(g.range_cue_pct(), 50);
    AHoldGesture h;
    h.update(true, 0, false);
    h.update(true, 3000, false);
    CHECK_EQ(h.range_cue_pct(), -1);
  }
  {  // the A+B force restart owns the press: its release fires nothing
    AHoldGesture g;
    g.update(true, 0, true);
    g.update(true, 2000, true);
    g.cancel();
    CHECK(g.update(false, 2500, true) == AHoldEvent::NONE);
    CHECK(hold_for(g, 300, true) == AHoldEvent::CLICK);  // and the next press is normal again
  }
  {  // Loop jitter and a single one-poll bounce must not shorten continuous-hold time.
    for (uint32_t seed = 2; seed <= 60; seed++) {
      AHoldGesture g;
      uint32_t now = 1000;
      CHECK(g.update(true, now, true) == AHoldEvent::NONE);
      bool fired = false;
      uint32_t n = seed;
      while (now < 7000) {
        n = (n * 17 + 13) % 59 + 2;
        now += n;
        const AHoldEvent event = g.update(true, now, true);
        if (event == AHoldEvent::RANGE) {
          fired = true;
          CHECK(now - 1000 >= RANGE_ENTER_HOLD_MS);
          break;
        }
      }
      CHECK(fired);
    }
    AHoldGesture bounce;
    bounce.update(true, 0, true);
    bounce.update(false, 2400, true);
    bounce.update(true, 2402, true);
    CHECK(bounce.update(true, 7401, true) == AHoldEvent::NONE);
    CHECK(bounce.update(true, 7402, true) == AHoldEvent::RANGE);
  }
}

static void test_range_editor_idle_exit_and_field_switch() {
  RangeEditor r;
  r.open(1000);
  CHECK(r.active());
  CHECK(r.field() == RangeField::RADIUS);
  r.switch_field(2000);
  CHECK(r.field() == RangeField::STRENGTH);
  CHECK(!r.poll_idle(2000 + RANGE_IDLE_EXIT_MS - 1));
  r.touch(5000);
  CHECK(!r.poll_idle(5000 + RANGE_IDLE_EXIT_MS - 1));
  CHECK(r.poll_idle(5000 + RANGE_IDLE_EXIT_MS));
  CHECK(!r.active());
  // A button held keeps it open (no exit mid-hold, then a stray HOME on the release).
  RangeEditor h;
  h.open(0);
  CHECK(!h.poll_idle(RANGE_IDLE_EXIT_MS + 500, /*button_down=*/true));
  CHECK(h.active());
  CHECK(!h.poll_idle(RANGE_IDLE_EXIT_MS + 600, false));  // the hold counted as activity
  CHECK(h.poll_idle(RANGE_IDLE_EXIT_MS + 500 + RANGE_IDLE_EXIT_MS, false));
}

// Polish round 1 (MEDIUM): RANGE never edits invisibly: it closes with no station or a low battery.
static void test_range_must_close_without_a_station_or_on_low_battery() {
  CHECK(!range_must_close(true, -1));
  CHECK(!range_must_close(true, 50));
  CHECK(range_must_close(false, -1));
  CHECK(range_must_close(true, LOW_BATTERY_PCT));
  CHECK(!range_must_close(true, LOW_BATTERY_PCT + 1));
}

static void test_distance_labels_are_anchored_at_minus_57_is_3_m() {
  CHECK_EQ(std::string(range_distance_label(-57)), std::string("~3 M"));
  CHECK_EQ(std::string(range_distance_label(-54)), std::string("~2 M"));
  CHECK_EQ(std::string(range_distance_label(-60)), std::string("~5 M"));
  CHECK_EQ(std::string(range_distance_label(-40)), std::string("UNDER 1 M"));
  CHECK_EQ(std::string(range_distance_label(-90)), std::string("OVER 20 M"));
  CHECK_EQ(std::string(range_distance_label(-78, true)), std::string("5-7 M"));
}

int main() {
  test_rule_keeps_a_younger_edit_and_applies_an_older_or_equal_one();
  test_rule_absent_age_applies_mc_as_before();
  test_absent_age_same_value_keeps_the_edit_changed_value_applies();
  test_identity_change_resets_both_edits();
  test_a_new_game_with_the_same_mc_value_keeps_the_edit();
  test_threshold_zero_is_the_stick_default();
  test_the_clamp_and_the_step();
  test_no_edit_without_a_station();
  test_tx_power_mapping_and_parse();
  test_tx_power_absent_keeps_the_sticks_own_and_fields_are_independent();
  test_status_fields_edit_age_only_when_src_is_station();
  test_locked_range_edits_are_refused_and_unlocked_edits_are_logged();
  test_reboot_restores_value_seq_and_an_unknown_age();
  test_release_drops_the_edit_but_keeps_the_log();
  test_status_threshold_is_never_zero();
  test_seq_never_goes_down();
  test_a_hold_timing();
  test_range_editor_idle_exit_and_field_switch();
  test_range_must_close_without_a_station_or_on_low_battery();
  test_distance_labels_are_anchored_at_minus_57_is_3_m();
  if (failures) {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("sticks3 range: all checks passed\n");
  return 0;
}
