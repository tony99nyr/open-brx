// mc_discovery.h - F642: how a Stick finds Mission Control with no USB step (docs/spec/utility.md §5g.3).
//
// Pure C++17, no Arduino: the glue (mc_link_glue.h) owns the sockets and passes `now_ms`, IPs and netmasks
// as plain integers. One cycle, while the link is LOOKING_FOR_MC and dialling is allowed:
//   1. the typed URL (TypedMcFallback: three failed dials, then once a minute),
//   2. the last LAN MC that welcomed this Stick (a private IPv4 ws:// URL only), MC_LAST_GOOD_DIALS dials,
//   3. mDNS for MC_MDNS_WINDOW_MS,
//   4. a TCP-connect scan of the Stick's own /24 for port 8766 (sends nothing; a host that accepts is dialled),
//   5. a cooldown (mDNS only), then back to 1.
// A dial counts only when MC's welcome says ok. Every dial has a deadline: the WebSocket library fires no
// event for a refused TCP connect, so a stale address otherwise held the link at CONNECTING for ever.
#pragma once
#include <cstdint>
#include <cstdio>
#include <string>

#include "station_persistence.h"  // TypedMcFallback, saved_mc_url_usable

namespace brx {

constexpr uint32_t MC_DIAL_TIMEOUT_MS = 8000;       // a dial with no ok welcome by then has failed
constexpr unsigned MC_LAST_GOOD_DIALS = 2;          // per cycle
constexpr uint32_t MC_MDNS_WINDOW_MS = 20000;       // per cycle
constexpr uint32_t MC_SCAN_COOLDOWN_MS = 30000;     // after a sweep that found no MC (mDNS still browses)
constexpr uint16_t MC_SCAN_PORT = 8766;             // MC's node WebSocket port (the phone's MC_WS_PORT)
constexpr unsigned MC_SCAN_POOL = 4;                // probes in flight at once
constexpr uint32_t MC_SCAN_PROBE_TIMEOUT_MS = 600;  // per probe
constexpr uint32_t MC_SCAN_PROBE_GAP_MS = 50;       // between probe starts: at most 20 a second
constexpr unsigned MC_SCAN_TRIED_MAX = 8;           // candidates that failed the hello, skipped this sweep

// ---- IPv4 helpers (host order: a.b.c.d == a<<24 | b<<16 | c<<8 | d) -----------------------------
inline bool private_ipv4(uint32_t ip) {
  return (ip & 0xFF000000u) == 0x0A000000u ||  // 10/8
         (ip & 0xFFF00000u) == 0xAC100000u ||  // 172.16/12
         (ip & 0xFFFF0000u) == 0xC0A80000u;    // 192.168/16
}

// A strict dotted quad: four 1-3 digit octets, each at most 255. A hostname is refused.
inline bool parse_ipv4(const std::string& s, uint32_t& out) {
  uint32_t ip = 0;
  size_t pos = 0;
  for (int part = 0; part < 4; ++part) {
    if (part > 0) {
      if (pos >= s.size() || s[pos] != '.') return false;
      ++pos;
    }
    size_t digits = 0;
    unsigned v = 0;
    while (pos < s.size() && s[pos] >= '0' && s[pos] <= '9' && digits < 4) {
      v = v * 10 + (unsigned)(s[pos] - '0');
      ++pos;
      ++digits;
    }
    if (digits == 0 || digits > 3 || v > 255) return false;
    ip = (ip << 8) | v;
  }
  if (pos != s.size()) return false;
  out = ip;
  return true;
}

inline std::string ipv4_string(uint32_t ip) {
  char b[16];
  snprintf(b, sizeof b, "%u.%u.%u.%u", (unsigned)(ip >> 24), (unsigned)((ip >> 16) & 0xFF),
           (unsigned)((ip >> 8) & 0xFF), (unsigned)(ip & 0xFF));
  return b;
}

inline std::string mc_ws_url(const std::string& host, unsigned port, const std::string& path) {
  return "ws://" + host + ":" + std::to_string(port) + path;
}

// The last good MC may only be a plain ws:// URL to a literal private IPv4. A wss:// or a hostname (a tunnel
// host is random per start, §5g.3) is never cached.
inline bool last_good_mc_url_ok(const std::string& url) {
  if (!saved_mc_url_usable(url)) return false;  // also refuses anything but ws://
  const size_t colon = url.find(':', 5);
  uint32_t ip = 0;
  return parse_ipv4(url.substr(5, colon - 5), ip) && private_ipv4(ip);
}

// Whether a welcomed address should be written as the last good MC: never the typed URL, never a rewrite.
inline bool should_save_last_good(const std::string& url, const std::string& typed, const std::string& current) {
  return last_good_mc_url_ok(url) && url != typed && url != current;
}

// The addresses the scan probes: the /24 that holds `ip`, or the netmask's own range when it is narrower.
// Network and broadcast are excluded. False when there is nothing to scan (a /31 or /32).
inline bool mc_scan_range(uint32_t ip, uint32_t mask, uint32_t& first, uint32_t& last) {
  const uint32_t eff = mask | 0xFFFFFF00u;
  const uint32_t net = ip & eff;
  const uint32_t bcast = net | ~eff;
  if (bcast - net < 2) return false;
  first = net + 1;
  last = bcast - 1;
  return true;
}

// ---- the subnet scan -----------------------------------------------------------------------------
// Ascending order. The glue opens one socket per slot and reports each probe's end with probe_done().
class McScan {
 public:
  struct Slot {
    bool active = false;
    uint32_t ip = 0;
    uint32_t started_ms = 0;
  };

