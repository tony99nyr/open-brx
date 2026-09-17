import { useState } from 'react';
import { RUNWAYS, useRunway } from '../runway';
import { RE_PUSH_HERE, STALE_ACK_FAULT, blocksPush, coverageLine, curedByPush, pushGate, reachLabel, reachOf, reachTooltip, sentenceCase, splitBlocker } from '../api/derive';
import type { Player } from '../api/types';
import { useStore } from '../store';
import { F, T, TAB, teamColor } from '../tokens';
import { BTN_RESET, OutlineTag, PrimaryButton, Progress, ScreenHeader, Tag, useNarrow } from '../ui';
import { SetupSteps } from '../ui/SetupSteps';
import { PreArmSummary, armOverrideCopy } from '../ui/PreArmSummary';
import { McVerify } from '../ui/McVerify';
import { StandDownChip, StandbySection } from '../ui/Standby';
import { GameEditPanel } from '../ui/GameEditPanel';
import { UnrosteredPhonesBanner } from '../ui/UnrosteredPhones';


export function Lobby() {
  const { state, run, api, setView } = useStore();
  const [runway, setRunway] = useRunway();   // survives a tab switch (field 2026-08-30)
  const [drag, setDrag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);          // RE-PUSH in flight (R2-1)
  if (!state) return null;
  const { players, lobby, readiness, teams } = state;
  const teamIds = state.config.mode === 'ffa' ? ['ffa'] : state.config.teams.map(t => t.team_id);
  const cols = teamIds.map(id => ({ id, name: teams.find(t => t.team_id === id)?.name ?? `${id.toUpperCase()} TEAM`, color: teamColor(id), members: players.filter(p => p.team_id === id) }));
  const unassigned = players.filter(p => !teamIds.includes(p.team_id ?? ''));
  const counts = cols.map(c => c.members.length);
  const balanced = Math.max(...counts) - Math.min(...counts) <= 1 && unassigned.length === 0;
  // EVERY judgement about pushing this config — the unplayable roster, the ack count, A36's three
  // proofs, which rows refuse a first push versus a re-push — is `derive.pushGate`, and GAMES's LOAD
  // reads the identical function. Two copies of these predicates is how the console ends up refusing
  // on one screen what it offers on the other (F151/R2-2); the reasoning that used to live here, and
  // why each rule is shaped the way it is, moved WITH the code into `derive.ts`.
  const gate = pushGate(state);
  const rosterFault = gate.rosterFault;
  const balancedForTeams = !rosterFault;
  const nReady = players.filter(p => p.ready).length;
  const notReady = players.filter(p => !p.ready).map(p => p.display);
  const allReady = nReady === players.length && players.length > 0;
  // U-1: the stale-ack sentence is computed from the ACKS, independently of the board — a stale ack
  // is always ALSO a red row, so anything that asked "are there faults?" first could never reach it.
  // F8a: ONE instruction string, everywhere (`RE_PUSH_HERE` is the label of the button below).
  const { acked, allAcked, noEcho, staleAcked, staleAckLine } = gate;
  // A28.4: derived, never asserted — "grey" the count while the tunnel is off, since it can only be 0.
  const cLine = coverageLine(state);
  const cColor = state.lan.public?.status !== 'up' ? T.micro : state.coverage?.level === 'full' ? T.ok : T.warn;
  const reachOfPlayer = (pid: string): 'lan' | 'backhaul' | undefined => {
    const n = state.nodes.find(x => x.player_id === pid);
    return n ? reachOf(n) : undefined;   // no node connected yet: no tag to show, never invent LAN
  };
  // F142 (field 2026-09-12, ISSUE 11b): a restored roster carried two players with no phone ever bound
  // — they looked exactly like real, connected operators here. `noPhone` drives the same dim treatment
  // KIT now gives that row.
  const noPhoneOf = (pid: string) => !state.nodes.some(x => x.player_id === pid);
  // Field 2026-08-30: the rail said only "E20D RED ON THE BOARD" and the operator read it as MC being
  // stuck — the REASON (GUN LINK LOST) was on the muster board, a screen away. Carry the blocker here.
  // Both block the push, but they are different situations and must not be described the same way:
  // `red` is a fault, `waiting` is just a phone that has not arrived (field 2026-09-01). START's gate
  // is `blockedCount` (a red is a red, whatever cures it); PUSH's is `pushBlockedCount`, which is the
  // SERVER's own (`state.py push_config._blocks_push`) and differs on both counts — A37's three
  // proofs are cured BY the push, and a phone that has not arrived refuses the FIRST push only.
  const { redRows, waitRows, blockedCount, pushBlockedCount, curableRows, waitWhy } = gate;
  const reds = redRows.map(b => b.sticker);
  // F8b: R2-8's suppression compared red ROWS with stale ACKS, so one row carrying a stale ack AND a
  // second red made "N guns cannot start" vanish for every other red on the board. The question is
  // which rows the stale-ack sentence does NOT already account for: the ones whose blockers are not
  // ALL stale acks.
  const notOnlyStale = redRows.filter(b => !((b.blockers ?? []).length > 0
    && (b.blockers ?? []).every(w => w.startsWith(STALE_ACK_FAULT))));
  // ONLY what actually gates the start. `ambers` (STALE LINK, SCREEN OFF, …) are advisories and were
  // printed in the same run-on sentence, which made a real fault read like a shrug.
  const faults = redRows.map(b => ({ who: b.sticker, why: b.blockers ?? [] }));

  // Two deliberate clicks (design-critic #5): PUSH, verify the acks/echoes land, THEN arm the countdown.
  const pushAndArm = async (force = false) => {
    if (!lobby.pushed) { await run(() => api.pushLobby(force)); return; }   // stop here — the rail's step 2 is real now
    const s = await run(() => api.start(runway, force));
    if (s) setView('armed');
  };
  // R2-1: the action every A36 fault line NAMES. `api.pushLobby` used to be reachable only while
  // `lobby.pushed` was false — after the first push the primary becomes ARM COUNTDOWN — so "RE-PUSH"
  // was a word on three fault lines with no control behind it, and the operator's only way to send a
  // fresh head was the HOST OVERRIDE force. The server treats a second push as a re-push (same
  // config_id, no new game number, every judgement about the old head dropped).
  const rePush = async (force = false) => {
    if (busy) return;                       // one head per click: a double tap re-compiles the roster twice
    setBusy(true);
    try { await run(() => api.pushLobby(force)); } finally { setBusy(false); }
  };
  const reteam = (p: Player, team_id: string) => { if (p.team_id !== team_id) run(() => api.patchPlayer(p.player_id, { team_id })); };

  // ---- the two buttons' gates, written once ------------------------------------------------
  // F1: the RE-PUSH shows whenever a re-push would CHANGE something — a row carrying a blocker only a
  // push clears, or a roster that has not finished acking the head it already has. It is disabled,
  // never merely erroring, when the server would refuse it whatever the operator does.
  const showRePush = lobby.pushed && (curableRows.length > 0 || !allAcked);
  const rePushDisabled = busy || !balancedForTeams;
  const staleish = staleAcked.length || curableRows.length;
  const armGating = readiness.board.filter(r => blocksPush(r, { repush: false }));
  const armDisabled = (lobby.pushed ? blockedCount > 0 : pushBlockedCount > 0) || !balancedForTeams
                      || players.length === 0 || (lobby.pushed && !allAcked);
  // F1: …and a disabled primary ALWAYS says why. This used to fall through to `''` for every reason
  // except an unplayable roster and a stale ack — so the commonest case of all, a red nobody can
  // re-push away, left the operator hovering a dead button that said nothing. Each reason is a
  // sentence; they are joined rather than ranked, because a board can carry more than one.
  const armWhy = [
    !balancedForTeams ? rosterFault ?? 'This roster cannot play' : '',
    players.length === 0 ? 'Add someone to the roster first' : '',
    staleish ? `${staleish} gun${staleish === 1 ? '' : 's'} answered for an older config — ${RE_PUSH_HERE}` : '',
    !staleish && lobby.pushed && !allAcked ? `Waiting for every gun to echo the config — or ${RE_PUSH_HERE}` : '',
    armGating.length
      ? `${armGating.length} row${armGating.length === 1 ? '' : 's'} no push can clear: ${armGating
          .map(r => `${r.sticker} ${(r.blockers ?? []).filter(b => !curedByPush(b)).map(b => splitBlocker(b).head).join(', ') || 'phone not arrived'}`)
          .join(' · ')}`
      : '',
  ].filter(Boolean).join('  ·  ');
  const armTitle = armDisabled ? armWhy || 'Not ready to arm yet' : '';
  // …and the OVERRIDE says what overriding actually costs. `armDisabled` above is true in every state
  // that trips the server's `_refuse_unconfigured_gun` (a player with no phone bound is a `waiting`
  // row, so `blockedCount` covers it), which makes `pushAndArm(true)` the ONLY reachable path past
  // that gate — and this button used to promise "Nodes still blocked will not arm; everyone else
  // starts on time." on the way through it. That is false exactly where it matters: a gun that never
  // took this config is not inert, it arms on the head it is still holding. The words now come from
  // the server's own `sync` block (`ui/PreArmSummary.armOverrideCopy`), naming the players and what
  // will happen to them. The override itself is untouched — this informs the judgement, it does not
  // take it away.
  const override = armOverrideCopy(state.sync);

  return (
    <div className="screen">
      <ScreenHeader kicker="[ A5 // LOBBY ]" title="Team Assignment" right={
        <>
          {rosterFault
            ? <Tag color={T.bad} size={9} style={{ letterSpacing: '.2em', padding: '3px 10px' }}>{counts.join(' V ')} — CANNOT PLAY</Tag>
            : <Tag color={balanced ? T.ok : T.warn} size={9} style={{ letterSpacing: '.2em', padding: '3px 10px' }}>{counts.join(' V ')} — {balanced ? 'BALANCED' : 'UNBALANCED'}</Tag>}
          {cLine && <Tag color={cColor} size={9} style={{ letterSpacing: '.2em', padding: '3px 10px' }}>{cLine}</Tag>}
          <Progress n={nReady} total={players.length} label="READY" color={T.ok} />
        </>
      } />
      {rosterFault && (
        <div role="alert" data-testid="roster-fault" style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6,
          background: 'rgba(255,82,82,.08)', border: `1px solid ${T.bad}`, borderLeft: `3px solid ${T.bad}`, padding: '12px 16px' }}>
          <span style={{ font: F.chk(700, 12), letterSpacing: '.06em', color: T.bad, lineHeight: 1.5 }}>▲ {rosterFault}</span>
          {/* F-8 (2026-09-13): HOST OVERRIDE (below, in the rail) never renders while a roster fault
              stands — `one_team_fault` refuses `force` on the server, so there is nothing an override
              tap could do here. It used to just vanish with no reason on screen, which read as a bug
              rather than as "this one isn't optional". */}
          <span data-no-override-reason style={{ font: F.chk(600, 11), letterSpacing: '.1em', color: T.micro }}>CANNOT BE OVERRIDDEN — FIX THE ROSTER FIRST</span>
        </div>
      )}
      {/* the field steps (power-cycle the grenade, place it) — see ui/SetupSteps */}
      <SetupSteps style={{ marginBottom: 12 }} />
      {/* A31: the standing "this win is settled at MC" line, naming the phones with no backhaul */}
      <McVerify style={{ marginBottom: 12 }} />
      {/* F-3/A39: a connected phone with nobody in the roster claiming it — last night's "4 guns
          connected, only 2 in lobby" confusion, made visible where the operator is actually looking. */}
      <UnrosteredPhonesBanner style={{ marginBottom: 12 }} />
      {/* B3: mode/night/health/weapon-pool, editable right here — no stepper, no recall needed pre-arm */}
      <GameEditPanel style={{ marginBottom: 12 }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        {cols.map(col => (
          <div key={col.id} style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column' }}
            onDragOver={e => e.preventDefault()} onDrop={() => { const p = players.find(x => x.player_id === drag); if (p) reteam(p, col.id); setDrag(null); }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: T.panelAlt, border: `1px solid ${T.line}`, borderBottom: 'none', borderTop: `2px solid ${col.color}` }}>
              <span style={{ font: F.chk(700, 13), letterSpacing: '.24em', color: col.color }}>{col.name}</span>
              <span style={{ flex: 1 }} />
              <span style={{ font: F.osw(600, 12), ...TAB, color: T.dim }}>{col.members.length} OPERATORS</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, border: `1px solid ${drag ? T.acc : T.line}`, padding: 6, background: T.panelDeep, minHeight: 200 }}>
              {col.members.map(mb => <MemberRow key={mb.player_id} p={mb} teamIds={teamIds} reach={reachOfPlayer(mb.player_id)} noPhone={noPhoneOf(mb.player_id)} onDragStart={() => setDrag(mb.player_id)} onMove={t => reteam(mb, t)} />)}
            </div>
          </div>
        ))}
        {unassigned.length > 0 && (
          <div style={{ flex: '1 1 240px' }}>
            <div style={{ padding: '10px 14px', background: T.panelAlt, border: `1px solid ${T.line}`, borderBottom: 'none', borderTop: `2px solid ${T.warn}`, font: F.chk(700, 13), letterSpacing: '.24em', color: T.warn }}>UNASSIGNED</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, border: `1px solid ${T.line}`, padding: 6, background: T.panelDeep }}>
              {unassigned.map(mb => <MemberRow key={mb.player_id} p={mb} teamIds={teamIds} reach={reachOfPlayer(mb.player_id)} noPhone={noPhoneOf(mb.player_id)} onDragStart={() => setDrag(mb.player_id)} onMove={t => reteam(mb, t)} />)}
            </div>
          </div>
        )}
      </div>
      {/* STANDBY (2026-09-12): who is sitting this one out, and the way back in */}
      <StandbySection />
      {/* The pre-arm check (2026-09-13). LOAD split "the game is loaded" from "the guns are
          configured", so the two halves have to be verified separately and named per player. */}
      <PreArmSummary />
      {/* Action rail — rebuilt 2026-09-01: "lots of small uppercase text. poor organization and
          readability and usability". One status line in sentence case, faults as a real per-gun list
          (blockers only — the advisories used to be jammed into the same run-on string), one primary
          action, and the overrides in a separate tray instead of a second copy of the same sentence. */}
      <div data-rail="lobby" style={{ marginTop: 16, background: `linear-gradient(180deg,${T.panelSoft},${T.panelDeep})`, border: `1px solid ${T.line}` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 28px', padding: '16px 20px' }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <Step n={1} done={allReady} label={<>Ready <b style={{ font: F.osw(700, 16), color: allReady ? T.ok : T.warn }}>{nReady}/{players.length}</b></>} />
            <Step n={2} done={allAcked} label={<>Config pushed {lobby.pushed && <b style={{ font: F.osw(700, 16), color: allAcked ? T.ok : T.warn }}>{acked}/{players.length}</b>}</>} />
            <Step n={3} done={false} label={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>Countdown
                <select aria-label="countdown length" value={String(runway)} onChange={e => setRunway(Number(e.target.value))}
                  style={{ background: T.inset, color: T.ink, border: `1px solid ${T.line2}`, font: F.osw(700, 16), padding: '4px 8px', minHeight: 36, cursor: 'pointer' }}>
                  {RUNWAYS.map(r => <option key={r} value={r}>{`${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`}</option>)}
                </select>
              </span>} />
          </div>
          <span style={{ flex: 1 }} />
          {/* U-4: "waiting to echo" is the wrong sentence for a gun that HAS answered — for the game
              before this one. Different fault, different fix (RE-PUSH, not wait), and the title is
              where an operator looks when a button will not move. */}
          {/* R2-1: the control every A36 fault line names. Secondary, beside the primary — the
              primary after a push is ARM COUNTDOWN, and a re-push is not the thing to do by
              default. Shown when a re-push would actually change something: a row only a push can
              clear, or a roster that has not finished acking the head it already has. */}
          {showRePush && (
            <button type="button" data-repush="1" data-repush-force={pushBlockedCount > 0 ? '1' : undefined}
              className={rePushDisabled ? undefined : 'hov-acc-ink hit44'} disabled={rePushDisabled}
              style={{ ...BTN_RESET, cursor: rePushDisabled ? 'not-allowed' : 'pointer',
                       color: rePushDisabled ? T.micro : pushBlockedCount > 0 ? T.warn : T.acc,
                       font: F.chk(700, 13), letterSpacing: '.06em', minHeight: 44, padding: '0 6px' }}
              // A re-push IS a push, so it meets the push gate. When something the push cannot cure is
              // also on the board (a gun that is not powered) the server refuses it unforced — and
              // START refuses a stale ack even WITH force, so an operator with both on the board would
              // have no way out at all. The button says which of the two it is about to do rather than
              // erroring on the click or quietly forcing.
              //
              // F1: and an UNPLAYABLE roster disables it outright. `_refuse_one_team` is checked after
              // the force gate on the server, so `force` does not open it — a clickable button here
              // could only ever throw, into a toast, about a fault whose fix is on this same screen.
              title={rosterFault
                ? rosterFault
                : pushBlockedCount > 0
                  ? `Sends this config to every gun again, over ${pushBlockedCount} row${pushBlockedCount === 1 ? '' : 's'} no push can clear. A gun that is not linked simply will not ack.`
                  : 'Compiles and sends this config to every gun again. The ack count drops to 0 and climbs as each one answers.'}
              onClick={() => rePush(pushBlockedCount > 0)}>
              {busy ? 'RE-PUSHING…'
                : pushBlockedCount > 0 ? `RE-PUSH CONFIG OVER ${pushBlockedCount} BLOCKED ▸` : 'RE-PUSH CONFIG ▸'}
            </button>
          )}
          <PrimaryButton onClick={() => pushAndArm()} disabled={armDisabled} title={armTitle}>
            {lobby.pushed ? 'ARM COUNTDOWN ▸' : 'PUSH CONFIG & ARM ▸'}
          </PrimaryButton>
        </div>

        <div style={{ padding: '0 20px 14px', font: F.chk(600, 13), lineHeight: 1.5,
                      color: faults.length ? T.bad : waitRows.length ? T.micro : notReady.length ? T.warn : T.ok }}>
          {/* U-1 (2026-09-13): `staleAcked` used to be consulted ONLY in the no-faults branch — and a
              stale ack always lands in that row's `blockers` (state.py `readiness()`), which makes the
              row red, which puts it in `faults`. So the generic count always won and the sentence
              naming the guns, and the one thing to DO about them, was unreachable on a real server.
              It is now asked FIRST, whatever else is red: "3 guns cannot start" is a count, and a
              count is not an instruction. */}
          {staleAckLine
            || (faults.length
              ? `${faults.length} gun${faults.length === 1 ? '' : 's'} cannot start`
              : waitWhy
                // Bench 2026-09-16: LOBBY reached from GAMES without KIT. Nothing had opened the kit and
                // nothing was pushed, so the phones said HOST IS SETTING UP and could not ready up. The line
                // named the players and not the step that frees them.
                || (notReady.length
                  ? `Not ready yet: ${notReady.join(', ')}${lobby.pushed ? '' : '. Their phones say HOST IS SETTING UP until you open KIT or push the config.'}`
                  : '')
                // A36: "no echo" and "echoed the LAST game" are different problems with different
                // answers, and this line used to be able to name NEITHER — a stale ack is `ok:true`,
                // so it fell out of the filter and the sentence rendered as "No config echo from  —
                // headset off, or gun asleep?" with an empty list, about guns that had answered.
                || (lobby.pushed && !allAcked
                    ? `No config echo from ${noEcho.join(', ')} — headset off, or gun asleep?`
                    : 'All nodes ready and in range. Push, then walk.'))}
          {/* R2-8: …and only when there is a fault the sentence above did NOT already account for.
              With two stale acks and nothing else, every red IS the stale ack, and "2 guns cannot
              start" beside "REAPER, VIPER still answering for an older config" counts the same two
              guns twice — which reads as four problems. */}
          {staleAckLine && notOnlyStale.length > 0 && (
            <span style={{ color: T.micro }}>{`  ·  ${notOnlyStale.length} gun${notOnlyStale.length === 1 ? '' : 's'} cannot start`}</span>
          )}
        </div>

        {faults.length > 0 && (
          <div style={{ borderTop: `1px solid ${T.line}`, padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {faults.map(f => (
              <div key={f.who} style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ font: F.osw(700, 15), letterSpacing: '.06em', color: T.ink, minWidth: 130 }}>{f.who}</span>
                {/* U-2 (2026-09-13): this kept only the text before the first " — ", which is the
                    STATEMENT half. Every server line is `STATEMENT — INSTRUCTION`, so "ACKED AN
                    OLDER CONFIG (id) — RE-PUSH" rendered on the START screen as a fault with no fix,
                    and all three A36 lines lost the only word that says what to do. Same split the
                    Armory card uses (`derive.splitBlocker`), one implementation. */}
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {f.why.map(w => {
                    const { head, hint } = splitBlocker(w);
                    return (
                      <span key={w} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span style={{ font: F.chk(600, 12), color: T.bad }}>▲ {head}</span>
                        {hint && <span style={{ font: F.chk(500, 11.5), color: T.micro, textTransform: 'none', paddingLeft: 14 }}>{sentenceCase(hint)}</span>}
                      </span>
                    );
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* `force` is the operator's override of a READINESS judgement. It does not open the one-team
          gate (state.py `one_team_fault`), so the tray must not be on screen claiming otherwise. */}
      {(lobby.pushed ? blockedCount > 0 : pushBlockedCount > 0) && balancedForTeams && (
        <div data-override="1" style={{ marginTop: 10, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* The risk goes ABOVE the button and ON THE SCREEN, in the console's fault shape (shouted
              statement, quiet cure). It was a tooltip, and this runs on a tablet where there is no
              hover at all — so the one sentence that could have stopped the 2026-09-12 start was
              unreachable on the device the operator was holding. */}
          {lobby.pushed && override.warn.length > 0 && (
            <div data-testid="override-risk" role="status" style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {override.warn.map(w => (
                <span key={w.head} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span style={{ font: F.chk(700, 12), color: T.bad, lineHeight: 1.5 }}>▲ {w.head}</span>
                  <span style={{ font: F.chk(500, 11.5), color: T.micro, textTransform: 'none', paddingLeft: 14, lineHeight: 1.5 }}>{w.hint}</span>
                </span>
              ))}
            </div>
          )}
          {/* F7: 11 px is the console's floor for a word that carries meaning, and this one names the
              whole tray. It sat at 10 and was the only thing in the action rail below the floor. */}
          <span style={{ font: F.mono(500, 11), letterSpacing: '.16em', color: T.micro }}>HOST OVERRIDE</span>
          <button type="button" className="hov-acc-ink hit44" style={{ ...BTN_RESET, cursor: 'pointer', color: T.bad, font: F.chk(700, 13), minHeight: 36 }}
            title={lobby.pushed
              ? override.title
              : 'Compiles and pushes to every bound node anyway. A gun that is not linked will simply not ack.'}
            onClick={() => pushAndArm(true)}>
            {lobby.pushed ? override.label : `Push anyway, over ${[reds.length && `${reds.length} fault${reds.length === 1 ? '' : 's'}`, waitRows.length && `${waitRows.length} missing phone${waitRows.length === 1 ? '' : 's'}`].filter(Boolean).join(' and ')}`} ▸
          </button>
        </div>
      )}
      {!allReady && players.length > 0 && (
        <div data-mark-ready="1" style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', font: F.mono(500, 11), letterSpacing: '.14em', color: T.dim }}>
          <span style={{ font: F.mono(500, 11), letterSpacing: '.16em', color: T.micro, marginRight: 4 }}>MARK READY</span>
          {players.filter(p => !p.ready).map(p => (
            <button key={p.player_id} type="button" className="hov-acc-ink hit44" style={{ ...BTN_RESET, cursor: 'pointer', color: T.dim, minHeight: 28 }} onClick={() => run(() => api.setReady(p.player_id, true))}>{p.display} ▸</button>
          ))}
        </div>
      )}
    </div>
  );
}

function MemberRow({ p, teamIds, reach, noPhone, onDragStart, onMove }: { p: Player; teamIds: string[]; reach?: 'lan' | 'backhaul'; noPhone?: boolean; onDragStart: () => void; onMove: (team_id: string) => void }) {
  const others = teamIds.filter(t => t !== p.team_id);
  // F-7 (2026-09-13): the wide layout wraps to 3-4 lines at 393 px — name, gun, NO PHONE, reach,
  // move-to chips, STAND DOWN and the ready tag all competing for one flex-wrap row with nothing
  // grouped. `useNarrow` (ui/index.tsx, same watched-viewport pattern Spectate.tsx's own
  // `useViewport` established) switches to a two-row compact layout under 480 px: identity + ready
  // pinned on row one (never wraps — the callsign ellipsises instead), every other control on row
  // two. jsdom lays nothing out, so this is proved as a MECHANISM here (`data-compact-row` appears,
  // the row count is right) and re-measured in pixels at 393 px by the e2e walk.
  const narrow = useNarrow();
  const readyTag = p.ready ? <OutlineTag color={T.ok} border="rgba(46,204,113,.5)">READY</OutlineTag> : <OutlineTag color={T.micro} border={T.line}>WAIT</OutlineTag>;
  // A28.3: which path this node's live socket is actually on right now — absent until a node
  // connects, never invented for one that hasn't (older server included). S40 (field 2026-09-12):
  // "BACKHAUL" read to an operator as "on cellular" — the word is now the same one the REACH
  // block uses (INTERNET), and the tooltip says what it is a fact ABOUT: the path to MC, never
  // the phone's own radio.
  const statusTags = <>
    {noPhone && <OutlineTag color={T.micro} border={T.line}>NO PHONE</OutlineTag>}
    {reach && <OutlineTag color={reach === 'backhaul' ? T.acc : T.micro} border={reach === 'backhaul' ? T.acc : T.line} title={reachTooltip(reach)}>{reachLabel(reach)}</OutlineTag>}
  </>;
  // tap-to-move (tablets have no HTML5 drag): one chip per other team
  const moveChips = (
    <span role="group" style={{ display: 'inline-flex', gap: 3, flexWrap: 'wrap' }} aria-label={`move ${p.display} to`}>
      {others.map(t => (
        <button key={t} type="button" className="hit44" onClick={() => onMove(t)} title={`Move ${p.display} to ${t.toUpperCase()}`}
          // F7 follow-up (2026-09-13): 9px was under the console's 11px floor for meaning-bearing
          // text -- the floor this same file states at :339 -- and these chips NAME the team a tap
          // moves a player onto. One `moveChips` const feeds both the wide row and the compact 393px
          // one, so this is the single place it is set; 11px also matches `StandDownChip` beside it.
          style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.14em', padding: '4px 8px', color: teamColor(t), border: `1px solid ${T.line}`, minHeight: 28, display: 'inline-flex', alignItems: 'center' }}>
          ▸ {t.toUpperCase()}
        </button>
      ))}
    </span>
  );
  if (narrow) {
    return (
      <div className="hov-acc" draggable onDragStart={onDragStart} data-no-phone={noPhone ? '1' : undefined} data-compact-row="1"
        style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', background: T.panel, border: `1px solid ${T.line}`, cursor: 'grab', minHeight: 44, opacity: noPhone ? 0.55 : 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden style={{ font: F.mono(600, 12), color: T.faint, letterSpacing: '-.1em', flex: 'none' }}>⠿</span>
          <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ font: F.chk(700, 14), letterSpacing: '.12em' }}><span style={{ color: T.micro, font: F.mono(500, 10) }}>#{p.player_num} </span>{p.display}</span>
            <span style={{ color: T.faint }}> · </span>
            <span style={{ font: F.mono(500, 10), color: T.micro }}>{p.gun_id ?? 'NO GUN'}</span>
          </span>
          <span style={{ flex: 'none' }}>{readyTag}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {statusTags}
          {moveChips}
          <StandDownChip p={p} />
        </div>
      </div>
    );
  }
  return (
    <div className="hov-acc" draggable onDragStart={onDragStart} data-no-phone={noPhone ? '1' : undefined}
      // F142 (field 2026-09-12, ISSUE 11b): a restored player with no phone bound read exactly like a
      // real, connected one — dim the row and say so, the same treatment KIT now gives it.
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: T.panel, border: `1px solid ${T.line}`, cursor: 'grab', minHeight: 44, flexWrap: 'wrap', opacity: noPhone ? 0.55 : 1 }}>
      <span aria-hidden style={{ font: F.mono(600, 12), color: T.faint, letterSpacing: '-.1em' }}>⠿</span>
      {/* F7 (phone-width pass, 2026-09-13): `flex: 1` with `minWidth: 0` let this collapse to 26 px at
          393 px — narrower than the word "VIPER" — and a callsign is one unbreakable word, so it
          OVERFLOWED and painted on top of the LAN tag beside it. Measured on the faults scene's phone
          shot. A basis wide enough for a callsign, and `anywhere` so nothing can ever paint outside
          the box again; the row already wraps, so the chips drop to their own line instead. */}
      <span style={{ flex: '1 1 116px', minWidth: 0, overflowWrap: 'anywhere' }}>
        <span style={{ display: 'block', font: F.chk(700, 14), letterSpacing: '.14em' }}><span style={{ color: T.micro, font: F.mono(500, 10) }}>#{p.player_num} </span>{p.display}</span>
        <span style={{ display: 'block', font: F.mono(500, 10), color: T.micro }}>{p.gun_id ?? 'NO GUN'}</span>
      </span>
      {statusTags}
      {moveChips}
      <StandDownChip p={p} />
      {readyTag}
    </div>
  );
}

function Step({ n, done, label }: { n: number; done: boolean; label: React.ReactNode }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ font: F.osw(700, 11), background: done ? T.ok : T.line, color: done ? T.accInk : T.dim, padding: '1px 7px' }}>{n}</span>
      <span style={{ font: F.chk(600, 11), letterSpacing: '.14em', color: T.dim, display: 'inline-flex', alignItems: 'center', gap: 8 }}>{label}</span>
    </span>
  );
}
