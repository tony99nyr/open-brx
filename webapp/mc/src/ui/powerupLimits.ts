// S-powerup-overrides (2026-09-28): ARMORY's own per-station override ranges for a powerup item's
// CHARGES, AMOUNT and RESPAWN (spawn_every_s). Mirrored exactly -- bounds AND step -- by
// `mcp/brx_mcp/mc/powerups.py` (`CHARGES_MIN`/`MAX`, `AMOUNT_MIN`/`MAX`/`STEP`, `SPAWN_EVERY_MIN`/`MAX`/`STEP`),
// which is the server's own real check; these are Tony's own picks, not a protocol limit (see the note on
// `StationItem` in `mcp/brx_mcp/mc/types.py`). A leaf module with no imports of its own, so both the mock
// (`mock/backend.ts`) and the console (`ui/powerupData.ts`, `screens/Items.tsx`) can import it with no risk
// of the `backend.ts` <-> `store.tsx` cycle a `powerupData.ts` import would create.
export const CHARGES_MIN = 1;
export const CHARGES_MAX = 4;
export const AMOUNT_MIN = 25;
export const AMOUNT_MAX = 150;
export const AMOUNT_STEP = 25;
export const SPAWN_EVERY_MIN = 30;
export const SPAWN_EVERY_MAX = 300;
export const SPAWN_EVERY_STEP = 30;
