import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { ToastStack } from "./components/ToastStack";
import { DemoPanel } from "./components/DemoPanel";
import { ChatDrawer } from "./components/ChatDrawer";
import { ResumePrompt } from "./components/ResumePrompt";
import { NoticeModal } from "./components/NoticeModal";
import { loadSession } from "./store/persistence";
import { useSimLoop } from "./hooks/useSimLoop";
import { useWeatherFeed } from "./hooks/useWeatherFeed";
import { useMarineFeeds } from "./hooks/useMarineFeeds";
import { useAgentWatch } from "./hooks/useAgentWatch";
import { useSimStore } from "./store/simStore";
import { VIEWS, type ViewId } from "./views/registry";

export default function App() {
  useSimLoop();
  useWeatherFeed();
  useMarineFeeds();
  useAgentWatch();
  const [view, setView] = useState<ViewId>("monitor");
  const [demoOpen, setDemoOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // D-76: read the save exactly once at mount; the prompt stays up until the
  // manager chooses (autosave can't clobber it before tick 10).
  const [savedSession, setSavedSession] = useState(() => loadSession());
  const resumeSaved = useSimStore((s) => s.resumeSaved);
  const discardSaved = useSimStore((s) => s.discardSaved);

  // The twin inspector's "Ask PortSentinel about this" queues a prompt; open the
  // chat drawer whenever one arrives (ChatDrawer consumes it into its input).
  const chatPrefill = useSimStore((s) => s.chatPrefill);
  useEffect(() => {
    if (chatPrefill) setChatOpen(true);
  }, [chatPrefill]);

  // The agent can dispatch a review on its own (proactive monitoring, or the
  // dashboard's "AI review"); surface the drawer so the answer is visible.
  const chatOpenSignal = useSimStore((s) => s.chatOpenSignal);
  useEffect(() => {
    if (chatOpenSignal > 0) setChatOpen(true);
  }, [chatOpenSignal]);
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  const toggleDark = () => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.theme = next ? "dark" : "light";
      return next;
    });
  };

  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  const ViewComponent = current.component;

  return (
    <div className="flex h-screen bg-slate-100 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
      <Sidebar
        active={current.id}
        onNavigate={setView}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          title={current.label}
          dark={dark}
          onToggleDark={toggleDark}
          demoOpen={demoOpen}
          onToggleDemo={() => setDemoOpen((o) => !o)}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((o) => !o)}
          onViewAllAlerts={() => setView("alerts")}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
        />
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4">
          <ViewComponent onNavigate={setView} />
        </main>
      </div>
      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} onNavigate={setView} />
      {/* Always mounted so the overlay remembers where it was dragged between
          openings; `open` only controls visibility. Closing it never touches
          the simulation. */}
      <DemoPanel open={demoOpen} onClose={() => setDemoOpen(false)} onNavigate={setView} />
      {savedSession && (
        <ResumePrompt
          saved={savedSession}
          onResume={() => {
            resumeSaved(savedSession);
            setSavedSession(null);
          }}
          onFresh={() => {
            discardSaved();
            setSavedSession(null);
          }}
        />
      )}
      <NoticeModal />
      <ToastStack />
    </div>
  );
}
