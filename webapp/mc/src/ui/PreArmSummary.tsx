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
//
// THE GLOSSARY, because the two axes were drifting onto one word (int-n1, 2026-09-13) — and keeping
// them apart in the operator's head is the whole reason this panel exists:
//   SENT               the PHONE axis: a game announcement reached a phone's socket (`LoadedGame`).
//   PUSHED             the GUN axis: MC compiled this config's head and wrote it for that tagger. It
//                      is what the PUSH CONFIG control does, and it is NOT a claim the gun took it.
//   ACKED / CONFIRMED  the gun itself answered for THIS `config_id`. The only proof of the two.
// The wire fields keep their own names (`phone_game`, `gun_sent`, `gun_acked`); these are the words
// on screen. Do not re-diverge them.
import { useState } from 'react';
import type { State } from '../api/types';
import { useStore } from '../store';
import { F, T } from '../tokens';
import { BTN_RESET, useNarrow } from './index';

/** What the operator is ACTUALLY about to do when they force the whistle past the server's gate
 *  (`state.py _refuse_unconfigured_gun`) — read off the server's own `sync` block, never guessed.
 *
 *  THE FIELD FAILURE THIS EXISTS FOR (2026-09-12): a gun that never took THIS config is not inert.
 *  It is still holding whatever head it last received, so at T-0 it arms and plays the PREVIOUS
 *  game's team id and weapons — a live player on the wrong side with the wrong loadout, and nothing
 *  on the board saying so. The console printed the exact opposite on the very button that does it
 *  ("Nodes still blocked will not arm; everyone else starts on time"), which is worse than silence:
 *  ARM itself is already disabled in every state this gate can trip, so the override IS the only
 *  reachable path past it, and the server's carefully worded refusal — which names every player it
 *  is about — never reached the screen at all.
 *
 *  THREE GROUPS, kept apart because they are different facts with different cures. That is this
 *  file's own rule read in its other direction: an UNKNOWN must no more be reported as a failure
 *  than an unchecked box may be reported as a pass.
 *    `holding`      `!gun_sent` — MC never sent this config's head for that gun. CERTAIN: the gun is
 *                   still on the head it last took.
 *    `unconfirmed`  pushed, but the gun has not answered for this `config_id`. UNKNOWN — it may well
 *                   have taken the head and said nothing (a silent gun is a RE-PUSH, not a verdict).
 *    `lateJoin`     the subset of `holding` with no phone bound at all. These are the ones `force` is
 *                   legitimately FOR, and why the gate is forceable at all: `_bind` pushes the bundle
 *                   and the running `start`, so a phone that arrives late hot-joins with the right
 *                   head on its own. The operator needs this half to make the judgement, not just
 *                   the risk — the point is to inform the call, never to take it away.
 *
 *  Returns null ONLY when the server sent no `sync` block. The caller must then say it CANNOT TELL —
 *  never that there is nothing to tell. */
export function armAnywayRisk(sync: State['sync']): { holding: string[]; unconfirmed: string[]; lateJoin: string[] } | null {
  if (!sync || !Array.isArray(sync.rows)) return null;
  return {
    holding: sync.rows.filter(r => !r.gun_sent).map(r => r.display),
    unconfirmed: sync.rows.filter(r => r.gun_sent && !r.gun_acked).map(r => r.display),
    lateJoin: sync.rows.filter(r => !r.gun_sent && !r.bound).map(r => r.display),
  };
}

export interface ArmOverrideCopy {
  /** the button's own words — the risk has to survive being read at a glance, on the control itself */
  label: string;
  /** the whole reasoning, for the operator who stops to hover */
  title: string;
  /** what goes ON SCREEN above the button: shouted statement, quiet instruction (the console's fault
   *  shape). A tooltip is not where a field-safety fact belongs — on the tablet this runs on there is
   *  no hover at all. */
  warn: { head: string; hint: string }[];
}

/** Up to `cap` names on the control itself; the rest are counted, and the title carries the full
 *  list. A label that grows without bound stops being read, but a bare count cannot be acted on. */
const nameList = (names: string[], cap = 3) =>
  names.length <= cap ? names.join(', ') : `${names.slice(0, cap).join(', ')} +${names.length - cap} more`;

const guns = (k: number) => `${k} gun${k === 1 ? '' : 's'}`;

/** The HOST OVERRIDE's label, tooltip and on-screen warning, from one reading of `sync` — so the
 *  button and the panel above it can never tell the operator two different stories. */
