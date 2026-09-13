// THE PRE-ARM CHECK — one place to look before the whistle (2026-09-13).
//
// Tony: "we need to have a validation on arm though to ensure everything is armed and configured in
// sync and correctly."
//
// Why it is new: LOAD split one event into two. Before it, "the game is loaded" and "the guns are
// configured" happened together at the push; now a phone can hold the current game while its gun has
// never been given weapons at all, and the second half only happens at the LOBBY push. So the operator
// needs to see BOTH halves, per player, and be told which one is missing for whom.
//
// What it is NOT: a second implementation of the gates. The stale ack, the echo mismatch, the pool
// fault and the one-team refusal all live on the server and are rendered by the readiness board and
// `derive.pushGate`. This reads `state.sync` — the server's own four facts per player — and adds no
// judgement of its own.
//
// THE RULE THIS SCREEN IS BUILT AROUND: no check may read as satisfied because nothing was checked.
// Every count names its denominator, and a zero-of-zero is never green — that is the `ALL GUNS ON
// THIS CONFIG (0/8)` defect of this same day, which came from rendering a vacuously-true predicate
// (`all_acked()` skips every player with no node bound) as a claim about everybody.
import { useState } from 'react';
import { useStore } from '../store';
import { F, T } from '../tokens';
import { BTN_RESET } from './index';

/** ✓ / ✕ / — with the colour doing the same job the glyph does (never colour alone). */
function Cell({ ok, na, title }: { ok: boolean; na?: boolean; title: string }) {
  const glyph = na ? '—' : ok ? '✓' : '✕';
  const color = na ? T.micro : ok ? T.ok : T.bad;
  return <span title={title} style={{ font: F.chk(700, 13), color, minWidth: 18, textAlign: 'center' }}>{glyph}</span>;
}

function Count({ label, n, of, good }: { label: string; n: number; of: number; good: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, font: F.chk(700, 12), letterSpacing: '.1em',
                   color: of === 0 ? T.micro : good ? T.ok : T.warn }}>
      <span style={{ font: F.mono(500, 11), letterSpacing: '.18em', color: T.dim }}>{label}</span>
      {/* the denominator is never dropped: "4" alone cannot be checked by eye, "4/8" can */}
      {n}/{of}
    </span>
  );
}

