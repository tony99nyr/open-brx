import { ItemChip, HelpNote } from '../ui/Compact';
import { useEffect, useState, type ReactNode } from 'react';
import { registrySig } from '../api/derive';
import type { Loadout, LoadoutOverrides, PerkView, PhaseRefusal, Player, WeaponSel, WeaponView } from '../api/types';
import { useStore } from '../store';
import { EvictButton } from '../ui/EvictButton';
import { StandbySection, guardedOnce, standDownLocked } from '../ui/Standby';
import { CHAMFER, F, PERK_COLOR, T, TAB, fmtAge, roleOf, teamColor } from '../tokens';
import { UNPLAYABLE_IDS, takesAlt } from '../rules/loadoutPolicy';
import { BTN_RESET, Blink, Brackets, DraftText, GhostButton, PanelHeader, Progress, ScreenHeader, ScrollX, Seg, StripedSlot, onKey } from '../ui';
import { TagHint } from '../ui/TagHint';
import { TAG_INPUT_MAX, tagError } from '../api/tag';
import { GLYPH, colourOf } from '../alerts';
import { LoadError } from '../ui/LoadError';
import { useResource } from '../ui/useResource';
import { GameEditPanel } from '../ui/GameEditPanel';
import { UnrosteredPhonesBanner } from '../ui/UnrosteredPhones';
import { StationAlerts } from '../ui/StationAlerts';
import { InPlayBanner, matchInPlay } from './Lobby';
import { PRESET_LABELS } from '../api/contract.gen';
import { kitGate, ContinueToLobby } from './kit/gate';
import { lockedSelect, poolOf, shortName, withoutKeys, type Slot } from './kit/helpers';
import { SlotCard, ArsenalHeader, WeaponHero, PerkHero, PlayerNum, PoolCard } from './kit/cards';
import { Lock, WeaponArt, PerkGlyph, PerkTrade } from './kit/art';

