import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { useStore } from '../store';

/** Round 2 candidate 11: the one way a screen loads a list from MC. Each screen used to hand-write a
 *  cancel-guarded fetch effect, and some turned a failure into "none" with `.catch(() => set([]))`.
 *
 *  - A failure keeps the last good data and reports `error`; it never looks like an empty list.
 *  - Only the newest load may write: a response that lands after a newer load started, or after the
 *    screen unmounted, is dropped.
 *  - It loads on mount, whenever `api` or `deps` change, and when the console reconnects. While the
 *    console is known offline it does not load (the request can only fail, and CommandBar already
 *    says MC is offline).
 *  - `retry()` loads again; `reload()` does the same and resolves when that load has settled, for a
 *    caller that refreshes after its own write. */
export interface Resource<T> {
  data: T;
  error: string | null;
  loading: boolean;
  retry: () => void;
  reload: () => Promise<void>;
}

export function useResource<T>(load: () => Promise<T>, initial: T, deps: DependencyList, failed: string): Resource<T> {
  const { api, connected } = useStore();
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(load);
  latest.current = load;
  const failedRef = useRef(failed);
  failedRef.current = failed;
  const generation = useRef(0);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    const mine = ++generation.current;
    const current = () => mounted.current && mine === generation.current;
    setLoading(true);
    try {
      const value = await latest.current();
      if (!current()) return;
      setData(value);
      setError(null);
    } catch (e) {
      if (!current()) return;
      setError((e as Error)?.message || failedRef.current);
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, []);

  useEffect(() => {
    if (!connected) { generation.current++; setLoading(false); return; }
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, connected, reload, ...deps]);

  const retry = useCallback(() => { void reload(); }, [reload]);
  return { data, error, loading, retry, reload };
}
