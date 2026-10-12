import type { NodeView, VersionsView } from '../api/types';
import { APP_MAJOR, APP_MINOR, OFFLINE_AFTER_MS } from '../api/contract.gen';

// Port of state.py Session.versions(), _newest_field_version() and types.py compatible().

function parseAppVer(value: string | null | undefined): number[] | null {
  if (typeof value !== 'string') return null;
  const core = value.trim().split('+', 1)[0].split('-', 1)[0];
  const parts = core.split('.');
  return parts.length === 3 && parts.every(part => /^\d+$/.test(part)) ? parts.map(Number) : null;
}

function newer(a: number[], b: number[]): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function sessionVersions(nodes: NodeView[], release: string | null): VersionsView {
  const field: Record<string, number> = {};
  let newest: number[] | null = null;
  for (const node of nodes) {
    if (node.node_type === 'utility' || node.last_seen_ms > OFFLINE_AFTER_MS) continue;
    const value = node.app_ver;
    if (!value) continue;
    field[value] = (field[value] ?? 0) + 1;
    const parsed = parseAppVer(value);
    if (!parsed || (APP_MAJOR === 0 ? parsed[0] !== APP_MAJOR || parsed[1] !== APP_MINOR : parsed[0] !== APP_MAJOR)) continue;
    if (!newest || newer(parsed, newest)) newest = parsed;
  }
  return { field, newest: newest ? (newest as number[]).join('.') : null, release,
    mc_major: APP_MAJOR === 0 ? `${APP_MAJOR}.${APP_MINOR}` : String(APP_MAJOR) };
}
