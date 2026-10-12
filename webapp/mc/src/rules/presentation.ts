/** Port of mcp/brx_mcp/mc/presentation.py profile_from_preset(), default_for(), merge(), summary() and table(). */
import type { GameConfig, PresentationRow, PresentationSummary } from '../api/types';
import {
  PRESENTATION_EVENT_NAMES, PRESENTATION_EVENTS, PRESENTATION_FLASH_COLOURS, PRESENTATION_GUN_DEFAULT,
  PRESENTATION_GUN_IN_PLAY, PRESENTATION_GUN_READOUT_DEFAULT, PRESENTATION_HEADSET_DEFAULT,
  PRESENTATION_MODE_PRESET, PRESENTATION_PALETTE, PRESENTATION_PRESETS,
  PRESENTATION_READOUT_POOL_ORDER, PRESENTATION_ROLE_WORDS, PRESENTATION_SOUND_IDS,
  PRESENTATION_SOUND_ROLES, PRESENTATION_SOUND_WORDS, PRESENTATION_SWITCHES, PRESENTATION_TEXT,
  PRESENTATION_VOICE_VALUES,
} from '../api/contract.gen';

type Profile = Record<string, unknown>;
type Block = Record<string, unknown>;
const object = (v: unknown): v is Block => v !== null && typeof v === 'object' && !Array.isArray(v);
const copy = <T,>(v: T): T => structuredClone(v);
const repr = (v: unknown): string => typeof v === 'string' ? `'${v}'` : JSON.stringify(v);

export function profileFromPreset(name: string): Profile {
  if (!(name in PRESENTATION_PRESETS))
    throw new Error(`presentation.preset must be one of ${JSON.stringify(Object.keys(PRESENTATION_PRESETS).sort())}`);
  return { ...copy(PRESENTATION_PRESETS[name]), preset: name };
}

export function defaultPresentation(mode?: string): Profile {
  return profileFromPreset(PRESENTATION_MODE_PRESET[mode ?? ''] ?? 'standard');
}

function colour(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === 'string') {
    const named = PRESENTATION_PALETTE[value.toLowerCase()];
    if (typeof named === 'number') return named;
  }
  if (Number.isInteger(value) && typeof value === 'number' && value >= 0 && value <= 8) return value;
  throw new Error(`colour must be 0..8 or one of ${JSON.stringify(Object.keys(PRESENTATION_PALETTE).sort())}, got ${repr(value)}`);
}

function sound(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error('sound must be a bank id string or null');
  if (value === 'VSF+JAY') return value;
  if (value.startsWith('voice:')) {
    if (!PRESENTATION_SOUND_ROLES.includes(value.slice(6))) throw new Error(`unknown voice role ${repr(value)}`);
    return value;
  }
  const id = value.toUpperCase();
  if (!PRESENTATION_SOUND_IDS.includes(id))
    throw new Error(`sound ${repr(value)} is not on the gun (see data/sound_catalog.json)`);
  return id;
}

