import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CommandBar } from './frame/CommandBar';
import { Armed } from './screens/Armed';
import { Armory } from './screens/Armory';
import { Designer } from './screens/Designer';
import { Catalog } from './screens/Catalog';
import { Debug } from './screens/Debug';
import { Games } from './screens/Games';
import { Kit } from './screens/Kit';
import { Live } from './screens/Live';
import { Lobby } from './screens/Lobby';
import { Recap } from './screens/Recap';
import { StoreProvider, useStore } from './store';
import { F, T } from './tokens';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('console error', error, info.componentStack); }
  render() {
    if (this.state.error) {
      return (
        <div role="alert" style={{ font: F.mono(500, 11), letterSpacing: '.14em', color: T.bad, padding: 40, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span>▲ CONSOLE ERROR — {String(this.state.error.message || this.state.error).toUpperCase()}</span>
          <button type="button" onClick={() => location.reload()} style={{ alignSelf: 'flex-start', font: F.chk(700, 12), letterSpacing: '.2em', padding: '10px 18px', background: T.acc, color: T.accInk, border: 'none', cursor: 'pointer', minHeight: 44 }}>RELOAD</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Screen() {
  const { state, view, authRequired } = useStore();
  if (!state) {
    return authRequired
      ? <div style={{ font: F.mono(500, 10), letterSpacing: '.2em', color: T.warn, padding: 40 }}>OPERATOR TOKEN REQUIRED — open the <code>#tok=…</code> link printed by the MC server, or paste the token above.</div>
      : <div style={{ font: F.mono(500, 10), letterSpacing: '.2em', color: T.micro, padding: 40 }}>CONNECTING TO MISSION CONTROL… (append <code>?mock</code> for the in-browser demo)</div>;
  }
  switch (view) {
    case 'muster': return <Armory />;
    case 'build': return <Games />;
    case 'designer': return <Designer />;
    case 'catalog': return <Catalog />;
    case 'debug': return <Debug />;
    case 'kit': return <Kit />;
    case 'lobby': return <Lobby />;
    case 'armed': return <Armed />;
    case 'live': return <Live />;
    case 'recap': return <Recap />;
  }
}

export default function App() {
  return (
    <StoreProvider>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <CommandBar />
        <main style={{ flex: 1, padding: '22px 24px 48px', overflow: 'auto' }}>
          <ErrorBoundary><Screen /></ErrorBoundary>
        </main>
      </div>
    </StoreProvider>
  );
}
