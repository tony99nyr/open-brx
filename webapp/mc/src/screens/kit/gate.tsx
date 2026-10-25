// KIT's way out: who KIT -> LOBBY would strand, the refusal lines, and the CONTINUE TO LOBBY control.
// Split out of Kit.tsx (round-2 candidate 11).
import { useEffect, useState } from 'react';
import type { PhaseRefusal, Player } from '../../api/types';
import { CHAMFER, F, T, TAB } from '../../tokens';
import { colourOf, glyphed, sevOf } from '../../alerts';
import { GhostButton } from '../../ui';

/** F127 (field 2026-09-11) -- who KIT -> LOBBY would strand.
 *
 *  MC's own rule is `state.py` `_all_ready` (contracts §4.4): "kit → lobby advances only when EVERY
 *  rostered player is ready". The phone FOLLOWS the phase -- `engine.js` moves a node that is not
 *  armed/live to `lobby` and `hud.js` then renders the lobby screen instead of the kit panel -- so
 *  the bare `setPhase('lobby')` this screen used to fire took the screen out from under everyone
 *  still choosing a loadout, silently, on both sides. The operator KEEPS the override (a phoneless
 *  player must not be able to hold up the night); it is now a two-tap that says whose screen it takes.
 *
 *  `known` is false for a roster this console cannot judge -- no players yet, or a snapshot with no
 *  `ready` field at all (an older MC). Say "readiness unknown" rather than invent a count.
 */
export function kitGate(players: Player[] | null | undefined) {
  const roster = Array.isArray(players) ? players : [];
  const known = roster.length > 0 && roster.every(p => typeof p?.ready === 'boolean');
  const waiting = known ? roster.filter(p => !p.ready) : [];
  return {
    known, total: roster.length, ready: known ? roster.length - waiting.length : 0,
    waiting: waiting.map(p => p.display || `#${p.player_num}`),
    // WHAT THE ROSTER IS RIGHT NOW — every player and whether they are ready, not just the unready
    // names. A server refusal describes the roster it was raised against; when ANY of this changes it
    // is describing something else and has to go. The unready NAMES alone were not enough: a refusal
    // raised while this console already read everyone as ready (the skew the A27 guard exists for)
    // had an empty name set before and after the missing player arrived and readied, so its sentence
    // — and its frozen 8/9 count — stayed on screen over a roster that was now green (round-2
    // review 2026-09-12).
    sig: roster.map(p => `${p.player_id}:${p.ready ? 1 : 0}`).join(','),
  };
}

/** Three names, then a count: a squad of 12 must not wrap the header to three lines. */
const waitingNames = (names: string[]) => (names.length <= 3
  ? names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  : `${names.slice(0, 3).join(', ')} +${names.length - 3} more`);

/** The refusal, as one line the operator can act on.
 *
 *  The server's sentence is rendered VERBATIM and first — it is the one that decided. The names are
 *  appended only when that sentence does not already carry them, because MC's own copy usually does
 *  ("1 of 9 are not READY: ROCCO") and printing them twice reads as two different facts. The
 *  "CONTINUE ANYWAY?" ends readiness refusals. A pending result cannot be overridden. */
function refusalLine(r: PhaseRefusal): string {
  const said = (r.error || '').trim() || 'MISSION CONTROL REFUSED THE ADVANCE';
  if (said === 'Finalise the result first.') return said;
  const names = (r.not_ready ?? []).map(n => n.toUpperCase()).filter(Boolean);
  // F221 polish (2026-09-25): MC's own sentence for this one refusal is "N of M are not READY: names",
  // mixed case with its own colon — appending ": CONTINUE ANYWAY?" doubled the colon and left half the
  // line lower case. Reshape that one known server sentence into one colon, upper case throughout, the
  // names in brackets; anything else keeps the general path below.
  const notReady = /^(\d+) of (\d+) are not READY: (.+)$/i.exec(said);
  if (notReady) {
    const [, n, total, who] = notReady;
    return `${n} OF ${total} NOT READY (${who.toUpperCase()}): CONTINUE ANYWAY?`;
  }
  const upper = said.toUpperCase();
  const missing = names.filter(n => !upper.includes(n));
  // just the names. The server's sentence has already said WHAT is wrong; repeating "ARE NOT READY"
  // after it makes one fact read as two.
  const who = missing.length ? `, ${waitingNames(missing)}` : '';
  // F221: one separator, a colon, joining the fact to the next action — never an em dash.
  return `${said}${who}${/CONTINUE ANYWAY\?$/.test(upper) ? '' : ': CONTINUE ANYWAY?'}`;
}

/** The refusal of a tap that ALREADY carried `force`.
 *
 *  A 409 on the forced tap used to re-render the same sentence the unforced tap produced, so the
 *  screen said nothing had changed while the override had in fact been sent and refused — and the
 *  12 s expiry then disarmed the button back to an UNFORCED tap, so the operator's next press was
 *  the first tap again (review 2026-09-12). This line says the override itself was refused; the
 *  button stays armed until it is cancelled, and the next tap forces again. */
