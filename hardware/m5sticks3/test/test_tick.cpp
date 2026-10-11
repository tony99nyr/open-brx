#include "check.h"
#include "tick_controller.h"

#include <cstdint>
#include <initializer_list>
#include <string>
#include <vector>

using namespace brx;
using K = TickIntentKind;

static void check(const TickIntents& got, std::initializer_list<TickIntent> want) {
  if (got != TickIntents(want)) {
    std::printf("got:");
    for (const auto& x : got) std::printf(" %d(%d,%s)", (int)x.kind, x.value, x.text.c_str());
    std::printf("\nwant:");
    for (const auto& x : want) std::printf(" %d(%d,%s)", (int)x.kind, x.value, x.text.c_str());
    std::printf("\n");
  }
  CHECK(got == TickIntents(want));
}

static TickRadioFacts radio(uint32_t now) {
  TickRadioFacts f;
  f.now_ms = now;
  return f;
}

static StationLink assigned(const char* kind, uint32_t now = 0);

static void bench_beacon_and_capture() {
  TickController bridge;
  auto no_hill = radio(static_cast<uint32_t>(contract::GRENADE_BEACON_PERIOD_MS));
  check(bridge.radio(no_hill), {});
  TickController c;
  auto f = radio(static_cast<uint32_t>(contract::GRENADE_BEACON_PERIOD_MS));
  f.bench_hill = true;
  for (const char* kind : {"respawn", "powerup", "control"}) {
    auto link = assigned(kind);
    f.assignment_present = link.assignment().present;  // saved bench mode HILL under each MC kind
    check(c.radio(f), {});
    f.now_ms += static_cast<uint32_t>(contract::GRENADE_BEACON_PERIOD_MS);
  }
  f.assignment_present = false;
  check(c.radio(f), {{K::SEND_BEACON}});
  f.now_ms += static_cast<uint32_t>(contract::GRENADE_BEACON_PERIOD_MS) - 1;
  check(c.radio(f), {});
  f.now_ms++;
  check(c.radio(f), {{K::SEND_BEACON}});

  f.capture_team = 3;
  f.ble_hill = true;
  check(c.radio(f), {{K::CLEAR_PENDING_CAPTURE}, {K::SEND_CAPTURE, 3}});
  f.capture_team = -1;
  check(c.radio(f), {});
  f.capture_team = -1;  // neutral drain has no pending owner
  check(c.radio(f), {});
  f.capture_team = 1;
  f.ble_hill = false;
  check(c.radio(f), {{K::CLEAR_PENDING_CAPTURE}});
  TickController ordered;
  f = radio(static_cast<uint32_t>(contract::GRENADE_BEACON_PERIOD_MS));
  f.bench_hill = true;
  f.ble_hill = true;
  f.capture_team = 3;
  f.auto_active = true;
  check(ordered.radio(f), {{K::CLEAR_PENDING_CAPTURE}, {K::SEND_CAPTURE, 3},
                           {K::SEND_BEACON}, {K::SEND_AUTO}});
  CHECK(hill_capture_word(3).team == 3 && hill_capture_word(3).mag == contract::HILL_CAPTURE_MAG);
}

static void stalled_and_wrapped_timers() {
  TickController automatic;
  auto auto_f = radio(400);
  auto_f.auto_active = true;
  auto_f.auto_interval_ms = 400;
  check(automatic.radio(auto_f), {{K::SEND_AUTO}});
  check(automatic.radio(auto_f), {});
  TickController c;
  auto f = radio(static_cast<uint32_t>(contract::GRENADE_BEACON_PERIOD_MS) * 4);
  f.bench_hill = true;
  check(c.radio(f), {{K::SEND_BEACON}});  // F335: no catch-up burst
  check(c.radio(f), {});
  f.now_ms += static_cast<uint32_t>(contract::GRENADE_BEACON_PERIOD_MS);
  f.auto_active = true;
  f.auto_interval_ms = 400;
  check(c.radio(f), {{K::SEND_BEACON}, {K::SEND_AUTO}});
  f.now_ms += 1;
  check(c.radio(f), {});

  TickController wrap;
  f = radio(UINT32_MAX - 100);
  f.bench_hill = true;
  check(wrap.radio(f), {{K::SEND_BEACON}});
  f.now_ms = 4898;  // 5000 unsigned milliseconds later
  check(wrap.radio(f), {});
  f.now_ms = 4899;
  check(wrap.radio(f), {{K::SEND_BEACON}});
}

