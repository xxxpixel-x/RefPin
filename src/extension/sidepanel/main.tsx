import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../index.css';
import { SidePanelApp } from './SidePanelApp';

ReactDOM.createRoot(document.getElementById('sidepanel-root')!).render(
  <React.StrictMode>
    <SidePanelApp />
  </React.StrictMode>,
);
