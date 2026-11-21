import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/noto-serif-tc';
import '@fontsource-variable/noto-sans-tc';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './styles/global.css';
import { App } from './app/App';
import { createAcceptanceClock } from './app/accept-clock';

const container = document.getElementById('root');
if (!container) throw new Error('找不到介面容器');

let clock;
if (import.meta.env.MODE === 'development') {
  const acceptance = createAcceptanceClock();
  clock = acceptance.clock;
  (window as unknown as { __floorClock: typeof acceptance.control }).__floorClock = acceptance.control;
}

createRoot(container).render(
  <StrictMode>
    <App clock={clock} />
  </StrictMode>,
);
