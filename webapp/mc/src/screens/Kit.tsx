import { useEffect, useRef, useState, type ReactNode } from 'react';
import { registrySig } from '../api/derive';
import type { Loadout, PerkView, PhaseRefusal, Player, WeaponView } from '../api/types';
import { useStore } from '../store';
import { EvictButton } from '../ui/EvictButton';
import { CHAMFER, F, PERK_COLOR, T, TAB, fmtAge, roleOf, teamColor } from '../tokens';
import { takesAlt } from './gameSummary';
import { BTN_RESET, Blink, Brackets, DraftText, GhostButton, NumberCell, PanelHeader, Progress, ScreenHeader, SectionRule, Seg, SegBar, StripedSlot, Tag, ValueBox, onKey } from '../ui';

type Slot = 'primary' | 'secondary' | 'perk';   // A14: the perk is its own slot

/** The pool THIS player's gun is armed with, and whether the host set it deliberately.
 *  `loadout.overrides` (modes §1.1) wins over the game's health block per player: the compiler
 *  reads it in `_to_gc()` and it goes out on that player's `$PSET`. It is the handicap knob -- a
 *  younger player at double health, the solo side of a 2v1 -- so it must never be silent. */
export function poolOf(p: Player | undefined, gameHp: number, gameAr: number) {
  const ov = p?.loadout?.overrides ?? {};
  const hp = ov.max_hp ?? gameHp, armor = ov.max_armor ?? gameAr;
  const gamePool = gameHp + gameAr;
  return {
    hp, armor, set: ov.max_hp != null || ov.max_armor != null,
    hpSet: ov.max_hp != null, armorSet: ov.max_armor != null,
    // vs the pool everyone else is armed with; 2.0 reads as "twice as hard to drop"
    mult: gamePool > 0 ? (hp + armor) / gamePool : 1,
  };
}
const PRESET_LABEL: Record<string, string> = { open: 'OPEN', no_heavies: 'NO HEAVIES', snipers: 'SNIPERS ONLY', custom: 'CUSTOM RULES' };

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
    waiting: waiting.map(p => (p.display || `#${p.player_num}`).toUpperCase()),
  };
}
/** Three names, then a count: a squad of 12 must not wrap the header to three lines. */
const waitingNames = (names: string[]) => (names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3} MORE`);

/** The refusal, as one line the operator can act on.
 *
 *  The server's sentence is rendered VERBATIM and first — it is the one that decided. The names are
 *  appended only when that sentence does not already carry them, because MC's own copy usually does
 *  ("1 of 9 are not READY: ROCCO") and printing them twice reads as two different facts. The
 *  "CONTINUE ANYWAY?" prompt is always last: it is what the next tap will do. */
export function refusalLine(r: PhaseRefusal): string {
  const said = (r.error || '').trim() || 'MISSION CONTROL REFUSED THE ADVANCE';
  const names = (r.not_ready ?? []).map(n => n.toUpperCase()).filter(Boolean);
  const upper = said.toUpperCase();
  const missing = names.filter(n => !upper.includes(n));
  // just the names. The server's sentence has already said WHAT is wrong; repeating "ARE NOT READY"
  // after it makes one fact read as two.
  const who = missing.length ? ` — ${waitingNames(missing)}` : '';
  return `${said}${who}${/CONTINUE ANYWAY\?$/.test(upper) ? '' : ' — CONTINUE ANYWAY?'}`;
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
  return `MC REFUSED THE OVERRIDE — ${said.toUpperCase()}`;
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

/** What a tap on CONTINUE came back with. `refusal` is A27's 409: the SERVER would not advance, and
 *  it said who is not ready. It is not an error — the operator can force it — so it never goes to the
 *  red strip, which is for things that went wrong. */
export type GoResult = { ok: boolean; refusal?: PhaseRefusal };

/** The KIT -> LOBBY button: the ready count IS the status, and a short roster is a two-tap confirm. */
function ContinueToLobby({ gate, onGo }: { gate: ReturnType<typeof kitGate>; onGo: (force: boolean) => Promise<GoResult> }) {
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
  const armed = (blocked && armedFor === who) || refusal != null;
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
  if (refusal != null && refusedAt !== who) { setRefusal(null); setRefusedAt(null); setRefusedForce(false); }
  // ...and it expires on its own, like the A14 loadout confirm: an armed warning left on screen is a
  // trap, because the next tap is the one that moves everybody.
  // ...EXCEPT once the override itself has been refused: expiring that would quietly turn the next
  // tap back into the first tap of a two-tap gate, on a screen still showing a refusal. It is
  // cleared by CANCEL, by the roster changing, or by the advance going through.
  useEffect(() => { if (!armed || refusedForce) return; const h = setTimeout(() => { setArmedFor(null); setRefusal(null); setRefusedAt(null); }, 12_000); return () => clearTimeout(h); }, [armed, refusedForce]);
  // The count rides on BOTH labels. Dropping it while armed left the strip's only number as the
  // KITTED tally — a different count, of a different thing, at the moment the operator is deciding.
  const count = readyCount(gate, refusal);
  const label = `${armed ? 'CONTINUE ANYWAY' : 'CONTINUE'}${count} ▸`;
  const go = async () => {
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
    if (r.refusal) { setRefusal(r.refusal); setRefusedAt(who); setRefusedForce(forced); return; }
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
        <button type="button" className={blocked ? 'hov-warnbg' : 'hov-accbg'} onClick={go}
          title={armed ? `Move ${waitingNames(gate.waiting)} to the lobby before they have finished kitting`
                       : blocked ? `${gate.waiting.length} player${gate.waiting.length === 1 ? ' is' : 's are'} still kitting`
                       : undefined}
          style={{ font: F.chk(700, 12), letterSpacing: '.2em', padding: '9px 18px', whiteSpace: 'nowrap', ...TAB,
                   background: blocked ? 'transparent' : T.acc, color: blocked ? T.warn : T.accInk,
                   border: `1px solid ${blocked ? T.warn : 'transparent'}`, clipPath: CHAMFER.tl10,
                   cursor: 'pointer', minHeight: 44 }}>
          {label}
        </button>
      </span>
      {armed && !refusal && (
        // The CONSEQUENCE, on screen. Suppressed once the SERVER has refused: its line says the same
        // thing with better information, and two warnings about one roster read as two problems
        // (real-server walk, 2026-09-12). It used to live in a `title` tooltip — which the operator was
        // never going to hover, and which a touch console has no way to show at all — so the visible
        // line said only that someone was "waiting", not that a tap takes their screen away (F127).
        <span role="alert" data-continue-warn="1" style={{ font: F.chk(600, 12), letterSpacing: '.06em', color: T.warn, maxWidth: 'min(620px, calc(100vw - 48px))', textAlign: 'right', lineHeight: 1.45 }}>
          {waitingNames(gate.waiting)} {gate.waiting.length === 1 ? 'IS' : 'ARE'} STILL KITTING AND WILL LOSE THEIR SCREEN — CONTINUE ANYWAY?
        </span>
      )}
      {refusal && (
        // The SERVER's sentence and the SERVER's names, verbatim. Not the console's own count — when
        // the two disagree this is the one that decided, and the operator is about to override it.
        <span role="alert" data-continue-refusal="1" data-override-refused={refusedForce ? '1' : '0'}
          style={{ font: F.chk(600, 12), letterSpacing: '.06em', color: refusedForce ? T.bad : T.warn, maxWidth: 'min(620px, calc(100vw - 48px))', textAlign: 'right', lineHeight: 1.45 }}>
          {refusedForce ? overrideRefusedLine(refusal) : refusalLine(refusal)}
        </span>
      )}
      {!gate.known && gate.total > 0 && (
        <span style={{ font: F.mono(500, 11), letterSpacing: '.14em', color: T.micro }}>READINESS UNKNOWN</span>
      )}
    </span>
  );
}

export function Kit() {
  const { state, weapons, perks, selPlayer, setSelPlayer, run, api, setView } = useStore();
  const [registry, setRegistry] = useState<{ gun_id: string; sticker: string; ble: { tail?: string } }[]>([]);
  // Keyed on WHICH GUNS MC knows about: the picker used to be fetched ONCE on mount, so a scan run
  // from MUSTER after KIT had been opened never reached this dropdown and the operator saw a gun
  // list that predated the scan they had just watched. Keying it on `readiness.t` instead would
  // refetch ~4x/s, since that is a clock — the first fix for this was that storm (review 2026-09-01).
  const sig = registrySig(state);
  useEffect(() => { api.armory().then(setRegistry).catch(() => setRegistry([])); }, [api, sig]);
  const [verdicts, setVerdicts] = useState<Record<string, { verdict: 'pass' | 'issue'; note: string }>>({});
  // `as never` used to silence the shape mismatch here — the route returns rows with weapon_id and t
  // as well. Narrow to what this screen reads instead, so a route change is a type error, not a cast.
  useEffect(() => {
    api.rangeVerdicts()
      .then(v => setVerdicts(Object.fromEntries(
        Object.entries(v).map(([id, r]) => [id, { verdict: r.verdict, note: r.note }]))))
      .catch(() => setVerdicts({}));
  }, [api]);
  // The full persona list. `$PSET`'s trailing tokens are a positional voice pack and every family in
  // the bank carries one; the console offered two of ~15, and `female` was a duplicate of `male`.
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { api.getVoices().then(v => setVoices(v.voices)).catch(() => setVoices([])); }, [api]);
  const [newName, setNewName] = useState('');
  const [slot, setSlot] = useState<Slot>('primary');
  // A14 two-tap confirm: Easy Reload takes the ALT button, so picking it beside a second weapon (or a second weapon
  // beside it) drops the other one. The first tap says so on the tile; the second tap sends. Expires on its own.
  const [confirm, setConfirm] = useState<{ pid: string; key: string; label: string } | null>(null);
  useEffect(() => { if (!confirm) return; const h = setTimeout(() => setConfirm(null), 8_000); return () => clearTimeout(h); }, [confirm]);
  // The host's last write per slot. When choice=player BOTH the phone and the host may write; if the phone lands
  // a pick seconds after the host did, the card would just flip — say so instead (brx-opus2, 2026-08-27).
  // Kept ABOVE the `!state` early return. It used to sit 40 lines further down, so the render that
  // first received a snapshot would run two more hooks than the one before it — "rendered more hooks
  // than during the previous render". Latent only because `App`'s `Screen()` gates on the same
  // condition and `state` is never re-nulled; oxlint had been reporting it as an ERROR throughout,
  // which is its own lesson. `test/screens.test.tsx` now mounts every screen with no snapshot and
  // then re-renders the SAME tree with one, which is what makes React compare the two hook lists.
  const [hostPick, setHostPick] = useState<{ pid: string; slot: Slot; id: string | null; label: string; t: number } | null>(null);
  useEffect(() => { if (!hostPick) return; const h = setTimeout(() => setHostPick(null), 12_000); return () => clearTimeout(h); }, [hostPick]);
  if (!state) return null;
  const players = state.players;
  const sp = players.find(p => p.player_id === selPlayer) ?? players[0];
  const pol = state.config.loadout_policy?.primary ? state.config.loadout_policy : undefined;   // older MC / pre-A10 session: no rules
  const pool = state.loadout_pool ?? { primary: weapons.map(w => w.weapon_id), secondary_weapons: weapons.map(w => w.weapon_id), perks: perks.map(k => k.perk_id) };
  const trying = state.kit.trying;
  const browsing = state.kit.browsing ?? {};
  // counts only players we can actually reach: a loadout with no phone on the net cannot be pushed
  const kitted = players.filter(p => (p.loadout?.weapons?.length ?? 0) > 0 && p.team_id && p.gun_id
    && state.nodes.some(n => n.player_id === p.player_id)).length;
  const gate = kitGate(players);            // F127: who CONTINUE would take the kit screen away from
  const node = sp ? state.nodes.find(n => n.player_id === sp.player_id) : undefined;

  // Gun options = the armory registry PLUS any connected node whose gun is not registered.
  // The armory (`~/.brx-mcp/armory.json`) is built by cabling a tagger over USB, so a field Mac that
  // has never done that has an EMPTY registry — which used to leave this select with only "NO GUN"
  // and no way to kit anyone. Muster's device-first claim already falls back to the gun tail (which
  // the server matcher accepts, state.py `_find_player_for_gun` second pass); this does the same.
  const gunOptions: { gun_id: string; label: string }[] = [];
  const seenGun = new Set<string>();
  const addGun = (gun_id: string, label: string) => {
    const k = gun_id.toUpperCase();
    if (seenGun.has(k)) return;      // one option per gun: a registry row whose gun_id IS a node's
    seenGun.add(k);                  // tail would otherwise be emitted twice, with a duplicate key
    gunOptions.push({ gun_id, label });
  };
  registry.forEach(r => addGun(r.gun_id, `${r.sticker}${r.ble?.tail ? `-${r.ble.tail}` : ''}`));
  state.nodes
    .filter(n => n.gun_tail && !registry.some(r => (r.ble?.tail || '').toUpperCase() === n.gun_tail!.toUpperCase()))
    .forEach(n => addGun(n.gun_tail!, `${n.gun_name || n.gun_tail} · UNREGISTERED`));
  // keep an already-assigned gun selectable even if its node dropped and it was never registered
  if (sp?.gun_id) addGun(sp.gun_id, `${sp.gun_id} · OFFLINE`);   // keep an assigned gun selectable if its node dropped
  // <select> matches option values case-SENSITIVELY, so a player whose gun_id differs only in case
  // from the option would silently display "— NO GUN —" (review 2026-08-31).
  const selectedGun = gunOptions.find(o => o.gun_id.toUpperCase() === (sp?.gun_id ?? '').toUpperCase())?.gun_id ?? '';
  const patch = (p: Partial<Player>) => sp && run(() => api.patchPlayer(sp.player_id, p));

  const wById = (id?: string | null) => weapons.find(w => w.weapon_id === id);
  const kById = (id?: string | null) => perks.find(k => k.perk_id === id);
  const lo: Loadout = sp?.loadout ?? { weapons: [] };
  const gameHp = state.config.health?.max_hp ?? 100, gameAr = state.config.health?.max_armor ?? 0;
  const playerPool = poolOf(sp, gameHp, gameAr);
  const primary = wById(lo.weapons?.[0]?.weapon_id);
  const secondaryW = wById(lo.weapons?.[1]?.weapon_id);
  const perk = kById(lo.perk);
  const secRule = pol?.secondary, primRule = pol?.primary, perkRule = pol?.perk;
  const ruleOf = (s: Slot) => (s === 'primary' ? primRule : s === 'secondary' ? secRule : perkRule);
  const slotLocked = (s: Slot) => { const r = ruleOf(s); return r?.choice === 'fixed' || r?.choice === 'off'; };
  // what the arsenal below is showing
  const showKind: 'weapon' | 'perk' = slot === 'perk' ? 'perk' : 'weapon';
  const focusItem: WeaponView | PerkView | undefined = slot === 'primary' ? primary : slot === 'secondary' ? secondaryW : perk;
  const prim0 = lo.weapons?.[0] ?? { weapon_id: 'assault_rifle' };

  const setLoadout = async (next: Loadout, tryWeapon?: string, note?: { slot: Slot; id: string | null; label: string }) => {
    if (!sp) return;
    setConfirm(null);
    const ok = await patch({ loadout: { ...(sp.loadout ?? {}), ...next } });
    if (ok === undefined) return;   // the server refused (error strip shows why) — no override note, no try-out (review #1)
    if (note) setHostPick({ pid: sp.player_id, ...note, t: Date.now() });
    if (tryWeapon && !state.lobby.pushed) await run(() => api.tryout(sp.player_id, tryWeapon));
  };
  /** The first tap on a conflicting tile arms the confirm and returns true; the second tap (same tile) returns false = go. */
  const needsConfirm = (key: string, label: string) => {
    if (!sp) return true;
    if (confirm && confirm.pid === sp.player_id && confirm.key === key) return false;
    setConfirm({ pid: sp.player_id, key, label }); return true;
  };
  const pickPrimary = (w: WeaponView) => setLoadout({ weapons: [{ weapon_id: w.weapon_id }, ...(lo.weapons ?? []).slice(1, 2)], perk: lo.perk ?? null }, w.weapon_id, { slot: 'primary', id: w.weapon_id, label: w.name });
  // A14: a second weapon keeps the perk — unless the perk is the ALT-button one, which it then drops (after a confirm)
  const pickSecondary = (w: WeaponView) => {
    const drops = takesAlt(perk) ? perk : undefined;
    if (drops && needsConfirm(`weapon:${w.weapon_id}`, `DROPS ${drops.name.toUpperCase()} — TAP AGAIN`)) return;
    return setLoadout({ weapons: [prim0, { weapon_id: w.weapon_id }], perk: drops ? null : (lo.perk ?? null) }, w.weapon_id, { slot: 'secondary', id: w.weapon_id, label: w.name });
  };
  // A14: a perk rides beside the weapons — Easy Reload is the one that takes the second weapon with it (after a confirm)
  const pickPerk = async (k: PerkView) => {
    const drops = takesAlt(k) ? secondaryW : undefined;
    if (drops && needsConfirm(`perk:${k.perk_id}`, `DROPS THEIR ${drops.name.toUpperCase()} — TAP AGAIN`)) return;
    await setLoadout({ weapons: drops ? [prim0] : (lo.weapons ?? [prim0]), perk: k.perk_id }, undefined, { slot: 'perk', id: k.perk_id, label: k.name });
    if (drops && sp && trying[sp.player_id] === drops.weapon_id) await run(() => api.endTryout(sp.player_id));   // the dropped secondary was being tried out: quiet the gun (e2e lane finding)
  };
  // A per-player POOL override. Sent as part of the loadout because that is where the server keeps
  // it; `weapons` must ride along or the PATCH is rejected as a shape error (state.py _clean_loadout).
  // Passing `undefined` drops the key from the JSON, which is how the server is told to clear it.
  const setPool = (next: { max_hp?: number; max_armor?: number } | undefined) => {
    if (!sp) return;
    const weapons = lo.weapons?.length ? lo.weapons : [prim0];
    return setLoadout({ weapons, perk: lo.perk ?? null, overrides: next });
  };
  const patchPool = (k: 'max_hp' | 'max_armor', v: number) => {
    const cur = lo.overrides ?? {};
    return setPool({ ...cur, [k]: v });
  };

  const clearSecondary = () => setLoadout({ weapons: [prim0], perk: lo.perk ?? null }, undefined, { slot: 'secondary', id: null, label: 'EMPTY' });
  const clearPerk = () => setLoadout({ weapons: lo.weapons ?? [prim0], perk: null }, undefined, { slot: 'perk', id: null, label: 'NO PERK' });
  // did the phone overwrite the host's pick within the hold window?
  const overridden = (s: Slot) => {
    const h = hostPick; if (!h || h.pid !== sp?.player_id || h.slot !== s) return null;
    const cur = s === 'primary' ? (primary?.weapon_id ?? null) : s === 'secondary' ? (secondaryW?.weapon_id ?? null) : (perk?.perk_id ?? null);
    return cur !== h.id ? h : null;
  };
  const reapply = (h: { slot: Slot; id: string | null }) => {
    if (h.slot === 'primary') { const w = wById(h.id); if (w) pickPrimary(w); return; }
    if (h.slot === 'perk') { const k = kById(h.id); if (k) pickPerk(k); else clearPerk(); return; }
    const w = wById(h.id); if (w) pickSecondary(w); else clearSecondary();
  };
  const confirmFor = (key: string) => (confirm && sp && confirm.pid === sp.player_id && confirm.key === key ? confirm.label : null);

  const rulesChip = pol && (
    <button type="button" className="hov-acc" onClick={() => setView('build')} title="Loadout rules are set in BUILD"
      style={{ ...BTN_RESET, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', border: `1px solid ${T.line}`, minHeight: 36, cursor: 'pointer' }}>
      <span style={{ width: 6, height: 6, background: PERK_COLOR }} />
      <span style={{ font: F.mono(600, 10), letterSpacing: '.2em', color: T.dim }}>GAME RULES</span>
      <span style={{ font: F.chk(700, 11), letterSpacing: '.14em' }}>{PRESET_LABEL[pol.preset] ?? pol.preset.toUpperCase()}</span>
      {!pol.hud_select && <span style={{ font: F.mono(500, 9), letterSpacing: '.14em', color: T.micro }}>· PHONE PICKS OFF</span>}
    </button>
  );

  return (
    <div className="screen">
      <ScreenHeader kicker="[ A3 // KIT-OUT ]" title="Kit Each Player" right={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {rulesChip}
          <Progress n={kitted} total={players.length} label="KITTED" />
          {/* The ready tally used to sit beside the button as its own number and the button ignored it.
              It is ON the button now: one status, and it is the one the tap acts on (F127). */}
          {/* `run()` returns undefined on a THROW and the call's own value otherwise — and a phase change
              is a body nobody reads, so `api.setPhase` resolving `undefined` (a 204, or any api that
              does not echo) would have read as a refusal and stranded the operator on KIT with no error
              strip to explain it. Return the sentinel from INSIDE `run`, so the only refusal is a throw
              (review 2026-09-12). */}
          <ContinueToLobby gate={gate} onGo={async force => {
            // A27: a 409 is a REFUSAL, not a failure — it is caught here so it never reaches the red
            // strip, and handed back so the button can turn into the confirm that carries `force`.
            let refusal: PhaseRefusal | undefined;
            const ok = await run(async () => {
              try {
                await api.setPhase('lobby', force || undefined);
                return true;
              } catch (e) {
                const err = e as Error & { status?: number; body?: PhaseRefusal };
                if (err.status === 409) { refusal = err.body ?? { error: err.message }; return false; }
                throw e;                          // anything else really is an error
              }
            });
            if (refusal) return { ok: false, refusal };
            if (!ok) return { ok: false };        // threw: the error strip says why, stay on KIT
            setView('lobby');
            return { ok: true };
          }} />
        </span>} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        {/* roster */}
        <div className="kit-roster" style={{ flex: '1 1 250px', maxWidth: 330, display: 'flex', flexDirection: 'column' }}>
          <div style={{ border: `1px solid ${T.line}`, borderBottom: 'none' }}><PanelHeader label="SQUAD ROSTER" right={<span style={{ font: F.mono(500, 10), letterSpacing: '.14em', color: T.micro }}>{players.length} OPERATORS</span>} /></div>
          <div className="kit-roster-rows" style={{ display: 'flex', flexDirection: 'column', gap: 3, border: `1px solid ${T.line}`, padding: 6, background: T.panelDeep }}>
            {players.map(pl => {
              const on = pl.player_id === sp?.player_id;
              const tw = trying[pl.player_id];
              const isBrowsing = !!browsing[pl.player_id];
              const plo = pl.loadout ?? { weapons: [] };
              const p0 = wById(plo.weapons?.[0]?.weapon_id), p1 = wById(plo.weapons?.[1]?.weapon_id), pk = kById(plo.perk);
              // A restored roster shows players whose phone and tagger are long gone. Calling that
              // KITTED is a lie — the loadout exists, the gear does not (field 2026-09-02).
              const liveNode = state.nodes.some(n => n.player_id === pl.player_id);
              const kittedRow = !!(p0 && pl.team_id && pl.gun_id);
              let chip: ReactNode;
              if (tw) chip = <span style={{ font: F.chk(700, 9), letterSpacing: '.14em', color: T.accInk, background: T.warn, padding: '2px 7px', animation: 'tryPulse 1.6s infinite', whiteSpace: 'nowrap' }}>TRYING {(wById(tw)?.name ?? tw).toUpperCase()}</span>;
              else if (pl.ready) chip = <span style={{ font: F.chk(700, 10), letterSpacing: '.14em', color: T.ok }}>READY ✓</span>;
              else if (isBrowsing) chip = <span style={{ font: F.chk(700, 10), letterSpacing: '.14em', color: T.acc, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Blink color={T.acc} period={1.2} size={6} />PICKING…</span>;
              else if (!liveNode) chip = <span style={{ font: F.chk(700, 10), letterSpacing: '.14em', color: T.micro }}>NO PHONE</span>;
              else chip = <span style={{ font: F.chk(700, 10), letterSpacing: '.14em', color: kittedRow ? T.dim : T.micro }}>{kittedRow ? 'KITTED' : pl.gun_id ? 'FITTING' : 'NO GUN'}</span>;
              return (
                <div key={pl.player_id} className="hov-acc kit-row" role="button" tabIndex={0} aria-pressed={on} onClick={() => setSelPlayer(pl.player_id)} onKeyDown={onKey(() => setSelPlayer(pl.player_id))}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: on ? 'rgba(57,180,255,.06)' : 'transparent', border: `1px solid ${on ? T.acc : 'transparent'}`, cursor: 'pointer', minHeight: 44 }}>
                  <span style={{ width: 4, alignSelf: 'stretch', background: teamColor(pl.team_id) }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', font: F.chk(700, 14), letterSpacing: '.14em' }}><span style={{ color: T.micro, font: F.mono(500, 10) }}>#{pl.player_num} </span>{pl.display}</span>
                    <span style={{ display: 'flex', gap: 8, font: F.mono(500, 10), letterSpacing: '.06em', color: T.micro, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                      <span>{pl.gun_id ?? 'NO GUN'}</span>
                      <span style={{ color: T.faint }}>·</span>
                      <span style={{ color: T.dim, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p0 ? shortName(p0.name) : '—'}
                        <span style={{ color: T.faint }}> + </span>
                        {p1 ? shortName(p1.name) : <span style={{ color: T.faint }}>NONE</span>}
                        {pk && <span style={{ color: PERK_COLOR }}> ◆ {pk.name.toUpperCase()}</span>}</span>
                      {(() => { const pp = poolOf(pl, gameHp, gameAr); return pp.set
                        ? <span data-pool-chip={pl.player_id} title={`Armed at ${pp.hp} HP / ${pp.armor} AR — the game pool is ${gameHp} / ${gameAr}`}
                            style={{ color: T.warn, whiteSpace: 'nowrap' }}>◆ {pp.hp}/{pp.armor} POOL</span>
                        : null; })()}
                    </span>
                  </span>
                  {chip}
                </div>
              );
            })}
            <form onSubmit={e => { e.preventDefault(); if (newName.trim()) { run(() => api.addPlayer({ display: newName.trim() })); setNewName(''); } }}
              style={{ display: 'flex', gap: 6, padding: '6px 4px 2px' }}>
              <input className="textbox" value={newName} onChange={e => setNewName(e.target.value)} placeholder="+ ADD OPERATOR" aria-label="new operator callsign"
                style={{ flex: 1, font: F.chk(600, 12), letterSpacing: '.1em', borderBottomColor: T.line, minHeight: 44 }} />
              <GhostButton size={10} pad="4px 10px">ADD</GhostButton>
            </form>
          </div>
        </div>

        {/* detail */}
        {sp && (
          <div style={{ flex: '3 1 560px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            {/* identity strip */}
            <div style={{ background: T.panel, border: `1px solid ${T.line}`, padding: '16px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 28px', clipPath: CHAMFER.tr14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ width: 6, height: 46, background: teamColor(sp.team_id) }} />
                <div>
                  <div style={{ font: F.mono(500, 9), letterSpacing: '.26em', color: T.micro }}>OPERATOR
                    <span style={{ marginLeft: 10, color: T.acc }}>#<PlayerNum key={sp.player_id} value={sp.player_num} onCommit={n => patch({ player_num: n })} /></span>
                  </div>
                  <DraftText key={sp.player_id} value={sp.display} ariaLabel="operator callsign" transform={s => s.toUpperCase()} onCommit={v => patch({ display: v })}
                    style={{ font: F.osw(700, 32), letterSpacing: '.1em', width: `${Math.max(6, sp.display.length + 1)}ch`, minHeight: 44 }} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ font: F.mono(500, 9), letterSpacing: '.22em', color: T.micro }}>TEAM</span>
                <span role="group" aria-label="team" style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {(state.config.mode === 'ffa' ? ['ffa'] : state.config.teams.map(tm => tm.team_id)).map(t => {
                    const on = sp.team_id === t;
                    const col = state.teams.find(tm => tm.team_id === t)?.color ?? teamColor(t);
                    return (
                      <button key={t} type="button" className="hit44" onClick={() => patch({ team_id: t })} aria-pressed={on}
                        style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.14em', padding: '8px 14px', background: on ? col : 'transparent', color: on ? T.accInk : col, border: `1px solid ${on ? col : T.line}`, cursor: 'pointer', minHeight: 36, display: 'inline-flex', alignItems: 'center' }}>
                        {t.toUpperCase()}
                      </button>
                    );
                  })}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ font: F.mono(500, 9), letterSpacing: '.22em', color: T.micro }}>VOICE</span>
                {voices.length > 2 ? (
                  <select aria-label={`voice for ${sp.display}`} value={sp.voice ?? 'male'} onChange={e => patch({ voice: e.target.value })}
                    style={{ background: T.inset, color: T.ink, border: `1px solid ${T.line2}`, font: F.mono(600, 11), letterSpacing: '.06em', padding: '6px 8px', minHeight: 36, cursor: 'pointer' }}>
                    {/* No "unverified" marker here. A bare `·` in a native <select> has no legend and
                        no tooltip — Tony asked what it meant, which is the answer. Whether a pack has
                        been confirmed BY EAR is a developer's concern, and the operator finds out the
                        instant they pick one. The count lives on the Debug page instead. */}
                    {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                ) : (
                  <Seg value={sp.voice === 'female' ? 'female' : 'male'} options={[{ value: 'male', label: 'MALE' }, { value: 'female', label: 'FEMALE' }]} onChange={v => patch({ voice: v })} pad="4px 12px" />
                )}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: T.inset, border: `1px solid ${T.line}` }}>
                <Blink color={node ? T.ok : T.bad} />
                <select aria-label={`gun for ${sp.display}`} value={selectedGun} onChange={e => patch({ gun_id: e.target.value || null })}
                  style={{ background: T.inset, color: T.ink, border: `1px solid ${T.line2}`, font: F.mono(600, 11), letterSpacing: '.06em', padding: '6px 8px', minHeight: 36, cursor: 'pointer' }}>
                  <option value="">— NO GUN —</option>
                  {gunOptions.map(o => {
                    const takenBy = players.find(q => q.player_id !== sp.player_id && (q.gun_id || '').toUpperCase() === o.gun_id.toUpperCase());
                    return <option key={o.gun_id} value={o.gun_id} disabled={!!takenBy}>{o.label}{takenBy ? ` · ${takenBy.display}` : ''}</option>;
                  })}
                </select>
                <span style={{ font: F.mono(500, 11), letterSpacing: '.06em', color: node ? T.ok : sp.gun_id ? T.bad : T.micro }}>{node ? `LINKED ${fmtAge(node.last_seen_ms)}` : sp.gun_id ? 'NO NODE' : 'PICK A GUN'}</span>
                {node && <EvictButton nodeId={node.node_id} />}
              </div>
            </div>

            {/* loadout rail + hero */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' }}>
              <div className="kit-rail" style={{ flex: '1 1 280px', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SlotCard label="PRIMARY" slot="primary" active={slot === 'primary'} onClick={() => setSlot('primary')} rule={primRule} item={primary} kind="weapon" required
                  overridden={overridden('primary')} onReapply={reapply} />
                <SlotCard label="SECONDARY" slot="secondary" active={slot === 'secondary'} onClick={() => setSlot('secondary')} rule={secRule}
                  item={secondaryW} kind={secondaryW ? 'weapon' : 'none'}
                  overridden={overridden('secondary')} onReapply={reapply}
                  onClear={secondaryW && !slotLocked('secondary') ? clearSecondary : undefined} />
                <SlotCard label="PERK" slot="perk" active={slot === 'perk'} onClick={() => setSlot('perk')} rule={perkRule}
                  item={perk} kind={perk ? 'perk' : 'none'}
                  overridden={overridden('perk')} onReapply={reapply}
                  onClear={perk && !slotLocked('perk') ? clearPerk : undefined} />
                <PoolCard hp={gameHp} armor={gameAr} pool={playerPool} onSet={patchPool} onClear={() => setPool(undefined)} name={sp.display} />
                <div style={{ font: F.mono(500, 9), letterSpacing: '.14em', color: T.micro, padding: '2px 4px' }}>
                  {pol?.hud_select ? '▲ PLAYERS PICK ON THEIR PHONE — ANYTHING YOU SET HERE OVERRIDES IT AND SHOWS ON THEIR SCREEN' : '▲ PHONE PICKS ARE OFF — YOU KIT EVERY PLAYER HERE'}
                </div>
              </div>

              {/* hero: the focused slot's item */}
              <Brackets color={slot === 'perk' ? PERK_COLOR : T.acc} style={{ flex: '2 1 420px', minWidth: 0, padding: 18, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
                {!focusItem ? (
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, minHeight: 150 }}>
                    <div style={{ font: F.osw(700, 26), letterSpacing: '.08em', color: T.dim }}>
                      {slot === 'perk' ? (perkRule?.choice === 'off' ? 'PERKS ARE OFF FOR THIS GAME' : 'NO PERK') : secRule?.choice === 'off' ? 'SECONDARY IS OFF FOR THIS GAME' : 'NO SECONDARY'}
                    </div>
                    <div style={{ font: F.chk(500, 13), color: T.dim, maxWidth: '54ch', lineHeight: 1.5 }}>
                      {slot === 'perk'
                        ? (perkRule?.choice === 'off' ? 'The ruleset switched perks off for everyone. Change it in GAMES.' : 'A perk rides beside the weapons — pick one below, or leave it empty; that is a valid kit. Easy Reload takes the ALT button, so it drops the second weapon.')
                        : secRule?.choice === 'off' ? 'The ruleset switched slot 2 off for everyone. Change it in BUILD.' : 'The alt-fire button does nothing. Pick a second weapon from the arsenal below — or leave it empty; that is a valid kit.'}
                    </div>
                  </div>
                ) : 'weapon_id' in focusItem ? (
                  <WeaponHero w={focusItem} slot={slot} sp={sp} tryingId={trying[sp.player_id]} pushed={state.lobby.pushed} verdicts={verdicts} setVerdicts={setVerdicts} />
                ) : (
                  <PerkHero k={focusItem} />
                )}
              </Brackets>
            </div>

            {/* arsenal for the focused slot */}
            <div>
              <ArsenalHeader slot={slot} rule={ruleOf(slot)} pool={pool} weapons={weapons} preset={pol?.preset}
                onClear={slot === 'secondary' && secondaryW && !slotLocked('secondary') ? clearSecondary : slot === 'perk' && perk && !slotLocked('perk') ? clearPerk : undefined} onBuild={() => setView('build')} />
              {ruleOf(slot)?.choice === 'off' ? null : showKind === 'weapon' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(152px,1fr))', gap: 8 }}>
                  {weapons.map(w => {
                    const allowed = (slot === 'primary' ? pool.primary : pool.secondary_weapons).includes(w.weapon_id);
                    const on = slot === 'primary' ? w.weapon_id === primary?.weapon_id : w.weapon_id === secondaryW?.weapon_id;
                    const fixed = ruleOf(slot)?.choice === 'fixed';
                    const dis = !allowed || (fixed && !on);
                    const role = roleOf(w.role, w.cls);
                    const ask = slot === 'secondary' ? confirmFor(`weapon:${w.weapon_id}`) : null;
                    return (
                      <div key={w.weapon_id} className={dis ? undefined : 'hov-acc'} role="button" tabIndex={dis ? -1 : 0} aria-pressed={on} aria-disabled={dis || undefined}
                        aria-label={`${w.name}, ${role.label}, magazine ${w.clip}${dis ? ', not allowed by the rules' : ''}`}
                        title={!allowed ? 'Not allowed by this game’s rules' : fixed ? 'Fixed by the ruleset' : undefined}
                        onClick={() => { if (!dis) (slot === 'primary' ? pickPrimary : pickSecondary)(w); }} onKeyDown={onKey(() => { if (!dis) (slot === 'primary' ? pickPrimary : pickSecondary)(w); })}
                        style={{ background: on ? 'rgba(57,180,255,.08)' : dis ? T.panelDeep : T.panel, border: `1px solid ${ask ? T.warn : on ? T.acc : T.line}`, padding: 8, cursor: dis ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', gap: 7, minHeight: 44 }}>
                        {ask && <span role="alert" style={{ font: F.chk(700, 10), letterSpacing: '.12em', color: T.warn }}>▲ {ask}</span>}
                        <StripedSlot height={64} style={{ background: `url(assets/weapons/${w.weapon_id}.jpg) center/contain no-repeat, repeating-linear-gradient(45deg,${T.slot} 0 6px,${T.panel} 6px 12px)`, opacity: dis ? .25 : 1, filter: dis ? 'grayscale(1)' : undefined }}
                          corner={<>
                            <span style={{ position: 'absolute', top: 3, right: 5, font: F.mono(600, 8), letterSpacing: '.14em', color: role.color }}>{role.label}</span>
                            {on && <span style={{ position: 'absolute', top: 3, left: 5, font: F.chk(700, 8), letterSpacing: '.14em', color: T.accInk, background: T.acc, padding: '1px 5px' }}>{slot === 'primary' ? 'PRIMARY' : 'SECONDARY'}</span>}
                          </>} />
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                          {dis && <Lock color={T.micro} size={10} />}
                          <span style={{ font: F.chk(700, 12), letterSpacing: '.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: dis ? T.dim : T.ink, flex: 1 }}>{w.name}</span>
                          {w.caution && <span title={w.caution} aria-label={w.caution} style={{ font: F.chk(700, 10), color: T.bad }}>▲</span>}
                          <span style={{ font: F.osw(600, 11), ...TAB, color: T.micro }} title={`magazine ${w.clip}`}>MAG {w.clip}</span>
                          {verdicts[w.weapon_id] && <span title={verdicts[w.weapon_id].note || undefined} style={{ font: F.chk(700, 10), color: verdicts[w.weapon_id].verdict === 'pass' ? T.ok : T.bad }}>{verdicts[w.weapon_id].verdict === 'pass' ? '✓' : '✗'}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 8 }}>
                  {perks.map(k => {
                    const allowed = pool.perks.includes(k.perk_id);
                    const on = k.perk_id === perk?.perk_id;
                    const fixed = perkRule?.choice === 'fixed';
                    const dis = !allowed || (fixed && !on);
                    const ask = confirmFor(`perk:${k.perk_id}`);
                    return (
                      <div key={k.perk_id} className={dis ? undefined : 'hov-acc'} role="button" tabIndex={dis ? -1 : 0} aria-pressed={on} aria-disabled={dis || undefined}
                        aria-label={`${k.name} perk${dis ? ', not allowed by the rules' : ''}`} title={!allowed ? 'Not allowed by this game’s rules' : takesAlt(k) && secondaryW ? `Takes the ALT button — drops their ${secondaryW.name}` : undefined}
                        onClick={() => { if (!dis) pickPerk(k); }} onKeyDown={onKey(() => { if (!dis) pickPerk(k); })}
                        style={{ background: on ? 'rgba(196,139,255,.08)' : T.panel, border: `1px solid ${ask ? T.warn : on ? PERK_COLOR : T.line}`, padding: 10, cursor: dis ? 'not-allowed' : 'pointer', display: 'flex', gap: 12, alignItems: 'center', minHeight: 44, opacity: dis ? .32 : 1, flexWrap: 'wrap' }}>
                        {ask && <span role="alert" style={{ flex: '1 0 100%', font: F.chk(700, 10), letterSpacing: '.12em', color: T.warn }}>▲ {ask}</span>}
                        <span style={{ width: 52, height: 52, flex: 'none', display: 'grid', placeItems: 'center', background: T.inset, border: `1px solid ${on ? PERK_COLOR : T.line}` }}><PerkGlyph id={k.perk_id} size={30} color={on ? PERK_COLOR : T.dim} /></span>
                        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ font: F.chk(700, 13), letterSpacing: '.05em' }}>{k.name}</span>
                            {!k.verified && <span title="Effect not yet proven on hardware" style={{ font: F.mono(500, 8), letterSpacing: '.14em', color: T.warn }}>UNPROVEN</span>}
                          </span>
                          <span style={{ font: F.mono(600, 10), letterSpacing: '.1em', color: PERK_COLOR }}>{effectLine(k)}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- pieces ---------- */

function SlotCard({ label, slot, active, onClick, rule, item, kind, required, onClear, overridden, onReapply }:
  { label: string; slot: Slot; active: boolean; onClick: () => void; rule?: { choice: string } | null; item?: WeaponView | PerkView; kind: 'weapon' | 'perk' | 'none'; required?: boolean; onClear?: () => void;
    overridden?: { slot: Slot; id: string | null; label: string } | null; onReapply?: (h: { slot: Slot; id: string | null }) => void }) {
  const choice = rule?.choice ?? 'player';
  const locked = choice === 'fixed' || choice === 'off';
  const right = choice === 'fixed' ? 'FIXED BY THE GAME' : choice === 'off' ? 'OFF FOR THIS GAME' : choice === 'host' ? 'HOST PICKS' : 'PLAYER PICKS · YOU CAN OVERRIDE';
  const isPerk = kind === 'perk' && item && 'perk_id' in item;
  const color = isPerk ? PERK_COLOR : T.acc;
  const empty = kind === 'none';
  // `✕ CLEAR` is absolutely positioned in the card's bottom-right corner, and the line it lands on is
  // the weapon's `ROLE · MAG 12 · RES 24` — which ran straight under it on every SECONDARY plate in
  // every Kit screenshot we have (review 2026-09-12). Absolute position takes an element out of flow,
  // so nothing was ever going to move for it: the room has to be RESERVED. The ammo line then WRAPS
  // into that narrower column rather than ellipsising, because truncating it to "SIDEARM · MAG 7 · R…"
  // trades one unreadable reserve count for a missing one.
  const clearW = onClear ? 96 : 0;
  return (
    <div role="button" tabIndex={0} aria-pressed={active} onClick={onClick} onKeyDown={onKey(onClick)} className="hov-acc"
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', minHeight: 96, cursor: 'pointer',
        background: active ? (isPerk ? 'rgba(196,139,255,.07)' : 'rgba(57,180,255,.07)') : T.panel,
        borderTop: `1px ${empty ? 'dashed' : 'solid'} ${active ? color : T.line}`, borderRight: `1px ${empty ? 'dashed' : 'solid'} ${active ? color : T.line}`, borderBottom: `1px ${empty ? 'dashed' : 'solid'} ${active ? color : T.line}`, borderLeft: `3px solid ${active ? color : T.line2}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ font: F.chk(700, 12), letterSpacing: '.22em', color: active ? color : T.dim }}>{active ? '▸ ' : ''}{label}</span>
        <span style={{ font: F.mono(500, 8.5), letterSpacing: '.12em', color: locked ? T.warn : T.micro, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}>{locked && <Lock color={T.warn} />}{right}</span>
      </div>
      {empty ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48 }}>
          <span style={{ width: 64, height: 44, flex: 'none', border: `1px dashed ${T.line2}`, display: 'grid', placeItems: 'center', font: F.osw(700, 20), color: T.faint }}>—</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: F.osw(700, 18), letterSpacing: '.06em', color: T.dim }}>{choice === 'off' ? 'OFF' : slot === 'perk' ? 'NO PERK' : 'EMPTY'}</span>
            <span style={{ font: F.chk(500, 11), color: T.micro }}>{choice === 'off' ? (slot === 'perk' ? 'This game has no perks — change it in GAMES' : 'This game has no slot 2 — change it in GAMES') : slot === 'perk' ? 'Rides beside the weapons · tap to pick' : 'Alt-fire does nothing · tap to pick'}</span>
          </span>
        </div>
      ) : item && 'weapon_id' in item ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, paddingRight: clearW }}>
          <span style={{ width: 84, height: 48, flex: 'none', background: `url(assets/weapons/${item.weapon_id}.jpg) center/contain no-repeat, ${T.inset}`, border: `1px solid ${T.line}` }} />
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: F.osw(700, 18), letterSpacing: '.06em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name.toUpperCase()}</span>
            <span data-slot-ammo="1" style={{ font: F.mono(500, 10), letterSpacing: '.1em', color: T.micro, lineHeight: 1.35 }}><span style={{ color: roleOf(item.role, item.cls).color }}>{roleOf(item.role, item.cls).label}</span> · MAG {item.clip} · RES {item.reserve}</span>
          </span>
        </div>
      ) : item && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, paddingRight: clearW }}>
          <span style={{ width: 48, height: 48, flex: 'none', display: 'grid', placeItems: 'center', background: T.inset, border: `1px solid ${PERK_COLOR}` }}><PerkGlyph id={item.perk_id} size={28} color={PERK_COLOR} /></span>
          <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ font: F.osw(700, 18), letterSpacing: '.06em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name.toUpperCase()}</span>
            <span data-slot-ammo="1" style={{ font: F.mono(500, 10), letterSpacing: '.1em', color: PERK_COLOR, lineHeight: 1.35 }}>PERK · {effectLine(item)}</span>
          </span>
        </div>
      )}
      {onClear && (
        <button type="button" data-slot-clear={slot} onClick={e => { e.stopPropagation(); onClear(); }} aria-label={`clear ${slot}`} title={slot === 'perk' ? 'No perk' : 'Leave slot 2 empty'} className="hov-acc-ink"
          style={{ ...BTN_RESET, position: 'absolute', right: 8, bottom: 8, width: clearW - 12, textAlign: 'right', font: F.mono(600, 9), letterSpacing: '.14em', color: T.micro, padding: '8px 10px', minHeight: 36, boxSizing: 'border-box' }}>✕ CLEAR</button>
      )}
      {required && !item && <span style={{ font: F.mono(500, 9), color: T.bad }}>A PRIMARY IS REQUIRED</span>}
      {overridden && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', font: F.mono(600, 9.5), letterSpacing: '.12em', color: T.warn }}>
          ▲ CHANGED FROM THEIR PHONE — YOURS WAS {overridden.label.toUpperCase()}
          <button type="button" onClick={e => { e.stopPropagation(); onReapply?.(overridden); }} className="hov-warnbg"
            style={{ ...BTN_RESET, font: F.chk(700, 10), letterSpacing: '.16em', color: T.warn, border: `1px solid ${T.warn}`, padding: '7px 12px', minHeight: 36 }}>REAPPLY MINE</button>
        </div>
      )}
    </div>
  );
}

