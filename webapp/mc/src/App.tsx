import { Component, type ErrorInfo, type ReactNode } from 'react';
import { colourOf } from './alerts';
import { CommandBar } from './frame/CommandBar';
import { Armed } from './screens/Armed';
import { Armory } from './screens/Armory';
import { Build } from './screens/Build';
import { Catalog } from './screens/Catalog';
import { Debug } from './screens/Debug';
import { Games } from './screens/Games';
import { Kit } from './screens/Kit';
import { Live } from './screens/Live';
import { Lobby } from './screens/Lobby';
import { Recap } from './screens/Recap';
import { Spectate } from './screens/Spectate';
import { StoreProvider, useStore } from './store';
import { F, T } from './tokens';
import { FaultPill } from './ui/Compact';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('console error', error, info.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40 }}><FaultPill id="frame-console-error" short="Console error"
          why={String(this.state.error.message || this.state.error)} extra={<button type="button" onClick={() => location.reload()} style={{ alignSelf: 'flex-start', font: F.chk(700, 12), letterSpacing: '.2em', padding: '6px 12px', background: T.acc, color: T.accInk, border: 'none', cursor: 'pointer', minHeight: 32 }}>Reload</button>} /></div>
      );
    }
    return this.props.children;
  }
}

function Screen() {
  const { state, view, authRequired } = useStore();
  if (!state) {
    return authRequired
      ? <div data-alert="frame-token-required-app" data-sev="neutral" style={{ font: F.mono(500, 10), letterSpacing: '.2em', color: colourOf('frame-token-required-app'), padding: 40 }}>
          Open MC's token link or paste the token.
        </div>
      : <div data-alert="frame-connecting" data-sev="neutral" style={{ font: F.mono(500, 10), letterSpacing: '.2em', color: colourOf('frame-connecting'), padding: 40 }}>Connecting. Check the MC server if stalled.</div>;
  }
  switch (view) {
    case 'muster': return <Armory />;
    case 'build': return <Games />;
    case 'designer': return <Build />;
    case 'catalog': return <Catalog />;
    case 'debug': return <Debug />;
    case 'kit': return <Kit />;
    case 'lobby': return <Lobby />;
    case 'armed': return <Armed />;
    case 'live': return <Live />;
    case 'recap': return <Recap />;
    case 'spectate': return <Spectate />;
  }
}

/** S25: the spectator board renders WITHOUT the command bar. That bar carries PANIC, the phase nav and
 *  the ☰ menu — every one of which is a control, and this screen is pointed at a room. It is not enough
 *  to leave controls off `Spectate.tsx` while the shell around it still has them. */
function Shell() {
  const { view } = useStore();
  if (view === 'spectate') return <ErrorBoundary><Screen /></ErrorBoundary>;
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <CommandBar />
      <main style={{ flex: 1, padding: '22px 24px 48px', overflow: 'auto' }}>
        <ErrorBoundary><Screen /></ErrorBoundary>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
