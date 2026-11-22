import { localeReady } from '../../i18n/core';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../index.css';
import { SidePanelApp } from './SidePanelApp';

void localeReady.then(() => {
  ReactDOM.createRoot(document.getElementById('sidepanel-root')!).render(
    <React.StrictMode>
      <SidePanelApp />
    </React.StrictMode>,
  );
});
