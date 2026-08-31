import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
cpSync(`${root}/assets`, `${root}/dist/assets`, { recursive: true });