export function mergePresentation(current: Profile | null | undefined, patch: Profile, mode?: string): Profile {
  if (!object(patch)) throw new Error('presentation must be an object');
  const profile = 'preset' in patch ? profileFromPreset(String(patch.preset))
    : copy(current || defaultPresentation(mode));
  let edited = false;
  for (const key of PRESENTATION_SWITCHES) {
    if (!(key in patch)) continue;
    if (typeof patch[key] !== 'boolean') throw new Error(`presentation.${key} must be true/false`);
    if (profile[key] !== patch[key]) edited = true;
    profile[key] = patch[key];
  }
  if ('voice' in patch) {
    if (!PRESENTATION_VOICE_VALUES.includes(patch.voice as string))
      throw new Error(`presentation.voice must be one of ${JSON.stringify(PRESENTATION_VOICE_VALUES)}`);
    if (profile.voice !== patch.voice) edited = true;
    profile.voice = patch.voice;
  }
  if ('headset' in patch) {
    if (!object(patch.headset)) throw new Error('presentation.headset must be an object');
    const before = profile.headset;
    const cur: Block = { ...(object(before) ? before : PRESENTATION_HEADSET_DEFAULT) };
    for (const [key, value] of Object.entries(patch.headset)) {
      if (key === 'pregame' || key === 'in_play') {
        const allowed = key === 'pregame' ? ['team', 'off'] : ['dark', 'team'];
        if (!allowed.includes(value as string)) throw new Error(`presentation.headset.${key} must be ${allowed.join('|')}`);
        cur[key] = value;
      } else if (['start_flash', 'respawn_flash', 'role', 'carrier'].includes(key)) {
        if (typeof value !== 'boolean') throw new Error(`presentation.headset.${key} must be true/false`);
        if (key === 'carrier') { cur.role = value; delete cur.carrier; }
        else cur[key] = value;
      } else if (key === 'hit') cur.hit = colour(value);
      else if (key === 'death') {
        if (value === null) throw new Error('presentation.headset.death must be "native" or a colour (null would fail at push time)');
        cur.death = value === 'native' || value === 'flash' ? 'native' : colour(value);
      } else throw new Error(`presentation.headset.${key}: unknown field`);
    }
    if (JSON.stringify(cur) !== JSON.stringify(before)) edited = true;
    profile.headset = cur;
    profile.headset_team = cur.in_play === 'team' || cur.pregame === 'team';
  }
  if ('gun' in patch) {
    if (!object(patch.gun)) throw new Error('presentation.gun must be an object');
    const before = profile.gun;
    const cur: Block = { ...(object(before) ? before : PRESENTATION_GUN_DEFAULT) };
    for (const [key, value] of Object.entries(patch.gun)) {
      if (key === 'in_play') {
        if (!PRESENTATION_GUN_IN_PLAY.includes(value as string))
          throw new Error(`presentation.gun.in_play must be one of ${PRESENTATION_GUN_IN_PLAY.join('|')}`);
        cur.in_play = value;
      } else if (key === 'pregame') {
        if (value !== 'team' && value !== 'off') throw new Error('presentation.gun.pregame must be team|off');
        cur.pregame = value;
      } else if (key === 'readout') {
        if (!object(value)) throw new Error('presentation.gun.readout must be an object');
        const readout: Block = { ...(object(cur.readout) ? cur.readout : PRESENTATION_GUN_READOUT_DEFAULT) };
        for (const [rk, rv] of Object.entries(value)) {
          if (rk === 'pools') {
            if (!Array.isArray(rv) || rv.some(pool => !PRESENTATION_READOUT_POOL_ORDER.includes(pool)))
              throw new Error(`presentation.gun.readout.pools must be a subset of ${JSON.stringify(PRESENTATION_READOUT_POOL_ORDER)}`);
            readout.pools = [...rv];
          } else if (rk === 'hold_s' || rk === 'reload_glance_s') {
            if (typeof rv !== 'number' || !Number.isFinite(rv) || rv < 1 || rv > 10)
              throw new Error(`presentation.gun.readout.${rk} must be 1..10`);
            readout[rk] = rv;
          } else throw new Error(`presentation.gun.readout.${rk}: unknown field`);
        }
        cur.readout = readout;
      } else throw new Error(`presentation.gun.${key}: unknown field`);
    }
    if (JSON.stringify(cur) !== JSON.stringify(before)) edited = true;
    profile.gun = cur;
  }
  if ('events' in patch) {
    if (!object(patch.events)) throw new Error('presentation.events must be an object');
    const events: Block = { ...(object(profile.events) ? profile.events : {}) };
    for (const [event, spec] of Object.entries(patch.events)) {
      if (!PRESENTATION_EVENT_NAMES.includes(event))
        throw new Error(`unknown presentation event ${repr(event)}; known: ${JSON.stringify(PRESENTATION_EVENT_NAMES)}`);
      if (spec === null) { delete events[event]; edited = true; continue; }
      if (!object(spec)) throw new Error(`presentation.events.${event} must be an object or null`);
      const cur: Block = { ...(object(events[event]) ? events[event] : {}) };
      for (const [key, value] of Object.entries(spec)) {
        if (key === 'sound') cur.sound = sound(value);
        else if (key === 'gun_led' || key === 'headset') cur[key] = colour(value);
        else if (key === 'flash') {
          if (value !== null && !(value as string in PRESENTATION_FLASH_COLOURS))
            throw new Error(`presentation.events.${event}.flash must be green|null (the small LED is green-only)`);
          cur.flash = value;
        } else if (key === 'slot') {
          if (value !== null && value !== 'queue' && value !== 'interrupt')
            throw new Error(`presentation.events.${event}.slot must be queue|interrupt|null`);
          cur.slot = value;
        } else throw new Error(`presentation.events.${event}.${key}: unknown field`);
      }
      events[event] = cur;
      edited = true;
    }
    profile.events = events;
  }
  if (edited) profile.preset = 'custom';
  return profile;
}

function headset(block: unknown): Block {
  const h: Block = { ...(object(block) ? block : {}) };
  if ('carrier' in h && !('role' in h)) h.role = h.carrier;
  delete h.carrier;
  return h;
}

