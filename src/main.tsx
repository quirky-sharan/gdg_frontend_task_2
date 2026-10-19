import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadSaved } from './state/persistence';
import { demoSheet } from './state/samples';
import { useSheet } from './state/store';
import './styles.css';

// Restore the autosaved sheet, or start with the feature demo.
const saved = loadSaved();
if (saved) useSheet.getState().loadInitial(saved.doc, saved.colWidths);
else useSheet.getState().loadInitial(demoSheet(), { 0: 120, 5: 110, 7: 170, 8: 190 });

// Handy for debugging from the devtools console.
if (import.meta.env.DEV) (window as unknown as { sheet: typeof useSheet }).sheet = useSheet;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
