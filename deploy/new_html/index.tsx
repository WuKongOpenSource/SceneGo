import React from 'react';
import ReactDOM from 'react-dom/client';

import '@fontsource/sora/500.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import '@fontsource/sora/800.css';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
import './styles/design-tokens.css';
import '../static/css/tab-navigation.css';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
