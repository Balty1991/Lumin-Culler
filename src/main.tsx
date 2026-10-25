import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { BootBoundary } from './ui/rescue/BootBoundary';
import { RescueApp } from './ui/rescue/RescueApp';

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BootBoundary>
      <RescueApp />
    </BootBoundary>
  </React.StrictMode>
);
