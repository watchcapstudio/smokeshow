import React from 'react';
import ReactDOM from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import App from './App.jsx';
import { initInstallCapture, recordVisit } from './lib/installNudge.js';
import './styles/seo.css';

initInstallCapture(); // beforeinstallprompt fires early — catch it pre-mount
recordVisit();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <Analytics />
  </React.StrictMode>,
);
