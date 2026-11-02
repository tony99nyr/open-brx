// F642: the Stick's MC discovery policy (mc_discovery.h): typed, last good, mDNS, the /24 scan, cooldown.
#include "check.h"
#include "mc_discovery.h"
#include "station_link.h"  // in_live_play

#include <vector>

using namespace brx;

static uint32_t ip(unsigned a, unsigned b, unsigned c, unsigned d) { return a << 24 | b << 16 | c << 8 | d; }
static const uint32_t MASK24 = 0xFFFFFF00u;
static const uint32_t OWN = ip(192, 168, 50, 20);

// Fail one dial the way the glue does: start it, let the deadline pass, fail it.
static uint32_t fail_dial(McDiscovery& d, McSource src, uint32_t now) {
  d.dial_started(src, now);
  CHECK(d.poll(now + 1, true, OWN, MASK24) == McStep::WAIT);  // nothing else while a dial is in flight
  CHECK(!d.dial_timed_out(now + MC_DIAL_TIMEOUT_MS - 1));
  CHECK(d.dial_timed_out(now + MC_DIAL_TIMEOUT_MS));
  d.dial_failed(now + MC_DIAL_TIMEOUT_MS);
  d.dial_failed(now + MC_DIAL_TIMEOUT_MS);  // the socket's own event after the deadline: no double count
  return now + MC_DIAL_TIMEOUT_MS;
}

static void test_f642_order_typed_last_good_mdns_scan() {
  McDiscovery d;
  d.set_last_good("ws://192.168.50.7:8766/ws");
  uint32_t t = 1000;
  for (int i = 0; i < 3; ++i) {
    CHECK(d.poll(t, true, OWN, MASK24) == McStep::DIAL_TYPED);
    t = fail_dial(d, McSource::TYPED, t);
  }
  for (unsigned i = 0; i < MC_LAST_GOOD_DIALS; ++i) {
    CHECK(d.poll(t, true, OWN, MASK24) == McStep::DIAL_LAST_GOOD);
    t = fail_dial(d, McSource::LAST_GOOD, t);
  }
  CHECK(d.poll(t, true, OWN, MASK24) == McStep::BROWSE_MDNS);
  CHECK(d.phase() == McPhase::MDNS);
  CHECK(d.poll(t + MC_MDNS_WINDOW_MS - 1, true, OWN, MASK24) == McStep::BROWSE_MDNS);
  CHECK(d.poll(t + MC_MDNS_WINDOW_MS, true, OWN, MASK24) == McStep::SCAN);
  CHECK(d.scan().running());
}

static void test_f642_no_typed_and_no_last_good_goes_straight_to_mdns() {
  McDiscovery d;
  CHECK(d.poll(0, false, OWN, MASK24) == McStep::BROWSE_MDNS);
  d.set_last_good("ws://mc.example.org:8766/ws");  // a hostname is never a last good MC
  CHECK(d.last_good().empty());
}

static void test_f642_last_good_only_private_ipv4_ws() {
  CHECK(last_good_mc_url_ok("ws://192.168.1.5:8766/ws"));
  CHECK(last_good_mc_url_ok("ws://10.0.0.9:8766/ws"));
  CHECK(last_good_mc_url_ok("ws://172.20.10.2:8766/ws"));
  CHECK(!last_good_mc_url_ok("ws://172.32.0.1:8766/ws"));        // outside 172.16/12
  CHECK(!last_good_mc_url_ok("ws://203.0.113.5:8766/ws"));       // public (RFC 5737)
  CHECK(!last_good_mc_url_ok("wss://192.168.1.5:8766/ws"));      // a tunnel scheme
  CHECK(!last_good_mc_url_ok("wss://random-words.trycloudflare.com:443/ws"));
  CHECK(!last_good_mc_url_ok("ws://mc-laptop.local:8766/ws"));   // a hostname
  CHECK(!last_good_mc_url_ok("ws://192.168.1.256:8766/ws"));
  CHECK(!last_good_mc_url_ok("ws://192.168.1:8766/ws"));
  CHECK(!last_good_mc_url_ok("ws://192.168.1.5.6:8766/ws"));
  CHECK(!last_good_mc_url_ok("ws://0192.168.1.5:8766/ws"));
  // Saved only when new, and never the typed URL.
  CHECK(should_save_last_good("ws://192.168.1.5:8766/ws", "ws://192.168.1.9:8766/ws", ""));
  CHECK(!should_save_last_good("ws://192.168.1.5:8766/ws", "ws://192.168.1.5:8766/ws", ""));
  CHECK(!should_save_last_good("ws://192.168.1.5:8766/ws", "", "ws://192.168.1.5:8766/ws"));
  CHECK(!should_save_last_good("wss://192.168.1.5:8766/ws", "", ""));
  CHECK_EQ(mc_ws_url("192.168.1.5", 8766, "/ws"), std::string("ws://192.168.1.5:8766/ws"));
}

