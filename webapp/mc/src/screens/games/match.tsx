// PLAY's match settings: one match item row, the TEAMS control and its colour chooser, the mode mark. Split
// out of Games.tsx (round-2 candidate 11).
import { useState } from 'react';
import type { GamePick, HillSettings, MatchSettings, TeamColour } from '../../api/types';
import { F, T, TEAM } from '../../tokens';
import { Seg, SEG_PAD_44, Toggle } from '../../ui';
import { VenueModeManualLink } from '../../ui/VenueModeReminder';
import { MODE_ART } from '../../modeArt';
import { ModeEmblem } from '../ModeEmblem';
import { legalColours } from '../../teamColours';
import { setRunway } from '../../runway';
import { type MatchItemKey } from '../matchItems';
import { TEAM_COUNT_MIN, TEAM_COUNT_MAX } from '../../api/contract.gen';
import { TimeControl, KillsControl, CountdownControl, HoldControl, HillControl } from './controls';

/** GAME MODE's own mark (Tony, 2026-09-26), beside its name in a FIXED box so the row never jumps.
 *  `object-fit: contain` -- the whole mark shows, never a crop. A mode with no `<mode>.jpg` yet, or
 *  whose image fails to load, falls back to ModeEmblem's line drawing (never a broken-image icon);
 *  `MODE_ART` decides which modes have art, never a name hard-coded here, so a mode added later (or
 *  koth, once its art lands) needs no change to this file. */
export function ModeMark({ mode }: { mode: string }) {
  const [broken, setBroken] = useState(false);
  const hasArt = MODE_ART.has(mode) && !broken;
  return (
    <span data-testid="mode-mark" style={{ display: 'inline-block', width: 56, height: 36, flexShrink: 0, position: 'relative',
      background: T.inset, border: `1px solid ${T.line2}`, overflow: 'hidden' }}>
      {hasArt
        ? <img src={`assets/modes/${mode}.jpg`} alt="" onError={() => setBroken(true)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        : <ModeEmblem mode={mode} />}
    </span>
  );
}

/** One MATCH SETTINGS strip item, by key (screens/matchItems.ts). Each wraps its own control in a
 *  `display: contents` fieldset (disables with `locked`, contributes no box of its own); an item's
 *  own extras (the manual link, the ON/OFF word) are siblings, never inside that fieldset. */
export function MatchItem({ itemKey, pick, locked, runwayVal, pickMatch, mode, currentTeams, pickTeams }:
  { itemKey: MatchItemKey; pick: GamePick; locked: boolean; runwayVal: number; pickMatch: (p: Partial<MatchSettings>) => void;
    mode: string; currentTeams: TeamColour[]; pickTeams: (teams: TeamColour[]) => void }) {
  const guarded = (child: React.ReactNode) => (
    <fieldset disabled={locked} style={{ border: 'none', margin: 0, padding: 0, display: 'contents' }}>{child}</fieldset>
  );
  switch (itemKey) {
    case 'time':
      return guarded(<TimeControl seconds={pick.match.time_limit_s} onChange={s => pickMatch({ time_limit_s: s })} />);
    case 'kills':
      return guarded(<KillsControl fragLimit={pick.match.frag_limit} onChange={n => pickMatch({ frag_limit: n })} />);
    case 'countdown':
      return guarded(<CountdownControl seconds={runwayVal} onChange={setRunway} />);
    case 'daynight':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {guarded(
            <Seg size={14} label="day or night" value={pick.match.night ? 'night' : 'day'} pad={SEG_PAD_44}
              options={[{ value: 'day', label: 'DAY' }, { value: 'night', label: 'NIGHT' }]}
              onChange={v => pickMatch({ night: v === 'night' })} />,
          )}
          <VenueModeManualLink />
        </span>
      );
    case 'silenced':
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
          {guarded(<Toggle on={pick.match.silenced} onChange={v => pickMatch({ silenced: v })} label="silenced" />)}
          {/* VQA QA-12: the switch alone (grey/blue) was the only sign of the state — add the word. */}
          <span style={{ font: F.chk(700, 14), letterSpacing: '.04em', color: pick.match.silenced ? T.ink : T.dim }}>
            SILENCED: {pick.match.silenced ? 'ON' : 'OFF'}
          </span>
        </span>
      );
    case 'teams':
      // F413: the pick's OWN `match.teams` is only set once a mode change or a TEAMS edit has named
      // one explicitly (games-presets.md §7's "red, blue" default is compose's, not this control's) --
      // absent that, this shows the ROSTER'S actual teams (`cfg.teams`, via `currentTeams`), never an
      // invented default that could disagree with who is on what team right now.
      return guarded(<TeamsControl teams={pick.match.teams ?? currentTeams} mode={mode} onChange={pickTeams} />);
    case 'hold':
      // Review MEDIUM (brx1, e8811fea): NO TARGET said nothing about what it was NO TARGET *of* --
      // the same leading label TEAMS already carries.
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: F.mono(600, 11), letterSpacing: '.16em', color: T.micro }}>HOLD</span>
          {guarded(<HoldControl seconds={pick.match.hold_target_s ?? null} onChange={s => pickMatch({ hold_target_s: s })} />)}
        </span>
      );
    case 'hill':
      // F559: a set key goes to every control station; a cleared one is a null, which the server turns back into SET ON THE HILL.
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: F.mono(600, 11), letterSpacing: '.16em', color: T.micro }}>HILL</span>
          {guarded(<HillControl hill={pick.match.hill} onChange={patch => {
            // The wire patch may carry a null key (clears it) or be null (clears both); the stored type has neither.
            const left = { ...(pick.match.hill ?? {}), ...patch };
            const any = Object.values(left).some(v => v != null);
            pickMatch({ hill: (any ? patch : null) as unknown as HillSettings });
          }} />)}
        </span>
      );
  }
}

