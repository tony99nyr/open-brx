import { T } from '../tokens';
import { GhostButton } from './index';
import { Alert } from './Alert';
import { alertWords } from '../alerts';

/** Round 2 candidate 11: the one strip for a list that failed to load (`useResource`'s `error`), with a
 *  RETRY that loads it again. A failed load must never look like an empty list. */
export function LoadError({ id, testid, retryTestid, what, error, onRetry }:
  { id: string; testid: string; retryTestid: string; what: string; error: string; onRetry: () => void }) {
  return (
    <Alert id={id} testid={testid} style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ lineHeight: 1.5 }}>{alertWords(`COULD NOT LOAD ${what}: ${error}`)}</span>
      <span data-testid={retryTestid}>
        <GhostButton size={14} pad="8px 14px" color={T.ink} border={T.line2} onClick={onRetry}>RETRY ▸</GhostButton>
      </span>
    </Alert>
  );
}