static void test_f642_ok_welcome_picks_the_last_good_to_save() {
  McDiscovery d;
  const std::string typed = "ws://192.168.50.9:8766/ws";
  CHECK(d.poll(0, true, OWN, MASK24) == McStep::DIAL_TYPED);
  d.dial_started(McSource::TYPED, 0);
  CHECK(d.welcomed(typed, typed).empty());  // the typed URL is never the last good
  d.dial_started(McSource::MDNS, 10);
  CHECK(d.dialling());
  d.dial_failed(20);  // closed before any welcome: nothing to adopt
  CHECK(!d.dialling());
  d.dial_started(McSource::MDNS, 30);
  CHECK_EQ(d.welcomed("ws://192.168.50.7:8766/ws", typed), std::string("ws://192.168.50.7:8766/ws"));
  CHECK(!d.dialling());
  CHECK(d.phase() == McPhase::TYPED);  // the next drop starts a fresh cycle
  d.set_last_good("ws://192.168.50.7:8766/ws");  // the glue, once the NVS write landed
  d.dial_started(McSource::LAST_GOOD, 40);
  CHECK(d.welcomed("ws://192.168.50.7:8766/ws", typed).empty());  // already saved: no flash write
  d.dial_started(McSource::SCAN, 50);
  CHECK(d.welcomed("wss://192.168.50.8:8766/ws", typed).empty());
  CHECK(d.welcomed("ws://mc.example.org:8766/ws", typed).empty());
}

static void test_f642_typed_match_compares_the_address_not_the_text() {
  CHECK(same_mc_address("ws://192.168.1.5:8766/ws", "ws://192.168.001.005:8766/ws"));
  CHECK(same_mc_address("ws://192.168.1.5:8766/ws", "ws://192.168.1.5:08766/ws"));
  CHECK(!same_mc_address("ws://192.168.1.5:8766/ws", "ws://192.168.1.5:8767/ws"));
  CHECK(!same_mc_address("ws://192.168.1.5:8766/ws", "ws://192.168.1.5:8766/other"));
  CHECK(!same_mc_address("ws://192.168.1.5:8766/ws", "ws://mc.local:8766/ws"));
  CHECK(!should_save_last_good("ws://192.168.1.5:8766/ws", "ws://192.168.001.005:08766/ws", ""));
  CHECK(!should_save_last_good("ws://192.168.1.5:8766/ws", "", "ws://192.168.1.005:8766/ws"));
}

static void test_f642_a_full_tried_list_never_skips_rolled_back_probes() {
  McScan s;
  CHECK(s.begin(OWN, MASK24));
  uint32_t now = 0;
  unsigned slot = 0;
  uint32_t a = 0;
  // Fill the tried list: .1 to .8 each answer and fail their hello.
  for (unsigned host = 1; host <= MC_SCAN_TRIED_MAX; ++host, now += MC_SCAN_PROBE_GAP_MS) {
    CHECK(s.next_probe(now, slot, a));
    CHECK_EQ(a, ip(192, 168, 50, host));
    s.probe_done(slot, true);
    s.candidate_failed();
  }
  // .9 .10 .11 in flight; .11 answers first and fails: .9 and .10 must still be probed.
  unsigned slots[3];
  for (int i = 0; i < 3; ++i, now += MC_SCAN_PROBE_GAP_MS) CHECK(s.next_probe(now, slots[i], a));
  CHECK_EQ(a, ip(192, 168, 50, 11));
  s.probe_done(slots[2], true);
  s.candidate_failed();
  CHECK_EQ(s.cursor(), ip(192, 168, 50, 9));
  std::vector<uint32_t> next;
  for (int i = 0; i < 3; ++i, now += MC_SCAN_PROBE_GAP_MS) {
    CHECK(s.next_probe(now, slot, a));
    next.push_back(a);
    s.probe_done(slot, false);
  }
  CHECK(next == std::vector<uint32_t>({ip(192, 168, 50, 9), ip(192, 168, 50, 10), ip(192, 168, 50, 12)}));
}

