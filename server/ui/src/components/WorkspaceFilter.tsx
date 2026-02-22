import { useSessionsStore } from "@/stores/sessions";
import { FolderPicker } from "./FolderPicker";
import { X } from "lucide-react";

export function WorkspaceFilter() {
  const { cwd, browseRoot, setCwd, workspaceFilter, setWorkspaceFilter } = useSessionsStore();

  return (
    <div className="flex items-center gap-1">
      <div className="flex-1 min-w-0">
        <FolderPicker
          cwd={workspaceFilter ?? cwd}
          browseRoot={browseRoot}
          onCwdChange={(path) => { setWorkspaceFilter(path); setCwd(path); }}
        />
      </div>
      {workspaceFilter && (
        <button
          onClick={() => setWorkspaceFilter(null)}
          title="Show all workspaces"
          aria-label="Clear workspace filter"
          className="shrink-0 mr-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
