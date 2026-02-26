import type { ProviderAdapter, ProviderSessionOptions, ProviderSessionResult, NormalizedMessage, PaginatedMessages, SessionListItem, PermissionModeCommon } from "./types.js";
export declare class ClaudeAdapter implements ProviderAdapter {
    readonly name = "Claude Code";
    readonly id = "claude";
    readonly modeTransitionTools: Map<string, PermissionModeCommon>;
    run(options: ProviderSessionOptions): AsyncGenerator<NormalizedMessage, ProviderSessionResult, undefined>;
    /**
     * Parse all messages from a JSONL file into normalized messages.
     * Computes thinking duration from timestamps and attaches tool summaries.
     */
    private _parseAllMessages;
    getSessionHistory(sessionId: string): Promise<NormalizedMessage[]>;
    getMessages(sessionId: string, options?: {
        before?: number;
        limit?: number;
    }): Promise<PaginatedMessages>;
    listSessions(cwd?: string): Promise<SessionListItem[]>;
    getSessionFilePath(sessionId: string): Promise<string | null>;
    normalizeFileLine(line: string, index: number): NormalizedMessage | null;
}
