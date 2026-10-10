// The official documents the site says it links are reachable: every external URL in docs/manual and docs/platform,
// plus every external href in the built pages (the footer link lives in a template, not in a manual file).
//
// This used to be spec 2b in site/test/site.spec.mjs, inside the gate. It depends on other hosts being up and fast,
// and on 2026-10-10 it timed out a lander gate while GitHub answered 503 and 504. It now runs in CI's
// `external-links` job, which never turns main red (its failure shows only inside the run). The likeliest dead link,
// one of ours to a moved file, is still blocked in the gate, offline: mcp/tests/test_site_external_links.py checks
// every github.com/tony99nyr/open-brx/{blob,tree}/main/<path> link against the checkout.
//
// Rules (unchanged from the spec): a 4xx is a dead link and fails; 429 (the host rate-limiting this checker), a 5xx
// (the host failing) and a transport error are reported and skipped. Run: `npm run build && node tools/check-external-links.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../../webapp');
const DOCS = path.resolve(HERE, '../../docs');
const TIMEOUT_MS = 20_000;

export function collectUrls({ docs = DOCS, web = WEB } = {}) {   // web: null = the markdown only
  const urls = new Set();
  for (const dir of ['manual', 'platform'].map(d => path.join(docs, d))) {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md')) {
      for (const u of fs.readFileSync(path.join(dir, f), 'utf8').match(/https?:\/\/[^\s)"'<]+/g) || []) urls.add(u);
    }
  }
  for (const f of web ? fs.readdirSync(web).filter(f => f.endsWith('.html')) : []) {
    for (const u of fs.readFileSync(path.join(web, f), 'utf8').match(/href="(https?:\/\/[^"]+)"/g) || []) urls.add(u.slice(6, -1));
  }
  return [...urls].sort();
}

/** {bad: ["url -> status"], skipped: ["url (why)"]}. One request at a time per host (hosts in parallel), and one
 *  retry of a 429 after `retryMs`: a burst at one host (most links are GitHub) drew 429s, and a 429 is skipped, so a
 *  dead link could hide behind one (Codex review, 2026-10-10). */
export async function checkUrls(urls, fetchImpl = fetch, { retryMs = 3000 } = {}) {
  const bad = [], skipped = [];
  const byHost = new Map();
  for (const u of urls) {
    const host = (() => { try { return new URL(u).host; } catch { return ''; } })();
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(u);
  }
  const get = u => fetchImpl(u, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
  await Promise.all([...byHost.values()].map(async list => {
    for (const u of list) {
      try {
        let r = await get(u);
        if (r.status === 429) { await new Promise(res => setTimeout(res, retryMs)); r = await get(u); }
        if (r.status === 429 || r.status >= 500) skipped.push(`${u} (${r.status})`);
        else if (r.status >= 400) bad.push(`${u} -> ${r.status}`);
      } catch (e) { skipped.push(`${u} (${String(e.message || e).split('\n')[0]})`); }
    }
  }));
  return { bad: bad.sort(), skipped: skipped.sort() };
}

// realpath both sides: run through a symlink, argv[1] keeps the link and the guard would skip every check (Opus review).
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const urls = collectUrls();
  if (!urls.length) { console.error('the manual publishes no external link at all'); process.exit(1); }
  const { bad, skipped } = await checkUrls(urls);
  for (const s of skipped) console.log(`  could not verify: ${s}`);
  console.log(`${urls.length} external link(s): ${urls.length - bad.length - skipped.length} ok, ${skipped.length} not verifiable, ${bad.length} dead`);
  if (bad.length) { for (const b of bad) console.error(`  DEAD: ${b}`); process.exit(1); }
}