export function Kit() {
  const { state, weapons, perks, selPlayer, setSelPlayer, run, api, setView, enterPhase, connected } = useStore();
  // Keyed on WHICH GUNS MC knows about: the picker used to be fetched ONCE on mount, so a scan run
  // from MUSTER after KIT had been opened never reached this dropdown and the operator saw a gun
  // list that predated the scan they had just watched. Keying it on `readiness.t` instead would
  // refetch ~4x/s, since that is a clock — the first fix for this was that storm (review 2026-09-01).
  const sig = registrySig(state);
  // Round 2 candidate 11: a failed load used to read as "no guns", "no range log" or "no voices"
  // (`.catch(() => set([]))`); it shows the load error with a RETRY now, and keeps the last good list.
  const registryRes = useResource<{ gun_id: string; sticker: string; ble: { tail?: string } }[]>(() => api.armory(), [], [sig], 'could not load the gun list');
  const registry = registryRes.data;
  // `as never` used to silence the shape mismatch here — the route returns rows with weapon_id and t
  // as well. Narrow to what this screen reads instead, so a route change is a type error, not a cast.
  const verdictsRes = useResource<Record<string, { verdict: 'pass' | 'issue'; note: string }>>(
    () => api.rangeVerdicts().then(v => Object.fromEntries(Object.entries(v).map(([id, r]) => [id, { verdict: r.verdict, note: r.note }]))),
    {}, [], 'could not load the range log');
  // A verdict the operator records here shows at once, over the loaded range log.
  const [localVerdicts, setVerdicts] = useState<Record<string, { verdict: 'pass' | 'issue'; note: string }>>({});
  // The overlay holds the record the server answered with, so a failed write shows nothing and a trimmed
  // note matches. An entry leaves once a load shows the server holding the same verdict. A load that
  // started before the write and lands after it carries the old value, so it must not clear it.
  useEffect(() => {
    setVerdicts(local => {
      const kept = Object.fromEntries(Object.entries(local).filter(([id, v]) =>
        verdictsRes.data[id]?.verdict !== v.verdict || verdictsRes.data[id]?.note !== v.note));
      return Object.keys(kept).length === Object.keys(local).length ? local : kept;
    });
  }, [verdictsRes.data]);
  const verdicts = { ...verdictsRes.data, ...localVerdicts };
  // The full persona list. `$PSET`'s trailing tokens are a positional voice pack and every family in
  // the bank carries one; the console offered two of ~15, and `female` was a duplicate of `male`.
  const voicesRes = useResource<{ id: string; name: string }[]>(() => api.getVoices().then(v => v.voices), [], [], 'could not load the voices');
  const voices = voicesRes.data;
  const loadFailures = ([['THE GUN LIST', registryRes], ['THE RANGE LOG', verdictsRes], ['THE VOICES', voicesRes]] as const)
    .filter(([, r]) => r.error);
  const [newName, setNewName] = useState('');
  // F366: the rename field's draft, for its length hint (a stored tag over the limit shows the refusal until renamed)
  const [nameDraft, setNameDraft] = useState<{ pid: string; v: string } | null>(null);
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
  // Fix-1 (polish 2026-09-23): THE KIT LOCKS AT START (A30). In ARMED/LIVE the server refuses every
  // field that is compiled to the gun (loadout, voice, voice_slots, player_num, gun_id: 409), a team
  // change (B1: the gun's $TID is in the head), a phase move (so CONTINUE) and a roster removal. KIT
  // then shows LOBBY's banner and offers none of those. Kept: the callsign (`display` rides in
  // `assign` and never reaches the gun, and the server still takes it), picking which player to look
  // at, and the slot focus. ADD is hidden too: the server takes a late joiner, but one added here has
  // no gun and the gun picker is locked, so it would be a record that can never play. A late joiner
  // comes in through ARMORY, which claims a gun in the same call.
  const locked = matchInPlay(state.phase);

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
  // F366: the rename field grows with, and its hint reads, what is being typed (not only the committed name)
  const shownName = sp ? (nameDraft?.pid === sp.player_id ? nameDraft.v : sp.display) : '';

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
  // A14/S50: a second weapon keeps the perk — unless something already owns the ALT button, which the
  // pick then drops (after a confirm). Two things can own it: a perk that claims it (`effects.alt_reload`;
  // no row carries it today, and the rule tests the EFFECT so a future one is covered), and this player's
  // Easy Reload override. A second weapon needs ALT to swap, so the server refuses either pair outright —
  // the confirm names what goes, rather than letting the operator collect a 400.
  const pickSecondary = (w: WeaponView) => {
    const dropsPerk = takesAlt(perk) ? perk : undefined;
    const dropsEasy = !dropsPerk && !!lo.overrides?.easy_reload;
    const ask = dropsPerk ? `DROPS ${dropsPerk.name.toUpperCase()} — TAP AGAIN`
      : dropsEasy ? 'DROPS EASY RELOAD — TAP AGAIN' : null;
    if (ask && needsConfirm(`weapon:${w.weapon_id}`, ask)) return;
    return setLoadout({
      weapons: [prim0, { weapon_id: w.weapon_id }],
      perk: dropsPerk ? null : (lo.perk ?? null),
      // untouched unless THIS pick takes the button off Easy Reload: leaving the key out keeps whatever
      // the player already has (the pool handicap rides through an unrelated weapon pick)
      ...(dropsEasy ? { overrides: withoutKeys(lo.overrides, 'easy_reload') } : {}),
    }, w.weapon_id, { slot: 'secondary', id: w.weapon_id, label: w.name });
  };
  // A14: a perk rides beside the weapons — Easy Reload is the one that takes the second weapon with it (after a confirm)
  const pickPerk = async (k: PerkView) => {
    const drops = takesAlt(k) ? secondaryW : undefined;
    if (drops && needsConfirm(`perk:${k.perk_id}`, `DROPS THEIR ${drops.name.toUpperCase()} — TAP AGAIN`)) return;
    await setLoadout({ weapons: drops ? [prim0] : (lo.weapons ?? [prim0]), perk: k.perk_id }, undefined, { slot: 'perk', id: k.perk_id, label: k.name });
    if (drops && sp && trying[sp.player_id] === drops.weapon_id) await run(() => api.endTryout(sp.player_id));   // the dropped secondary was being tried out: quiet the gun (e2e lane finding)
  };
  // The per-player ACCESSIBILITY block (`loadout.overrides`, loadout.md §2): the POOL handicap and
  // Easy Reload. Sent as part of the loadout because that is where the server keeps it; `weapons`
  // must ride along or the PATCH is rejected as a shape error (state.py _clean_loadout).
  const setOverrides = (next: LoadoutOverrides | undefined, weapons?: WeaponSel[]) => {
    if (!sp) return;
    const ws = weapons ?? (lo.weapons?.length ? lo.weapons : [prim0]);
    return setLoadout({ weapons: ws, perk: lo.perk ?? null, overrides: next });
  };
  const patchPool = (k: 'max_hp' | 'max_armor', v: number) => setOverrides({ ...(lo.overrides ?? {}), [k]: v });
  // MATCH THE GAME POOL drops the two POOL numbers and nothing else. It used to send the block
  // absent, so evening up a handicap also switched off a player's Easy Reload, silently.
  const clearPool = () => setOverrides(withoutKeys(lo.overrides, 'max_hp', 'max_armor'));
  /** EASY RELOAD on or off, leaving the POOL alone for the same reason.
   *
   *  ALT cannot both reload and swap weapons (a hardware fact: Easy Reload maps ALT to RELOAD with
   *  `$BMAP,1,97`), so the server refuses the override beside a second weapon. Switching it ON
   *  therefore drops that weapon, after a confirm that names it — the same two-tap the ALT-button
   *  perk used to get, now asked of the switch that owns the button. */
  const setEasyReload = async (on: boolean) => {
    if (!sp || !!lo.overrides?.easy_reload === on) return;                 // a tap on the current state writes nothing
    const drops = on ? secondaryW : undefined;
    if (drops && needsConfirm('easy_reload', `DROPS THEIR ${drops.name.toUpperCase()} — TAP AGAIN`)) return;
    const rest = withoutKeys(lo.overrides, 'easy_reload');
    await setOverrides(on ? { ...(rest ?? {}), easy_reload: true } : rest, drops ? [prim0] : undefined);
    // the dropped secondary was being tried out: quiet the gun (the same tidy-up pickPerk does)
    if (drops && trying[sp.player_id] === drops.weapon_id) await run(() => api.endTryout(sp.player_id));
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
    <button type="button" className="hov-acc" onClick={() => setView('build')} title="Loadout rules are set in GAMES"
      style={{ ...BTN_RESET, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', border: `1px solid ${T.line}`, minHeight: 36, cursor: 'pointer' }}>
      <span style={{ width: 6, height: 6, background: PERK_COLOR }} />
      <span style={{ font: F.mono(600, 11), letterSpacing: '.2em', color: T.dim }}>GAME RULES</span>
      <span style={{ font: F.chk(700, 11), letterSpacing: '.14em' }}>{PRESET_LABELS[pol.preset] ?? pol.preset.toUpperCase()}</span>
      {!pol.hud_select && <span style={{ font: F.mono(500, 11), letterSpacing: '.14em', color: T.micro }}>· PHONE PICKS OFF</span>}
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
          {!locked && <ContinueToLobby gate={gate} onGo={async force => {
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
            enterPhase('lobby');
            return { ok: true };
          }} />}
        </span>} />
      {matchInPlay(state.phase) && (
        <InPlayBanner screen="kit" phase={state.phase} onGo={() => setView(state.phase)}
          headline="The kit is locked."
          why="Every gun already holds this match's loadouts. MC refuses a weapon, perk, pool, voice, gun, number or team change until the match ends. A callsign can still be renamed." />
      )}
      {/* F-3/A39: a connected phone with nobody in the roster claiming it — last night's "4 guns
          connected, only 2 in lobby" confusion, made visible where the operator is actually looking. */}
      <StationAlerts unlockOnly />
      <UnrosteredPhonesBanner style={{ marginBottom: 12 }} />
      {/* While the console is known offline, CommandBar already says so: a stale load error stays quiet. */}
      {connected && loadFailures.map(([what, r], i) => (
        <LoadError key={what} id="kit-load-error" testid={`kit-load-error-${i}`} retryTestid={`kit-load-retry-${i}`} what={what} error={r.error!} onRetry={r.retry} />
      ))}
      {/* B3: mode/night/health/weapon-pool, editable right here — no stepper, no recall needed pre-arm */}
      {/* Kept in ARMED/LIVE: the panel locks itself there (one disabled <fieldset>, and its open body
          says RECALL first), and test/game-edit-panel.test.tsx proves that lock through KIT. */}
      <GameEditPanel style={{ marginBottom: 16 }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        {/* roster */}
        <div className="kit-roster" style={{ flex: '1 1 250px', maxWidth: 330, display: 'flex', flexDirection: 'column' }}>
          <div style={{ border: `1px solid ${T.line}`, borderBottom: 'none' }}><PanelHeader label="SQUAD ROSTER" right={<span style={{ font: F.mono(500, 11), letterSpacing: '.14em', color: T.micro }}>{players.length} OPERATORS</span>} /></div>
          {/* M18 (visual QA 2026-09-23): at 900 px and under the roster is a sideways strip, and at 900 px
              it showed 4 of 8 players with nothing on screen saying there were more. <ScrollX> owns the
              scroll now: it fades the cut edge and prints the hint, and only while more is off the edge. */}
          <ScrollX hint={`▸ SCROLL FOR ALL ${players.length} PLAYERS`} hintStyle={{ padding: '6px 0 6px 2px' }} style={{ scrollSnapType: 'x proximity' }}>
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
              // F221: an activity status, not a fault, so the TEXT is neutral (no amber, no glyph) — but
              // it is still LIVE (the player is trying the weapon right now), so the chip keeps its own
              // pulse (`tryPulse`, styles.css), same as before this rework.
              if (tw) chip = <span style={{ font: F.chk(700, 11), letterSpacing: '.14em', color: colourOf('kit-roster-trying'), whiteSpace: 'nowrap', borderRadius: 3, animation: 'tryPulse 1.6s ease-in-out infinite' }}>TRYING {(wById(tw)?.name ?? tw).toUpperCase()}</span>;
              else if (pl.ready) chip = <span style={{ font: F.chk(700, 11), letterSpacing: '.14em', color: T.ok }}>READY ✓</span>;
              else if (isBrowsing) chip = <span style={{ font: F.chk(700, 11), letterSpacing: '.14em', color: T.acc, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Blink color={T.acc} period={1.2} size={6} />PICKING…</span>;
              // F221: a phone waiting for its gun is Tony's AMBER bucket; a KITTED-but-gone row (F142's
              // restored ghost) is the same bucket but says so by name, so it does not blend into the crowd.
              else if (!liveNode) chip = <span style={{ font: F.chk(700, 11), letterSpacing: '.14em', color: colourOf(kittedRow ? 'kit-roster-restored-ghost' : 'kit-roster-no-phone') }}>{kittedRow ? 'RESTORED · NO PHONE' : 'NO PHONE'}</span>;
              else chip = <span style={{ font: F.chk(700, 11), letterSpacing: '.14em', color: kittedRow ? T.dim : T.micro }}>{kittedRow ? 'KITTED' : pl.gun_id ? 'FITTING' : 'NO GUN'}</span>;
              return (
                <div key={pl.player_id} className="hov-acc kit-row" role="button" tabIndex={0} aria-pressed={on} data-no-phone={liveNode ? undefined : '1'}
                  onClick={() => setSelPlayer(pl.player_id)} onKeyDown={onKey(() => setSelPlayer(pl.player_id))}
                  // F142 (field 2026-09-12, ISSUE 11b): a restored roster row with no phone read exactly
                  // like a real, kitted operator — two ghost players sat on the board through an entire
                  // kit-out before anyone noticed. `liveNode` already drove the NO PHONE chip; the ROW
                  // itself now dims too, so the difference is visible at a glance, not just on hover.
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: on ? 'rgba(57,180,255,.06)' : 'transparent', border: `1px solid ${on ? T.acc : 'transparent'}`, cursor: 'pointer', minHeight: 44, opacity: liveNode ? 1 : 0.55 }}>
                  <span style={{ width: 4, flex: 'none', alignSelf: 'stretch', background: teamColor(pl.team_id) }} />
                  <span style={{ flex: '1 1 0', minWidth: 0 }}>
                    {/* F318: a TRYING chip took the room and the callsign was squeezed; it ellipsises, and says itself in full on hover. */}
                    <span data-kit-name={pl.player_id} title={`#${pl.player_num} ${pl.display}`}
                      style={{ display: 'block', font: F.chk(700, 14), letterSpacing: '.14em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ color: T.micro, font: F.mono(500, 11) }}>#{pl.player_num} </span>{pl.display}</span>
                    <span style={{ display: 'flex', gap: 8, font: F.mono(500, 11), letterSpacing: '.06em', color: T.micro, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                      <span>{pl.gun_id ?? 'NO GUN'}</span>
                      <span style={{ color: T.faint }}>·</span>
                      <span style={{ color: T.dim, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p0 ? shortName(p0.name) : '—'}
                        <span style={{ color: T.faint }}> + </span>
                        {p1 ? shortName(p1.name) : <span style={{ color: T.faint }}>NONE</span>}
                        {pk && <span style={{ color: PERK_COLOR }}> ◆ {pk.name.toUpperCase()}</span>}</span>
                      {/* F221: a deliberate, host-set difference — status, not a fault (NEUTRAL). */}
                      {(() => { const pp = poolOf(pl, gameHp, gameAr); return pp.set
                        ? <span data-pool-chip={pl.player_id} title={`Armed at ${pp.hp} HP / ${pp.armor} AR: the game pool is ${gameHp} / ${gameAr}`}
                            style={{ color: colourOf('kit-pool-chip'), whiteSpace: 'nowrap' }}>◆ {pp.hp}/{pp.armor} POOL</span>
                        : null; })()}
                      {/* The OTHER accessibility switch, marked for the same reason as the pool: the host
                          has to see who is set up differently without selecting them one at a time. */}
                      {pl.loadout?.overrides?.easy_reload && (
                        <span data-easy-chip={pl.player_id} title={`The ALT button reloads ${pl.display}'s gun`}
                          style={{ color: T.acc, whiteSpace: 'nowrap' }}>◆ ALT RELOADS</span>
                      )}
                    </span>
                  </span>
                  {/* READY / TRYING / NO PHONE never shrinks and never wraps: on a phone the roster
                      becomes a 210px horizontal strip, and this tag was the part pushed past the row
                      (and off the screen: x=407 on a 393px phone, measured 2026-09-12). The callsign
                      and the loadout line beside it already ellipsise. */}
                  <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>{chip}</span>
                </div>
              );
            })}
            {!locked && <form onSubmit={e => { e.preventDefault(); if (newName.trim() && !tagError(newName)) { run(() => api.addPlayer({ display: newName.trim() })); setNewName(''); } }}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 4px 2px' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="textbox" value={newName} onChange={e => setNewName(e.target.value)} placeholder="+ ADD OPERATOR" aria-label="new operator callsign" maxLength={TAG_INPUT_MAX}
                  style={{ flex: 1, font: F.chk(600, 12), letterSpacing: '.1em', borderBottomColor: T.line, minHeight: 44 }} />
                <GhostButton size={11} pad="4px 10px" disabled={!!tagError(newName)}>ADD</GhostButton>
              </div>
              <TagHint value={newName} testId="add-tag-hint" />
            </form>}
          </div>
          </ScrollX>
          {/* STANDBY (2026-09-12): parked players, with PLAY. Nothing on an older server. */}
          <StandbySection style={{ marginTop: 10 }} />
        </div>

        {/* detail */}
        {sp && (
          <div style={{ flex: '3 1 560px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            {/* identity strip */}
            <div style={{ background: T.panel, border: `1px solid ${T.line}`, padding: '16px 20px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 28px', clipPath: CHAMFER.tr14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <span style={{ width: 6, height: 46, background: teamColor(sp.team_id) }} />
                <div>
                  <div style={{ font: F.mono(500, 11), letterSpacing: '.26em', color: T.micro }}>OPERATOR
                    <span style={{ marginLeft: 10, color: T.acc }}>#<PlayerNum key={sp.player_id} value={sp.player_num} disabled={locked} onCommit={n => patch({ player_num: n })} /></span>
                  </div>
                  <DraftText key={sp.player_id} value={sp.display} ariaLabel="operator callsign" transform={s => s.toUpperCase()} onCommit={v => patch({ display: v })}
                    maxLength={TAG_INPUT_MAX} canCommit={v => !tagError(v)} onDraft={v => setNameDraft({ pid: sp.player_id, v })}
                    style={{ font: F.osw(700, 32), letterSpacing: '.1em', width: `${Math.max(6, shownName.length + 1)}ch`, minHeight: 44 }} />
                  <TagHint value={shownName} testId="rename-tag-hint" />
                </div>
              </div>
              {/* Pull this operator out of the lobby without losing what was just typed. */}
              {!standDownLocked(state.phase) && (
                <GhostButton size={11} pad="6px 12px" title={`Pull ${sp.display} out of the lobby — kept on STANDBY, PLAY puts them back`}
                  onClick={() => guardedOnce(sp.player_id, () => run(() => api.standbyPlayer(sp.player_id)))}>
                  <span data-stand-down={sp.player_id}>▸ STAND DOWN</span>
                </GhostButton>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ font: F.mono(500, 11), letterSpacing: '.22em', color: T.micro }}>TEAM</span>
                <span role="group" aria-label="team" style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {(state.config.mode === 'ffa' ? ['ffa'] : state.config.teams.map(tm => tm.team_id)).map(t => {
                    const on = sp.team_id === t;
                    const col = state.teams.find(tm => tm.team_id === t)?.color ?? teamColor(t);
                    return (
                      <button key={t} type="button" className="hit44" onClick={() => { if (!locked) patch({ team_id: t }); }} aria-pressed={on} disabled={locked}
                        title={locked ? 'Teams are locked while the match is in play' : undefined}
                        style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.14em', padding: '8px 14px', background: on ? col : 'transparent', color: on ? T.accInk : col, border: `1px solid ${on ? col : T.line}`, cursor: locked ? 'default' : 'pointer', minHeight: 36, display: 'inline-flex', alignItems: 'center', opacity: locked && !on ? 0.4 : 1 }}>
                        {t.toUpperCase()}
                      </button>
                    );
                  })}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ font: F.mono(500, 11), letterSpacing: '.22em', color: T.micro }}>VOICE</span>
                {voices.length > 2 ? (
                  <select aria-label={`voice for ${sp.display}`} disabled={locked} value={sp.voice ?? 'male'} onChange={e => patch({ voice: e.target.value })}
                    style={{ background: T.inset, color: T.ink, border: `1px solid ${T.line2}`, font: F.mono(600, 11), letterSpacing: '.06em', padding: '6px 8px', minHeight: 36, ...lockedSelect(locked) }}>
                    {/* No "unverified" marker here. A bare `·` in a native <select> has no legend and
                        no tooltip — Tony asked what it meant, which is the answer. Whether a pack has
                        been confirmed BY EAR is a developer's concern, and the operator finds out the
                        instant they pick one. The count lives on the Debug page instead. */}
                    {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                ) : (
                  locked ? <span style={{ font: F.mono(600, 11), letterSpacing: '.06em', color: T.dim }}>{(sp.voice ?? 'male').toUpperCase()}</span> : <Seg value={sp.voice === 'female' ? 'female' : 'male'} options={[{ value: 'male', label: 'MALE' }, { value: 'female', label: 'FEMALE' }]} onChange={v => patch({ voice: v })} pad="4px 12px" />
                )}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: T.inset, border: `1px solid ${T.line}` }}>
                <Blink color={node ? T.ok : T.bad} />
                <select aria-label={`gun for ${sp.display}`} disabled={locked} value={selectedGun} onChange={e => patch({ gun_id: e.target.value || null })}
                  style={{ background: T.inset, color: T.ink, border: `1px solid ${T.line2}`, font: F.mono(600, 11), letterSpacing: '.06em', padding: '6px 8px', minHeight: 36, ...lockedSelect(locked) }}>
                  <option value="">— NO GUN —</option>
                  {gunOptions.map(o => {
                    const takenBy = players.find(q => q.player_id !== sp.player_id && (q.gun_id || '').toUpperCase() === o.gun_id.toUpperCase());
                    return <option key={o.gun_id} value={o.gun_id} disabled={!!takenBy}>{o.label}{takenBy ? ` · ${takenBy.display}` : ''}</option>;
                  })}
                </select>
                {/* F221: a link lost pre-match (LOBBY/KIT) is Tony's AMBER bucket, not the RED "lost during a match" one. */}
                <span style={{ font: F.mono(500, 11), letterSpacing: '.06em', color: node ? T.ok : sp.gun_id ? colourOf('kit-no-node') : T.micro }}>{node ? `LINKED ${fmtAge(node.last_seen_ms)}` : sp.gun_id ? 'NO NODE' : 'PICK A GUN'}</span>
                {node && <EvictButton nodeId={node.node_id} />}   {/* A30: EVICT works in every phase (a stranger holding a gun's name) */}
              </div>
            </div>

            {/* loadout rail + hero */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'stretch' }}>
              <div className="kit-rail" style={{ flex: '1 1 280px', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SlotCard matchLocked={locked} label="PRIMARY" slot="primary" active={slot === 'primary'} onClick={() => setSlot('primary')} rule={primRule} item={primary} kind="weapon" required
                  overridden={locked ? null : overridden('primary')} onReapply={reapply} />
                <SlotCard matchLocked={locked} label="SECONDARY" slot="secondary" active={slot === 'secondary'} onClick={() => setSlot('secondary')} rule={secRule}
                  item={secondaryW} kind={secondaryW ? 'weapon' : 'none'}
                  overridden={locked ? null : overridden('secondary')} onReapply={reapply}
                  onClear={secondaryW && !slotLocked('secondary') && !locked ? clearSecondary : undefined} />
                <SlotCard matchLocked={locked} label="PERK" slot="perk" active={slot === 'perk'} onClick={() => setSlot('perk')} rule={perkRule}
                  item={perk} kind={perk ? 'perk' : 'none'}
                  overridden={locked ? null : overridden('perk')} onReapply={reapply}
                  onClear={perk && !slotLocked('perk') && !locked ? clearPerk : undefined} />
                <PoolCard locked={locked} hp={gameHp} armor={gameAr} pool={playerPool} onSet={patchPool} onClear={clearPool} name={sp.display}
                  easy={!!lo.overrides?.easy_reload} onEasy={setEasyReload} easyAsk={confirmFor('easy_reload')} />
                {/* F221: THE KIT LOCKED is a real constraint right now (AMBER); the other two just state the
                    loadout policy's mode of operation (NEUTRAL) — same render site, different facts, different colours. */}
                {locked
                  ? <div style={{ padding: '2px 4px' }}><ItemChip id="kit-slot-note-locked" short="Kit locked" icon="lock" detail="The kit locked at the start of the match. Change it after the whistle." /></div>
                  : <div style={{ padding: '2px 4px' }}><HelpNote label="Phone picks" keep={pol?.hud_select ? 'Players pick on their phone. Anything you set here overrides it and shows on their screen.' : 'Phone picks are off: you kit every player here.'} /></div>}
              </div>

              {/* hero: the focused slot's item */}
              <Brackets color={slot === 'perk' ? PERK_COLOR : T.acc} style={{ flex: '2 1 420px', minWidth: 0, padding: 18, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
                {!focusItem ? (
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, minHeight: 150 }}>
                    <div style={{ font: F.osw(700, 26), letterSpacing: '.08em', color: T.dim }}>
                      {slot === 'perk' ? (perkRule?.choice === 'off' ? 'Perks are off for this game. Change it in BUILD.' : 'NO PERK') : secRule?.choice === 'off' ? 'Secondary is off for this game. Change it in BUILD.' : 'NO SECONDARY'}
                    </div>
                  </div>
                ) : 'weapon_id' in focusItem ? (
                  <WeaponHero w={focusItem} slot={slot} sp={sp} tryingId={locked ? undefined : trying[sp.player_id]} pushed={state.lobby.pushed} verdicts={verdicts} setVerdicts={setVerdicts} />
                ) : (
                  <PerkHero k={focusItem} />
                )}
              </Brackets>
            </div>

            {/* arsenal for the focused slot */}
            <div>
              <ArsenalHeader slot={slot} rule={ruleOf(slot)} pool={pool} weapons={weapons} preset={pol?.preset}
                onClear={locked ? undefined : slot === 'secondary' && secondaryW && !slotLocked('secondary') ? clearSecondary : slot === 'perk' && perk && !slotLocked('perk') ? clearPerk : undefined} onBuild={() => setView('build')} />
              {ruleOf(slot)?.choice === 'off' ? null : showKind === 'weapon' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(152px,1fr))', gap: 8 }}>
                  {/* MERGE-5 (round-3 fix pass, 2026-09-13): the rack is FILTERED through
                      `UNPLAYABLE_IDS`, never merely greyed. A tile disabled in every game forever,
                      titled "Not allowed by this game's rules", states something false about the game
                      and hides the real reason (its $SIR row deals no damage in this build —
                      policy.py). The CATALOGUE carries that fact, tagged; KIT does not offer what
                      nobody can be handed. */}
                  {weapons.filter(w => !UNPLAYABLE_IDS.has(w.weapon_id)).map(w => {
                    const allowed = (slot === 'primary' ? pool.primary : pool.secondary_weapons).includes(w.weapon_id);
                    const on = slot === 'primary' ? w.weapon_id === primary?.weapon_id : w.weapon_id === secondaryW?.weapon_id;
                    const fixed = ruleOf(slot)?.choice === 'fixed';
                    // honest pickers (Tony 2026-10-25): a weapon the held perk cannot ride with (`PerkView.blocked_*`)
                    // is not offered; change the perk first
                    const perkClash = !on && !!perk && ((slot === 'primary' ? perk.blocked_primary : perk.blocked_secondary) ?? []).includes(w.weapon_id);
                    const dis = locked || !allowed || (fixed && !on) || perkClash;
                    const role = roleOf(w.role, w.cls);
                    const ask = slot === 'secondary' ? confirmFor(`weapon:${w.weapon_id}`) : null;
                    return (
                      <div key={w.weapon_id} className={dis ? undefined : 'hov-acc'} role="button" tabIndex={dis ? -1 : 0} aria-pressed={on} aria-disabled={dis || undefined}
                        aria-label={`${w.name}, ${role.label}, magazine ${w.clip}${locked ? ', locked while the match is in play' : perkClash && allowed ? `, does not work with ${perk!.name}` : dis ? ', not allowed by the rules' : ''}`}
                        title={locked ? 'The kit is locked while the match is in play' : !allowed ? 'Not allowed by this game’s rules' : perkClash ? `Does not work with ${perk!.name}` : fixed ? 'Fixed by the ruleset' : undefined}
                        onClick={() => { if (!dis) (slot === 'primary' ? pickPrimary : pickSecondary)(w); }} onKeyDown={onKey(() => { if (!dis) (slot === 'primary' ? pickPrimary : pickSecondary)(w); })}
                        style={{ background: on ? 'rgba(57,180,255,.08)' : dis ? T.panelDeep : T.panel, border: `1px solid ${ask ? T.warn : on ? T.acc : T.line}`, padding: 8, cursor: dis ? 'not-allowed' : 'pointer', display: 'flex', flexDirection: 'column', gap: 7, minHeight: 44 }}>
                        {ask && <span role="alert" style={{ font: F.chk(700, 11), letterSpacing: '.12em', color: T.warn }}>▲ {ask}</span>}
                        <StripedSlot height={64} style={{ background: `repeating-linear-gradient(45deg,${T.slot} 0 6px,${T.panel} 6px 12px)`, opacity: dis ? .25 : 1, filter: dis ? 'grayscale(1)' : undefined }}
                          corner={<>
                            <span style={{ position: 'absolute', top: 3, right: 5, font: F.mono(600, 11), letterSpacing: '.14em', color: role.color }}>{role.label}</span>
                            {on && <span style={{ position: 'absolute', bottom: 3, left: 5, font: F.chk(700, 11), letterSpacing: '.14em', color: T.accInk, background: T.acc, padding: '1px 5px' }}>{slot === 'primary' ? 'PRIMARY' : 'SECONDARY'}</span>}
                          </>}>
                          <WeaponArt key={w.weapon_id} id={w.weapon_id} size={22} />
                        </StripedSlot>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                          {dis && <Lock color={T.micro} size={10} />}
                          <span style={{ font: F.chk(700, 12), letterSpacing: '.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: dis ? T.dim : T.ink, flex: 1 }}>{w.name}</span>
                          {/* F221: briefing information about a known hardware quirk, not a live fault: amber, not red. */}
                          {w.caution && <span title={w.caution} aria-label={w.caution} style={{ font: F.chk(700, 11), color: colourOf('kit-weapon-caution-icon') }}>{GLYPH}</span>}
                          <span style={{ font: F.osw(600, 11), ...TAB, color: T.micro }} title={`magazine ${w.clip}`}>MAG {w.clip}</span>
                          {/* F221: a pass/fail QA marker, not a live-match alert — NOT-ALERT, so the fail glyph never borrows T.bad. */}
                          {verdicts[w.weapon_id] && <span title={verdicts[w.weapon_id].note || undefined} style={{ font: F.chk(700, 11), color: verdicts[w.weapon_id].verdict === 'pass' ? T.ok : T.body }}>{verdicts[w.weapon_id].verdict === 'pass' ? '✓' : '✗'}</span>}
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
                    // F551: a perk the push would refuse with this kit's weapons (`PerkView.blocked_*`) is not offered
                    const clash = primary && (k.blocked_primary ?? []).includes(primary.weapon_id) ? primary
                      : secondaryW && (k.blocked_secondary ?? []).includes(secondaryW.weapon_id) ? secondaryW : null;
                    const dis = locked || !allowed || (fixed && !on) || (!!clash && !on);
                    const ask = confirmFor(`perk:${k.perk_id}`);
                    return (
                      <div key={k.perk_id} className={dis ? undefined : 'hov-acc'} role="button" tabIndex={dis ? -1 : 0} aria-pressed={on} aria-disabled={dis || undefined}
                        aria-label={`${k.name} perk${locked ? ', locked while the match is in play' : clash && !on ? `, does not work with the ${clash.name}` : dis ? ', not allowed by the rules' : ''}`} title={locked ? 'The kit is locked while the match is in play' : !allowed ? 'Not allowed by this game’s rules' : clash ? `Does not work with the ${clash.name}` : takesAlt(k) && secondaryW ? `Takes the ALT button — drops their ${secondaryW.name}` : undefined}
                        onClick={() => { if (!dis) pickPerk(k); }} onKeyDown={onKey(() => { if (!dis) pickPerk(k); })}
                        style={{ background: on ? 'rgba(196,139,255,.08)' : T.panel, border: `1px solid ${ask ? T.warn : on ? PERK_COLOR : T.line}`, padding: 10, cursor: dis ? 'not-allowed' : 'pointer', display: 'flex', gap: 12, alignItems: 'center', minHeight: 44, opacity: dis ? .32 : 1, flexWrap: 'wrap' }}>
                        {ask && <span role="alert" style={{ flex: '1 0 100%', font: F.chk(700, 11), letterSpacing: '.12em', color: T.warn }}>▲ {ask}</span>}
                        <span style={{ width: 52, height: 52, flex: 'none', display: 'grid', placeItems: 'center', background: T.inset, border: `1px solid ${on ? PERK_COLOR : T.line}` }}><PerkGlyph id={k.perk_id} size={30} color={on ? PERK_COLOR : T.dim} /></span>
                        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ font: F.chk(700, 13), letterSpacing: '.05em' }}>{k.name}</span>
                            {/* F221: a confidence fact about our own build, not something the operator can fix tonight — NEUTRAL. */}
                            {!k.verified && <span title="Effect not yet proven on hardware" style={{ font: F.mono(500, 11), letterSpacing: '.14em', color: colourOf('kit-perk-unproven') }}>UNPROVEN</span>}
                          </span>
                          <PerkTrade k={k} style={{ font: F.mono(600, 11), letterSpacing: '.1em' }} />
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