/** F413 (games-presets.md §7): 2 to 4 unique team colours, one chooser per rostered team, each shown
 *  in its own colour (`tokens.ts`'s TEAM swatch map — the same colours the roster/HUD use elsewhere).
 *  KOTH fixes the count at 2 and never offers yellow (a neutral hill broadcasts tid 2, F82). This
 *  component only ever proposes the next `TeamColour[]`, never sends anything itself. */

function TeamsControl({ teams, mode, onChange }: { teams: TeamColour[]; mode: string; onChange: (teams: TeamColour[]) => void }) {
  const isKoth = mode === 'koth';
  const offered = legalColours(mode);
  const setCount = (n: number) => {
    if (n === teams.length) return;
    if (n < teams.length) { onChange(teams.slice(0, n)); return; }
    const next = [...teams];
    for (const c of offered) { if (next.length >= n) break; if (!next.includes(c)) next.push(c); }
    onChange(next);
  };
  const setSlot = (i: number, c: TeamColour) => {
    const next = [...teams];
    next[i] = c;
    onChange(next);
  };
  return (
    <span data-testid="match-teams-item" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ font: F.mono(600, 11), letterSpacing: '.16em', color: T.micro }}>TEAMS</span>
      {/* KOTH: exactly 2, no count control (F413 §7) -- nothing to choose. */}
      {!isKoth && (
        <Seg size={14} label="team count" value={String(teams.length)} pad={SEG_PAD_44}
          options={Array.from({ length: TEAM_COUNT_MAX - TEAM_COUNT_MIN + 1 }, (_, i) => TEAM_COUNT_MIN + i).map(n => ({ value: String(n), label: String(n) }))}
          onChange={v => setCount(Number(v))} />
      )}
      {teams.map((c, i) => (
        <span key={i} style={{ display: 'inline-flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
          <span style={{ font: F.mono(600, 11), letterSpacing: '.08em', color: T.micro }}>TEAM {i + 1}</span>
          <ColourChooser slot={i} value={c} offered={offered} teams={teams}
            onChange={v => setSlot(i, v)} />
        </span>
      ))}
    </span>
  );
}

/** One team slot's colour, as a dropdown (bench 2026-09-28, Tony: it replaced a row of swatch buttons).
 *  The select fills with the chosen colour; each option shows in its own colour. A colour another slot
 *  already uses stays listed, disabled, with that slot's name, so the set never looks shorter than it is. */
function ColourChooser({ slot, value, offered, teams, onChange }:
  { slot: number; value: TeamColour; offered: TeamColour[]; teams: TeamColour[]; onChange: (c: TeamColour) => void }) {
  return (
    <select aria-label={`team ${slot + 1} colour`} data-testid={`match-teams-colour-${slot}`} value={value}
      onChange={e => onChange(e.target.value as TeamColour)}
      style={{ minWidth: 120, minHeight: 44, padding: '8px 10px', cursor: 'pointer', boxSizing: 'border-box',
        background: TEAM[value], color: '#0c1420', border: `2px solid ${TEAM[value]}`, borderRadius: 0,
        font: F.chk(700, 13), letterSpacing: '.06em' }}>
      {offered.map(c => {
        const owner = teams.findIndex((t, j) => j !== slot && t === c);
        return (
          <option key={c} value={c} disabled={owner >= 0} style={{ background: T.panelDeep, color: TEAM[c] }}>
            {c.toUpperCase()}{owner >= 0 ? ` · TEAM ${owner + 1}` : ''}
          </option>
        );
      })}
    </select>
  );
}
