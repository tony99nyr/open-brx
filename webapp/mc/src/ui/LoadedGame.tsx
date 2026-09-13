// WHAT IS LOADED, and HOW loaded it is — the two readouts the GAMES tab, the KIT/LOBBY edit panel
// and the summary rail all share.
//
// Tony, 2026-09-13: "The tab should then change state to active game config. Every setting for the
// current config shown." The reason is the one that should drive every judgement here — "several
// times while players were kitting I wanted to make adjustments and I would have to remake a game
// type and hit continue hoping it pushed the updates". A settings list that shows SOME of the config
// answers that doubt only for the fields it happens to carry, so `full` shows every key of
// `GameConfig`, including the ones no control has ever edited (stun, siphon, presentation, hit audio,
// mode rules, coverage, VIP, LED, player numbering) and the `config_id` the guns must echo.
//
// The SHORT list is the one the summary rail has always rendered — same labels, same order, same
// `LABEL / value` markup — because `test/e2e/koth.mjs` reads those rows by label and a relabelled row
// is an invisible break.
import type { GameConfig, ModeInfo, PerkView, Player, WeaponView } from '../api/types';
import { objectiveLine, rulesLine } from '../screens/gameSummary';
import { F, T, TAB } from '../tokens';
import { Blink } from './index';

export type SettingRow = [label: string, value: string];

const yn = (v: unknown) => (v ? 'ON' : 'OFF');

/** Every row the operator can read about the game that is loaded. `full` adds the fields no console
 *  control edits — shown READ-ONLY and always, never hidden when absent: "the console does not say"
 *  and "the game does not have one" are different answers, and only one of them is true. */
export function gameSettingRows(
  cfg: GameConfig,
  mode: ModeInfo | undefined,
  weapons: WeaponView[],
  perks: PerkView[],
  opts: { full?: boolean; players?: Player[] } = {},
): SettingRow[] {
  const rows: SettingRow[] = [
    ['TEAMS', mode?.teams_text ?? cfg.teams.map(t => t.team_id.toUpperCase()).join(' V ') ?? '—'],
    ['WIN', mode?.win_text ?? '—'],
    ['RESPAWN', cfg.respawn.type === 'none' ? 'OFF · LIVES' : `${cfg.respawn.type.toUpperCase()} · ${cfg.respawn.delay_s} S`],
    ['TIME', cfg.time_limit_s ? `${Math.round(cfg.time_limit_s / 60)} MIN` : '—'],
    ['HEALTH', `HP ${cfg.health.max_hp} · ARMOR ${cfg.health.max_armor}`],
    ['LOADOUT', rulesLine(cfg, weapons, perks) || '—'],
    ['VENUE', `${cfg.environment.toUpperCase()}${cfg.night ? ' · NIGHT OPS' : ''}`],
  ];
  // F70/F88: only the objective modes carry this, and a grenade drives exactly ONE point.
  const obj = objectiveLine(cfg);
  if (obj) rows.push(['OBJECTIVE', obj]);
  if (!opts.full) return rows;

  const mp = cfg.mode_params ?? {};
  const vip = opts.players?.find(p => p.player_id === cfg.vip_player_id);
  const preset = (cfg.presentation as { preset?: unknown } | undefined)?.preset;
  rows.push(
    ['MODE', (mode?.name ?? cfg.mode).toUpperCase()],
    ['SCORING', [cfg.scoring.frag_limit != null ? `FRAG LIMIT ${cfg.scoring.frag_limit}` : '', `WIN BY ${String(cfg.scoring.win_by).toUpperCase()}`].filter(Boolean).join(' · ')],
    ['PHONE PICKS', yn(cfg.loadout_policy?.hud_select)],
    ['MODE RULES', Object.keys(mp).length ? Object.entries(mp).map(([k, v]) => `${k.toUpperCase()} ${String(v).toUpperCase()}`).join(' · ') : '— (THIS MODE DECLARES NONE)'],
    ['OBJECTIVE SOURCE', cfg.station_source ? cfg.station_source.toUpperCase() : '—'],
    ['STATIONS', cfg.stations?.length ? cfg.stations.map(s => `#${s.id} ${s.kind.toUpperCase()}`).join(' · ') : '— (NONE ASSIGNED)'],
    ['COVERAGE', cfg.coverage === 'full' ? 'FULL' : 'PARTIAL'],
    // F15/A20: absent = the stock charge-rifle damage row, byte for byte.
    ['STUN (EMP)', cfg.stun ? `${cfg.stun.duration_s ?? 10} S DISARM` : 'OFF'],
    // S14: absent or {0,0} = off.
    ['SIPHON', cfg.siphon && (cfg.siphon.hp || cfg.siphon.armor) ? `HP +${cfg.siphon.hp} · ARMOR +${cfg.siphon.armor}` : 'OFF'],
    // A17: both default OFF — bench F38/F39 (a $SIR sound REPLACES the $PSET pool sound).
    ['HIT AUDIO', `PER-CLASS ${yn(cfg.hit_audio_class)} · PER-WEAPON ${yn(cfg.hit_audio_rekey)}`],
    ['LED', cfg.led && Object.keys(cfg.led).length ? 'CUSTOM' : 'DEFAULT'],
    ['PRESENTATION', typeof preset === 'string' ? preset.toUpperCase() : 'DEFAULT'],
    ['VIP', cfg.vip_player_id ? (vip?.display ?? cfg.vip_player_id).toUpperCase() : '—'],
    ['PLAYER NUMBERS', `FROM ${cfg.player_num_base ?? 1}`],
    // The id every gun has to echo back. It is the whole A36 proof in one string, and the operator's
    // own answer to "is what I am looking at what the guns are holding".
    ['CONFIG ID', cfg.config_id],
  );
  return rows;
}

