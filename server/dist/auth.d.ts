import type { IncomingMessage, ServerResponse } from "node:http";
export declare function requirePassword(): void;
export declare function authenticateRequest(req: IncomingMessage): boolean;
export declare function authenticateToken(token: string): boolean;
export declare function sendUnauthorized(res: ServerResponse): void;
