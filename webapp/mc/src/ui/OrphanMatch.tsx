// Bench 2026-09-17: MC restarted mid-match with no snapshot to resume from, and the phones played on in a
// match the new process knew nothing about. `state.orphan_match` is present ONLY while a bound phone
// reports that match (`state.py orphan_match_view`), so this renders nothing at all otherwise. It lives
// on the MATCH tab (Tony: not ARMORY), and the MATCH nav tab carries a dot while it is present.
import { useState } from 'react';
import { useStore } from '../store';
import { setNotice } from '../notice';
import { F, T } from '../tokens';
import { Alert } from './Alert';
import { GhostButton, PrimaryButton } from './index';

export function OrphanMatch() {
  const { state, run, api } = useStore();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const om = state?.orphan_match;
  if (!om) return null;
  const n = om.phones;
  const phones = `${n} PHONE${n === 1 ? ' IS' : 'S ARE'}`;
  return (
    <div data-testid="orphan-match" role="status"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 14px', marginBottom: 12 }}>
      {/* F221 polish r2: `frame-orphan-match` is amber-only, and Tony's rule is explicit that AMBER is
          never a banner — this used to keep the bordered, left-ruled box even after the words moved
          onto their own line (F221 round 1); now it is one plain <Alert> line, nothing else. */}
      <span style={{ flex: '1 1 260px' }}>
        <Alert id="frame-orphan-match" variant="line" what={`${phones} IN A MATCH THIS MC DID NOT START`} />
        <span style={{ display: 'block', font: F.mono(500, 11), letterSpacing: '.08em', color: T.dim }}>
          {om.players.join(', ')} · {om.arm_state.toUpperCase()}
        </span>
      </span>
      {om.can_resume && (
        <PrimaryButton size={12} pad="10px 18px"
          title="Run their match on this MC and score it from the facts MC holds. Nothing is sent to the phones."
          onClick={async () => {
            const s = await run(() => api.resumeOrphan(om.match_id));
            if (s) setNotice('RESUMED THEIR MATCH');
          }}>RESUME MATCH</PrimaryButton>
      )}
      {confirmEnd ? (
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <GhostButton color={T.bad} border={T.bad} onClick={async () => {
            setConfirmEnd(false);
            const s = await run(() => api.endOrphan(om.match_id));
            if (s) setNotice(`TOLD ${n} PHONE${n === 1 ? '' : 'S'} TO END THEIR MATCH`);
          }}>END IT ON {n} PHONE{n === 1 ? '' : 'S'}</GhostButton>
          <GhostButton onClick={() => setConfirmEnd(false)}>CANCEL</GhostButton>
        </span>
      ) : (
        <GhostButton color={T.bad} border={T.line2} onClick={() => setConfirmEnd(true)}>END THEIR MATCH</GhostButton>
      )}
    </div>
  );
}
