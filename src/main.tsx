import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.tsx';
import { AppProvider } from './store/AppStore';
import { firstRunState, workspaceStorage } from './lib/workspaceStorage';

function OpeningWorkspace() {
  return (
    <div className="boot-screen">
      <div className="brand__mark">T</div>
      <p>Opening workspace…</p>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);

async function boot() {
  root.render(<OpeningWorkspace />);
  const saved = await workspaceStorage.load();
  if (saved) void workspaceStorage.snapshot(saved, 'launch');
  root.render(
    <StrictMode>
      <AppProvider initialState={saved ?? firstRunState()}>
        <App />
      </AppProvider>
    </StrictMode>
  );
}

void boot();
