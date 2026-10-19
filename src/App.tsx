import { useEffect } from 'react';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { FormulaBar } from './components/FormulaBar';
import { Grid } from './components/grid/Grid';
import { focusGrid } from './components/grid/layout';
import { ShortcutsDialog, Toast } from './components/Overlays';
import { SidePanel } from './components/SidePanel';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { startAutosave } from './state/persistence';

export function App() {
  useEffect(() => {
    focusGrid();
    return startAutosave();
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <FormulaBar />
      <main className="workspace">
        <div className="grid-area">
          <Grid />
          <DiagnosticsPanel />
        </div>
        <SidePanel />
      </main>
      <StatusBar />
      <ShortcutsDialog />
      <Toast />
    </div>
  );
}
