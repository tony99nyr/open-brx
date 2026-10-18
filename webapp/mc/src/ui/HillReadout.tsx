// F559: the hill pace in force, as one line: "HILL: CAPTURE 15 S · NET CAP 4". A key the game does not set reads STATION DEFAULT
// (each hill phone keeps its own +/- value). KING OF THE HILL only; any other mode shows nothing. An older server sends no
// `config.hill`: both keys then read STATION DEFAULT.
import type { ConfigView } from '../api/types';
import { F, T } from '../tokens';

export function hillReadoutText(config: Pick<ConfigView, 'mode' | 'hill'> | undefined): string | null {
  if (config?.mode !== 'koth') return null;
  const capture = config.hill?.capture_s;
  const net = config.hill?.net_cap;
  return `HILL: CAPTURE ${capture == null ? 'STATION DEFAULT' : `${capture} S`} · NET CAP ${net == null ? 'STATION DEFAULT' : net}`;
}

export function HillReadout({ config, style }: { config: Pick<ConfigView, 'mode' | 'hill'> | undefined; style?: React.CSSProperties }) {
  const text = hillReadoutText(config);
  if (!text) return null;
  return <div data-testid="hill-readout" role="status" style={{ font: F.chk(600, 12), letterSpacing: '.06em', lineHeight: 1.5, color: T.dim, ...style }}>{text}</div>;
}