  // False when the Stick's own address is not private or its range is empty: no scan.
  bool begin(uint32_t own_ip, uint32_t mask) {
    stop();
    if (!private_ipv4(own_ip) || !mc_scan_range(own_ip, mask, first_, last_)) return false;
    own_ = own_ip;
    cursor_ = first_;
    running_ = true;
    return true;
  }
  void stop() {
    running_ = false;
    has_candidate_ = false;
    tried_n_ = 0;
    any_started_ = false;
    for (auto& s : slots_) s = Slot();
  }
  bool running() const { return running_; }
  // Every address probed, none in flight, no candidate waiting on its dial.
  bool finished() const { return running_ && cursor_ > last_ && in_flight() == 0 && !has_candidate_; }
  unsigned in_flight() const {
    unsigned n = 0;
    for (const auto& s : slots_) n += s.active ? 1 : 0;
    return n;
  }
  const Slot& slot(unsigned i) const { return slots_[i]; }
  uint32_t first() const { return first_; }
  uint32_t last() const { return last_; }

  // True when a new probe may start now; fills its slot and address. Never more than MC_SCAN_POOL in flight,
  // never two starts closer than MC_SCAN_PROBE_GAP_MS, never while a candidate is being dialled.
  bool next_probe(uint32_t now, unsigned& slot, uint32_t& ip) {
    if (!running_ || has_candidate_) return false;
    if (any_started_ && (uint32_t)(now - last_start_ms_) < MC_SCAN_PROBE_GAP_MS) return false;
    unsigned free_slot = MC_SCAN_POOL;
    for (unsigned i = 0; i < MC_SCAN_POOL; ++i) {
      if (!slots_[i].active) { free_slot = i; break; }
    }
    if (free_slot == MC_SCAN_POOL) return false;
    while (cursor_ <= last_ && (cursor_ == own_ || tried(cursor_))) ++cursor_;
    if (cursor_ > last_) return false;
    slots_[free_slot] = Slot{true, cursor_, now};
    ip = cursor_++;
    slot = free_slot;
    any_started_ = true;
    last_start_ms_ = now;
    return true;
  }
  bool probe_timed_out(unsigned slot, uint32_t now) const {
    return slot < MC_SCAN_POOL && slots_[slot].active &&
           (uint32_t)(now - slots_[slot].started_ms) >= MC_SCAN_PROBE_TIMEOUT_MS;
  }
  // `open`: the host accepted the TCP connect. The scan pauses on it and the glue closes every other probe;
  // those are probed again after the candidate's dial, so the cursor goes back to the lowest of them.
  void probe_done(unsigned slot, bool open) {
    if (slot >= MC_SCAN_POOL || !slots_[slot].active) return;
    const uint32_t ip = slots_[slot].ip;
    slots_[slot] = Slot();
    if (!open || has_candidate_) return;
    has_candidate_ = true;
    candidate_ = ip;
    for (auto& s : slots_) {
      if (s.active && s.ip < cursor_) cursor_ = s.ip;
      s = Slot();
    }
  }
  bool candidate(uint32_t& ip) const {
    if (!has_candidate_) return false;
    ip = candidate_;
    return true;
  }
  // The candidate's dial failed (no ok welcome): skip it for the rest of this sweep and go on.
  void candidate_failed() {
    if (!has_candidate_) return;
    has_candidate_ = false;
    if (tried_n_ < MC_SCAN_TRIED_MAX) tried_[tried_n_++] = candidate_;
    else if (cursor_ <= candidate_) cursor_ = candidate_ + 1;  // the list is full: never re-probe it
  }