static void repaint_and_backlight() {
  TickController c;
  TickDisplayFacts d{0, true};
  check(c.display(d), {{K::PAINT}, {K::CLEAR_DIRTY}});
  d = {250, false};
  check(c.display(d), {{K::PAINT}, {K::CLEAR_DIRTY}});
  d = {BACKLIGHT_IDLE_MS - 1, false};
  check(c.display(d), {{K::PAINT}, {K::CLEAR_DIRTY}});
  d = {BACKLIGHT_IDLE_MS, false};
  check(c.display(d), {{K::DIM}});
  d = {BACKLIGHT_IDLE_MS + 1, true};
  check(c.display(d), {{K::PAINT}, {K::BRIGHTEN}, {K::CLEAR_DIRTY}});
  d = {BACKLIGHT_IDLE_MS * 2, false};
  check(c.display(d), {{K::PAINT}, {K::CLEAR_DIRTY}});
  d.now_ms++;
  check(c.display(d), {{K::DIM}});

  TickController pinned;
  check(pinned.display({0, true}), {{K::PAINT}, {K::CLEAR_DIRTY}});
  check(pinned.display({20000, true}), {{K::PAINT}, {K::CLEAR_DIRTY}});
  check(pinned.display({30000, false}), {{K::PAINT}, {K::CLEAR_DIRTY}});

  TickController dirty_paint;
  check(dirty_paint.display({500, true}), {{K::PAINT}, {K::CLEAR_DIRTY}});
  check(dirty_paint.display({501, false}), {});
}

static StationLink assigned(const char* kind, uint32_t now) {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = kind;
  a.id = 9;
  a.game = 3;
  link.apply_station_config(a, now);
  return link;
}

static void player_admission_and_epoch() {
  CHECK(TickController::player_tick_allowed(true, false, false));
  CHECK(TickController::player_tick_allowed(false, true, true));
  CHECK(!TickController::player_tick_allowed(false, true, false));
  CHECK(!TickController::player_tick_allowed(false, false, true));
  TickController c;
  PlayerPresence p;
  StationLink link;
  CHECK(!c.begin_players(link, p, 250).due);
  TickController kind_tick;
  link = assigned("respawn");
  CHECK(kind_tick.begin_players(link, p, 500).due == REVIVE_FEEDBACK_ENABLED);
  link = assigned("powerup");
  CHECK(!kind_tick.begin_players(link, p, 750).due);
  link = assigned("control");
  CHECK(!c.begin_players(link, p, 249).due);
  auto a = c.begin_players(link, p, 250);
  CHECK(a.due);
  check(a.intents, {});
  CHECK(!c.begin_players(link, p, 499).due);
  CHECK(c.begin_players(link, p, 500).due);
  Advert old;
  old.role = contract::ADVERT_ROLE_PLAYER;
  old.id = 7;
  old.team = 1;
  old.game = 3;
  old.state = contract::ADVERT_PLAYER_STATE_ALIVE;
  p.observe(old, -40, 500);
  CHECK(p.count() == 1);
  link.apply_release();
  link = assigned("control");
  a = c.begin_players(link, p, 750);
  CHECK(a.due);
  check(a.intents, {});
  StationAssignment next = link.assignment();
  next.id = 10;
  link.apply_station_config(next, 750);
  a = c.begin_players(link, p, 1000);
  CHECK(a.due);
  check(a.intents, {{K::CLEAR_SIGHTINGS}, {K::CLEAR_PRESENCE}});
  p.clear();
  CHECK(p.count() == 0);

  TickController wrap;
  auto w = assigned("control");
  PlayerPresence wp;
  CHECK(wrap.begin_players(w, wp, UINT32_MAX - 20).due);
  CHECK(!wrap.begin_players(w, wp, 228).due);
  CHECK(wrap.begin_players(w, wp, 229).due);
}

