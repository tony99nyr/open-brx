import { useEffect, useRef, useState } from 'react';
import { AuthError, downloadWithAuth } from '../api/client';
import type { ReportResult } from '../api/types';
import { useStore } from '../store';
import { F, T } from '../tokens';
import { GhostButton, PrimaryButton } from './index';

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
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { dialogRef.current?.focus(); }, []);
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
      if (e instanceof AuthError) { setPhase('auth'); return; }
      setError((e as Error).message || 'Report failed'); setPhase('error');
    }
  }

  /** The header's own token control (`CommandBar`'s "Operator token needed") is real, but it sits
   *  BEHIND this modal overlay — a 401 here must not strand the operator looking at a "try again"
   *  that can only 401 again. Send them to it directly instead. */
  function goToToken() {
    setView('debug');
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
              <p style={{ font: F.chk(600, 13), lineHeight: 1.5, color: T.ink, margin: 0 }}>
                This makes a report from this session. Names, tagger ids, IP addresses and the access code are removed.
              </p>
              <p style={{ font: F.chk(600, 13), lineHeight: 1.5, color: T.ink, margin: 0 }}>
                GitHub issues are public, so open the file and check it before you post it.
              </p>
              <p style={{ font: F.chk(600, 13), lineHeight: 1.5, color: T.ink, margin: 0 }}>
                Short names, numbers and text you typed (team and game names) are not changed, so check the file before you post it.
              </p>
              {phase === 'error' && (
                <div role="alert" style={{ font: F.chk(700, 12), lineHeight: 1.5, color: T.bad, border: `1px solid ${T.bad}`, background: 'rgba(255,82,82,.1)', padding: '9px 12px' }}>
                  ▲ {error}
                </div>
              )}
              <span>
                <PrimaryButton onClick={makeReport}>{phase === 'error' ? 'TRY AGAIN' : 'MAKE REPORT'}</PrimaryButton>
              </span>
            </>
          ) : null}
          {phase === 'busy' && (
            <div role="status" aria-live="polite" style={{ font: F.chk(700, 12), letterSpacing: '.14em', color: T.dim }}>
              MAKING REPORT… THIS CAN TAKE A FEW SECONDS
            </div>
          )}
          {phase === 'auth' && (
            <>
              <div role="alert" style={{ font: F.chk(700, 12), lineHeight: 1.5, color: T.warn, border: `1px solid ${T.warn}`, background: 'rgba(255,176,32,.1)', padding: '9px 12px' }}>
                ▲ Operator token required to make a report. Enter it, then try again.
              </div>
              <span>
                <PrimaryButton onClick={goToToken}>ENTER OPERATOR TOKEN</PrimaryButton>
              </span>
            </>
          )}
          {phase === 'done' && result && (
            <>
              {result.too_large && (
                <div role="alert" style={{ font: F.chk(700, 12), lineHeight: 1.5, color: T.warn, border: `1px solid ${T.warn}`, background: 'rgba(255,176,32,.1)', padding: '9px 12px' }}>
                  ▲ This report is larger than 25 MB, GitHub&#39;s limit for an attachment. Make the issue anyway and say so: a developer will ask for the file another way.
                </div>
              )}
              {removedList.length > 0 && (
                <div style={{ font: F.mono(500, 11), letterSpacing: '.08em', color: T.micro }}>
                  Removed: {removedList.map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(' · ')}
                </div>
              )}
              {downloadErr && (
                <div role="alert" style={{ font: F.chk(700, 12), color: T.bad }}>▲ {downloadErr}</div>
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
