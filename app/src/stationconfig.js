// A4 (review 2026-10-10): the one parse rule for MC's `station_config`, shared with the Stick
// (hardware/m5sticks3/station_link.h parse_station_config) through app/test/fixtures/station-config-cases.json.
// PURE: no clock, no advert, no range edit. utility.js applyStationConfig applies the result in its own order.
import { POWERUP_STATION_ID_MAX, STATION_LOCK_MAX_S, STATION_TEAM_ANY } from './transport/contract.gen.js';

export const STATION_KINDS = Object.freeze(['respawn', 'powerup', 'extraction', 'bomb', 'control']);
export const STATION_ID_MAX = 65535;          // the advert carries the station id in two bytes
export const VALID_IDS_MAX = 32;              // a bound for the display and the Stick's saved copy, not an air limit

const isInt = v => typeof v === 'number' && Number.isSafeInteger(v);   // the Stick checks the same +-2^53 bound

/**
 * Parse a station_config body. A refusal changes nothing on the station: the caller keeps every setting and logs `refused`.
 * @param {unknown} body
 * @returns {{ok: false, refused: string} | {ok: true, kind: string, team: number, id: number, game: number,
 *   valid_ids: number[]|null, lock_s: number, item: object|null, threshold: unknown, threshold_age_ms: unknown,
 *   tx_power: unknown, tx_power_age_ms: unknown}}
 */
export function parseStationConfig(body) {
  const no = refused => ({ ok: /** @type {false} */ (false), refused });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return no('station_config is not an object');
  const b = /** @type {Record<string, any>} */ (body);
  if (!STATION_KINDS.includes(b.kind)) return no(`unknown station kind ${JSON.stringify(b.kind)}`);
  if (!isInt(b.team) || !((b.team >= 0 && b.team <= 3) || b.team === STATION_TEAM_ANY)) return no(`team ${JSON.stringify(b.team)} is not 0-3 or ${STATION_TEAM_ANY}`);
  if (!isInt(b.id) || b.id < 1 || b.id > STATION_ID_MAX) return no(`station id ${JSON.stringify(b.id)} is outside 1..${STATION_ID_MAX}`);
  // a claim names a powerup station in one advert byte (powerup.js), so a larger id would be claimed as another station
  if (b.kind === 'powerup' && b.id > POWERUP_STATION_ID_MAX) return no(`powerup station id ${b.id} is outside 1..${POWERUP_STATION_ID_MAX}`);
  const lock = typeof b.lock_s === 'number' && Number.isFinite(b.lock_s) ? Math.max(0, Math.min(STATION_LOCK_MAX_S, Math.trunc(b.lock_s))) : 0;
  return {
    ok: true, kind: b.kind, team: b.team, id: b.id,
    game: typeof b.game === 'number' && Number.isFinite(b.game) ? (((Math.trunc(b.game) % 256) + 256) % 256) : 0,   // one byte on air (the Stick's fmod); absent = any game
    valid_ids: Array.isArray(b.valid_ids) ? b.valid_ids.filter(v => isInt(v) && v >= 1 && v <= STATION_ID_MAX).slice(0, VALID_IDS_MAX) : null,   // station ids
    lock_s: lock,
    item: b.kind === 'powerup' && b.item && typeof b.item === 'object' && !Array.isArray(b.item) ? b.item : null,
    threshold: b.threshold, threshold_age_ms: b.threshold_age_ms, tx_power: b.tx_power, tx_power_age_ms: b.tx_power_age_ms,
  };
}
