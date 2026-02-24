import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function readVersion(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(dir, "..", "package.json");
  try {
    return JSON.parse(readFileSync(pkgPath, "utf-8")).version;
  } catch {
    return "0.0.0";
  }
}

export const SERVER_VERSION = readVersion();
