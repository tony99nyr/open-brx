import { useState } from 'react';
import type { GameConfig } from '../api/types';
import { useStore } from '../store';
import { F, T } from '../tokens';
import { Chamfer, PanelHeader, ScreenHeader, SectionRule, Seg, StripedSlot, Tag, Toggle, ValueBox, onKey } from '../ui';

const MODE_ART = new Set(['tdm', 'ffa', 'infection', 'lms', 'extraction']);   // public/assets/modes/*.jpg

export function Build() {
  const { state, modes, run, api } = useStore();
  const [extras, setExtras] = useState(false);
  if (!state) return null;
  const cfg = state.config;
  const sel = modes.find(m => m.mode === cfg.mode) ?? modes[0];
  const put = (partial: Partial<GameConfig>) => run(() => api.putConfig(partial));

  return (
    <div className="screen">
      <ScreenHeader kicker="[ A2 // GAME AUTHORING ]" title="Build the Game" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: '2 1 480px' }}>
          <SectionRule label="SELECT MODE" style={{ marginBottom: 12 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
            {modes.map(m => {
              const on = m.mode === cfg.mode;
              return (
                <div key={m.mode} className="hov-acc" role="button" tabIndex={0} aria-pressed={on} onClick={() => { if (m.mode !== cfg.mode) put({ ...m.defaults, config_id: cfg.config_id }); }} onKeyDown={onKey(() => { if (m.mode !== cfg.mode) put({ ...m.defaults, config_id: cfg.config_id }); })}
                  style={{ background: on ? 'rgba(57,180,255,.06)' : T.panel, border: `1px solid ${on ? T.acc : T.line}`, borderTop: `2px solid ${on ? T.acc : 'transparent'}`,
                    padding: 10, display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer' }}>
                  <StripedSlot height={76} caption={MODE_ART.has(m.mode) ? undefined : 'mode art'}
                    style={{ background: MODE_ART.has(m.mode) ? `url(assets/modes/${m.mode}.jpg) center/cover no-repeat` : undefined }}
                    corner={<>
                      <span style={{ position: 'absolute', top: 6, left: 6, font: F.osw(700, 12), letterSpacing: '.12em', background: on ? T.acc : T.panelAlt, color: on ? T.accInk : T.dim, padding: '2px 9px' }}>{m.abbr}</span>
                      {on && <span style={{ position: 'absolute', top: 6, right: 6 }}><Tag size={9}>ACTIVE</Tag></span>}
                    </>} />
                  <div>
                    <div style={{ font: F.osw(600, 15), letterSpacing: '.08em' }}>{m.name}</div>
                    <div style={{ font: F.chk(500, 12), color: T.dim, marginTop: 3 }}>{m.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {sel && (
            <div className="screen" style={{ marginTop: 14, background: `linear-gradient(180deg,${T.panelSoft},${T.panelDeep})`, border: `1px solid ${T.line}`, borderLeft: `3px solid ${T.acc}`, padding: '16px 18px', display: 'flex', flexWrap: 'wrap', gap: '18px 28px', alignItems: 'stretch' }}>
              {MODE_ART.has(sel.mode) && (
                <div style={{ flex: '1 1 560px', minWidth: 320, maxWidth: 980 }}>
                  {/* the briefing boards carry baked-in text — NEVER crop: native 2816x1536 aspect, contain */}
                  <div style={{ width: '100%', aspectRatio: '2816 / 1536', background: `url(assets/modes/${sel.mode}.jpg) center/contain no-repeat, ${T.inset}`, border: `1px solid ${T.line2}` }} />
                </div>
              )}
              <div style={{ flex: '1 1 300px', minWidth: 280, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}>
                <div>
                  <div style={{ font: F.mono(600, 9), letterSpacing: '.26em', color: T.acc, marginBottom: 6 }}>MODE BRIEFING // {sel.name}</div>
                  <div style={{ font: F.chk(500, 13), lineHeight: 1.55, color: T.body, maxWidth: '58ch' }}>{sel.brief}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, maxWidth: 380 }}>
                  {[['TEAMS', sel.teams_text], ['WIN CONDITION', sel.win_text], ['RESPAWN', sel.respawn_text]].map(([l, v]) => (
                    <div key={l} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, background: T.panel, border: `1px solid ${T.line}`, borderLeft: `2px solid ${T.line2}`, padding: '8px 14px' }}>
                      <span style={{ font: F.mono(500, 9), letterSpacing: '.2em', color: T.dim }}>{l}</span>
                      <span style={{ font: F.chk(700, 13), letterSpacing: '.06em', textAlign: 'right' }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {(state.config_warnings?.length ?? 0) > 0 && (
            <div style={{ marginTop: 10, font: F.mono(500, 10), letterSpacing: '.12em', color: T.warn }}>▲ {state.config_warnings!.join(' · ').toUpperCase()}</div>
          )}
          {state.config_errors.length > 0 && (
            <div style={{ marginTop: 10, font: F.mono(500, 10), letterSpacing: '.12em', color: T.bad }}>▲ {state.config_errors.join(' · ').toUpperCase()}</div>
          )}
        </div>
        <Chamfer style={{ flex: '1 1 330px', maxWidth: 460 }}>
          <PanelHeader label="GLOBAL SETTINGS" />
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Row label="ENVIRONMENT">
              <Seg value={cfg.environment} options={[{ value: 'indoor', label: 'INDOOR' }, { value: 'outdoor', label: 'OUTDOOR' }]} onChange={v => put({ environment: v })} />
            </Row>
            <Row label={<>NIGHT OPS <span style={{ font: F.mono(500, 10), color: T.micro }}>// BLACKOUT HUD</span></>}>
              <Toggle on={cfg.night} onChange={v => put({ night: v })} label="night ops" />
            </Row>
            <div style={{ height: 1, background: T.line }} />
            <Row label="RESPAWN TYPE">
              <Seg value={cfg.respawn.type} options={[{ value: 'scanner', label: 'SCANNER' }, { value: 'auto', label: 'AUTO' }, { value: 'none', label: 'NONE' }]}
                onChange={v => put({ respawn: { ...cfg.respawn, type: v } })} />
            </Row>
            <Row label="RESPAWN DELAY">
              <ValueBox value={cfg.respawn.delay_s} unit="S" label="respawn delay seconds" min={0} max={300} onChange={v => put({ respawn: { ...cfg.respawn, delay_s: v } })} />
            </Row>
            <Row label={<>TIME LIMIT <span style={{ font: F.mono(500, 10), color: T.micro }}>// REQUIRED</span></>}>
              <ValueBox value={Math.round((cfg.time_limit_s ?? 0) / 60)} unit="MIN" label="time limit minutes" min={1} max={120} onChange={v => put({ time_limit_s: v * 60 })} />
            </Row>
            <Row label={<>SCORE TO WIN <span style={{ font: F.mono(500, 10), color: T.micro }}>// IN-COVERAGE ONLY</span></>}>
              <ValueBox value={cfg.scoring.frag_limit ?? 0} label="score to win" min={0} max={999} onChange={v => put({ scoring: { ...cfg.scoring, frag_limit: v || null } })} />
            </Row>
            <div style={{ height: 1, background: T.line }} />
            <button type="button" className="hov-acc-ink" aria-expanded={extras} onClick={() => setExtras(e => !e)}
              style={{ background: 'transparent', border: 'none', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', cursor: 'pointer', color: T.micro, minHeight: 44, font: 'inherit' }}>
              <span style={{ font: F.mono(600, 10), letterSpacing: '.22em' }}>LED &amp; ENVIRONMENT EXTRAS</span>
              <span>{extras ? '▾' : '▸'}</span>
            </button>
            {extras && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Row label="HEALTH"><ValueBox value={cfg.health.max_hp} unit="HP" min={1} max={999} onChange={v => put({ health: { ...cfg.health, max_hp: v } })} /></Row>
                <Row label="ARMOR"><ValueBox value={cfg.health.max_armor} unit="AR" min={0} max={999} onChange={v => put({ health: { ...cfg.health, max_armor: v } })} /></Row>
                <div style={{ font: F.mono(500, 9), letterSpacing: '.12em', color: T.micro }}>GUN LED-OFF FOR NIGHT IS UNVERIFIED ON HARDWARE (P17) — THE HUD BLACKOUT IS RELIABLE.</div>
              </div>
            )}
          </div>
        </Chamfer>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 }}>
      <span style={{ font: F.chk(600, 13), letterSpacing: '.1em' }}>{label}</span>
      {children}
    </div>
  );
}