static void player_events_and_order() {
  HillUpdate u;
  u.captured = true; u.captured_team = 3; u.captured_from = 1;
  u.neutralised = true; u.neutralised_team = 1; u.neutralised_by = 3;
  u.contested_edge = true; u.refused = true;
  check(TickController::player_events(u, 0, 1),
        {{K::QUEUE_CAPTURE, 3}, {K::WAKE_SCREEN}, {K::SERIAL_PRINTF, 0, "HILL CAPTURED team=3 from=1\n"},
         {K::WAKE_SCREEN}, {K::SERIAL_PRINTF, 0, "HILL NEUTRAL (team 1 lost it to team 3)\n"},
         {K::WAKE_SCREEN}, {K::SERIAL_PRINTLN, 0, "HILL CONTESTED"},
         {K::SERIAL_PRINTLN, 0, "# F82: a player on tid 2 is on the point; tid 2 can never hold a hill (use 0, 1, 3)"},
         {K::WAKE_SCREEN}, {K::REVIVE_FLASH}, {K::SERIAL_PRINTF, 0, "REVIVE count=1\n"}});
  u = HillUpdate{};
  u.uncontested_edge = true;
  check(TickController::player_events(u, 1, 1), {{K::WAKE_SCREEN}, {K::SERIAL_PRINTLN, 0, "HILL no longer contested"}});
  u = HillUpdate{};
  u.neutralised = true; u.neutralised_team = 3; u.neutralised_by = -1;
  check(TickController::player_events(u, 1, 1),
        {{K::WAKE_SCREEN}, {K::SERIAL_PRINTF, 0, "HILL NEUTRAL (team 3 lost it to team -1)\n"}});
}