function overrideRefusedLine(r: PhaseRefusal): string {
  const said = (r.error || '').trim() || 'IT WOULD NOT ADVANCE';
  return `MC REFUSED THE OVERRIDE: ${said.toUpperCase()}`;
}

/** The ready count the button prints. While the SERVER has refused, it is the SERVER's tally: the
 *  console's own roster said 9/9 READY on the very line that was being refused for an unready
 *  player, which reads as the console arguing with the sentence under it (review 2026-09-12). An
 *  older MC sends no counts with its 409 — then there is no number to print rather than a wrong one. */
function readyCount(gate: ReturnType<typeof kitGate>, refusal: PhaseRefusal | null): string {
  if (refusal) {
    return typeof refusal.greens === 'number' && typeof refusal.roster_size === 'number'
      ? ` · ${refusal.greens}/${refusal.roster_size} READY` : '';
  }
  return gate.known ? ` · ${gate.ready}/${gate.total} READY` : '';
}

/** What a tap on CONTINUE came back with. A readiness refusal permits an override.
 *  A pending-result refusal stays on KIT until the result is finalised. */
type GoResult = { ok: boolean; refusal?: PhaseRefusal };

/** The KIT -> LOBBY button: the ready count IS the status, and a short roster is a two-tap confirm. */
export function ContinueToLobby({ gate, onGo }: { gate: ReturnType<typeof kitGate>; onGo: (force: boolean) => Promise<GoResult> }) {
  const blocked = gate.known && gate.waiting.length > 0;
  const who = gate.waiting.join('|');
  // The confirm is armed FOR a named set of players, not as a flag, so it disarms itself the moment
  // what it is confirming changes under the operator: everyone readied, or it is a DIFFERENT set that
  // would be stranded now. (Derived during render, so there is no disarm effect to lag a snapshot
  // behind the button.) Leaving KIT unmounts this, which disarms it too.
  const [armedFor, setArmedFor] = useState<string | null>(null);
  // A27 (F127, server side): `POST /api/phase` refuses kit -> lobby with 409 `{error, not_ready}` while
  // anyone is unready. The console's OWN gate above counts the roster it last saw; the two can
  // disagree (a phone readied a snapshot ago, or the server knows about a player this console does
  // not), and when they do the server's list is the true one. So the refusal becomes the confirm: it
  // is shown with the server's names, and the NEXT tap carries `force: true`.
  const [refusal, setRefusal] = useState<PhaseRefusal | null>(null);
  // ...and whether the tap it refused had already carried `force`. That is a different event with a
  // different next step, and it must not expire back into an unforced tap.
  const [refusedForce, setRefusedForce] = useState(false);
  const pendingResult = refusal?.error?.trim() === 'Finalise the result first.';
  const armed = !pendingResult && ((blocked && armedFor === who) || refusal != null);
  // Deriving `armed` HIDES the confirm the moment the roster stops matching — but the armed-for set
  // also has to be FORGOTTEN, and the trigger is the SET CHANGING, not the roster unblocking. Clearing
  // only on `!blocked` left the old set behind through a roster that was still blocked by somebody
  // else: arm on SABLE|DRIFT, SABLE readies (who = DRIFT, still blocked, so the clear never ran), SABLE
  // un-readies, and `armed` flipped true again with no tap — the operator's very next tap moved
  // everybody. Exactly the F127 accident, two snapshots later (review 2026-09-12). Cleared DURING
  // render (React's "adjust state when the input changes" — there is no effect to lag a snapshot
  // behind, and no frame in which the button is armed at a set it was not armed for). Unmount needs no
  // cleanup: leaving KIT destroys this state with the component.
  if (armedFor !== null && armedFor !== who) setArmedFor(null);
  // a refusal describes a roster; when the roster changes it is describing something else
  const [refusedAt, setRefusedAt] = useState<string | null>(null);
  if (refusal != null && refusedAt !== gate.sig) { setRefusal(null); setRefusedAt(null); setRefusedForce(false); }
  // ...and it expires on its own, like the A14 loadout confirm: an armed warning left on screen is a
  // trap, because the next tap is the one that moves everybody.
  // ...EXCEPT once the override itself has been refused: expiring that would quietly turn the next
  // tap back into the first tap of a two-tap gate, on a screen still showing a refusal. It is
  // cleared by CANCEL, by the roster changing, or by the advance going through.
  useEffect(() => { if (!armed || refusedForce) return; const h = setTimeout(() => { setArmedFor(null); setRefusal(null); setRefusedAt(null); }, 12_000); return () => clearTimeout(h); }, [armed, refusedForce]);
  // The count rides on BOTH labels. Dropping it while armed left the strip's only number as the
  // KITTED tally — a different count, of a different thing, at the moment the operator is deciding.
  const count = readyCount(gate, pendingResult ? null : refusal);
  const label = `${armed ? 'CONTINUE ANYWAY' : 'CONTINUE'}${count} ▸`;
  const go = async () => {
    if (pendingResult) return;
    if (blocked && !armed) { setArmedFor(who); return; }   // first tap: arm on THIS set of names, send nothing
    // `force` rides on any tap the operator makes AFTER seeing a named warning — the console's own
    // F127 confirm counts, not just the server's refusal. Without that the two guards stack and
    // CONTINUE needs THREE taps: arm, refused, force (caught by `npm run e2e:kit`, 2026-09-12). Each
    // path is still two taps, and `force` is still never sent before the operator has been told whose
    // screen it takes:
    //   roster blocked here  → tap 1 arms and names them, tap 2 sends `force`
    //   roster looks green   → tap 1 sends plain, the server refuses and names them, tap 2 sends `force`
    const forced = armed;
    const r = await onGo(forced);
    // the server said no, and said who — and whether it was the OVERRIDE it turned down
    if (r.refusal) {
      const pending = r.refusal.error?.trim() === 'Finalise the result first.';
      setRefusal(r.refusal); setRefusedAt(gate.sig); setRefusedForce(forced && !pending);
      if (pending) setArmedFor(null);
      return;
    }
    if (r.ok) { setArmedFor(null); setRefusal(null); setRefusedAt(null); setRefusedForce(false); }  // otherwise it threw: the red strip says why, stay put
  };
  return (
    <span data-continue="kit" data-armed={armed ? '1' : '0'} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, maxWidth: '100%' }}>
      {/* CANCEL + CONTINUE are both nowrap, and armed they are 398px side by side — 5px wider than a
          393px phone, which pushed CANCEL off the right edge of the console (e2e 2026-09-12). Let the
          pair wrap instead: one row on the desk, stacked and still right-aligned on a phone. */}
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, maxWidth: '100%' }}>
        {armed && <GhostButton size={11} pad="9px 14px" onClick={() => { setArmedFor(null); setRefusal(null); setRefusedAt(null); setRefusedForce(false); }}>CANCEL</GhostButton>}
        {/* ONE element in both states, styled two ways. Swapping <button> for PrimaryButton when the
            roster blocks threw the focused element away mid-decision, so a keyboard operator lost the
            gate at the exact moment it started asking a question (review 2026-09-12). The transparent
            border keeps the box the same size in both looks, so nothing jumps either. */}
        <button type="button" className={blocked ? 'hov-warnbg' : 'hov-accbg'} onClick={go} disabled={pendingResult}
          title={armed ? `Move ${waitingNames(gate.waiting)} to the lobby before they have finished kitting`
                       : blocked ? `${gate.waiting.length} player${gate.waiting.length === 1 ? ' is' : 's are'} still kitting`
                       : undefined}
          style={{ font: F.chk(700, 12), letterSpacing: '.2em', padding: '9px 18px', whiteSpace: 'nowrap', ...TAB,
                   background: blocked ? 'transparent' : T.acc, color: blocked ? T.warn : T.accInk,
                   border: `1px solid ${blocked ? T.warn : 'transparent'}`, clipPath: CHAMFER.tl10,
                   cursor: pendingResult ? 'not-allowed' : 'pointer', minHeight: 44 }}>
          {label}
        </button>
      </span>
      {armed && !refusal && (
        // The CONSEQUENCE, on screen. Suppressed once the SERVER has refused: its line says the same
        // thing with better information, and two warnings about one roster read as two problems
        // (real-server walk, 2026-09-12). It used to live in a `title` tooltip — which the operator was
        // never going to hover, and which a touch console has no way to show at all — so the visible
        // line said only that someone was "waiting", not that a tap takes their screen away (F127).
        <span role="alert" data-continue-warn="1" style={{ font: F.chk(600, 12), letterSpacing: '.06em', color: colourOf('kit-continue-warn'), maxWidth: 'min(620px, calc(100vw - 48px))', textAlign: 'right', lineHeight: 1.45 }}>
          <span title={`${gate.waiting.join(', ')} still kitting and will lose their screen.`}>
            {glyphed('amber', `${gate.waiting.length <= 3 ? waitingNames(gate.waiting) : gate.waiting.length} still kitting, they lose their screen. Continue anyway?`)}
          </span>
        </span>
      )}
      {refusal && (() => {
        // The SERVER's sentence and the SERVER's names, verbatim. Not the console's own count — when
        // the two disagree this is the one that decided, and the operator is about to override it.
        const id = refusedForce ? 'kit-continue-refused-force' : 'kit-continue-refusal';
        return (
          <span role="alert" data-continue-refusal="1" data-override-refused={refusedForce ? '1' : '0'}
            style={{ font: F.chk(600, 12), letterSpacing: '.06em', color: colourOf(id), maxWidth: 'min(620px, calc(100vw - 48px))', textAlign: 'right', lineHeight: 1.45 }}>
            {glyphed(sevOf(id), refusedForce ? overrideRefusedLine(refusal) : refusalLine(refusal))}
          </span>
        );
      })()}
      {!gate.known && gate.total > 0 && (
        <span style={{ font: F.mono(500, 11), letterSpacing: '.14em', color: colourOf('kit-readiness-unknown') }}>READINESS UNKNOWN</span>
      )}
    </span>
  );
}
