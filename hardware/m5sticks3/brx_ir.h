// brx_ir.h - the BRX 25-bit IR word: pulse durations <-> bits <-> fields.
//
// Pure C++17, header-only, no Arduino: the same code runs on the Stick and in
// test/test_core.cpp on the host. Protocol: protocol/brx-ir-protocol.md, decoded
// by LaserTagMods (JEDGE/JBOX, github.com/LaserTagMods) and bench-verified here
// 2026-08-26. Timings below are the measured Tactix values, not the source defaults.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace brx {

// Measured 2026-08-26 at ~1 m: sync 1988-1991, one 990-994, zero 489-512, space 489-512 us.
constexpr uint32_t SYNC_US = 1990;
constexpr uint32_t MARK_ONE_US = 992;
constexpr uint32_t MARK_ZERO_US = 500;
constexpr uint32_t SPACE_US = 500;
// A Sony SIRC header (2390 us) passes node1's ">1500" gate, so the sync is bounded both ways.
constexpr uint32_t SYNC_MIN_US = 1800;
constexpr uint32_t SYNC_MAX_US = 2200;
constexpr uint32_t MARK_THRESH_US = 750;  // longer = 1
constexpr uint32_t MARK_MIN_US = 200;     // shorter = glitch
constexpr int WORD_BITS = 25;

// Protocols the stock firmware occupies (the B field, $WEAP t3).
constexpr int PROTO_SHOT = 0;
constexpr int PROTO_BEACON = 15;
// Beacon magnitudes are MODE ids, not charge (bench 2026-09-10).
constexpr int BEACON_HILL = 8;
constexpr int BEACON_RESPAWN = 6;
constexpr int BEACON_CAPTURED = 50;      // new owner, ~50 ms after the capturing shot
constexpr int BEACON_WAS_NEUTRAL = 53;   // next cycle, only when the outgoing state was neutral
constexpr int BEACON_BOOT = 56;
constexpr int GRENADE_NEUTRAL_TEAM = 2;  // a neutral grenade says team 2

struct Word {
  int proto = 0;    // B  bits 0-3
  int player = 0;   // P  bits 4-9
  int team = 0;     // T  bits 10-11
  int mag = 0;      // D  bits 12-19 (damage, or the beacon MODE)
  int crit = 0;     // C  bit 20
  int subtype = 0;  // U  bits 21-22 ($SIR subtype)
};

struct Decoded {
  bool sync_ok = false;    // leading mark inside SYNC_MIN..SYNC_MAX
  std::string bits;        // every mark after the sync, as '0'/'1'
  bool complete = false;   // exactly 25 bits
  bool parity_ok = false;  // Z0 != Z1, the gun's own acceptance test
  bool payload_ok = false; // Z also matches the genuine odd/even rule: a payload bit flip fails it
  Word word;               // valid only when complete
};

// Odd number of 1s in the 23-bit payload -> "01", even -> "10". The gun only checks Z0 != Z1,
// but genuine frames carry this, so we emit it for fidelity (irbridge.py payload_parity).
inline std::string payload_parity(const std::string& payload) {
  int ones = 0;
  for (size_t i = 0; i < payload.size() && i < 23; i++) ones += (payload[i] == '1');
  return (ones % 2) ? "01" : "10";
}

inline void put_bits(std::string& s, int v, int n) {
  for (int i = n - 1; i >= 0; i--) s += ((v >> i) & 1) ? '1' : '0';
}

inline int get_bits(const std::string& s, int lo, int hi) {
  int v = 0;
  for (int i = lo; i < hi && i < (int)s.size(); i++) v = (v << 1) | (s[i] == '1');
  return v;
}

inline std::string encode(const Word& w) {
  std::string s;
  put_bits(s, w.proto, 4);
  put_bits(s, w.player, 6);
  put_bits(s, w.team, 2);
  put_bits(s, w.mag, 8);
  put_bits(s, w.crit, 1);
  put_bits(s, w.subtype, 2);
  return s + payload_parity(s);
}

inline Word fields(const std::string& bits) {
  Word w;
  w.proto = get_bits(bits, 0, 4);
  w.player = get_bits(bits, 4, 10);
  w.team = get_bits(bits, 10, 12);
  w.mag = get_bits(bits, 12, 20);
  w.crit = get_bits(bits, 20, 21);
  w.subtype = get_bits(bits, 21, 23);
  return w;
}

