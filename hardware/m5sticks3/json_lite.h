// json_lite.h - a tiny, tolerant JSON reader for the wire bodies this Stick has to understand
// (welcome, station_config, station_update, control), plus hand-written string builders for the
// bodies it sends (hello, status). Not a general-purpose JSON library: no \uXXXX decoding, no
// number-format edge cases beyond what our own messages ever use, and a malformed document sets
// `ok=false` rather than throwing -- a station must keep its loop() running on a garbled frame
// from Mission Control, not crash on it. Pure C++17, header-only, no Arduino, no ArduinoJson.
//
// Why hand-rolled rather than ArduinoJson (docs/spec/utility.md §5g, contracts.md §5): the whole
// point of station_link.h is that it is host-testable with plain g++, and a JSON library pulled
// into the pure core would end that. Keeping one JSON path (this file) for both directions --
// sent AND received -- also means there is only one thing to keep honest against the wire
// contract, not two.
#pragma once
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <string>
#include <vector>

namespace brx {
namespace json {

struct Value {
  enum class Type { Null, Bool, Number, String, Array, Object } type = Type::Null;
  bool b = false;
  double num = 0;
  std::string str;
  std::vector<Value> arr;
  std::map<std::string, Value> obj;

  bool is_null() const { return type == Type::Null; }
  bool is_object() const { return type == Type::Object; }
  bool is_array() const { return type == Type::Array; }

  bool as_bool(bool def = false) const { return type == Type::Bool ? b : def; }
  long as_int(long def = 0) const { return type == Type::Number ? (long)num : def; }
  long long as_int64(long long def = 0) const { return type == Type::Number ? (long long)num : def; }
  std::string as_string(const std::string& def = "") const { return type == Type::String ? str : def; }

  // Object member lookup. A missing key or a non-object value both answer Null, so a caller can
  // chain `.get("item").get("weapon_id").as_string()` with no existence checks of its own -- the
  // A56 `item` field is additive, and an MC that never sends it must not need special-casing here.
  const Value& get(const std::string& key) const {
    static const Value null_value;
    if (type != Type::Object) return null_value;
    auto it = obj.find(key);
    return it == obj.end() ? null_value : it->second;
  }
  bool has(const std::string& key) const { return type == Type::Object && obj.count(key) > 0; }
};

class Parser {
 public:
  explicit Parser(const std::string& s) : s_(s), n_(s.size()) {}

  Value parse(bool* ok = nullptr) {
    skip_ws();
    Value v = parse_value();
    skip_ws();
    if (ok) *ok = !failed_;
    return v;
  }

 private:
  const std::string& s_;
  size_t n_;
  size_t i_ = 0;
  bool failed_ = false;

  char peek() const { return i_ < n_ ? s_[i_] : '\0'; }
  char get() { return i_ < n_ ? s_[i_++] : '\0'; }
  void skip_ws() {
    while (i_ < n_ && (s_[i_] == ' ' || s_[i_] == '\t' || s_[i_] == '\n' || s_[i_] == '\r')) i_++;
  }
  void fail() { failed_ = true; }

  bool consume(char c) {
    skip_ws();
    if (failed_ || peek() != c) { fail(); return false; }
    i_++;
    return true;
  }

  Value parse_value() {
    skip_ws();
    if (failed_) return Value();
    char c = peek();
    if (c == '{') return parse_object();
    if (c == '[') return parse_array();
    if (c == '"') return parse_string_value();
    if (c == 't' || c == 'f') return parse_bool();
    if (c == 'n') return parse_null();
    if (c == '-' || isdigit((unsigned char)c)) return parse_number();
    fail();
    return Value();
  }

  Value parse_object() {
    Value v;
    v.type = Value::Type::Object;
    if (!consume('{')) return v;
    skip_ws();
    if (peek() == '}') { i_++; return v; }
    while (!failed_) {
      skip_ws();
      if (peek() != '"') { fail(); return v; }
      std::string key = parse_raw_string();
      if (!consume(':')) return v;
      Value val = parse_value();
      if (failed_) return v;
      v.obj[key] = val;
      skip_ws();
      char c = get();
      if (c == '}') break;
      if (c != ',') { fail(); break; }
    }
    return v;
  }

  Value parse_array() {
    Value v;
    v.type = Value::Type::Array;
    if (!consume('[')) return v;
    skip_ws();
    if (peek() == ']') { i_++; return v; }
    while (!failed_) {
      Value val = parse_value();
      if (failed_) return v;
      v.arr.push_back(val);
      skip_ws();
      char c = get();
      if (c == ']') break;
      if (c != ',') { fail(); break; }
    }
    return v;
  }

  std::string parse_raw_string() {
    std::string out;
    if (get() != '"') { fail(); return out; }
    while (true) {
      if (i_ >= n_) { fail(); return out; }
      char c = get();
      if (c == '"') break;
      if (c == '\\') {
        if (i_ >= n_) { fail(); return out; }
        char e = get();
        switch (e) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'n': out += '\n'; break;
          case 't': out += '\t'; break;
          case 'r': out += '\r'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'u': i_ += 4; out += '?'; break;  // not decoded: no field we read ever needs it
          default: fail(); return out;
        }
      } else {
        out += c;
      }
    }
    return out;
  }

  Value parse_string_value() {
    Value v;
    v.type = Value::Type::String;
    v.str = parse_raw_string();
    return v;
  }

  Value parse_bool() {
    Value v;
    v.type = Value::Type::Bool;
    if (s_.compare(i_, 4, "true") == 0) { v.b = true; i_ += 4; }
    else if (s_.compare(i_, 5, "false") == 0) { v.b = false; i_ += 5; }
    else fail();
    return v;
  }

  Value parse_null() {
    Value v;
    if (s_.compare(i_, 4, "null") == 0) i_ += 4;
    else fail();
    return v;
  }

  Value parse_number() {
    size_t start = i_;
    if (peek() == '-') i_++;
    while (isdigit((unsigned char)peek())) i_++;
    if (peek() == '.') { i_++; while (isdigit((unsigned char)peek())) i_++; }
    if (peek() == 'e' || peek() == 'E') {
      i_++;
      if (peek() == '+' || peek() == '-') i_++;
      while (isdigit((unsigned char)peek())) i_++;
    }
    if (i_ == start) { fail(); return Value(); }
    Value v;
    v.type = Value::Type::Number;
    v.num = strtod(s_.substr(start, i_ - start).c_str(), nullptr);
    return v;
  }
};

inline Value parse(const std::string& s, bool* ok = nullptr) {
  Parser p(s);
  return p.parse(ok);
}

// ---- writer helpers ----
inline std::string escape(const std::string& s) {
  std::string out;
  out.reserve(s.size() + 2);
  for (char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if ((unsigned char)c < 0x20) {
          char buf[8];
          snprintf(buf, sizeof buf, "\\u%04x", c);
          out += buf;
        } else {
          out += c;
        }
    }
  }
  return out;
}

inline std::string quote(const std::string& s) { return "\"" + escape(s) + "\""; }

}  // namespace json
}  // namespace brx
