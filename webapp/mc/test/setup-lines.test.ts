// Stick hills (2026-09-24): the server's reverse SETUP warning (a CONTROL station under a grenade or IR-station
// objective) names the grenade or an IR station in passing, so it must map to its own line and never read as
// that source's field step (`KNOWN_SETUP_LINES` is first-match).
import { describe, expect, it } from 'vitest';
import { friendlySetupLine } from '../src/ui/SetupSteps';

const reverse = (what: string) =>
  `SETUP: A CONTROL STATION IS ASSIGNED BUT THIS GAME'S OBJECTIVE IS ${what} — every phone ignores the station's hill; ` +
  'set OBJECTIVE SOURCE to PHONE (a StickS3 or phone station), or clear the CONTROL station in ITEMS';

describe('friendlySetupLine: the control-station lines', () => {
  it('maps the reverse warning, under either source, to its own line', () => {
    for (const what of ['THE GRENADE', 'AN IR STATION']) {
      const line = friendlySetupLine(reverse(what));
      expect(line).toMatch(/every phone ignores its hill/);
      expect(line).not.toMatch(/Place and power the IR station|Power-cycle the grenade/);
    }
  });
  it('maps the no-station and the station-point lines to station wording', () => {
    expect(friendlySetupLine("SETUP: NO CONTROL STATION IS ASSIGNED — this game's objective is a Bluetooth control point"))
      .toMatch(/^No control station is assigned/);
    expect(friendlySetupLine('SETUP: THE CONTROL POINT IS A BLUETOOTH STATION — a StickS3, or a phone'))
      .toMatch(/^The control point is a Bluetooth station/);
  });
});