static void test_f642_scan_waits_while_the_station_is_in_play() {
  McDiscovery d;
  d.set_last_good("ws://192.168.50.7:8766/ws");
  uint32_t t = 0;
  for (unsigned i = 0; i < MC_LAST_GOOD_DIALS; ++i) t = fail_dial(d, McSource::LAST_GOOD, t);
  CHECK(d.poll(t, false, OWN, MASK24, true) == McStep::BROWSE_MDNS);
  t += MC_MDNS_WINDOW_MS;
  CHECK(d.poll(t, false, OWN, MASK24, true) == McStep::BROWSE_MDNS);  // no scan in play
  CHECK(d.phase() == McPhase::COOLDOWN);
  CHECK(!d.scan().running());
  t += MC_SCAN_COOLDOWN_MS;
  CHECK(d.poll(t, false, OWN, MASK24, true) == McStep::DIAL_LAST_GOOD);  // the other doors go on
  t = fail_dial(d, McSource::LAST_GOOD, t);
  CHECK(d.poll(t, false, OWN, MASK24, true) == McStep::DIAL_LAST_GOOD);
  t = fail_dial(d, McSource::LAST_GOOD, t);
  CHECK(d.poll(t, false, OWN, MASK24, false) == McStep::BROWSE_MDNS);
  t += MC_MDNS_WINDOW_MS;
  CHECK(d.poll(t, false, OWN, MASK24, false) == McStep::SCAN);  // play over: the scan runs
  unsigned slot = 0;
  uint32_t a = 0;
  CHECK(d.scan().next_probe(t, slot, a));
  CHECK(d.poll(t + 10, false, OWN, MASK24, true) == McStep::BROWSE_MDNS);  // a game went live mid-scan
  CHECK(!d.scan().running());
  CHECK_EQ(d.scan().in_flight(), 0u);
  // The link's flag: MC's A58 match lock marks a live match for any kind.
  StationLink link;
  CHECK(!link.in_live_play(0));
  link.restore_lock(60, 0);
  CHECK(link.in_live_play(1000));
  CHECK(!link.in_live_play(61000));
  // A hill counts from START until it freezes at the whistle.
  StationLink hill;
  StationAssignment cfg;
  cfg.present = true;
  cfg.kind = "control";
  cfg.id = 1;
  cfg.game = 3;
  cfg.starts_known = true;
  cfg.starts_in_ms = 0;
  cfg.ends_in_ms = 10000;
  hill.apply_station_config(cfg, 0);
  PlayerPresence players;
  hill.tick_players(players, 250);
  CHECK(hill.in_live_play(250));
  hill.tick_players(players, 10250);
  CHECK(hill.hill_ended());
  CHECK(!hill.in_live_play(10250));
}

static void test_f642_scan_range_and_skips() {
  uint32_t first = 0, last = 0;
  CHECK(mc_scan_range(OWN, MASK24, first, last));
  CHECK_EQ(first, ip(192, 168, 50, 1));
  CHECK_EQ(last, ip(192, 168, 50, 254));
  CHECK(mc_scan_range(ip(10, 1, 7, 33), 0xFFFF0000u, first, last));  // a /16 scans only the Stick's /24
  CHECK_EQ(first, ip(10, 1, 7, 1));
  CHECK_EQ(last, ip(10, 1, 7, 254));
  CHECK(mc_scan_range(ip(192, 168, 50, 200), 0xFFFFFF80u, first, last));  // a /25, the upper half
  CHECK_EQ(first, ip(192, 168, 50, 129));
  CHECK_EQ(last, ip(192, 168, 50, 254));
  CHECK(mc_scan_range(ip(192, 168, 50, 20), 0xFFFFFF80u, first, last));   // the lower half
  CHECK_EQ(first, ip(192, 168, 50, 1));
  CHECK_EQ(last, ip(192, 168, 50, 126));
  CHECK(!mc_scan_range(ip(192, 168, 50, 20), 0xFFFFFFFEu, first, last));  // a /31: nothing
  McScan s;
  CHECK(!s.begin(ip(203, 0, 113, 5), MASK24));  // a public address is never scanned

  // A whole sweep probes every host once: no .0, no .255, not the Stick itself.
  CHECK(s.begin(OWN, MASK24));
  std::vector<uint32_t> seen;
  uint32_t now = 0;
  unsigned slot = 0;
  uint32_t a = 0;
  while (!s.finished() && now < 100000) {
    while (s.next_probe(now, slot, a)) seen.push_back(a);
    for (unsigned i = 0; i < MC_SCAN_POOL; ++i) s.probe_done(i, false);
    now += 10;
  }
  CHECK(s.finished());
  CHECK_EQ(seen.size(), (size_t)253);
  bool bad = false;
  for (uint32_t x : seen) bad = bad || (x & 0xFF) == 0 || (x & 0xFF) == 255 || x == OWN;
  CHECK(!bad);
}

