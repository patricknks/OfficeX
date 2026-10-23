import { useEffect, useState } from 'react';
import { useStore } from './store';
import { startSimulator } from './mock/simulator';
import { connectLive } from './live';
import { useT } from './i18n';
import { Welcome } from './components/Welcome';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { AgentDrawer } from './components/AgentDrawer';
import { AddAgentDialog } from './components/AddAgentDialog';
import { ConnectDialog } from './components/ConnectDialog';
import { StageOverlay } from './components/StageOverlay';
import { ProjectorViewer } from './components/ProjectorViewer';
import { ProjectDrawer } from './components/ProjectDrawer';
import { NewProjectDialog } from './components/NewProjectDialog';
import { SecretaryDialog } from './components/SecretaryDialog';
import { Office } from './office/Office';

/** Errors from the server (e.g. "this team already has a manager") as a short-lived toast. */
function Toasts() {
  const [list, setList] = useState<{ id: number; text: string }[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const id = Date.now() + Math.random();
      setList((l) => [...l.slice(-2), { id, text: String((e as CustomEvent).detail) }]);
      window.setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), 6000);
    };
    window.addEventListener('ox:error', on);
    return () => window.removeEventListener('ox:error', on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((x) => (
        <p key={x.id} className="toast">
          {x.text}
        </p>
      ))}
    </div>
  );
}

export default function App() {
  const lang = useStore((s) => s.lang);
  const chat = useStore((s) => s.chat);
  const side = useStore((s) => s.side);
  const mode = useStore((s) => s.mode);
  const t = useT();
  useEffect(() => {
    let stop: (() => void) | undefined;
    let alive = true;
    connectLive().then((live) => {
      if (!alive) return;
      if (!live) {
        useStore.getState().setMode('demo');
        stop = startSimulator();
      }
    });
    return () => {
      alive = false;
      stop?.();
    };
  }, []);
  useEffect(() => {
    if (lang) document.documentElement.lang = lang;
  }, [lang]);

  if (mode === 'pending') return <div className="booting" aria-busy="true" />;
  if (!lang) return <Welcome />;
  return (
    <div className="app" data-mode={mode} style={{ ['--chat-w' as string]: chat.collapsed ? '48px' : `${chat.width}px`, ['--side-w' as string]: side.collapsed ? '48px' : `${side.width}px` }}>
      <TopBar />
      <Sidebar />
      <main className="stage" aria-label={t('stage.hint')}>
        <Office />
        <StageOverlay />
        <AgentDrawer />
        <ProjectDrawer />
      </main>
      <ChatPanel />
      <AddAgentDialog />
      <ConnectDialog />
      <ProjectorViewer />
      <NewProjectDialog />
      <SecretaryDialog />
      <Toasts />
    </div>
  );
}