function ArsenalHeader({ slot, rule, pool, weapons, preset, onClear, onBuild }:
  { slot: Slot; rule?: { choice: string; kinds?: string[] } | null; pool: { primary: string[]; secondary_weapons: string[]; perks: string[] }; weapons: WeaponView[];
    preset?: string; onClear?: () => void; onBuild: () => void }) {
  const choice = rule?.choice ?? 'player';
  const nAllowed = slot === 'primary' ? pool.primary.length : pool.secondary_weapons.length;
  const presetTxt = preset && preset !== 'open' ? ` · ${PRESET_LABEL[preset] ?? preset.toUpperCase()}` : '';
  const sidearms = !!rule?.kinds && !rule.kinds.includes('weapon') && rule.kinds.includes('sidearm');   // A12: pistols only
  const summary = choice === 'fixed' ? 'FIXED BY THE GAME' : choice === 'off' ? 'OFF FOR THIS GAME'
    : slot === 'perk' ? `${pool.perks.length} PERKS${presetTxt}`                                          // A14: the perk slot
    : sidearms ? `${nAllowed} SIDEARMS${presetTxt}`
    : `${nAllowed} OF ${weapons.length} WEAPONS${presetTxt}`;
  const hint = choice === 'fixed' || choice === 'off'
    ? <button type="button" className="hov-acc-ink" onClick={onBuild} style={{ ...BTN_RESET, font: F.mono(600, 9), letterSpacing: '.18em', color: T.warn, minHeight: 36 }}>CHANGE IN GAMES ▸</button>
    : <span>{slot === 'primary' ? 'SELECT TO ARM · TRY-OUT STARTS ON PICK' : slot === 'secondary' ? 'SELECT · WEAPONS TRY OUT ON PICK' : 'SELECT · APPLIED WHEN THE GAME IS PUSHED'}</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
      <SectionRule label={`ARSENAL // ${slot.toUpperCase()} · ${summary}`} hint={hint} style={{ marginBottom: 0 }} />
      {slot !== 'primary' && choice !== 'off' && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          {onClear && <GhostButton size={10} pad="6px 12px" onClick={onClear} title={slot === 'perk' ? 'No perk this game' : 'Leave slot 2 empty — alt-fire does nothing'}>{slot === 'perk' ? 'NONE · NO PERK' : 'NONE · LEAVE EMPTY'}</GhostButton>}
          <span style={{ font: F.mono(500, 9), letterSpacing: '.14em', color: T.micro, marginLeft: 'auto' }}>
            {slot === 'perk' ? <>A PERK RIDES BESIDE THE WEAPONS · <b style={{ color: T.dim }}>EASY RELOAD</b> TAKES THE ALT BUTTON AND DROPS THE SECOND WEAPON</>
              : <>SLOT 2 IS A {sidearms ? 'SIDEARM' : 'WEAPON'} · PERKS HAVE THEIR OWN SLOT</>}
          </span>
        </div>
      )}
    </div>
  );
}

