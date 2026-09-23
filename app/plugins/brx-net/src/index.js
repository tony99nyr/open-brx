import { registerPlugin } from '@capacitor/core';

const BrxNet = registerPlugin('BrxNet');

/** Match the Android plugin's decision for a WebSocket URL.
 * @param {string} url
 * @returns {boolean} */
export function isLanWsUrl(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ''); }
  catch (_) { return false; }
  if (host.endsWith('.local')) return true;
  const octets = host.split('.');
  if (octets.length === 4 && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    const [a, b] = octets.map(Number);
    return a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 169 && b === 254;
  }
  if (host.includes(':')) {
    const first = Number.parseInt(host.split(':')[0], 16);
    return Number.isFinite(first) && (first & 0xfe00) === 0xfc00 ||
      Number.isFinite(first) && (first & 0xffc0) === 0xfe80;
  }
  return false;
}

export { BrxNet };
