/** A mock download route. The mock has no HTTP server, so intercept only its own URL. */
export const PENDING_CSV_URL = '/__mock__/pending-result.csv';

export function installMockCsvFetch(): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url, location.href).pathname === PENDING_CSV_URL) {
      return Promise.resolve(new Response(JSON.stringify({ error: 'Finalise the result first.' }), {
        status: 409, headers: { 'content-type': 'application/json' },
      }));
    }
    return previous(input, init);
  }) as typeof fetch;
  return () => { globalThis.fetch = previous; };
}
