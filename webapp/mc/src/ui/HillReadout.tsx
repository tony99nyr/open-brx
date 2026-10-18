// F559: the hill pace in force, as one line: "HILL: CAPTURE 15 S · NET CAP 4". A key the game does not set reads SET ON THE HILL
// (MC sends nothing, so each hill keeps the pace it last had, MC's last value included, until it is changed on the hill).
// KING OF THE HILL only; any other mode shows nothing. An older server sends no
// `config.hill`: both keys then read SET ON THE HILL.
import type { ConfigView } from '../api/types';
import { F, T } from '../tokens';

export function hillReadoutText(config: Pick<ConfigView, 'mode' | 'hill'> | undefined): string | null {
  if (config?.mode !== 'koth') return null;
  const capture = config.hill?.capture_s;
  const net = config.hill?.net_cap;
  if (capture == null && net == null) return 'HILL: PACE SET ON EACH HILL';
  return `HILL: CAPTURE ${capture == null ? 'SET ON THE HILL' : `${capture} S`} · NET CAP ${net == null ? 'SET ON THE HILL' : net}`;
}

export function HillReadout({ config, style }: { config: Pick<ConfigView, 'mode' | 'hill'> | undefined; style?: React.CSSProperties }) {
  const text = hillReadoutText(config);
  if (!text) return null;
  return <div data-testid="hill-readout" role="status" style={{ font: F.chk(600, 12), letterSpacing: '.06em', lineHeight: 1.5, color: T.dim, ...style }}>{text}</div>;
}
