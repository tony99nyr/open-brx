// Shared assertion macros for the Stick host tests. Each test file includes this header once, so the
// static counter is its own per translation unit.
#pragma once
#include <cstdio>

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
    auto _a = (a);                                                                 \
    auto _b = (b);                                                                 \
    if (!(_a == _b)) {                                                             \
      std::printf("FAIL %s:%d  %s == %s\n", __FILE__, __LINE__, #a, #b);           \
      failures++;                                                                  \
    }                                                                              \
  } while (0)

// The usual end of main(): print the summary and return the exit code. `pass_msg` is the line a green run prints.
inline int report(const char* pass_msg) {
  if (failures) {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("%s\n", pass_msg);
  return 0;
}
