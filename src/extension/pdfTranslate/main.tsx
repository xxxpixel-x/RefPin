import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../index.css';
import { PdfTranslateApp } from './PdfTranslateApp';

ReactDOM.createRoot(document.getElementById('pdf-translate-root')!).render(
  <React.StrictMode>
    <PdfTranslateApp />
  </React.StrictMode>,
);