static void test_f642_scan_respects_pool_and_rate_cap() {
  McScan s;
  CHECK(s.begin(OWN, MASK24));
  std::vector<uint32_t> starts;
  unsigned slot = 0;
  uint32_t a = 0;
  for (uint32_t now = 0; now < 5000; ++now) {  // every millisecond; probes only ever time out
    for (unsigned i = 0; i < MC_SCAN_POOL; ++i) if (s.probe_timed_out(i, now)) s.probe_done(i, false);
    while (s.next_probe(now, slot, a)) starts.push_back(now);
    CHECK(s.in_flight() <= MC_SCAN_POOL);
  }
  CHECK(starts.size() > 10);
  // Every probe refused at once (a quiet LAN answers RST fast): only the rate cap holds the pace.
  McScan f;
  CHECK(f.begin(OWN, MASK24));
  std::vector<uint32_t> fast;
  for (uint32_t now = 0; now < 3000; ++now) {
    while (f.next_probe(now, slot, a)) {
      fast.push_back(now);
      f.probe_done(slot, false);
    }
  }
  CHECK(fast.size() >= 55);  // the cap, not a stall: about 20 a second
  // No 1 s window ever holds more than 20 starts.
  bool over = false;
  for (size_t i = 0; i + 20 < fast.size(); ++i) over = over || fast[i + 20] - fast[i] < 1000;
  for (size_t i = 0; i + 20 < starts.size(); ++i) over = over || starts[i + 20] - starts[i] < 1000;
  CHECK(!over);
  // With 600 ms probes the pool fills: at most 4 in flight even when the rate would allow more.
  McScan p;
  CHECK(p.begin(OWN, MASK24));
  unsigned peak = 0;
  for (uint32_t now = 0; now < 2000; now += 50) {
    while (p.next_probe(now, slot, a)) {}
    if (p.in_flight() > peak) peak = p.in_flight();
  }
  CHECK_EQ(peak, MC_SCAN_POOL);
}

static void test_f642_failed_candidate_resumes_at_the_next_address() {
  McDiscovery d;
  uint32_t t = 0;
  CHECK(d.poll(t, false, OWN, MASK24) == McStep::BROWSE_MDNS);
  t += MC_MDNS_WINDOW_MS;
  CHECK(d.poll(t, false, OWN, MASK24) == McStep::SCAN);
  McScan& s = d.scan();
  unsigned slot = 0;
  uint32_t a = 0;
  // Probe .1 to .4 one at a time; .4 accepts the TCP connect.
  for (unsigned host = 1; host <= 4; ++host) {
    CHECK(s.next_probe(t, slot, a));
    CHECK_EQ(a, ip(192, 168, 50, host));
    s.probe_done(slot, host == 4);
    t += MC_SCAN_PROBE_GAP_MS;
  }
  uint32_t cand = 0;
  CHECK(s.candidate(cand));
  CHECK_EQ(cand, ip(192, 168, 50, 4));
  CHECK(!s.next_probe(t, slot, a));  // paused while the candidate is dialled
  t = fail_dial(d, McSource::SCAN, t);  // no ok welcome by the deadline
  CHECK(!s.candidate(cand));
  CHECK(d.poll(t, false, OWN, MASK24) == McStep::SCAN);
  CHECK(s.next_probe(t, slot, a));
  CHECK_EQ(a, ip(192, 168, 50, 5));

  // Probes in flight when a candidate answers are probed again after its dial fails.
  McScan r;
  CHECK(r.begin(OWN, MASK24));
  uint32_t now = 0;
  unsigned slots[3];
  for (int i = 0; i < 3; ++i, now += MC_SCAN_PROBE_GAP_MS) CHECK(r.next_probe(now, slots[i], a));  // .1 .2 .3
  r.probe_done(slots[2], true);  // .3 answers first
  CHECK_EQ(r.in_flight(), 0u);   // the others are dropped (the glue closes them)
  r.candidate_failed();
  CHECK(r.next_probe(now, slot, a));
  CHECK_EQ(a, ip(192, 168, 50, 1));
  r.probe_done(slot, false);
  now += MC_SCAN_PROBE_GAP_MS;
  CHECK(r.next_probe(now, slot, a));
  CHECK_EQ(a, ip(192, 168, 50, 2));
  r.probe_done(slot, false);
  now += MC_SCAN_PROBE_GAP_MS;
  CHECK(r.next_probe(now, slot, a));
  CHECK_EQ(a, ip(192, 168, 50, 4));  // .3 failed its hello: skipped this sweep
}

