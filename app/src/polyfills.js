// Runtime-API polyfills for the esbuild `target` floor (scripts/build.mjs, chrome60). Esbuild lowers
// SYNTAX for us (optional chaining, nullish coalescing, logical assignment, ...); it cannot add a
// method a WebView's engine never shipped. These are the only ones this app's own code calls that
// landed after Chrome 60: `globalThis` (Chrome 71), `Object.fromEntries` (Chrome 73) and
// `Promise.prototype.finally` (Chrome 63). Import this FIRST in every entry point (src/app.js,
// src/utility.js), before anything that might call one of them.
if (typeof globalThis === 'undefined') {
  // eslint-disable-next-line no-undef -- `window` is the thing we're about to make reachable AS `globalThis`
  window.globalThis = window;
}

if (!Object.fromEntries) {
  Object.fromEntries = entries => {
    const obj = {};
    for (const [k, v] of entries) obj[k] = v;
    return obj;
  };
}

if (!Promise.prototype.finally) {
  Promise.prototype.finally = function (onFinally) {
    const run = () => Promise.resolve(typeof onFinally === 'function' ? onFinally() : onFinally);
    return this.then(
      value => run().then(() => value),
      reason => run().then(() => { throw reason; }),
    );
  };
}
