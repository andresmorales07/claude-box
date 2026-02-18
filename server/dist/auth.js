import { timingSafeEqual } from "node:crypto";
const API_PASSWORD = process.env.API_PASSWORD;
export function requirePassword() {
    if (!API_PASSWORD) {
        console.error("FATAL: API_PASSWORD environment variable is required");
        process.exit(1);
    }
}
function safeCompare(a, b) {
    if (a.length !== b.length)
        return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function authenticateRequest(req) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer "))
        return false;
    return safeCompare(auth.slice(7), API_PASSWORD);
}
export function authenticateToken(token) {
    return safeCompare(token, API_PASSWORD);
}
export function sendUnauthorized(res) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
}