function WeaponHero({ w, slot, sp, tryingId, pushed, verdicts, setVerdicts }:
  { w: WeaponView; slot: Slot; sp: Player; tryingId?: string; pushed: boolean; verdicts: Record<string, { verdict: 'pass' | 'issue'; note: string }>; setVerdicts: React.Dispatch<React.SetStateAction<Record<string, { verdict: 'pass' | 'issue'; note: string }>>> }) {
  const { run, api } = useStore();
  const role = roleOf(w.role, w.cls);
  return (
    <>
      <StripedSlot style={{ flex: '1 1 240px', maxWidth: 320, minHeight: 140, background: `url(assets/weapons/${w.weapon_id}.jpg) center/contain no-repeat` }}
        corner={<span style={{ position: 'absolute', top: 8, left: 10, zIndex: 1, font: F.mono(600, 9), letterSpacing: '.22em', color: T.dim, background: 'rgba(7,9,13,.75)', padding: '2px 6px' }}>{slot.toUpperCase()}</span>} />
      <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ font: F.osw(700, 28), letterSpacing: '.08em', textTransform: 'uppercase' }}>{w.name}</span>
          <Tag color={role.color} style={{ letterSpacing: '.22em', padding: '3px 10px' }}>{role.label}</Tag>
          {!w.verified && <span title="Retuned from the captured Callsign frame for balance — not the stock numbers" style={{ font: F.mono(500, 9), letterSpacing: '.16em', color: T.micro }}>TUNED · NOT STOCK</span>}
          {w.caution && <span role="alert" style={{ font: F.mono(600, 9), letterSpacing: '.14em', color: T.bad }}>▲ {w.caution.toUpperCase()}</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '7px 14px', alignItems: 'center', maxWidth: 440 }}>
          {/* Field 2026-08-30: these read `dmg`/`rpm` straight, but `dmg` is "% of a 115 pool per hit"
              (7-11 for most guns) so every DAMAGE bar sat near empty and no two weapons looked
              different. MC now ranks each stat across the ARSENAL and ships it as `bars`. */}
          {([['POWER', w.bars?.power ?? w.dmg], ['FIRE RATE', w.bars?.rof ?? w.rpm],
             ['AMMO CARRIED', w.bars?.ammo], ['KILL SPEED', w.bars?.ttk]] as const)
            .filter(([, v]) => v != null)
            .map(([l, v]) => <StatRow key={l} label={l} pct={v as number} />)}
        </div>
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {w.dmg_per_hit != null && <NumberCell label="DAMAGE / HIT" value={w.dmg_per_hit} size={20} pad="6px 14px" />}
          <NumberCell label="MAGAZINE" value={w.clip} size={20} pad="6px 14px" />
          <NumberCell label="RESERVE" value={w.reserve} size={20} pad="6px 14px" />
          {/* null means "no reload time", not zero — a bare unit with no number reads as a broken
              cell. CATALOG already showed `—`; this one did not (merge review 2026-09-01). */}
          <NumberCell label="RELOAD" value={w.reload_s ?? '—'} unit={w.reload_s == null ? undefined : 's'} size={20} pad="6px 14px" />
          {/* both follow the host's health config now, not a hardcoded 115 (W2) — say which pool */}
          {w.htk != null && <NumberCell label={w.pool ? `HITS TO KILL · ${w.pool}` : 'HITS TO KILL'} value={w.htk} size={20} pad="6px 14px" color={w.htk <= 2 ? T.warn : T.ink} />}
          {w.ttk_ms != null && <NumberCell label="TIME TO KILL" value={+(w.ttk_ms / 1000).toFixed(2)} unit="s" size={20} pad="6px 14px" />}
        </div>
        {w.desc && <div style={{ font: F.chk(500, 12), lineHeight: 1.5, color: T.dim, maxWidth: '54ch' }}>{w.desc}</div>}
        {tryingId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', font: F.mono(500, 10), letterSpacing: '.12em', color: T.warn }}>
            ▲ TRYING OUT ON {sp.display}'S GUN — HAVE THEM FIRE A FEW ROUNDS · POINT AWAY FROM OTHERS
            <GhostButton size={10} pad="4px 10px" onClick={() => run(() => api.endTryout(sp.player_id))}>END TRY-OUT</GhostButton>
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <GhostButton size={10} pad="4px 10px" onClick={async () => { await run(() => api.rangeVerdict(tryingId, 'pass')); setVerdicts(v => ({ ...v, [tryingId]: { verdict: 'pass', note: '' } })); }}>SOUNDS RIGHT ✓</GhostButton>
              <GhostButton size={10} pad="4px 10px" onClick={async () => { const note = window.prompt('what is wrong? (sound / rate / damage / no burst…)'); if (note === null) return; await run(() => api.rangeVerdict(tryingId, 'issue', note)); setVerdicts(v => ({ ...v, [tryingId]: { verdict: 'issue', note } })); }}>LOG ISSUE ✗</GhostButton>
            </span>
          </div>
        )}
        {pushed && <div style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: T.micro }}>TRY-OUTS CLOSED — THE GAME HAS BEEN PUSHED TO THE GUNS</div>}
        {verdicts[w.weapon_id]?.verdict === 'issue' && <div style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: T.bad }}>RANGE LOG: {verdicts[w.weapon_id].note.toUpperCase()}</div>}
      </div>
    </>
  );
}

