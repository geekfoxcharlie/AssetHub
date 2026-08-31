import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
rmSync(`${root}/dist`, { recursive: true, force: true });
