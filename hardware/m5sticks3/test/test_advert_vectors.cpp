// The Stick's advert codec (brx_advert.h) against the vectors it shares with the phone (app/src/beacon.js) and MC
// (mcp/brx_mcp/beacon.py): app/test/fixtures/advert-vectors.json. app/test/beacon-vectors.test.mjs and
// mcp/tests/test_advert_vectors.py read the same file. Build + run:
//   g++ -std=c++17 -I.. test_advert_vectors.cpp -o /tmp/test_advert_vectors [&& /tmp/test_advert_vectors [fixture.json]]
// With no argument the fixture is found from this file's own path (__FILE__).
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include "brx_advert.h"
#include "json_lite.h"
#include "presence.h"  // PLAYER_ALIVE

using namespace brx;
using json::Value;

static int failures = 0;
static int checks = 0;

static void check(bool ok, const std::string& what) {
  checks++;
  if (!ok) { std::printf("FAIL %s\n", what.c_str()); failures++; }
}

static long bit_value(const std::string& name) {
  if (name == "alive") return PLAYER_ALIVE;
  if (name == "planting") return contract::ADVERT_PLAYER_STATE_PLANTING;
  if (name == "defusing") return contract::ADVERT_PLAYER_STATE_DEFUSING;
  if (name == "extracting") return contract::ADVERT_PLAYER_STATE_EXTRACTING;
  if (name == "claiming") return PLAYER_CLAIMING;
  if (name == "claim_ready") return PLAYER_CLAIM_READY;
  if (name == "revived") return PLAYER_REVIVED;
  return -1;
}

static Advert from_case(const Value& c) {
  Advert a;
  a.role = (uint8_t)(c.get("role").as_string() == "player" ? ROLE_PLAYER : ROLE_STATION);
  a.id = (uint16_t)c.get("id").as_int();
  a.kind = (uint8_t)c.get("kind").as_int();
  a.team = (uint8_t)c.get("team").as_int();
  a.state = (uint8_t)c.get("state").as_int();
  a.value = (uint8_t)c.get("value").as_int();
  a.seq = (uint8_t)c.get("seq").as_int();
  a.game = (uint8_t)c.get("game").as_int();
  a.threshold = (int)c.get("threshold").as_int();
  a.taker = (uint8_t)c.get("taker").as_int();
  return a;
}

static bool same(const Advert& a, const Advert& b) {
  return a.role == b.role && a.id == b.id && a.kind == b.kind && a.team == b.team && a.state == b.state &&
         a.value == b.value && a.seq == b.seq && a.game == b.game && a.threshold == b.threshold && a.taker == b.taker;
}

int main(int argc, char** argv) {
  std::string here = __FILE__;
  here = here.substr(0, here.rfind('/') == std::string::npos ? 0 : here.rfind('/'));
  if (here.empty()) here = ".";
  std::string path = argc > 1 ? argv[1] : here + "/../../../app/test/fixtures/advert-vectors.json";
  std::ifstream f(path);
  if (!f) { std::printf("FAIL cannot open %s\n", path.c_str()); return 1; }
  std::stringstream ss;
  ss << f.rdbuf();
  bool ok = false;
  Value doc = json::parse(ss.str(), &ok);
  if (!ok || !doc.get("cases").is_array() || !doc.get("reject").is_array()) { std::printf("FAIL fixture does not parse\n"); return 1; }

  int bits_seen = 0;
  for (const Value& c : doc.get("cases").arr) {
    const std::string name = c.get("name").as_string();
    const std::string uuid = c.get("uuid").as_string();
    const Advert want = from_case(c);
    check(advert_uuid(want) == uuid, "encode: " + name);
    Advert got;
    check(decode_advert(uuid, got) && same(got, want), "decode: " + name);
    if (c.has("bit")) {
      bits_seen++;
      check(bit_value(c.get("bit").as_string()) == c.get("state").as_int(), "generated bit: " + name);
    }
  }
  check(bits_seen == 7, "one vector per PLAYER_STATE bit");
  for (const Value& v : doc.get("variants").arr) {
    bool stick = false;
    for (const Value& r : v.get("runners").arr) if (r.as_string() == "stick") stick = true;
    if (!stick) continue;
    const Value* target = nullptr;
    for (const Value& c : doc.get("cases").arr) if (c.get("name").as_string() == v.get("decodes_as").as_string()) target = &c;
    Advert got;
    check(target && decode_advert(v.get("uuid").as_string(), got) && same(got, from_case(*target)), "variant: " + v.get("name").as_string());
  }
  for (const Value& r : doc.get("reject").arr) {
    Advert got;
    check(!decode_advert(r.get("uuid").as_string(), got), "reject: " + r.get("name").as_string());
  }
  if (failures) { std::printf("%d of %d checks failed\n", failures, checks); return 1; }
  std::printf("all checks passed (%d)\n", checks);
  return 0;
}