function PerkHero({ k }: { k: PerkView }) {
  const fx = k.effects ?? {};
  return (
    <>
      <div style={{ flex: '0 0 auto', width: 150, minHeight: 140, display: 'grid', placeItems: 'center', background: T.inset, border: `1px solid ${PERK_COLOR}` }}>
        <PerkGlyph id={k.perk_id} size={86} color={PERK_COLOR} />
      </div>
      <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ font: F.osw(700, 28), letterSpacing: '.08em', textTransform: 'uppercase' }}>{k.name}</span>
          <Tag color={PERK_COLOR} style={{ letterSpacing: '.22em', padding: '3px 10px' }}>PERK</Tag>
          {!k.verified && <span title="Effect not yet proven on hardware" style={{ font: F.mono(500, 9), letterSpacing: '.16em', color: T.warn }}>UNPROVEN ON HARDWARE</span>}
        </div>
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {fx.max_armor_add != null && <NumberCell label="ARMOR" value={`+${fx.max_armor_add}`} color={PERK_COLOR} size={20} pad="6px 14px" />}
          {fx.ammo_mult != null && <NumberCell label="MAG & RESERVE" value={`×${fx.ammo_mult}`} color={PERK_COLOR} size={20} pad="6px 14px" />}
          {fx.reload_mult != null && <NumberCell label="RELOADS" value={`${+(1 / fx.reload_mult).toFixed(1)}× FASTER`} color={PERK_COLOR} size={20} pad="6px 14px" />}
          {fx.alt_reload && <NumberCell label="ALT BUTTON" value="RELOAD" color={PERK_COLOR} size={20} pad="6px 14px" />}
          {fx.switch_mult != null && <NumberCell label="WEAPON SWAP" value={`${+(1 / fx.switch_mult).toFixed(1)}× FASTER`} color={PERK_COLOR} size={20} pad="6px 14px" />}
        </div>
        <div style={{ font: F.chk(500, 13), lineHeight: 1.5, color: T.body, maxWidth: '54ch' }}>{k.desc}</div>
        <div style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: T.micro }}>PASSIVE — APPLIED TO THE GUN WHEN THE GAME IS PUSHED · NOTHING TO TRY OUT{fx.alt_reload ? ' · TAKES THE ALT BUTTON: NO SECOND WEAPON WITH THIS ONE' : ' · RIDES BESIDE BOTH WEAPONS'}</div>
      </div>
    </>
  );
}

