import type { StationKind } from '../api/types';
import { STATION_DEFAULT_THRESHOLD_DBM } from '../api/contract.gen';

/** H1: what threshold 0 resolves to, and where an edit begins: the generated STATION_DEFAULT_THRESHOLD_DBM for the
 *  station's platform and kind (types.py), the same table MC's `_wire_threshold`, the phone and the Stick read. */
export function bubbleDefault(kind: StationKind, stick: boolean): { label: string; start: number } {
  const start = STATION_DEFAULT_THRESHOLD_DBM[stick ? 'sticks3' : 'phone'][kind];
  return stick ? { label: "DEFAULT (the Stick's own)", start } : { label: `DEFAULT (${start}, phone)`, start };
}