// The alternating mark/space list a receiver sees, starting with the sync mark. No trailer:
// after the last bit the carrier stays off, which is what a decoder's end check wants.
inline std::vector<uint32_t> to_pulses(const std::string& bits) {
  std::vector<uint32_t> p;
  p.push_back(SYNC_US);
  p.push_back(SPACE_US);
  for (char c : bits) {
    p.push_back(c == '1' ? MARK_ONE_US : MARK_ZERO_US);
    p.push_back(SPACE_US);
  }
  return p;
}

// Glitch repair. `in` alternates polarity by index (even = mark, odd = space). A segment shorter
// than MARK_MIN_US is a fragment, and fragments come in runs between two real segments:
//  - real neighbours of the SAME polarity (an odd run): the run is one segment of the opposite
//    polarity with blips inside. Keep it as such when its own-polarity content reaches MARK_MIN_US
//    (a 500 us space chopped into 120/190/190 is still a 500 us space); otherwise it was all noise
//    and the two neighbours are one segment (a 992 us mark split 500/190/302 is one 992 us mark).
//  - real neighbours of DIFFERENT polarity (an even run): each fragment joins the neighbour whose
//    polarity it shares (a mark split 60/190/742 is a 190 us blip in the space and an 802 us mark).
// Folding by whole runs is what keeps index parity intact; folding one fragment at a time reads a
// space as a bit and produces a complete, parity-valid, WRONG word. Leading noise before the sync
// is skipped by starting at the first mark-polarity segment inside the sync window.
inline std::vector<uint32_t> fold_glitches(const std::vector<uint32_t>& in) {
  std::vector<uint32_t> out;
  size_t n = in.size(), i = 0;
  for (size_t k = 0; k < n; k += 2) {
    if (in[k] >= SYNC_MIN_US && in[k] <= SYNC_MAX_US) { i = k; break; }
  }
  while (i < n) {
    if (in[i] >= MARK_MIN_US) { out.push_back(in[i]); i++; continue; }
    size_t j = i;
    uint32_t same = 0, other = 0;  // polarity relative to out.back(); in[i] is always the opposite
    while (j < n && in[j] < MARK_MIN_US) { (((j - i) & 1) ? same : other) += in[j]; j++; }
    if (out.empty()) { i = j; continue; }
    if (j >= n) { out.back() += same + other; break; }  // trailing fragments: nothing follows
    if ((j - i) & 1) {
      if (other >= MARK_MIN_US) { out.push_back(same + other); i = j; }
      else { out.back() += same + other + in[j]; i = j + 1; }
    } else {
      out.back() += same;
      out.push_back(in[j] + other);
      i = j + 1;
    }
  }
  return out;
}

// `durations` alternate mark, space, mark, ... beginning with the first mark, exactly what
// ir_capture.ino prints in its RAW line. A receiver's active-low output makes a mark a LOW.
inline Decoded decode(const std::vector<uint32_t>& raw) {
  Decoded d;
  std::vector<uint32_t> durations = fold_glitches(raw);
  if (durations.empty()) return d;
  uint32_t sync = durations[0];
  d.sync_ok = sync >= SYNC_MIN_US && sync <= SYNC_MAX_US;
  if (!d.sync_ok) return d;
  for (size_t i = 2; i < durations.size(); i += 2) {  // marks sit at even indexes after the sync
    uint32_t mark = durations[i];
    if (mark >= SYNC_MIN_US) continue;  // a stray long pulse is not a bit; parity of the index survives
    d.bits += (mark > MARK_THRESH_US) ? '1' : '0';
  }
  // Exactly 25, not "at least": an inserted segment (a dropout splitting a mark, two blips that
  // survive folding) yields 26 or 27 bits whose first 25 pass BOTH parity tests with wrong fields.
  // Rejecting such a frame costs one repeat of a word that repeats anyway.
  d.complete = (int)d.bits.size() == WORD_BITS;
  if (d.complete) {
    d.parity_ok = d.bits[23] != d.bits[24];
    d.payload_ok = d.bits.substr(23, 2) == payload_parity(d.bits);
    d.word = fields(d.bits);
  }
  return d;
}

}  // namespace brx