export function Lock({ color = T.warn, size = 10 }: { color?: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" fill={color} /><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke={color} strokeWidth="2.5" /></svg>;
}

export function PerkGlyph({ id, size = 24, color = PERK_COLOR }: { id: string; size?: number; color?: string }) {
  const c = { fill: 'none', stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'body_armor': return <svg width={size} height={size} viewBox="0 0 24 24"><path {...c} d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path {...c} d="M12 3v18M4 12h16" opacity=".5" /></svg>;
    case 'extended_mags': return <svg width={size} height={size} viewBox="0 0 24 24"><path {...c} d="M8 3h8v18H8zM8 8h8M8 13h8M8 18h8" /><path {...c} d="M4 6v12M20 6v12" opacity=".5" /></svg>;
    case 'quick_hands': return <svg width={size} height={size} viewBox="0 0 24 24"><path {...c} d="M13 2 5 13h6l-1 9 9-12h-6z" /></svg>;
    case 'easy_reload': return <svg width={size} height={size} viewBox="0 0 24 24"><path {...c} d="M20 12a8 8 0 1 1-2.3-5.7" /><path {...c} d="M20 4v5h-5" /><circle cx="12" cy="12" r="2" fill={color} stroke="none" /></svg>;
    case 'quick_switch': return <svg width={size} height={size} viewBox="0 0 24 24"><path {...c} d="M4 8h12l-3-3M20 16H8l3 3" /></svg>;
    case 'med_kit': return <svg width={size} height={size} viewBox="0 0 24 24"><rect {...c} x="3" y="6" width="18" height="14" rx="2" /><path {...c} d="M12 10v6M9 13h6M9 6V4h6v2" /></svg>;
    default: return <svg width={size} height={size} viewBox="0 0 24 24"><circle {...c} cx="12" cy="12" r="8" /><path {...c} d="M12 8v4l3 2" /></svg>;
  }
}

const effectLine = (k: PerkView) => {
  const fx = k.effects ?? {}; const out: string[] = [];
  if (fx.max_armor_add != null) out.push(`+${fx.max_armor_add} ARMOR`);
  if (fx.ammo_mult != null) out.push(`×${fx.ammo_mult} AMMO`);
  if (fx.reload_mult != null) out.push(`RELOADS ${+(1 / fx.reload_mult).toFixed(1)}× FASTER`);
  if (fx.alt_reload) out.push('ALT BUTTON RELOADS');
  if (fx.switch_mult != null) out.push(`SWAPS ${+(1 / fx.switch_mult).toFixed(1)}× FASTER`);
  return out.join(' · ') || 'PASSIVE';
};
const shortName = (n: string) => n.replace(/ Rifle$/i, '').replace(/ Launcher$/i, ' LNCHR').toUpperCase();

/** Player number 1–63, draft-then-commit (see ValueBox). */
function PlayerNum({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false), pending = useRef<number | null>(null), latest = useRef(value);
  latest.current = value;
  useEffect(() => { if (pending.current != null && value === pending.current) pending.current = null; if (!focused.current && pending.current == null) setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === '' || String(value) === draft.trim()) { setDraft(String(value)); return; }
    if (Number.isInteger(n) && n >= 1 && n <= 63) { setInvalid(false); pending.current = n; onCommit(n); setTimeout(() => { if (pending.current != null) { pending.current = null; setDraft(String(latest.current)); } }, 1500); }
    else { setInvalid(true); setDraft(String(value)); }   // never a silent revert: the hint below explains
  };
  const setFocused = (f: boolean) => { focused.current = f; };
  return (
    <>
      <input className="numbox" type="number" min={1} max={63} value={draft} aria-label="player number (1–63)" aria-invalid={invalid || undefined}
        style={{ width: '2.6em', font: F.mono(600, 10), color: invalid ? T.bad : T.acc, textAlign: 'left', minHeight: 32, borderBottom: invalid ? `1px solid ${T.bad}` : undefined }}
        onFocus={() => { setFocused(true); setInvalid(false); }} onBlur={() => { setFocused(false); commit(); }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onChange={e => setDraft(e.target.value)} />
      {invalid && <span role="alert" style={{ marginLeft: 8, font: F.mono(500, 9), letterSpacing: '.12em', color: T.bad }}>PLAYER NUMBER MUST BE 1–63</span>}
    </>
  );
}

function StatRow({ label, pct }: { label: string; pct: number }) {
  return (
    <>
      <span style={{ font: F.mono(500, 9.5), letterSpacing: '.2em', color: T.micro }}>{label}</span>
      <SegBar pct={pct} color={T.ink} height={10} cell={10} style={{ display: 'block' }} />
    </>
  );
}

/** The per-player POOL override (modes §1.1). Deliberately loud: a player armed differently from
 *  everyone else is a rule of the match, not a setting, so it states the game's own numbers beside
 *  the player's and says whose gun it changes. Clearing it is one tap. */
function PoolCard({ hp, armor, pool, onSet, onClear, name }: {
  hp: number; armor: number; name: string;
  pool: ReturnType<typeof poolOf>;
  onSet: (k: 'max_hp' | 'max_armor', v: number) => void; onClear: () => void;
}) {
  const on = pool.set;
  const mult = pool.mult.toFixed(pool.mult % 1 === 0 ? 0 : 1);
  return (
    <div data-pool-card style={{ border: `1px solid ${on ? T.warn : T.line}`, background: T.panelDeep, padding: '8px 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ font: F.chk(700, 11), letterSpacing: '.18em', color: on ? T.warn : T.dim }}>POOL</span>
        <span data-pool-state style={{ font: F.mono(500, 10), letterSpacing: '.12em', color: on ? T.warn : T.micro }}>
          {on ? `${mult}\u00d7 GAME POOL` : 'GAME DEFAULT'}
        </span>
      </div>
      {(['max_hp', 'max_armor'] as const).map(k => {
        const isHp = k === 'max_hp';
        const val = isHp ? pool.hp : pool.armor, base = isHp ? hp : armor, set = isHp ? pool.hpSet : pool.armorSet;
        return (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ font: F.chk(600, 11), letterSpacing: '.14em', color: T.dim, width: 52 }}>{isHp ? 'HEALTH' : 'ARMOR'}</span>
            <ValueBox value={val} unit={isHp ? 'HP' : 'AR'} min={isHp ? 1 : 0} max={999} label={`${name} ${isHp ? 'health' : 'armor'}`} onChange={v => onSet(k, v)} />
            <span data-pool-base={k} style={{ font: F.mono(500, 10), letterSpacing: '.06em', color: set ? T.micro : T.faint, whiteSpace: 'nowrap' }}>
              {set ? `GAME ${base}` : 'SAME AS GAME'}
            </span>
          </div>
        );
      })}
      <div style={{ font: F.mono(500, 9), letterSpacing: '.1em', color: on ? T.warn : T.micro, lineHeight: 1.6 }}>
        {on
          ? `\u25b2 ON PURPOSE: ${name.toUpperCase()} IS ARMED AT ${pool.hp} HP / ${pool.armor} AR. EVERY OTHER PLAYER USES THE GAME POOL.`
          : '\u25b2 SET A DIFFERENT POOL FOR THIS ONE PLAYER (A HANDICAP: A YOUNGER PLAYER, OR THE SOLO SIDE OF A 2v1).'}
      </div>
      {on && <GhostButton onClick={onClear} color={T.warn} border={T.warn} size={10} pad="7px 12px">MATCH THE GAME POOL</GhostButton>}
    </div>
  );
}
