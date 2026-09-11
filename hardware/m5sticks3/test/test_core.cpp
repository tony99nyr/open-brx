// Host tests for the Stick's pure core. Build + run:
//   g++ -std=c++17 -I.. test_core.cpp -o /tmp/test_core && /tmp/test_core
// mcp/tests/test_sticks3_core.py does exactly that when g++ exists.
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "brx_advert.h"
#include "brx_ir.h"
#include "control_point.h"

static int failures = 0;
#define CHECK(cond)                                                            \
  do {                                                                         \
    if (!(cond)) {                                                             \
      std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);              \
      failures++;                                                              \
    }                                                                          \
  } while (0)
#define CHECK_EQ(a, b)                                                                     \
  do {                                                                                     \
    auto _a = (a);                                                                         \
    auto _b = (b);                                                                         \
    if (!(_a == _b)) {                                                                     \
      std::printf("FAIL %s:%d  %s == %s\n", __FILE__, __LINE__, #a, #b);                   \
      failures++;                                                                          \
    }                                                                                      \
  } while (0)

using namespace brx;

// --- IR word ------------------------------------------------------------------------------

static std::string due_s(const char* r) { return r ? std::string(r) : std::string("(null)"); }

static void test_parity_rule() {
  // The four bench words from protocol/brx-ir-protocol.md: damage 22 (even ones) -> "10",
  // damage 9 (odd) -> "01", damage 0 (odd: proto 0, player 0, team 1 has one 1) -> "01".
  Word w;
  w.team = 1;
  w.mag = 22;
  CHECK_EQ(encode(w).substr(23), std::string("10"));
  w.mag = 9;
  CHECK_EQ(encode(w).substr(23), std::string("01"));
  w.mag = 0;
  CHECK_EQ(encode(w).substr(23), std::string("01"));
  w.proto = 10;
  w.mag = 115;
  CHECK_EQ(encode(w).substr(23), std::string("10"));
  CHECK_EQ(encode(w).size(), (size_t)25);
}

static void test_measured_shot_decodes() {
  // A Tactix shot as the bench recorded it: proto 0, player 0, team 1, damage 22, parity 10.
  // Durations use the measured extremes so the thresholds are exercised, not just the ideal.
  std::string bits = "0000000000010001011000010";
  std::vector<uint32_t> d;
  d.push_back(1988);
  d.push_back(489);
  for (char c : bits) {
    d.push_back(c == '1' ? 990 : 512);
    d.push_back(505);
  }
  Decoded r = decode(d);
  CHECK(r.sync_ok);
  CHECK(r.complete);
  CHECK(r.parity_ok);
  CHECK_EQ(r.bits, bits);
  CHECK_EQ(r.word.proto, 0);
  CHECK_EQ(r.word.player, 0);
  CHECK_EQ(r.word.team, 1);
  CHECK_EQ(r.word.mag, 22);
  CHECK_EQ(r.word.crit, 0);
}

static void test_round_trip_all_fields() {
  Word w;
  w.proto = 15;
  w.player = 42;
  w.team = 2;
  w.mag = 200;
  w.crit = 1;
  w.subtype = 3;
  std::string bits = encode(w);
  Decoded r = decode(to_pulses(bits));
  CHECK(r.complete && r.parity_ok && r.sync_ok);
  CHECK_EQ(r.word.proto, 15);
  CHECK_EQ(r.word.player, 42);
  CHECK_EQ(r.word.team, 2);
  CHECK_EQ(r.word.mag, 200);
  CHECK_EQ(r.word.crit, 1);
  CHECK_EQ(r.word.subtype, 3);
  CHECK_EQ(to_pulses(bits).size(), (size_t)52);  // sync pair + 25 bit pairs
}

static void test_sync_gate_rejects_sirc_and_missing_sync() {
  std::vector<uint32_t> sirc = {2390, 600, 1200, 600, 600, 600};
  CHECK(!decode(sirc).sync_ok);
  std::vector<uint32_t> nosync = {992, 500, 500, 500};
  CHECK(!decode(nosync).sync_ok);
  CHECK(!decode({}).sync_ok);
}

static void test_timings_are_the_measured_ones() {
  // Literals, not the constants: a round trip through shared constants would pass with any value.
  CHECK_EQ(SYNC_US, 1990u);
  CHECK_EQ(MARK_ONE_US, 992u);
  CHECK_EQ(MARK_ZERO_US, 500u);
  CHECK_EQ(SPACE_US, 500u);
  CHECK_EQ(SYNC_MIN_US, 1800u);
  CHECK_EQ(SYNC_MAX_US, 2200u);
  CHECK_EQ(MARK_THRESH_US, 750u);
}

static void test_glitch_and_short_frames() {
  Word w;
  w.proto = 0; w.player = 5; w.team = 1; w.mag = 22;
  std::string bits = encode(w);
  // One 50 us blip splitting a ONE mark (992 -> 500, 50, 442): the same word must come back.
  auto d = to_pulses(bits);
  size_t one_at = 2 + 2 * bits.find('1');
  CHECK_EQ(d[one_at], MARK_ONE_US);
  d[one_at] = 500;
  d.insert(d.begin() + one_at + 1, {50u, 442u});
  Decoded r = decode(d);
  CHECK(r.complete);
  CHECK_EQ(r.bits, bits);
  // One blip splitting a SPACE (500 -> 200, 50, 250): alignment must survive too.
  auto e = to_pulses(bits);
  e[3] = 200;
  e.insert(e.begin() + 4, {50u, 250u});
  Decoded q = decode(e);
  CHECK(q.complete);
  CHECK_EQ(q.bits, bits);
  // A 26th pulse makes the frame INCOMPLETE, never a word: a mark split by a >= 200 us dropout
  // shifts every field yet the first 25 bits can pass both parity tests. Exactly 25 or nothing.
  auto t = to_pulses(bits);
  t.push_back(500);
  t.push_back(500);
  Decoded u = decode(t);
  CHECK(!u.complete);
  auto split = to_pulses(bits);
  split[one_at] = 400;
  split.insert(split.begin() + one_at + 1, {300u, 292u});  // a 300 us dropout inside a 992 us mark
  Decoded v = decode(split);
  CHECK(!v.complete);
  CHECK_EQ(v.bits.size(), (size_t)26);
  // A list that starts with a space (the receiver caught the tail of something) is not a frame.
  auto sp = to_pulses(bits);
  sp.insert(sp.begin(), 500u);
  CHECK(!decode(sp).sync_ok);
  auto shortd = to_pulses(bits.substr(0, 20));
  Decoded s = decode(shortd);
  CHECK(s.sync_ok);
  CHECK(!s.complete);
  CHECK(!s.parity_ok);
}

// Every single-blip placement inside one mark or one space, exhaustively. A blip must either fold
// back to the exact word or leave the frame visibly broken; it must NEVER yield a complete,
// Z0 != Z1 word that says something else (that is a shot credited to the wrong player).
static void test_every_single_blip_placement_is_safe() {
  Word w;
  w.proto = 0; w.player = 5; w.team = 1; w.mag = 22;
  std::string bits = encode(w);
  const auto base = to_pulses(bits);
  size_t one_at = 2 + 2 * bits.find('1'), zero_at = 2 + 2 * bits.find('0'), space_at = 3;
  CHECK_EQ(base[one_at], MARK_ONE_US);
  CHECK_EQ(base[zero_at], MARK_ZERO_US);
  size_t wrong = 0, exact = 0, total = 0;
  for (size_t at : {one_at, zero_at, space_at}) {
    uint32_t D = base[at];
    for (uint32_t b = 1; b < MARK_MIN_US; b++) {
      for (uint32_t a = 1; a + b < D; a++) {
        uint32_t c = D - a - b;
        auto d = base;
        d[at] = a;
        d.insert(d.begin() + at + 1, {b, c});
        Decoded r = decode(d);
        total++;
        if (r.complete && r.parity_ok && r.bits != bits) wrong++;
        if (r.complete && r.bits == bits) exact++;
      }
    }
  }
  CHECK(total > 10000);  // the sweep really ran
  CHECK_EQ(wrong, 0u);
  CHECK_EQ(exact, total);  // and in fact every placement folds back to the word
  // The two placements that broke a fragment-at-a-time fold, spelled out.
  auto d = base; d[one_at] = 60; d.insert(d.begin() + one_at + 1, {190u, 742u});
  CHECK_EQ(decode(d).bits, bits);
  auto e = base; e[space_at] = 120; e.insert(e.begin() + space_at + 1, {190u, 190u});
  CHECK_EQ(decode(e).bits, bits);
  // Noise before the sync is skipped, not fatal.
  auto f = base; f.insert(f.begin(), {50u, 300u});
  CHECK(decode(f).sync_ok);
  CHECK_EQ(decode(f).bits, bits);
}

static void test_genuine_parity_catches_a_payload_flip() {
  Word w;
  w.proto = 0; w.player = 5; w.team = 1; w.mag = 22;
  std::string bits = encode(w);
  Decoded ok = decode(to_pulses(bits));
  CHECK(ok.parity_ok);
  CHECK(ok.payload_ok);
  bits[12] = bits[12] == '1' ? '0' : '1';  // top bit of the magnitude
  Decoded flipped = decode(to_pulses(bits));
  CHECK(flipped.complete);
  CHECK(flipped.parity_ok);   // the gun would still accept it (Z0 != Z1 is all it checks)
  CHECK(!flipped.payload_ok); // we can tell, and the station gates ownership on this
  CHECK_EQ(flipped.word.mag, 150);
}

static void test_withdrawn_advert_republishes_as_first_with_seq_intact() {
  AdvertPolicy p;
  AdvertView v{0, CONTROL_HELD, 0, true};
  CHECK_EQ(due_s(p.due(v, 0)), std::string("first"));
  uint8_t s1 = p.published(v, 0);
  CHECK(p.due(v, 10) == nullptr);
  p.have_last = false;  // what the sketch does when a BRIDGE goes stale and withdraws the advert
  CHECK_EQ(due_s(p.due(v, 20)), std::string("first"));
  uint8_t s2 = p.published(v, 20);
  CHECK_EQ((uint8_t)(s2 - s1), 1);  // seq keeps counting across a withdrawal; a scanner never sees it go back
  p.seq = 255;
  CHECK_EQ(p.published(v, 30), 0);  // and wraps at 8 bits like beacon.js (seq & 0xff)
}

static void test_equal_parity_pair_is_invalid() {
  std::string bits = encode(Word{});
  bits[23] = '1';
  bits[24] = '1';
  Decoded r = decode(to_pulses(bits));
  CHECK(r.complete);
  CHECK(!r.parity_ok);
}

// --- Advert ---------------------------------------------------------------------------------

static void test_advert_matches_beacon_js() {
  // Pinned from `node -e "import('./app/src/beacon.js').then(m=>console.log(m.encodeUuid(...)))"`.
  Advert a;
  a.id = 1;
  a.kind = KIND_CONTROL;
  a.team = 0;
  a.state = 1;
  a.value = 40;
  a.seq = 3;
  a.game = 7;
  a.threshold = -74;
  CHECK_EQ(advert_uuid(a), std::string("4f425258-0101-0001-0500-01280307b600"));

  Advert n;
  n.id = 1;
  n.kind = KIND_CONTROL;
  CHECK_EQ(advert_uuid(n), std::string("4f425258-0101-0001-05ff-000000000000"));

  Advert big;
  big.id = 300;
  big.kind = KIND_CONTROL;
  big.team = 3;
  big.state = 5;
  big.value = 255;
  big.seq = 255;
  big.game = 200;
  big.threshold = -128;
  CHECK_EQ(advert_uuid(big), std::string("4f425258-0101-012c-0503-05ffffc88000"));
}

static void test_advert_policy_mirrors_control_js() {
  AdvertPolicy p;
  AdvertView v{TEAM_ANY, 0, 0};
  CHECK_EQ(due_s(p.due(v, 0)), std::string("first"));
  CHECK_EQ(p.published(v, 0), 1);
  CHECK(p.due(v, 10) == nullptr);
  AdvertView owned{1, CONTROL_HELD, 0};
  CHECK_EQ(due_s(p.due(owned, 10)), std::string("state"));
  p.published(owned, 10);
  AdvertView progress{1, CONTROL_HELD, 50};
  CHECK(p.due(progress, 500) == nullptr);  // value-only changes wait out the interval
  CHECK_EQ(due_s(p.due(progress, 1010)), std::string("progress"));
  p.seq = 255;
  CHECK_EQ(p.published(progress, 1010), 0);  // seq wraps at a byte like the JS `& 0xff`
}

// --- Control point --------------------------------------------------------------------------

static Word beacon(int team, int mag) {
  Word w;
  w.proto = PROTO_BEACON;
  w.team = team;
  w.mag = mag;
  return w;
}
static Word shot(int team, int mag) {
  Word w;
  w.proto = PROTO_SHOT;
  w.player = 5;
  w.team = team;
  w.mag = mag;
  return w;
}

static void test_bridge_mirrors_the_grenade() {
  ControlPoint cp;
  cp.mode = Mode::BRIDGE;
  CHECK_EQ(cp.view(0).team, TEAM_ANY);
  CHECK_EQ(cp.view(0).state, 0);
  CHECK(!cp.on_word(beacon(2, BEACON_HILL), 1000));  // neutral grenade: team 2 stays neutral
  CHECK_EQ(cp.owner, TEAM_ANY);
  CHECK(cp.on_word(beacon(0, BEACON_HILL), 6000));  // red captured it
  CHECK_EQ(cp.owner, 0);
  CHECK_EQ(cp.view(6000).state & CONTROL_HELD, CONTROL_HELD);
  CHECK(!cp.on_word(beacon(0, BEACON_HILL), 11000));  // same owner again: no change
  CHECK(!cp.on_word(beacon(1, BEACON_RESPAWN), 11500));  // a respawn word never sets ownership
  CHECK(!cp.on_word(beacon(1, BEACON_BOOT), 11500));
  CHECK(!cp.on_word(beacon(1, BEACON_WAS_NEUTRAL), 11500));
  CHECK_EQ(cp.owner, 0);
  CHECK(!cp.on_word(shot(1, 22), 11600));  // shots are the grenade's business in BRIDGE mode
  CHECK_EQ(cp.owner, 0);
  // Capture word: its team bits are the new owner, acted on at once; the beacon 5 s later confirms.
  CHECK(cp.on_word(beacon(1, BEACON_CAPTURED), 12000));
  CHECK_EQ(cp.owner, 1);
  CHECK_EQ(cp.view(12100).state & CONTROL_RISING, CONTROL_RISING);
  CHECK(cp.view(12100).active);
  CHECK(!cp.on_word(beacon(1, BEACON_HILL), 16000));  // the confirming beacon changes nothing
  CHECK_EQ(cp.owner, 1);
  CHECK_EQ(cp.captures, 2u);
  // Back to neutral after a power cycle of the grenade.
  CHECK(cp.on_word(beacon(2, BEACON_HILL), 21000));
  CHECK_EQ(cp.owner, TEAM_ANY);
}

static void test_bridge_goes_stale_after_two_missed_beacons() {
  ControlPoint cp;
  cp.mode = Mode::BRIDGE;
  CHECK(!cp.view(0).active);  // nothing heard yet: nothing to say
  cp.on_word(beacon(3, BEACON_HILL), 1000);
  CHECK(cp.view(1000 + BRIDGE_STALE_MS).active);
  CHECK(!cp.view(1000 + BRIDGE_STALE_MS + 1).active);  // stale: the advert is withdrawn, not faked
  CHECK_EQ(cp.view(1000 + BRIDGE_STALE_MS + 1).team, 3);  // the screen still knows the last owner
  cp.on_word(beacon(3, BEACON_HILL), 30000);
  CHECK(cp.view(30000).active);
  CHECK_EQ(cp.view(30000).state & CONTROL_HELD, CONTROL_HELD);
  // A live NEUTRAL grenade is active and neutral; a dead one is inactive. The two never look alike.
  cp.on_word(beacon(2, BEACON_HILL), 35000);
  CHECK(cp.view(35000).active);
  CHECK_EQ(cp.view(35000).team, TEAM_ANY);
  CHECK(!cp.view(35000 + BRIDGE_STALE_MS + 1).active);
  // The clock wrapping past zero does not resurrect or kill anything.
  ControlPoint wrap;
  wrap.mode = Mode::BRIDGE;
  wrap.on_word(beacon(0, BEACON_HILL), 0xFFFFF000u);
  CHECK(wrap.view(0x00000100u).active);
  wrap.on_word(beacon(1, BEACON_CAPTURED), 0xFFFFFF00u);
  CHECK_EQ(wrap.view(0x00000100u).state & CONTROL_RISING, CONTROL_RISING);
  CHECK_EQ(wrap.view(0x00001000u).state & CONTROL_RISING, 0);
}

static void test_hill_attacker_wins_ties() {
  ControlPoint cp;
  cp.mode = Mode::HILL;
  CHECK_EQ(cp.beacon_word().team, GRENADE_NEUTRAL_TEAM);
  CHECK_EQ(cp.beacon_word().mag, BEACON_HILL);
  CHECK_EQ(cp.beacon_word().proto, PROTO_BEACON);
  // 1 AR round (9) took a neutral hill.
  CHECK(cp.on_word(shot(0, 9), 100));
  CHECK_EQ(cp.owner, 0);
  CHECK_EQ(cp.charge[0], 9u);
  CHECK_EQ(cp.beacon_word().team, 0);
  // Blue needs to reach 9: 22 does it in one, and the winner holds what it took to win.
  CHECK(cp.on_word(shot(1, 22), 200));
  CHECK_EQ(cp.owner, 1);
  CHECK_EQ(cp.charge[1], 22u);
  CHECK_EQ(cp.charge[0], 0u);
  // Red at 9 + 9 = 18 < 22: no flip; 9 more = 27 >= 22: flip, and red now holds 27, not 9.
  CHECK(!cp.on_word(shot(0, 9), 300));
  CHECK(!cp.on_word(shot(0, 9), 310));
  CHECK_EQ(cp.owner, 1);
  CHECK(cp.on_word(shot(0, 9), 320));
  CHECK_EQ(cp.owner, 0);
  CHECK_EQ(cp.charge[0], 27u);
  // So blue cannot ping-pong it back with one round: 22 < 27, a second 22 does it.
  CHECK(!cp.on_word(shot(1, 22), 330));
  CHECK(cp.on_word(shot(1, 22), 340));
  CHECK_EQ(cp.charge[1], 44u);
  CHECK_EQ(cp.captures, 4u);
  cp.reset();
  CHECK_EQ(cp.captures, 0u);
  cp.on_word(shot(2, 45), 400);
  CHECK(!cp.on_word(shot(3, 44), 410));
  CHECK(cp.on_word(shot(3, 1), 420));  // 45 == 45: the attacker wins the tie
  CHECK_EQ(cp.owner, 3);
  CHECK_EQ(cp.view(420).state & CONTROL_RISING, CONTROL_RISING);
  CHECK_EQ(cp.view(420 + RISING_HOLD_MS).state & CONTROL_RISING, 0);
  // The holder's own shots add charge but never change ownership; progress is its share.
  CHECK(!cp.on_word(shot(3, 55), 500));
  CHECK_EQ(cp.charge[3], 100u);
  CHECK_EQ(cp.view(500).value, 100);
  cp.on_word(shot(0, 50), 600);
  CHECK_EQ(cp.view(600).value, 66);
  // Beacons and non-shot protocols are ignored in HILL mode.
  CHECK(!cp.on_word(beacon(1, BEACON_HILL), 700));
  CHECK_EQ(cp.owner, 3);
}

int main() {
  test_parity_rule();
  test_measured_shot_decodes();
  test_round_trip_all_fields();
  test_sync_gate_rejects_sirc_and_missing_sync();
  test_timings_are_the_measured_ones();
  test_glitch_and_short_frames();
  test_every_single_blip_placement_is_safe();
  test_genuine_parity_catches_a_payload_flip();
  test_withdrawn_advert_republishes_as_first_with_seq_intact();
  test_equal_parity_pair_is_invalid();
  test_advert_matches_beacon_js();
  test_advert_policy_mirrors_control_js();
  test_bridge_mirrors_the_grenade();
  test_bridge_goes_stale_after_two_missed_beacons();
  test_hill_attacker_wins_ties();
  if (failures) {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("sticks3 core: all checks passed\n");
  return 0;
}