export function PreArmSummary({ style }: { style?: React.CSSProperties }) {
  const { state } = useStore();
  const [showAll, setShowAll] = useState(false);
  if (!state) return null;
  const sync = state.sync;
  // An older MC sends no `sync` block. Render NOTHING rather than a summary built from a guess: a
  // pre-arm check that invents its own answer is worse than no pre-arm check at all.
  if (!sync || !Array.isArray(sync.rows)) return null;

  const { rows, totals } = sync;
  const pushed = state.lobby.pushed;
  const problems = rows.filter(r => !r.gun_sent || !r.gun_acked || !r.phone_game);
  const shown = showAll ? rows : problems;
  const verdict = totals.in_sync
    ? 'IN SYNC — EVERY GUN HAS THIS CONFIG'
    : totals.rostered === 0
      ? 'NOBODY IS ROSTERED — NOTHING TO CHECK'
      : !pushed
        ? 'GUNS NOT CONFIGURED YET — PUSH CONFIG BELOW'
        : `${totals.rostered - totals.gun_acked} OF ${totals.rostered} GUNS HAVE NOT CONFIRMED THIS CONFIG`;

  return (
    <div data-testid="pre-arm-summary" style={{ border: `1px solid ${totals.in_sync ? T.line : T.warn}`,
      borderLeft: `3px solid ${totals.in_sync ? T.ok : T.warn}`, background: T.panelSoft, marginBottom: 12, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px 18px', flexWrap: 'wrap', padding: '10px 14px' }}>
        <span style={{ font: F.chk(700, 12), letterSpacing: '.2em', color: T.acc }}>PRE-ARM CHECK</span>
        <span role="status" data-testid="pre-arm-verdict"
          style={{ font: F.chk(700, 12), letterSpacing: '.08em', color: totals.in_sync ? T.ok : T.warn }}>
          {verdict}
        </span>
        <span style={{ flex: 1 }} />
        <span data-testid="pre-arm-counts" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <Count label="PHONES TOLD" n={totals.phone_game} of={totals.rostered} good={totals.rostered > 0 && totals.phone_game === totals.rostered} />
          <Count label="GUNS SENT" n={totals.gun_sent} of={totals.rostered} good={totals.rostered > 0 && totals.gun_sent === totals.rostered} />
          <Count label="ACKED" n={totals.gun_acked} of={totals.rostered} good={totals.rostered > 0 && totals.gun_acked === totals.rostered} />
          {/* ECHO is reported, never required: `not_echoed` is the ordinary answer on our v4.32
              firmware (A37), so a red here would refuse every whistle in the field. */}
          <Count label="ECHO" n={totals.gun_echo_proven} of={totals.rostered} good={totals.rostered > 0 && totals.gun_echo_proven === totals.rostered} />
        </span>
        {rows.length > 0 && (
          <button type="button" data-testid="pre-arm-toggle" className="hov-acc hit44" onClick={() => setShowAll(v => !v)}
            style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.14em', color: T.dim, border: `1px solid ${T.line}`, padding: '8px 12px', minHeight: 36, cursor: 'pointer' }}>
            {showAll ? 'ONLY PROBLEMS' : `ALL ${rows.length}`}
          </button>
        )}
      </div>

      {shown.length > 0 && (
        <div style={{ borderTop: `1px solid ${T.line}`, padding: '8px 14px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', font: F.mono(500, 11), letterSpacing: '.16em', color: T.micro }}>
            <span style={{ flex: '1 1 150px', minWidth: 0 }}>PLAYER</span>
            <span style={{ width: 92, textAlign: 'center' }}>PHONE</span>
            <span style={{ width: 92, textAlign: 'center' }}>GUN SENT</span>
            <span style={{ width: 92, textAlign: 'center' }}>ACKED</span>
            <span style={{ width: 92, textAlign: 'center' }}>ECHO</span>
            <span style={{ flex: '1 1 190px', minWidth: 0 }}>WHAT TO DO</span>
          </div>
          {shown.map(r => {
            // ONE instruction per row, the first thing that is actually wrong — an operator reading
            // four cures at once does none of them.
            const todo = !r.bound ? 'No phone bound — switch it on and bind it, or STAND DOWN'
              : !r.phone_game ? 'Phone was not reachable at LOAD — LOAD again from GAMES'
              : !r.gun_sent ? 'Gun has no head yet — PUSH CONFIG below'
              : !r.gun_acked ? 'Gun has not confirmed this config — RE-PUSH CONFIG below'
              : r.gun_echo === 'mismatch' ? 'Gun answered with another weapon — RE-PUSH CONFIG below'
              : '';
            return (
              <div key={r.player_id} data-testid="pre-arm-row" data-player={r.player_id}
                style={{ display: 'flex', gap: 12, alignItems: 'center', font: F.chk(600, 12), padding: '3px 0' }}>
                <span style={{ flex: '1 1 150px', minWidth: 0, overflowWrap: 'anywhere' }}>
                  <span style={{ color: T.micro, font: F.mono(500, 11) }}>#{r.player_num} </span>{r.display}
                  <span style={{ color: T.micro, font: F.mono(500, 11) }}> {r.gun_id}</span>
                </span>
                <span style={{ width: 92, textAlign: 'center' }}><Cell ok={r.phone_game} title="An `assign` for this config reached this phone's socket" /></span>
                <span style={{ width: 92, textAlign: 'center' }}><Cell ok={r.gun_sent} title="MC compiled and sent this config's frames for this player" /></span>
                <span style={{ width: 92, textAlign: 'center' }}><Cell ok={r.gun_acked} title="The gun answered for THIS config_id" /></span>
                <span style={{ width: 92, textAlign: 'center' }}>
                  {/* A37: only a MISMATCH is a fault here. `not_echoed` is the ordinary answer on our
                      v4.32 units, and `null` is the server saying the check DID NOT RUN at all
                      (nothing pushed, no ack for this config, no readable $WEAP in the head —
                      `state.py _echo_state`). Painting either of those red would state a failure
                      nobody established, which is the precise thing this panel exists to prevent —
                      and is what it did on its first run (caught on the koth screenshot, 2026-09-13). */}
                  <Cell ok={r.gun_echo === 'proven'} na={r.gun_echo !== 'proven' && r.gun_echo !== 'mismatch'}
                    title={r.gun_echo === 'proven' ? 'The gun echoed the pushed weapon'
                      : r.gun_echo === 'mismatch' ? 'The gun echoed a different weapon than the one pushed'
                      : r.gun_echo === 'not_echoed' ? 'No echo — the ordinary answer on v4.32 firmware, and never a fault'
                      : 'Not checked yet — nothing pushed, or no ack for this config'} />
                </span>
                <span style={{ flex: '1 1 190px', minWidth: 0, font: F.chk(500, 11.5), color: todo ? T.warn : T.micro, textTransform: 'none' }}>{todo || 'Ready'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
