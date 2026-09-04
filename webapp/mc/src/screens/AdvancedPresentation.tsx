// ADVANCED — SOUNDS & LIGHTS (read only). A11 / A11.5.
//
// Shows TONIGHT'S applied game's presentation profile from GET /api/presentation: the preset, the seven
// switches, MC's live confidence (which gates the MC-driven global-state events), and every event with
// its SOURCE (HUD = the phone fires it from its own gun and clock; MC = only Mission Control can know it,
// pushed best-effort while the HUDs are in coverage), its sound (id + the words from the on-gun sound
// catalog), its colours and whether the profile has it enabled. Tony (2026-09-04): "visible in the MC
// under an advanced button or dropdown or something. For now read only."
//
// Failure shape matters more than the happy path here (ui-build-verify): an older server has no such
// route -> a visible "server predates this UI" line, never a blank panel; any other error -> its message.
import { useState } from 'react';
import type { PresentationRow, PresentationView } from '../api/types';
import { useStore } from '../store';
import { F, T } from '../tokens';
import { BTN_RESET, SectionRule } from '../ui';

const PALETTE = ['RED', 'BLUE', 'YELLOW', 'GREEN', 'PURPLE', 'TEAL', 'WHITE', 'PINK', 'ORANGE'];
const SWATCH = ['#e33', '#37f', '#ed2', '#3c5', '#a4e', '#3cc', '#eee', '#f7b', '#f92'];
const SOURCE_LABEL: Record<PresentationRow['source'], string> = { hud: 'HUD', mc: 'MC', both: 'HUD + MC' };
const SOURCE_HINT: Record<PresentationRow['source'], string> = {
  hud: 'the phone fires it from its own gun and clock — works with MC out of range',
  mc: 'only Mission Control can know it — pushed best-effort while the HUDs are connected',
  both: 'the phone fires its own; MC tells everyone else',
};
const SWITCHES: [keyof PresentationView['summary'], string][] = [
  ['announcer', 'ANNOUNCER'], ['gun_flash', 'GUN FLASHES'], ['headset_team', 'HEADSET TEAM COLOUR'], ['sight_flash', 'SIGHT FLASH'],
  ['hud_events', 'HUD EVENTS'], ['mc_events', 'MC EVENTS'], ['mc_confidence', 'MC CONFIDENCE GATE'],
];

function Colour({ idx }: { idx: number | null }) {
  if (idx == null) return <span style={{ color: T.faint }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span aria-hidden style={{ width: 10, height: 10, background: SWATCH[idx] ?? '#888', border: `1px solid ${T.line2}`, display: 'inline-block' }} />
      <span>{PALETTE[idx] ?? idx}</span>
    </span>
  );
}