function resolved(config: GameConfig): Profile {
  const raw: Block = object(config.presentation) ? config.presentation : {};
  const base = typeof raw.preset === 'string' && raw.preset in PRESENTATION_PRESETS
    ? profileFromPreset(raw.preset) : defaultPresentation(config.mode);
  const profile: Profile = copy(base);
  for (const key of PRESENTATION_SWITCHES) if (key in raw) profile[key] = Boolean(raw[key]);
  if (PRESENTATION_VOICE_VALUES.includes(raw.voice as string)) profile.voice = raw.voice;
  if (raw.preset === 'custom') profile.preset = 'custom';
  profile.headset = { ...PRESENTATION_HEADSET_DEFAULT, ...headset(base.headset), ...headset(raw.headset) };
  profile.gun = { ...PRESENTATION_GUN_DEFAULT, ...(object(base.gun) ? base.gun : {}),
    ...(object(raw.gun) ? raw.gun : {}) };
  const overrides: Block = { ...(object(base.events) ? base.events : {}), ...(object(raw.events) ? raw.events : {}) };
  const events: Block = {};
  for (const [name, definition] of Object.entries(PRESENTATION_EVENTS)) {
    const spec: Block = { ...definition };
    const override = overrides[name];
    if (object(override)) for (const key of ['sound', 'gun_led', 'headset', 'flash', 'slot'])
      if (key in override) spec[key] = override[key];
    events[name] = spec;
  }
  profile.events = events;
  return profile;
}

export function presentationView(config: GameConfig): { summary: PresentationSummary; events: PresentationRow[]; presets: string[] } {
  const profile = resolved(config);
  const raw = object(config.presentation) ? config.presentation : defaultPresentation(config.mode);
  const h = profile.headset as Block;
  const g = profile.gun as Block;
  const summary: PresentationSummary = {
    preset: String(profile.preset ?? 'standard'),
    announcer: Boolean(profile.announcer), gun_flash: Boolean(profile.gun_flash),
    headset_team: Boolean(profile.headset_team), sight_flash: Boolean(profile.sight_flash),
    hud_events: Boolean(profile.hud_events), mc_events: Boolean(profile.mc_events),
    mc_confidence: Boolean(profile.mc_confidence), blackout: Boolean(profile.blackout),
    silent_weapons: Boolean(profile.silent_weapons),
    voice: PRESENTATION_VOICE_VALUES.includes(profile.voice as string)
      ? profile.voice as PresentationSummary['voice'] : 'on',
    headset: { pregame: String(h.pregame), start_flash: Boolean(h.start_flash),
      in_play: String(h.in_play), hit: h.hit as number | null,
      death: h.death as string | number, respawn_flash: Boolean(h.respawn_flash),
      role: Boolean(h.role), carrier: Boolean(h.role) },
    gun: { in_play: String(g.in_play), pregame: String(g.pregame),
      ...(object(g.readout) ? { readout: g.readout } : {}) },
    custom_events: Object.entries(object(raw.events) ? raw.events : {})
      .filter(([, value]) => object(value) && (Boolean(value.sound) || value.gun_led != null
        || value.headset != null || Boolean(value.flash) || Boolean(value.slot)))
      .map(([name]) => name).sort(),
  };
  const rows: PresentationRow[] = Object.entries(profile.events as Block).map(([event, value]) => {
    const spec = value as Block;
    const sid = spec.sound as string | null;
    const words = sid === 'VSF+JAY' ? 'Victory! + sting'
      : sid?.startsWith('voice:') ? "the player's own voice: "
        + (sid === 'voice:kill' ? 'kill line' : PRESENTATION_ROLE_WORDS[sid.slice(6)] ?? sid.slice(6))
      : sid ? PRESENTATION_SOUND_WORDS[sid] ?? '' : '';
    const ungated = Boolean(spec.ungated);
    const muted = !ungated && (
      (['announcer', 'objective'].includes(String(spec.group)) && !profile.announcer)
      || (spec.source === 'hud' && !profile.hud_events)
      || (spec.source === 'mc' && !profile.mc_events));
    return { event, source: (spec.source ?? 'mc') as PresentationRow['source'],
      desc: String(spec.desc ?? ''), sound: sid ?? null, words,
      gun_led: spec.gun_led as number | null, headset: spec.headset as number | null,
      flash: (spec.flash ?? null) as PresentationRow['flash'],
      slot: (spec.slot ?? null) as PresentationRow['slot'],
      text: PRESENTATION_TEXT[event] ?? '', enabled: !muted };
  });
  return { summary, events: rows, presets: Object.keys(PRESENTATION_PRESETS).sort() };
}
