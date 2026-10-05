// Late-start quirks (review 2026-10-05). A late start (go-live with no countdown, so no T-3 pre-arm) sends the
// divergence poll before the deferred `$SPAWN` burst reaches the gun.
//  (b) The unspawned gun answers the poll `$HP,0,0,0`. B5 holds that zero, and the `$QUERY`'s `$LCD` that follows
//      reports the full pools. The previous pools must follow that `$LCD`, else the spawn read-back's `$HP,45,70,0`
//      reads as a GAIN: a phantom "armour up" line (`VA1G`) and a +70 HUD float.
// Driven through the golden-trace runner, so the fake gun answers exactly as it does for the traces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEngine } from './golden-trace-runner.mjs';

const ARMOUR_UP = '$PLAY,,4,6,VA1G,,,,*';

async function lateStart(countdown) {
  const trace = { name: 'late-start', setup: { delay: 'timers', countdown_s: countdown, gun: { life: true }, fields: ['moment'] },
    steps: [{ advance_ms: 10 }, { advance_ms: 3000 + countdown * 1000 }, { check: 'live' }, { advance_ms: 3000 }, { check: 'later' }] };
  return runEngine(trace);
}

for (const countdown of [0, 3]) {
  test(`quirk (b): a start with a ${countdown} s countdown plays no armour-up line and shows no gain`, async () => {
    const r = await lateStart(countdown);
    const writes = r.checkpoints.flatMap(c => c.writes);
    if (countdown === 0) assert.ok(r.logs.some(l => l.includes('(late)')), 'setup: a late start carries the table in its burst');
    assert.ok(!writes.includes(ARMOUR_UP), `no armour-up line: ${JSON.stringify(writes.filter(w => w.startsWith('$PLAY')))}`);
    for (const c of r.checkpoints) assert.notEqual(c.state.moment && c.state.moment.kind, 'gain', `no gain moment at ${c.at}`);
  });
}
