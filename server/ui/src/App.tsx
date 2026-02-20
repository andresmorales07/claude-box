import { useState, useCallback, useEffect } from "react";
import { SessionList } from "./components/SessionList";
import { ChatView } from "./components/ChatView";
import { FolderPicker } from "./components/FolderPicker";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import "./globals.css";

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem("api_token") ?? "");
  const [authenticated, setAuthenticated] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [cwd, setCwd] = useState("");
  const [browseRoot, setBrowseRoot] = useState("");

  useEffect(() => {
    if (!authenticated) return;
    fetch("/api/config", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.ok ? res.json() : null)
      .then((config) => {
        if (config?.browseRoot) {
          setBrowseRoot(config.browseRoot);
          if (!cwd) setCwd(config.defaultCwd ?? config.browseRoot);
        }
      })
      .catch(() => {});
  }, [authenticated, token]);

  const startSession = useCallback(async (sessionCwd: string) => {
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: sessionCwd }),
      });
      if (res.ok) {
        const session = await res.json();
        setActiveSessionId(session.id);
        setShowSidebar(false);
      }
    } catch (err) {
      console.error("Failed to start session:", err);
    }
  }, [token]);

  const resumeSession = useCallback(async (historySessionId: string) => {
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ resumeSessionId: historySessionId, cwd, provider: "claude" }),
      });
      if (res.ok) {
        const session = await res.json();
        setActiveSessionId(session.id);
        setShowSidebar(false);
      }
    } catch (err) {
      console.error("Failed to resume session:", err);
    }
  }, [token, cwd]);

  if (!authenticated) {
    return <LoginPage token={token} setToken={setToken} onLogin={() => setAuthenticated(true)} />;
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-dvh">
        <header className="flex items-center gap-3 px-4 py-3 bg-card border-b border-border shrink-0">
          <button
            className="bg-transparent border-none text-foreground text-2xl cursor-pointer p-0 leading-none md:hidden"
            onClick={() => setShowSidebar(!showSidebar)}
          >
            {showSidebar ? "\u2715" : "\u2630"}
          </button>
          <h1 className="text-lg font-bold text-primary">Hatchpod</h1>
        </header>
        <div className="flex flex-1 overflow-hidden relative">
          <aside className={cn(
            "absolute top-0 left-0 bottom-0 w-[280px] bg-card border-r border-border z-10 flex flex-col transition-transform duration-200 ease-in-out",
            "md:static md:translate-x-0 md:shrink-0",
            showSidebar ? "translate-x-0" : "-translate-x-full"
          )}>
            <FolderPicker token={token} cwd={cwd} browseRoot={browseRoot} onCwdChange={setCwd} onStartSession={startSession} />
            <SessionList token={token} cwd={cwd} activeSessionId={activeSessionId} onSelectSession={(id) => { setActiveSessionId(id); setShowSidebar(false); }} onResumeSession={resumeSession} />
          </aside>
          <main className="flex-1 flex flex-col overflow-hidden">
            {activeSessionId ? (
              <ChatView sessionId={activeSessionId} token={token} />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-lg">
                <p>Create a new session to get started</p>
              </div>
            )}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function LoginPage({ token, setToken, onLogin }: { token: string; setToken: (t: string) => void; onLogin: () => void }) {
  const [error, setError] = useState("");
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/sessions", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { localStorage.setItem("api_token", token); onLogin(); }
      else if (res.status === 401) { setError("Invalid password"); }
      else { setError(`Server error (${res.status})`); }
    } catch { setError("Unable to reach server — check your connection"); }
  };
  return (
    <div className="flex items-center justify-center h-dvh p-4">
      <form className="bg-card p-8 rounded-lg border border-border w-full max-w-[360px] flex flex-col gap-4" onSubmit={handleSubmit}>
        <h1 className="text-2xl font-bold text-center text-primary">Hatchpod</h1>
        <Input type="password" placeholder="API Password" value={token} onChange={(e) => setToken(e.target.value)} autoFocus />
        <Button type="submit" className="w-full">Connect</Button>
        {error && <p className="text-destructive text-sm text-center">{error}</p>}
      </form>
    </div>
  );
}