export function armOverrideCopy(sync: State['sync']): ArmOverrideCopy {
  const FORCED = "Arms the countdown anyway, past the server's own refusal.";
  const risk = armAnywayRisk(sync);
  // An older MC sends no `sync` block. It must not be told everything is fine, and it must not be
  // told something is wrong either: what is true is that NOTHING WAS CHECKED — on the one control
  // where that matters most.
  if (!risk) {
    return {
      label: 'Arm anyway',
      title: `${FORCED} This server sends no pre-arm check, so MC CANNOT TELL YOU which guns are on this config. `
        + 'A gun that never took it is not inert — it arms on the head it is still holding and plays that '
        + "game's team and weapons. Restart MC to get the check back.",
      warn: [{ head: 'MC CANNOT CHECK THE GUNS ON THIS SERVER',
               hint: 'Nothing here has confirmed that any gun is on this config — this MC predates the pre-arm '
                 + 'check. Restart it before trusting the board.' }],
    };
  }
  const { holding, unconfirmed, lateJoin } = risk;
  const n = holding.length, u = unconfirmed.length;
  const label = n > 0
    ? `Arm anyway — ${guns(n)} will play the head ${n === 1 ? 'it is' : 'they are'} still holding: ${nameList(holding)}`
    : u > 0
      ? `Arm anyway — ${guns(u)} ${u === 1 ? 'has' : 'have'} not confirmed this config: ${nameList(unconfirmed)}`
      : 'Arm anyway';
  // The forceable half, and it is a FACT about these players, not a reassurance: a phone that binds
  // later hot-joins with the right head. Named only for the rows it is actually true of.
  const late = lateJoin.length
    ? ` ${lateJoin.length} of them (${lateJoin.join(', ')}) have no phone bound: if that phone binds, it hot-joins `
      + 'with the right head on its own, which is the case this override is for.'
    : '';
  const title = [
    FORCED,
    n > 0 ? `${guns(n)} have never been sent this config: ${holding.join(', ')}. A gun with no new head is NOT `
      + "inert — it arms on the head it is still holding and plays the previous game's team and weapons (the "
      + '2026-09-12 field failure). PUSH CONFIG, or stand them down, before the whistle.' + late : '',
    u > 0 ? `${guns(u)} were pushed this config but have not answered for it: ${unconfirmed.join(', ')} — whether `
      + 'they took it is unknown, not proven wrong. RE-PUSH CONFIG to find out.' : '',
    n === 0 && u === 0 ? 'Every rostered gun has taken and confirmed this config, so a blocked row here is a phone '
      + 'or link problem, not a wrong head.' : '',
  ].filter(Boolean).join(' ');
  const warn: ArmOverrideCopy['warn'] = [];
  if (n > 0) {
    warn.push({
      head: `${n} GUN${n === 1 ? '' : 'S'} ${n === 1 ? 'HAS' : 'HAVE'} NEVER TAKEN THIS CONFIG: ${holding.join(', ')}`,
      hint: `Not inert: ${n === 1 ? 'it arms' : 'each arms'} on the head it is still holding, so it plays the `
        + "previous game's team and weapons. PUSH CONFIG, or stand them down, before the whistle." + late,
    });
  }
  if (u > 0) {
    warn.push({
      head: `${u} GUN${u === 1 ? '' : 'S'} ${u === 1 ? 'HAS' : 'HAVE'} NOT CONFIRMED THIS CONFIG: ${unconfirmed.join(', ')}`,
      hint: 'MC pushed a head and the gun has not answered for it, so whether it took it is unknown. RE-PUSH '
        + 'CONFIG to find out.',
    });
  }
  return { label, title, warn };
}

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
  // F-7's watched viewport. Four fixed 92 px columns leave almost nothing for the instruction at
  // 393 px, and "Phone was not reachable at LOAD — LOAD again from GAMES" wrapped to seven lines of
  // one or two words (int-n1, from the phone-width screenshots): the single line the operator needs
  // fastest, rendered slowest to read. Under 480 px it gets a full-width row of its own.
  const narrow = useNarrow();
  if (!state) return null;
  const sync = state.sync;
  // An older MC sends no `sync` block. Render NOTHING rather than a summary built from a guess: a
  // pre-arm check that invents its own answer is worse than no pre-arm check at all.
  if (!sync || !Array.isArray(sync.rows)) return null;

  const { rows, totals } = sync;
  const pushed = state.lobby.pushed;
  const problems = rows.filter(r => !r.gun_sent || !r.gun_acked || !r.phone_game);
  const shown = showAll ? rows : problems;
  // THE GREEN IS DERIVED FROM WHAT IS ON SCREEN, not from one server field. `totals.in_sync` answers
  // the GUN question ONLY (`state.py sync_summary`: gun_sent and gun_acked), so this panel could —
  // and did — render "IN SYNC — EVERY GUN HAS THIS CONFIG" in green, with a green border, directly
  // above a row whose PHONE cell was a red ✕. Both halves are the whole reason the panel exists;
  // LOAD is what split them. A verdict reading all-clear over a row the panel is itself listing as
  // broken is the `(0/8)` false reassurance wearing a different hat.
  //
  // So green needs all three: the server's gun verdict, the phone column, and NO rendered row
  // failing. `problems.length` is the load-bearing term — whatever the totals say, this panel cannot
  // call itself clear while it is naming somebody. (`in_sync` itself is left alone on the server: it
  // is an honest answer to the GUN question, which is what its other callers ask it.)
  const phonesTold = totals.rostered > 0 && totals.phone_game === totals.rostered;
  const allClear = totals.in_sync && phonesTold && problems.length === 0;
  const verdict = allClear
    ? 'IN SYNC — EVERY GUN HAS THIS CONFIG, EVERY PHONE HAS THIS GAME'
    : totals.rostered === 0
      ? 'NOBODY IS ROSTERED — NOTHING TO CHECK'
      : !totals.in_sync
        ? (!pushed
            ? 'GUNS NOT CONFIGURED YET — PUSH CONFIG BELOW'
            : `${totals.rostered - totals.gun_acked} OF ${totals.rostered} GUNS HAVE NOT CONFIRMED THIS CONFIG`)
        : !phonesTold
          ? `GUNS READY — BUT THIS GAME REACHED ONLY ${totals.phone_game} OF ${totals.rostered} PHONES`
          // Totals agreeing while a row disagrees is not a state today's server can produce; it is
          // what an older or a newer one might send. Say what is on screen rather than pick the
          // cheerier of the two answers.
          : `${problems.length} OF ${rows.length} PLAYERS STILL NEED WORK — SEE BELOW`;

  return (
    <div data-testid="pre-arm-summary" style={{ border: `1px solid ${allClear ? T.line : T.warn}`,
      borderLeft: `3px solid ${allClear ? T.ok : T.warn}`, background: T.panelSoft, marginBottom: 12, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px 18px', flexWrap: 'wrap', padding: '10px 14px' }}>
        <span style={{ font: F.chk(700, 12), letterSpacing: '.2em', color: T.acc }}>PRE-ARM CHECK</span>
        <span role="status" data-testid="pre-arm-verdict"
          style={{ font: F.chk(700, 12), letterSpacing: '.08em', color: allClear ? T.ok : T.warn }}>
          {verdict}
        </span>
        <span style={{ flex: 1 }} />
        <span data-testid="pre-arm-counts" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <Count label="PHONES TOLD" n={totals.phone_game} of={totals.rostered} good={totals.rostered > 0 && totals.phone_game === totals.rostered} />
          {/* PUSHED, not "SENT" (see the glossary at the top): SENT is the phone axis's word, and this
              count is true even for a player with no phone bound at all. */}
          <Count label="GUNS PUSHED" n={totals.gun_sent} of={totals.rostered} good={totals.rostered > 0 && totals.gun_sent === totals.rostered} />
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
            <span style={{ width: 92, textAlign: 'center' }}>PUSHED</span>
            <span style={{ width: 92, textAlign: 'center' }}>ACKED</span>
            <span style={{ width: 92, textAlign: 'center' }}>ECHO</span>
            {/* at phone width the instruction is a row of its own, so this header would label nothing */}
            {!narrow && <span style={{ flex: '1 1 190px', minWidth: 0 }}>WHAT TO DO</span>}
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
              <div key={r.player_id} data-testid="pre-arm-row" data-player={r.player_id} data-compact={narrow ? '1' : '0'}
                style={{ display: 'flex', gap: narrow ? '2px 12px' : 12, alignItems: 'center',
                         flexWrap: narrow ? 'wrap' : 'nowrap', font: F.chk(600, 12), padding: '3px 0' }}>
                <span style={{ flex: '1 1 150px', minWidth: 0, overflowWrap: 'anywhere' }}>
                  <span style={{ color: T.micro, font: F.mono(500, 11) }}>#{r.player_num} </span>{r.display}
                  <span style={{ color: T.micro, font: F.mono(500, 11) }}> {r.gun_id}</span>
                </span>
                <span style={{ width: 92, textAlign: 'center' }}><Cell ok={r.phone_game} title="An `assign` for this config reached this phone's socket" /></span>
                {/* PUSHED is a fact about what MC WROTE, never about what the gun took — ACKED is the
                    only proof of that, so a green here beside a red there is a real and common state,
                    not a contradiction. */}
                <span style={{ width: 92, textAlign: 'center' }}><Cell ok={r.gun_sent} title="MC compiled this config's head and pushed it for this player — not a claim the gun took it (see ACKED)" /></span>
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
                <span data-testid="pre-arm-todo" data-narrow={narrow ? '1' : '0'}
                  style={{ flex: narrow ? '1 1 100%' : '1 1 190px', minWidth: 0, font: F.chk(500, 11.5),
                           color: todo ? T.warn : T.micro, textTransform: 'none', paddingLeft: narrow ? 2 : 0 }}>
                  {todo || 'Ready'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
