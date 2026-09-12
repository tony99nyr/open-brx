// Build identity — contracts A29. `APP_VER` is baked at BUILD time by scripts/build.mjs
// (esbuild `--define:__APP_VER__`), so a phone reports the tree it was cut from:
//   "<package.json version>+<git short sha>[-dirty]"   e.g. "0.1.8+28c9e76-dirty"
// It used to be a hard-coded 'hud-0.2', so MC could not tell APK 0.1.8 from today's build
// (game test 2026-09-11). Imported by the transport, which puts it on `hello` AND every `status`.
//
// The `typeof` guard is what makes this file work in three places at once: bundled (esbuild has
// replaced the identifier with a string literal), run straight from source under `node --test`
// (the identifier is undeclared, and `typeof` on an undeclared name is legal), and in a www/ bundle
// built by an older script that never defined it.
export const APP_VER = (typeof __APP_VER__ !== 'undefined' && __APP_VER__) || '0.0.0+unbuilt';

/** `android` | `ios` | `web` (contracts A29 `hello.platform`). Capacitor injects the bridge into the
 *  native webview, so its own platform API is the only reliable answer; a desktop browser and the
 *  rig both read `web`. Deliberately NOT a user-agent sniff: Chrome on a phone is not the app, and a
 *  mislabelled node sends MC hunting for an APK that was never installed. Called per frame, so it
 *  stays a cheap property read rather than a cached boot-time value (the bridge appears late). */
export function platformName() {
  try {
    const cap = globalThis.Capacitor;
    if (cap && typeof cap.getPlatform === 'function') {
      const p = cap.getPlatform();
      if (p === 'android' || p === 'ios' || p === 'web') return p;
      if (p) return String(p);
    }
  } catch (_) { /* no bridge */ }
  return 'web';
}
