import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/noto-serif-tc';
import '@fontsource-variable/noto-sans-tc';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './styles/global.css';
import { App } from './app/App';

const container = document.getElementById('root');
if (!container) throw new Error('找不到介面容器');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
