import type { StationKind } from '../api/types';
import { STATION_DEFAULT_THRESHOLD_DBM } from '../api/contract.gen';

/** H1: what threshold 0 resolves to: the generated STATION_DEFAULT_THRESHOLD_DBM for the station's platform and
 *  kind (types.py), the same table MC's `_wire_threshold`, the phone and the Stick read. */
export function defaultThreshold(kind: StationKind, stick: boolean): number {
  return STATION_DEFAULT_THRESHOLD_DBM[stick ? 'sticks3' : 'phone'][kind];
}
