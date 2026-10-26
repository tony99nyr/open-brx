import { useEffect, useRef, useState } from 'react';
import { AuthError, downloadWithAuth } from '../api/client';
import type { ReportResult } from '../api/types';
import { useStore } from '../store';
import { F, T } from '../tokens';
import { GhostButton, PrimaryButton } from './index';
import { FaultPill, ItemChip, HelpNote } from './Compact';
import { OPERATOR_TOKEN, colourOf, tokenRefusedLine } from '../alerts';

type Phase = 'idle' | 'busy' | 'done' | 'error' | 'auth';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** "Report a problem" — reachable from the command bar's menu in every phase (contracts.md has no
 *  phase gate for it: a community member can hit a bug at any point in a match and the control must
 *  still be there). `POST /api/report` bundles this session's evidence into a zip with names, tagger
 *  ids, IP addresses and the access code stripped server-side; the panel then offers a download and a
 *  pre-filled GitHub issue.
 *
 *  A plain overlay, not a screen: it must render even when the SCREEN under it has crashed, so it
 *  lives beside `CommandBar`'s own menu, outside the `<main>` the app's error boundary wraps
 *  (`App.tsx`'s `Shell`). */
export function ReportPanel({ onClose }: { onClose: () => void }) {
  const { api, setView } = useStore();
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);   // F540: MC refused the token this tab holds (an MC restart)
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // M22 (visual QA 2026-09-23): focus goes INTO the dialog when it opens, and back into it whenever the
  // control that held it goes away. MAKE REPORT unmounts the moment it is pressed (idle → busy), and
  // the browser drops focus to <body>, behind the overlay, so a keyboard user was stranded there.
  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.contains(document.activeElement)) d.focus();
  }, [phase]);
  // Escape closes; Tab/Shift+Tab stay inside the dialog while it is open (focus already returns to
  // the ☰ button on close — CommandBar's own `onClose`).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const list = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (list.length === 0) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function makeReport() {
    setPhase('busy'); setError(null); setDownloadErr(null);
    try {
      const r = await api.makeReport();
      setResult(r); setPhase('done');
    } catch (e) {
      if (e instanceof AuthError) { setRefused(e.message === tokenRefusedLine()); setPhase('auth'); return; }
      setError((e as Error).message || 'Report failed'); setPhase('error');
    }
  }

  /** The header's own token control (`CommandBar`'s "Operator token needed") is real, but it sits
   *  BEHIND this modal overlay — a 401 here must not strand the operator looking at a "try again"
   *  that can only 401 again. Send them to it directly instead.
   *
   *  Round 2: `setView` says whether it actually navigated -- `debug` is exempt from the unsaved-edit
   *  guard, but a LATCHED spectator tab still only records what it was asked for (S25) and never
   *  becomes `debug` at all. This used to close the panel regardless, stranding that tab with no token
   *  screen behind it and no word that anything went wrong. */
  function goToToken() {
    if (!setView('debug')) {
      setError('Could not open the token screen from this tab. Enter the token from another tab, then try again.');
      setPhase('error');
      return;
    }
    onClose();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      (document.getElementById('dbg-tok') as HTMLInputElement | null)?.focus();
    }));
  }

  async function download() {
    if (!result) return;
    setDownloadErr(null);
    try { await downloadWithAuth(result.download, result.file); }
    catch (e) { setDownloadErr((e as Error).message || 'Download failed'); }
  }

  const removedList = result ? Object.entries(result.removed).filter(([, n]) => n > 0) : [];

  return (
    <div role="presentation" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(4,8,14,.72)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '10vh 16px' }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="report-title" tabIndex={-1}
        data-testid="report-panel" data-report-phase={phase}
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(480px, 100%)', background: T.page, border: `1px solid ${T.line2}`, display: 'flex', flexDirection: 'column', outline: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: T.panelAlt, borderBottom: `1px solid ${T.line}` }}>
          <span id="report-title" style={{ font: F.chk(700, 13), letterSpacing: '.24em', color: T.ink, flex: 1 }}>REPORT A PROBLEM</span>
          <button type="button" aria-label="Close" onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: T.dim, font: F.osw(700, 18), cursor: 'pointer', minHeight: 44, minWidth: 44 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 16px 20px' }}>
          {phase === 'idle' || phase === 'error' ? (
            <>
              <p data-alert="frame-report-idle" data-sev="neutral" style={{ font: F.chk(600, 13), lineHeight: 1.5, color: T.ink, margin: 0 }}>
                <HelpNote label="Report privacy" infoTestid="help2-report-info" keep="Names you typed in the console stay in the report, and it goes to a public GitHub issue." />
              </p>
              {phase === 'error' && <FaultPill id="frame-report-error" short="Report failed" why={error ?? ''} />}
              <span>
                <PrimaryButton onClick={makeReport}>{phase === 'error' ? 'TRY AGAIN' : 'MAKE REPORT'}</PrimaryButton>
              </span>
            </>
          ) : null}
          {phase === 'busy' && (
            <div role="status" aria-live="polite" data-alert="frame-report-busy" data-sev="neutral" style={{ font: F.chk(700, 12), letterSpacing: '.14em', color: colourOf('frame-report-busy') }}>
              MAKING REPORT… THIS CAN TAKE A FEW SECONDS
            </div>
          )}
          {phase === 'auth' && (
            <>
              {refused
                ? <FaultPill id="frame-token-refused" short="MC refused the token" why="This tab's operator token is old or wrong. Did MC restart? Open the #tok= link that MC printed, or enter a new token." />
                : <div role="status" data-alert="frame-token-required-app" data-sev="neutral" style={{ font: F.chk(700, 12), lineHeight: 1.5, color: colourOf('frame-token-required-app'), padding: '9px 12px' }}>
                    {OPERATOR_TOKEN.what}: {OPERATOR_TOKEN.actPre} <code>{OPERATOR_TOKEN.code}</code> {OPERATOR_TOKEN.actPost}, THEN TRY AGAIN TO MAKE THE REPORT.
                  </div>}
              <span>
                <PrimaryButton onClick={goToToken}>ENTER OPERATOR TOKEN</PrimaryButton>
              </span>
            </>
          )}
          {phase === 'done' && result && (
            <>
              {/* M22: the privacy warning used to vanish at the moment it matters most, when the file
                  exists and is about to be posted. It stays, above the controls that post it. */}
              <div data-testid="report-privacy" style={{ font: F.chk(600, 12), lineHeight: 1.5, color: T.ink, border: `1px solid ${T.line2}`, background: T.panelAlt, padding: '9px 12px' }}>
                GitHub issues are public, so open the file and check it before you post it. Short names, numbers and text you typed (team and game names) are not changed.
              </div>
              {result.too_large && <ItemChip id="frame-report-too-large" role="alert" short="Report exceeds 25 MB" detail="GitHub's attachment limit is 25 MB. Make the issue anyway and note this. A developer will ask for the file another way." />}
              {removedList.length > 0 && (
                <div style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.micro }}>
                  Removed: {removedList.map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}${n === 1 || /s$/.test(k) ? '' : 's'}`).join(' · ')}
                </div>
              )}
              {downloadErr && (
                <FaultPill id="frame-report-download-err" short="Report download failed" why={downloadErr} />
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <GhostButton onClick={download}>⬇ DOWNLOAD REPORT</GhostButton>
                {/* target=_blank + rel=noopener, a real anchor: a popup blocker only eats a click that
                    never reaches an <a> — a synthetic window.open() from a click HANDLER is exactly
                    the shape that gets silently blocked. */}
                <a href={result.issue_url} target="_blank" rel="noopener noreferrer" className="hov-acc"
                  style={{ font: F.chk(700, 11), letterSpacing: '.16em', padding: '9px 16px', background: 'transparent',
                           border: `1px solid ${T.line}`, color: T.dim, textDecoration: 'none', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
                  OPEN GITHUB ISSUE ↗
                </a>
              </div>
              <p style={{ font: F.chk(600, 12), lineHeight: 1.5, color: T.micro, margin: 0 }}>
                Drag the downloaded file into the issue.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
