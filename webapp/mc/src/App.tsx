import { CommandBar } from './frame/CommandBar';
import { Armed } from './screens/Armed';
import { Armory } from './screens/Armory';
import { Build } from './screens/Build';
import { Kit } from './screens/Kit';
import { Live } from './screens/Live';
import { Lobby } from './screens/Lobby';
import { Recap } from './screens/Recap';
import { StoreProvider, useStore } from './store';
import { F, T } from './tokens';

function Screen() {
  const { state, view } = useStore();
  if (!state) {
    return <div style={{ font: F.mono(500, 10), letterSpacing: '.2em', color: T.micro, padding: 40 }}>CONNECTING TO MISSION CONTROL… (append <code>?mock</code> for the in-browser demo)</div>;
  }
  switch (view) {
    case 'muster': return <Armory />;
    case 'build': return <Build />;
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
          <Screen />
        </main>
      </div>
    </StoreProvider>
  );
}
