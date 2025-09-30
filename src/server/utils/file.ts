import { glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function resolveDbPath(fileName?: string): string {
    const dbPath = resolve(__dirname, "../db/data");
    return fileName ? resolve(dbPath, fileName) : dbPath;
}

export function getDbFiles(pattern: string): AsyncIterable<string> {
    return glob(pattern, { cwd: resolveDbPath() });
}