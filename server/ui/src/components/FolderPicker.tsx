import { useState, useEffect, useCallback } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  token: string;
  cwd: string;
  browseRoot: string;
  onCwdChange: (cwd: string) => void;
  onStartSession: (cwd: string) => void;
}

export function FolderPicker({ token, cwd, browseRoot, onCwdChange, onStartSession }: Props) {
  const [open, setOpen] = useState(false);
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const rootName = browseRoot.split("/").filter(Boolean).pop() ?? "root";

  const relPath = cwd.startsWith(browseRoot)
    ? cwd.slice(browseRoot.length).replace(/^\//, "")
    : "";

  const segments = relPath ? relPath.split("/") : [];

  const fetchDirs = useCallback(async (rel: string) => {
    setLoading(true);
    try {
      const params = rel ? `?path=${encodeURIComponent(rel)}` : "";
      const res = await fetch(`/api/browse${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const body = await res.json();
        setDirs(body.dirs);
      } else {
        setDirs([]);
      }
    } catch (err) {
      console.error("Failed to browse:", err);
      setDirs([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (open) fetchDirs(relPath);
  }, [open, relPath, fetchDirs]);

  const navigateTo = (rel: string) => {
    const newCwd = rel ? `${browseRoot}/${rel}` : browseRoot;
    onCwdChange(newCwd);
  };

  if (!browseRoot) return null;

  return (
    <div className="border-b border-border">
      <div className="flex items-center">
        <button
          className="flex-1 min-w-0 flex items-center gap-2 w-full px-3 py-2.5 bg-transparent border-none text-foreground text-[0.8125rem] cursor-pointer text-left hover:bg-accent"
          onClick={() => setOpen(!open)}
          type="button"
        >
          <span className="shrink-0 text-[0.625rem] text-muted-foreground">{open ? "\u25BE" : "\u25B8"}</span>
          <span className="flex items-center flex-wrap gap-0 min-w-0 overflow-hidden">
            <span
              className={cn(
                "cursor-pointer font-mono text-xs hover:text-primary hover:underline",
                segments.length === 0 ? "text-foreground" : "text-muted-foreground"
              )}
              onClick={(e) => { e.stopPropagation(); navigateTo(""); }}
            >
              {rootName}
            </span>
            {segments.map((seg, i) => (
              <span key={i}>
                <span className="text-muted-foreground mx-1 text-xs">/</span>
                <span
                  className={cn(
                    "cursor-pointer font-mono text-xs hover:text-primary hover:underline",
                    i === segments.length - 1 ? "text-foreground" : "text-muted-foreground"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigateTo(segments.slice(0, i + 1).join("/"));
                  }}
                >
                  {seg}
                </span>
              </span>
            ))}
          </span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="shrink-0 bg-transparent border-none text-muted-foreground text-[0.625rem] cursor-pointer px-2.5 py-1.5 leading-none hover:text-emerald-400"
              onClick={() => onStartSession(cwd)}
              type="button"
            >
              &#9654;
            </button>
          </TooltipTrigger>
          <TooltipContent>Start session here</TooltipContent>
        </Tooltip>
      </div>
      {open && (
        <div className="max-h-[200px] overflow-y-auto border-t border-border">
          {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>}
          {!loading && dirs.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No subdirectories</div>
          )}
          {!loading && dirs.map((dir) => {
            const dirCwd = relPath ? `${browseRoot}/${relPath}/${dir}` : `${browseRoot}/${dir}`;
            return (
              <div key={dir} className="flex items-center">
                <button
                  className="flex-1 min-w-0 block w-full px-3 py-1.5 pl-6 bg-transparent border-none text-foreground text-[0.8125rem] font-mono cursor-pointer text-left hover:bg-accent hover:text-primary"
                  onClick={() => navigateTo(relPath ? `${relPath}/${dir}` : dir)}
                  type="button"
                >
                  {dir}
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="shrink-0 bg-transparent border-none text-muted-foreground text-[0.625rem] cursor-pointer px-2.5 py-1.5 leading-none hover:text-emerald-400"
                      onClick={() => onStartSession(dirCwd)}
                      type="button"
                    >
                      &#9654;
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Start session in this folder</TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
