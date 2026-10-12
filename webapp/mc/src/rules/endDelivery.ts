import type { EndDeliveryView, Player } from '../api/types';

export const END_RETRY_MS = [2_000, 5_000, 10_000, 20_000, 40_000, 60_000] as const;

export type EndReceipt = {
  match_id: string; player_id: string; since: number; tries: number; next_t: number;
  confirmed: boolean; exhausted: boolean; last_ok: boolean;
};

// Server: state.py Session._arm_end_delivery().
export function sessionArmEndDelivery(match_id: string, player_id: string, now: number): EndReceipt {
  return { match_id, player_id, since: now, tries: 0, next_t: now + END_RETRY_MS[0],
    confirmed: false, exhausted: false, last_ok: false };
}

// Server: state.py Session._end_delivery_tried().
export function sessionEndDeliveryTried(e: EndReceipt, match_id: string, now: number, ok: boolean): EndReceipt {
  if (e.match_id !== match_id || e.confirmed) return e;
  const tries = e.tries + 1;
  return { ...e, tries, last_ok: ok,
    next_t: now + END_RETRY_MS[Math.min(tries - 1, END_RETRY_MS.length - 1)],
    exhausted: tries >= 1 + END_RETRY_MS.length };
}

// Server: state.py Session._note_end_confirm().
export function sessionNoteEndConfirm(e: EndReceipt, arm_state: string | undefined,
    match_id: string | undefined): EndReceipt {
  const moved_on = match_id !== undefined && match_id !== e.match_id;
  const took_ours = arm_state === 'kitted' && match_id === e.match_id;
  return !e.confirmed && (moved_on || took_ours) ? { ...e, confirmed: true } : e;
}

// Server: state.py Session._retry_end_delivery().
export function sessionRetryEndDelivery(e: EndReceipt, now: number, ok: boolean): EndReceipt {
  return e.confirmed || e.exhausted || e.next_t > now ? e : sessionEndDeliveryTried(e, e.match_id, now, ok);
}

// Server: state.py Session._note_end_confirm().
export function sessionNoteEndConfirmLine(display: string, since: number, now: number, tries: number): string {
  return `${display.toUpperCase()}'S HUD CONFIRMED THE END, ${Math.floor(Math.max(0, now - since) / 1000)}S AFTER THE WHISTLE, ON DELIVERY ${tries}`;
}

// Server: state.py Session._say_end_unconfirmed().
export function sessionSayEndUnconfirmed(displays: readonly string[]): string {
  const names = [...displays].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const one = names.length === 1;
  return `${names.length} HUD${one ? '' : 'S'} NEVER CONFIRMED THE END (${names.join(', ')}). ` +
    `MC TOLD ${one ? 'IT' : 'THEM'} ${1 + END_RETRY_MS.length} TIMES. ` +
    `${one ? 'THAT TAGGER' : 'THOSE TAGGERS'} MAY STILL BE IN THE MATCH: ` +
    `END IT ON ${one ? 'THE GUN' : 'THOSE GUNS'}`;
}

// Server: state.py Session._end_delivery_view().
export function sessionEndDeliveryView(receipts: Readonly<Record<string, EndReceipt | undefined>>,
    players: readonly Player[], now: number): EndDeliveryView | undefined {
  const entries = Object.entries(receipts).filter((entry): entry is [string, EndReceipt] => !!entry[1]);
  if (!entries.length) return undefined;
  const rows = entries.flatMap(([node_id, e]) => {
    if (e.confirmed) return [];
    const display = players.find(p => p.player_id === e.player_id)?.display || e.player_id;
    return [{ player_id: e.player_id, display, node_id, tries: e.tries,
      since_ms: now - e.since, reached: !!e.last_ok, retrying: !e.exhausted }];
  }).sort((a, b) => a.display < b.display ? -1 : a.display > b.display ? 1 : 0);
  return { match_id: entries[0][1].match_id, total: entries.length,
    confirmed: entries.length - rows.length, unconfirmed: rows,
    retrying: rows.some(row => row.retrying) };
}