static void player_saves_and_sightings() {
  TickController c;
  PlayerPresence p;
  auto link = assigned("control");
  SavedHill hill;
  SavedHillClock clock;
  CHECK(c.begin_players(link, p, 250).due);
  check(c.finish_players(link, p, hill, clock, "s1", 250), {});
  CHECK(p.game == 3 && p.default_threshold == link.threshold_dbm());
  link.hill().restore_held(1, nullptr);
  CHECK(c.begin_players(link, p, 500).due);
  check(c.finish_players(link, p, hill, clock, "s1", 500), {{K::SAVE_HILL}});
  CHECK(c.begin_players(link, p, 750).due);
  check(c.finish_players(link, p, hill, clock, "s1", 750), {});

  TickController timed_tick;
  PlayerPresence timed_presence;
  auto timed = assigned("control");
  StationAssignment a = timed.assignment();
  a.starts_known = true;
  a.starts_in_ms = 0;
  a.ends_in_ms = 60000;
  a.duration_ms = 60000;
  timed.apply_station_config(a, 1000);
  SavedHill timed_hill;
  SavedHillClock timed_clock;
  CHECK(timed_tick.begin_players(timed, timed_presence, 1250).due);
  check(timed_tick.finish_players(timed, timed_presence, timed_hill, timed_clock, "s1", 1250), {{K::SAVE_CLOCK}});
  CHECK(timed_tick.begin_players(timed, timed_presence, 1500).due);
  check(timed_tick.finish_players(timed, timed_presence, timed_hill, timed_clock, "s1", 1500), {});
  CHECK(timed_tick.begin_players(timed, timed_presence, 31250).due);
  check(timed_tick.finish_players(timed, timed_presence, timed_hill, timed_clock, "s1", 31250), {{K::SAVE_CLOCK}});
  CHECK(timed_tick.begin_players(timed, timed_presence, 61000).due);
  check(timed_tick.finish_players(timed, timed_presence, timed_hill, timed_clock, "s1", 61000),
        {{K::SAVE_CLOCK}});
  CHECK(timed_tick.begin_players(timed, timed_presence, 61250).due);
  check(timed_tick.finish_players(timed, timed_presence, timed_hill, timed_clock, "s1", 61250), {});

  TickController freeze_tick;
  PlayerPresence freeze_presence;
  auto freeze = assigned("control");
  a = freeze.assignment();
  a.starts_known = true;
  a.starts_in_ms = 0;
  a.ends_in_ms = 1000;
  a.duration_ms = 1000;
  freeze.apply_station_config(a, 0);
  freeze.hill().restore_held(1);
  SavedHill freeze_hill;
  SavedHillClock freeze_clock;
  CHECK(freeze_tick.begin_players(freeze, freeze_presence, 250).due);
  check(freeze_tick.finish_players(freeze, freeze_presence, freeze_hill, freeze_clock, "s1", 250),
        {{K::SAVE_HILL}, {K::SAVE_CLOCK}});
  CHECK(freeze_tick.begin_players(freeze, freeze_presence, 1000).due);
  check(freeze_tick.finish_players(freeze, freeze_presence, freeze_hill, freeze_clock, "s1", 1000),
        {{K::SAVE_HILL}, {K::SAVE_CLOCK}});

  TickController sight_tick;
  PlayerPresence sight_presence;
  auto sight_link = assigned("control");
  a = sight_link.assignment();
  a.duration_ms = 60000;  // no START: the down-then-alive adverts anchor the clock
  sight_link.apply_station_config(a, 0);
  SavedHill sight_hill;
  SavedHillClock sight_clock;
  CHECK(sight_tick.begin_players(sight_link, sight_presence, 250).due);
  Sighting sp;
  sp.advert.role = contract::ADVERT_ROLE_PLAYER;
  sp.advert.id = 7;
  sp.advert.team = 1;
  sp.advert.game = 3;
  sp.rssi = -40;
  sp.seen_at = 100;
  sight_tick.observe_player(sight_link, sight_presence, 250, sp);
  sp.advert.state = contract::ADVERT_PLAYER_STATE_ALIVE;
  sp.seen_at = 200;
  sight_tick.observe_player(sight_link, sight_presence, 250, sp);
  CHECK(sight_link.hill_clock_remaining_ms(250) == 59950);
  check(sight_tick.finish_players(sight_link, sight_presence, sight_hill, sight_clock, "s1", 250),
        {{K::SAVE_CLOCK}});
  sp.seen_at = 300;  // a callback that ran after this tick's millis() must clamp for presence
  sight_tick.observe_player(sight_link, sight_presence, 250, sp);
  CHECK(sight_presence.get(7) && sight_presence.get(7)->seen_at == 250);

  TickController wrapped_sight_tick;
  PlayerPresence wrapped_sight_presence;
  auto wrapped_sight_link = assigned("control");
  sp.seen_at = UINT32_MAX - 5;
  wrapped_sight_tick.observe_player(wrapped_sight_link, wrapped_sight_presence, 20, sp);
  CHECK(wrapped_sight_presence.get(7) && wrapped_sight_presence.get(7)->seen_at == UINT32_MAX - 5);
}