/** The rows, rendered. One `LABEL` span followed by one value span per row — the shape
 *  `koth.mjs railRow()` locates. `columns` lets the full-width ACTIVE GAME CONFIG use the space
 *  instead of running one 20-row column down a 1440px screen. */
export function GameSettings({ rows, testid, minCol = 320, style }:
  { rows: SettingRow[]; testid?: string; minCol?: number; style?: React.CSSProperties }) {
  return (
    <div data-testid={testid} style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit,minmax(${minCol}px,1fr))`, gap: 5, ...style }}>
      {rows.map(([l, v]) => (
        <div key={l} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, background: T.panel, border: `1px solid ${T.line}`, padding: '7px 12px', minWidth: 0 }}>
          <span style={{ font: F.mono(500, 11), letterSpacing: '.2em', color: T.dim, flex: 'none' }}>{l}</span>
          <span style={{ font: F.chk(700, 12), letterSpacing: '.06em', textAlign: 'right', overflowWrap: 'anywhere', ...TAB }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

/** How many guns are confirmed on the config MC is holding RIGHT NOW.
 *
 *  "RE-PUSHING" is a CLAIM that something is actively in flight -- true for the ~1.5s a real gun
 *  takes to echo (`recent` -- the window after an edit), but a standing fault (one gun that will
 *  never ack, the same one LOBBY's step 2 lives with) is a different fact and must not be worded as
 *  an in-progress push forever. Once `recent` has expired, an incomplete count reads as what it now
 *  is: how many guns are actually caught up. */
export function LoadStatus({ pushed, acked, total, recent, testid = 'game-edit-repush' }:
  { pushed: boolean; acked: number; total: number; recent: boolean; testid?: string }) {
  if (!pushed) return <span data-testid={testid} style={{ font: F.mono(500, 11), letterSpacing: '.12em', color: T.micro }}>NOT LOADED YET — nothing on the guns to update</span>;
  // A CLAIM MUST NEVER OUTRUN THE NUMBER BESIDE IT. This used to be handed the server's `all_acked`,
  // which walks the roster the way `start()` does and SKIPS every player with no node bound -- so with
  // nobody's phone up yet it is vacuously true, and this line read "ALL GUNS ON THIS CONFIG (0/8)"
  // directly above "Waiting for 8 phones" (seen on the koth screenshot, 2026-09-13). That is exactly
  // the false reassurance the LOAD work exists to remove, in the one place the operator looks for it.
  // The wording is derived from the count it is printing, so the two cannot disagree; `all_acked`
  // remains the SERVER's gate for what may be armed, which is a different question.
  const everyone = total > 0 && acked >= total;
  const repushing = !everyone && recent;
  return (
    <span role="status" data-testid={testid} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, font: F.chk(700, 11.5), letterSpacing: '.1em', color: everyone ? T.ok : T.warn }}>
      {repushing && <Blink color={T.warn} size={7} />}
      {everyone ? `ALL GUNS ON THIS CONFIG (${acked}/${total})`
        : repushing ? `CONFIG CHANGED — RE-PUSHING TO EVERY GUN… ${acked}/${total} CONFIRMED`
        : `${acked}/${total} GUNS CONFIRMED ON THIS CONFIG`}
    </span>
  );
}
