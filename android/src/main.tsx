import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@shared/styles.css';
import './mobile.css';
import { AppProvider } from '@shared/store/AppStore';
import { firstRunState, workspaceStorage } from '@shared/lib/workspaceStorage';
import { MobileApp } from './MobileApp';

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
        <MobileApp />
      </AppProvider>
    </StrictMode>
  );
}

void boot();