static void test_f642_full_sweep_cools_down_then_restarts() {
  McDiscovery d;
  d.set_last_good("ws://192.168.50.7:8766/ws");
  uint32_t t = 0;
  for (unsigned i = 0; i < MC_LAST_GOOD_DIALS; ++i) {
    CHECK(d.poll(t, false, OWN, MASK24) == McStep::DIAL_LAST_GOOD);
    t = fail_dial(d, McSource::LAST_GOOD, t);
  }
  CHECK(d.poll(t, false, OWN, MASK24) == McStep::BROWSE_MDNS);
  t += MC_MDNS_WINDOW_MS;
  unsigned slot = 0;
  uint32_t a = 0;
  while (d.poll(t, false, OWN, MASK24) == McStep::SCAN) {
    while (d.scan().next_probe(t, slot, a)) {}
    for (unsigned i = 0; i < MC_SCAN_POOL; ++i) if (d.scan().probe_timed_out(i, t)) d.scan().probe_done(i, false);
    t += 10;
  }
  CHECK(d.phase() == McPhase::COOLDOWN);
  const uint32_t cool = t;
  CHECK(d.poll(cool + MC_SCAN_COOLDOWN_MS - 1, false, OWN, MASK24) == McStep::BROWSE_MDNS);
  CHECK(d.phase() == McPhase::COOLDOWN);
  // The cycle starts again: the last good MC gets its dials back.
  CHECK(d.poll(cool + MC_SCAN_COOLDOWN_MS, false, OWN, MASK24) == McStep::DIAL_LAST_GOOD);
}

static void test_f642_typed_comes_back_once_a_minute() {
  McDiscovery d;
  uint32_t t = 0;
  for (int i = 0; i < 3; ++i) {
    CHECK(d.poll(t, true, OWN, MASK24) == McStep::DIAL_TYPED);
    t = fail_dial(d, McSource::TYPED, t);
  }
  CHECK(d.poll(t, true, OWN, MASK24) == McStep::BROWSE_MDNS);
  d.halt();  // e.g. the cooldown ended, or Wi-Fi blinked: the cycle restarts at the typed step
  CHECK(d.poll(t + 1000, true, OWN, MASK24) == McStep::BROWSE_MDNS);  // still inside the typed 60 s
  d.halt();
  CHECK(d.poll(t + 60000, true, OWN, MASK24) == McStep::DIAL_TYPED);
  d.new_url();
  CHECK(d.poll(t + 60001, true, OWN, MASK24) == McStep::DIAL_TYPED);
}

static void test_f642_halt_stops_the_scan() {
  McDiscovery d;
  CHECK(d.poll(0, false, OWN, MASK24) == McStep::BROWSE_MDNS);
  CHECK(d.poll(MC_MDNS_WINDOW_MS, false, OWN, MASK24) == McStep::SCAN);
  unsigned slot = 0;
  uint32_t a = 0;
  CHECK(d.scan().next_probe(MC_MDNS_WINDOW_MS, slot, a));
  d.halt();  // LINK OFF, a MUSTER drop, Wi-Fi lost
  CHECK(!d.scan().running());
  CHECK_EQ(d.scan().in_flight(), 0u);
  CHECK(!d.scan().next_probe(MC_MDNS_WINDOW_MS + 1000, slot, a));
  CHECK(d.phase() == McPhase::TYPED);
  // A dial in flight when dialling stops is forgotten, never counted against the typed URL.
  d.dial_started(McSource::TYPED, 5000);
  d.halt();
  CHECK(!d.dialling());
  CHECK(!d.dial_timed_out(5000 + MC_DIAL_TIMEOUT_MS));
}

int main() {
  test_f642_order_typed_last_good_mdns_scan();
  test_f642_no_typed_and_no_last_good_goes_straight_to_mdns();
  test_f642_last_good_only_private_ipv4_ws();
  test_f642_ok_welcome_picks_the_last_good_to_save();
  test_f642_typed_match_compares_the_address_not_the_text();
  test_f642_a_full_tried_list_never_skips_rolled_back_probes();
  test_f642_scan_waits_while_the_station_is_in_play();
  test_f642_scan_range_and_skips();
  test_f642_scan_respects_pool_and_rate_cap();
  test_f642_failed_candidate_resumes_at_the_next_address();
  test_f642_full_sweep_cools_down_then_restarts();
  test_f642_typed_comes_back_once_a_minute();
  test_f642_halt_stops_the_scan();
  return report("all checks passed");
}
