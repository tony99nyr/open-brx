// F574: preload for a vite that must resolve `localhost` the way a GitHub runner does. The runner's /etc/hosts maps
// localhost to ::1 as well as 127.0.0.1, and Node's happy-eyeballs connect tries ::1 first; many dev boxes map it to
// 127.0.0.1 only, where a test of the proxy target can never see the collision. Only the all-addresses lookup a
// connect makes is changed: a listen keeps the box's own answer.
import dns from 'node:dns';

const lookup = dns.lookup;
dns.lookup = function (hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  const opts = typeof options === 'number' ? { family: options } : (options ?? {});
  if (hostname === 'localhost' && opts.all && !opts.family) {
    process.nextTick(callback, null, [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }]);
    return {};
  }
  return lookup.call(this, hostname, options, callback);
};