static void real_capture_and_neutral_drain() {
  TickController tick;
  PlayerPresence p;
  p.dwell_ms = 0;
  auto link = assigned("control");
  StationAssignment a = link.assignment();
  a.starts_known = true;
  a.starts_in_ms = 0;
  link.apply_station_config(a, 0);
  link.hill().capture_s = 1;
  SavedHill hill;
  SavedHillClock clock;
  Sighting sp;
  sp.advert.role = contract::ADVERT_ROLE_PLAYER;
  sp.advert.id = 7;
  sp.advert.team = 3;
  sp.advert.game = 3;
  sp.advert.state = contract::ADVERT_PLAYER_STATE_ALIVE;
  sp.rssi = -40;
  sp.seen_at = 250;
  CHECK(tick.begin_players(link, p, 250).due);
  tick.observe_player(link, p, 250, sp);
  check(tick.finish_players(link, p, hill, clock, "s1", 250), {});
  for (uint32_t now = 500; now < 1250; now += 250) {
    CHECK(tick.begin_players(link, p, now).due);
    check(tick.finish_players(link, p, hill, clock, "s1", now), {});
  }
  CHECK(tick.begin_players(link, p, 1250).due);
  check(tick.finish_players(link, p, hill, clock, "s1", 1250),
        {{K::SAVE_HILL}, {K::QUEUE_CAPTURE, 3}, {K::WAKE_SCREEN},
         {K::SERIAL_PRINTF, 0, "HILL CAPTURED team=3 from=-1\n"}});
  TickRadioFacts f = radio(1250);
  f.capture_team = 3;
  f.ble_hill = true;
  f.assignment_present = true;
  f.bench_hill = true;
  check(tick.radio(f), {{K::CLEAR_PENDING_CAPTURE}, {K::SEND_CAPTURE, 3}});
  f.capture_team = -1;
  check(tick.radio(f), {});

  p.clear();
  for (uint32_t now = 1500; now < 2250; now += 250) {
    CHECK(tick.begin_players(link, p, now).due);
    if (now == 1500) {
      sp.advert.id = 8;
      sp.advert.team = 1;
      sp.seen_at = now;
      tick.observe_player(link, p, now, sp);
    }
    check(tick.finish_players(link, p, hill, clock, "s1", now), {});
  }
  CHECK(tick.begin_players(link, p, 2250).due);
  check(tick.finish_players(link, p, hill, clock, "s1", 2250),
        {{K::SAVE_HILL}, {K::WAKE_SCREEN},
         {K::SERIAL_PRINTF, 0, "HILL NEUTRAL (team 3 lost it to team 1)\n"}});
  check(tick.radio(radio(2250)), {});  // no capture word follows a neutral drain
}

static void real_revive_feedback_when_enabled() {
  if (!REVIVE_FEEDBACK_ENABLED) return;
  TickController tick;
  PlayerPresence p;
  auto link = assigned("respawn");
  SavedHill hill;
  SavedHillClock clock;
  Sighting sp;
  sp.advert.role = contract::ADVERT_ROLE_PLAYER;
  sp.advert.id = 7;
  sp.advert.team = 1;
  sp.advert.game = 3;
  sp.rssi = -40;
  sp.seen_at = 250;
  CHECK(tick.begin_players(link, p, 250).due);
  tick.observe_player(link, p, 250, sp);
  check(tick.finish_players(link, p, hill, clock, "s1", 250), {});
  sp.advert.state = contract::ADVERT_PLAYER_STATE_ALIVE | contract::ADVERT_PLAYER_STATE_REVIVED;
  sp.advert.value = 9;
  sp.seen_at = 500;
  CHECK(tick.begin_players(link, p, 500).due);
  tick.observe_player(link, p, 500, sp);
  check(tick.finish_players(link, p, hill, clock, "s1", 500),
        {{K::WAKE_SCREEN}, {K::REVIVE_FLASH}, {K::SERIAL_PRINTF, 0, "REVIVE count=1\n"}});
  CHECK(tick.begin_players(link, p, 750).due);
  check(tick.finish_players(link, p, hill, clock, "s1", 750), {});
  link.hill().restore_held(1, nullptr);
  CHECK(tick.begin_players(link, p, 1000).due);
  check(tick.finish_players(link, p, hill, clock, "s1", 1000), {});
}

int main() {
  bench_beacon_and_capture();
  stalled_and_wrapped_timers();
  repaint_and_backlight();
  player_admission_and_epoch();
  player_events_and_order();
  player_saves_and_sightings();
  real_capture_and_neutral_drain();
  real_revive_feedback_when_enabled();
  return report("all checks passed");
}