 private:
  bool tried(uint32_t ip) const {
    for (unsigned i = 0; i < tried_n_; ++i) if (tried_[i] == ip) return true;
    return false;
  }
  bool running_ = false;
  uint32_t first_ = 0, last_ = 0, own_ = 0, cursor_ = 0;
  Slot slots_[MC_SCAN_POOL];
  bool any_started_ = false;
  uint32_t last_start_ms_ = 0;
  bool has_candidate_ = false;
  uint32_t candidate_ = 0;
  uint32_t tried_[MC_SCAN_TRIED_MAX] = {0};
  unsigned tried_n_ = 0;
};

// ---- the cycle -----------------------------------------------------------------------------------
enum class McSource : uint8_t { NONE, TYPED, LAST_GOOD, MDNS, SCAN };
enum class McPhase : uint8_t { TYPED, LAST_GOOD, MDNS, SCAN, COOLDOWN };
enum class McStep : uint8_t { WAIT, DIAL_TYPED, DIAL_LAST_GOOD, BROWSE_MDNS, SCAN };

inline const char* mc_source_name(McSource s) {
  switch (s) {
    case McSource::TYPED: return "typed";
    case McSource::LAST_GOOD: return "last-good";
    case McSource::MDNS: return "mdns";
    case McSource::SCAN: return "scan";
    default: return "none";
  }
}

class McDiscovery {
 public:
  TypedMcFallback& typed() { return typed_; }
  McScan& scan() { return scan_; }
  McPhase phase() const { return phase_; }
  bool dialling() const { return dialling_; }
  McSource dial_source() const { return source_; }

  // The saved last good MC (NVS `mc_last`); anything but a private IPv4 ws:// URL is ignored.
  void set_last_good(const std::string& url) { last_good_ = last_good_mc_url_ok(url) ? url : std::string(); }
  const std::string& last_good() const { return last_good_; }

  // Call while LOOKING_FOR_MC with dialling allowed. WAIT while a dial is in flight.
  McStep poll(uint32_t now, bool typed_usable, uint32_t own_ip, uint32_t mask) {
    if (dialling_) return McStep::WAIT;
    for (int guard = 0; guard < 8; ++guard) {
      switch (phase_) {
        case McPhase::TYPED:
          if (typed_usable && typed_.prefer_typed(now)) return McStep::DIAL_TYPED;
          enter(McPhase::LAST_GOOD, now);
          break;
        case McPhase::LAST_GOOD:
          if (!last_good_.empty() && last_good_dials_ < MC_LAST_GOOD_DIALS) return McStep::DIAL_LAST_GOOD;
          enter(McPhase::MDNS, now);
          break;
        case McPhase::MDNS:
          if ((uint32_t)(now - phase_since_) < MC_MDNS_WINDOW_MS) return McStep::BROWSE_MDNS;
          enter(McPhase::SCAN, now);
          if (!scan_.begin(own_ip, mask)) enter(McPhase::COOLDOWN, now);
          break;
        case McPhase::SCAN:
          if (!scan_.finished()) return McStep::SCAN;
          scan_.stop();
          enter(McPhase::COOLDOWN, now);
          break;
        case McPhase::COOLDOWN:
          if ((uint32_t)(now - phase_since_) < MC_SCAN_COOLDOWN_MS) return McStep::BROWSE_MDNS;
          enter(McPhase::TYPED, now);
          break;
      }
    }
    return McStep::WAIT;
  }

  void dial_started(McSource src, uint32_t now) {
    dialling_ = true;
    source_ = src;
    dial_since_ = now;
    typed_.dial_started(src == McSource::TYPED);
    if (src == McSource::LAST_GOOD) ++last_good_dials_;
  }
  bool dial_timed_out(uint32_t now) const {
    return dialling_ && (uint32_t)(now - dial_since_) >= MC_DIAL_TIMEOUT_MS;
  }
  // A closed socket or a passed deadline. Safe to call twice (the deadline, then the socket's own event).
  void dial_failed(uint32_t now) {
    if (!dialling_) return;
    dialling_ = false;
    typed_.dial_failed(now);
    if (source_ == McSource::SCAN) scan_.candidate_failed();
  }
  // MC's welcome said ok: the next drop starts a fresh cycle.
  void welcomed() {
    typed_.dial_succeeded();
    dialling_ = false;
    scan_.stop();
    phase_ = McPhase::TYPED;
    last_good_dials_ = 0;
  }
  // Dialling is not allowed (Wi-Fi down, LINK OFF, a MUSTER drop): forget the scan and start over later.
  void halt() {
    dialling_ = false;
    scan_.stop();
    phase_ = McPhase::TYPED;
    last_good_dials_ = 0;
  }
  // `MC <url>`: the typed address leads again.
  void new_url() {
    typed_.new_url();
    halt();
  }

 private:
  void enter(McPhase p, uint32_t now) {
    phase_ = p;
    phase_since_ = now;
    if (p == McPhase::TYPED) last_good_dials_ = 0;
  }
  TypedMcFallback typed_;
  McScan scan_;
  McPhase phase_ = McPhase::TYPED;
  uint32_t phase_since_ = 0;
  unsigned last_good_dials_ = 0;
  std::string last_good_;
  bool dialling_ = false;
  McSource source_ = McSource::NONE;
  uint32_t dial_since_ = 0;
};

}  // namespace brx
