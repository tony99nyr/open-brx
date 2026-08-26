import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { T } from '../tokens';
import { GhostButton } from './index';

/** Operator kick for one node (two-step: EVICT → CONFIRM within 4 s). Closes the node's socket, unbinds its player and
 *  rotates its key server-side (DELETE /api/nodes/{id}) — the recovery for a stranger that hello'd with a live gun
 *  name before the owner's phone connected. Auth-gated like every other write. */
export function EvictButton({ nodeId, label = 'EVICT' }: { nodeId: string; label?: string }) {
  const { run, api } = useStore();
  const [arm, setArm] = useState(false);
  useEffect(() => { if (!arm) return; const t = setTimeout(() => setArm(false), 4000); return () => clearTimeout(t); }, [arm]);
  if (!arm) return <GhostButton size={9} pad="2px 8px" title={`Kick node ${nodeId}: closes its link and frees its player (confirm step)`} onClick={() => setArm(true)}>{label}</GhostButton>;
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <GhostButton size={9} pad="2px 8px" color={T.bad} border={T.bad} hoverClass="hov-badbg" title="Confirm eviction" onClick={async () => { setArm(false); await run(() => api.evictNode(nodeId)); }}>CONFIRM KICK</GhostButton>
      <GhostButton size={9} pad="2px 8px" onClick={() => setArm(false)}>✕</GhostButton>
    </span>
  );
}
