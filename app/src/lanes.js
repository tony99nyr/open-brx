// docs/announcer.md "The three lanes" (F351/F352, Tony 2026-09-24): the HUD's alert timings, one owner for the engine
// (which decides when a spree ends) and the HUD (which draws and fades each lane).
export const LANE_HERO_MS = 2500;    // the HERO (my kill, my newest medal) stays this long after the last kill
export const LANE_FEED_MS = 4000;    // a FEED row (a down, a pickup, any other alert) lives this long
export const LANE_SETTLE_MS = 4000;  // an OBJECTIVE badge (the lead, the hill) dims after this; it stays until the next one of its key
