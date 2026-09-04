// brx-beacon — the one native capability the utility role needs that the central-only BLE plugin
// lacks: ADVERTISE. Identity rides in a 128-bit service UUID (app/src/beacon.js encodes it), because
// that is the only advert field iOS lets an app set besides the local name. Android additionally
// exposes transmit power, which is the radius knob (docs/spec/utility.md §3).
import { registerPlugin } from '@capacitor/core';

const BrxBeacon = registerPlugin('BrxBeacon', {
  web: () => Promise.resolve(new BrxBeaconWeb()),
});

/** Desktop-browser stand-in: nothing can advertise from a web page. Every call succeeds and says so. */
class BrxBeaconWeb {
  async isSupported() { return { advertising: false, txPowerControl: false, platform: 'web' }; }
  async start() { return { ok: false, advertising: false, reason: 'web' }; }
  async stop() { return { ok: true }; }
  async status() { return { advertising: false }; }
}

export { BrxBeacon };
