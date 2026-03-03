import type { HookEventName, MatcherGroup, HookHandler } from "@/stores/claude-hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Terminal, Globe } from "lucide-react";

interface HookEventCardProps {
  event: HookEventName;
  groups: MatcherGroup[];
  onEditHandler: (groupIdx: number, handlerIdx: number) => void;
  onDeleteHandler: (groupIdx: number, handlerIdx: number) => void;
}

function HandlerRow({
  handler,
  onEdit,
  onDelete,
}: {
  handler: HookHandler;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isCommand = handler.type === "command";

  return (
    <div className="flex items-center gap-2 py-1">
      <Badge variant="outline" className="text-xs shrink-0">
        {isCommand ? (
          <>
            <Terminal className="h-3 w-3" /> command
          </>
        ) : (
          <>
            <Globe className="h-3 w-3" /> http
          </>
        )}
      </Badge>
      <span className="text-xs font-mono text-muted-foreground truncate max-w-[300px]">
        {isCommand ? handler.command : handler.url}
      </span>
      <div className="ml-auto flex items-center gap-0.5 shrink-0">
        <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label="Edit handler">
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-destructive hover:text-destructive"
          onClick={() => {
            if (window.confirm("Delete this hook handler?")) {
              onDelete();
            }
          }}
          aria-label="Delete handler"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export function HookEventCard({ event, groups, onEditHandler, onDeleteHandler }: HookEventCardProps) {
  const handlerCount = groups.reduce((sum, g) => sum + g.hooks.length, 0);

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">{event}</span>
        <Badge variant="secondary" className="text-xs">
          {handlerCount} {handlerCount === 1 ? "handler" : "handlers"}
        </Badge>
      </div>

      {groups.map((group, groupIdx) => (
        <div key={groupIdx} className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">
            {group.matcher ? (
              <span className="font-mono">{group.matcher}</span>
            ) : (
              "All events"
            )}
          </span>
          {group.hooks.map((handler, handlerIdx) => (
            <HandlerRow
              key={handlerIdx}
              handler={handler}
              onEdit={() => onEditHandler(groupIdx, handlerIdx)}
              onDelete={() => onDeleteHandler(groupIdx, handlerIdx)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
