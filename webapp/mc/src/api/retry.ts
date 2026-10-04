/** O5: load one thing at mount; on failure report it and retry with backoff (2 s, 4 s ... capped at 30 s)
 *  until it loads or `cancelled()` says the caller is gone. Returns a cancel function. */
export function loadWithRetry<T>(
  load: () => Promise<T>,
  onOk: (v: T) => void,
  onFail: (failed: boolean) => void,
  opts: { firstMs?: number; maxMs?: number } = {},
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = opts.firstMs ?? 2000;
  const max = opts.maxMs ?? 30000;
  const attempt = () => {
    load().then(v => { if (stopped) return; onFail(false); onOk(v); }, () => {
      if (stopped) return;
      onFail(true);
      timer = setTimeout(attempt, delay);
      delay = Math.min(delay * 2, max);
    });
  };
  attempt();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
