// F402 (bench 2026-09-28, Tony): after a KOTH LOAD blocked on "no hill" jumps to ARMORY, returning to
// PLAY is the NEXT step, so the button points forward. It stays secondary while no hill is assigned and
// turns PRIMARY the moment a control station is, so it draws the eye. ARMORY's header and the ITEMS
// callout both render it (the callout repeats it once the scroll moves the header off screen, QA-18).
import { useStore } from '../store';
import { GhostButton, PrimaryButton } from '../ui';

export function ContinueToPlay({ testid }: { testid: string }) {
  const { state, setView, setFocusHill } = useStore();
  const hillSet = (state?.stations ?? []).some(s => s.assigned?.kind === 'control');
  const go = () => { setFocusHill(false); setView('build'); };
  return (
    <span data-testid={testid} data-ready={hillSet ? 'true' : 'false'}>
      {hillSet
        ? <PrimaryButton size={12} pad="10px 18px" onClick={go}>CONTINUE TO PLAY ▸</PrimaryButton>
        : <GhostButton onClick={go}>CONTINUE TO PLAY ▸</GhostButton>}
    </span>
  );
}