export function AdvancedPresentation() {
  const { api } = useStore();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PresentationView | null>(null);
  const [err, setErr] = useState<{ status?: number; msg: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Loaded from the click that opens the panel (not an effect): the fetch is the user's action, and
  // its failure is shown where they clicked. Re-opening re-fetches, so the view is never stale.
  const toggle = () => {
    if (open) { setOpen(false); return; }
    setOpen(true); setLoading(true); setErr(null);
    api.getPresentation()
      .then(v => { setView(v); setLoading(false); })
      .catch((e: Error & { status?: number }) => { setErr({ status: e.status, msg: e.message || 'request failed' }); setLoading(false); });
  };

  const stale = err?.status === 404;
  return (
    <section data-testid="advanced-presentation">
      <SectionRule label="5 // ADVANCED — SOUNDS & LIGHTS" hint="READ ONLY · WHAT EACH GAME EVENT SOUNDS AND LOOKS LIKE" style={{ marginBottom: 12 }} />
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls="advanced-presentation-body" className="hov-acc"
        style={{ ...BTN_RESET, font: F.chk(700, 11), letterSpacing: '.14em', padding: '9px 14px', minHeight: 36, cursor: 'pointer',
          background: open ? T.acc : 'transparent', color: open ? T.accInk : T.dim, border: `1px solid ${open ? T.acc : T.line}` }}>
        {open ? '▾ ADVANCED' : '▸ ADVANCED'}
      </button>
      {open && (
        <div id="advanced-presentation-body" style={{ marginTop: 12, background: T.panel, border: `1px solid ${T.line}`, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ font: F.chk(500, 12), color: T.micro, lineHeight: 1.45 }}>
            This is tonight's <b>applied</b> game, as the server resolved it, not the draft above. Presets and per-event edits are set on the server today
            (<code style={{ font: F.mono(500, 11) }}>PUT /api/config {'{'}"presentation": …{'}'}</code>); the picker comes next.
          </div>
          {loading && <div role="status" style={{ font: F.mono(600, 10.5), letterSpacing: '.14em', color: T.dim }}>LOADING…</div>}
          {stale && <div role="alert" style={{ font: F.mono(600, 10), letterSpacing: '.12em', color: T.warn }}>▲ THE MC SERVER PREDATES THIS UI — IT HAS NO /api/presentation. RESTART IT: <code>python -m brx_mcp.mc</code></div>}
          {err && !stale && <div role="alert" style={{ font: F.mono(600, 10), letterSpacing: '.12em', color: T.warn }}>▲ COULD NOT LOAD THE PRESENTATION PROFILE — {err.msg.toUpperCase()}</div>}
          {view && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <span style={{ font: F.mono(600, 10.5), letterSpacing: '.22em', color: T.dim }}>PRESET</span>
                <span data-testid="presentation-preset" style={{ font: F.osw(700, 15), letterSpacing: '.1em', color: T.ink, textTransform: 'uppercase' }}>{view.summary.preset.replace('_', ' ')}</span>
                <span style={{ marginLeft: 12, font: F.mono(600, 10.5), letterSpacing: '.22em', color: T.dim }}>SWITCHES</span>
                {SWITCHES.map(([k, label]) => {
                  const on = Boolean(view.summary[k]);
                  return <span key={k} aria-label={`${label} ${on ? 'on' : 'off'}`} style={{ font: F.chk(700, 10.5), letterSpacing: '.1em', padding: '3px 8px', border: `1px solid ${on ? T.acc : T.line}`, color: on ? T.ink : T.faint, textDecoration: on ? 'none' : 'line-through' }}>{label}</span>;
                })}
              </div>
              <div role="status" data-testid="mc-confidence" style={{ font: F.mono(600, 10.5), letterSpacing: '.12em', color: view.mc_confidence.confident ? T.ok : T.warn }}>
                {view.mc_confidence.confident
                  ? 'MC CONFIDENT — EVERY HUD CONNECTED, FRESH AND FLUSHED: MC-DRIVEN EVENTS (LEAD, NEXT KILL WINS) WILL BE SENT'
                  : `MC NOT CONFIDENT — OFFLINE ${view.mc_confidence.missing.length} · STALE ${view.mc_confidence.stale.length} · UNFLUSHED ${view.mc_confidence.unflushed.length}: MC-DRIVEN GLOBAL EVENTS ARE WITHHELD`}
              </div>
              <div style={{ font: F.chk(500, 12), color: T.micro, lineHeight: 1.45 }}>
                <b>HUD</b> = {SOURCE_HINT.hud}. <b>MC</b> = {SOURCE_HINT.mc}. Muted events show struck through.
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table aria-label="presentation events" style={{ borderCollapse: 'collapse', width: '100%', font: F.mono(500, 11), letterSpacing: '.04em' }}>
                  <thead>
                    <tr style={{ color: T.dim, textAlign: 'left' }}>
                      {['EVENT', 'SOURCE', 'WHEN', 'SOUND', 'GUN', 'HEADSET', 'HUD TEXT'].map(h => <th key={h} style={{ padding: '6px 8px', borderBottom: `1px solid ${T.line}`, font: F.mono(600, 10), letterSpacing: '.18em' }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {view.events.map(r => (
                      <tr key={r.event} data-testid={`pres-row-${r.event}`} style={{ color: r.enabled ? T.body : T.faint, textDecoration: r.enabled ? 'none' : 'line-through', borderBottom: `1px solid ${T.line}` }}>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', color: r.enabled ? T.ink : T.faint }}>{r.event}</td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }} title={SOURCE_HINT[r.source]}>
                          <span style={{ font: F.chk(700, 10), letterSpacing: '.12em', padding: '2px 6px', border: `1px solid ${r.source === 'hud' ? T.ok : r.source === 'mc' ? T.warn : T.acc}`, color: r.source === 'hud' ? T.ok : r.source === 'mc' ? T.warn : T.acc }}>{SOURCE_LABEL[r.source]}</span>
                        </td>
                        <td style={{ padding: '6px 8px', font: F.chk(500, 12), color: r.enabled ? T.dim : T.faint }}>{r.desc}</td>
                        <td style={{ padding: '6px 8px' }}>{r.sound ? <><span style={{ color: r.enabled ? T.ink : T.faint }}>{r.sound}</span>{r.words ? <span style={{ color: T.dim }}> · {r.words}</span> : null}</> : <span style={{ color: T.faint }}>—</span>}</td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}><Colour idx={r.gun_led} /></td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}><Colour idx={r.headset} /></td>
                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap', color: T.dim }}>{r.text || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
