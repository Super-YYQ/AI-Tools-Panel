import React from 'react';
import { createRoot } from 'react-dom/client';
import { bootstrapSession } from './api';
import { App } from './App';
import './styles.css';

// FUN-001: consume and strip the session fragment BEFORE the router reads
// window.location.hash, so the first page is always the overview.
bootstrapSession();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
