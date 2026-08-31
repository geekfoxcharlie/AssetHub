import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CliEnvelope } from "../lib/types.js";

export const cliJs = fileURLToPath(new URL("../cli.js", import.meta.url));

export function tmpRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "assethub-test-"));
}

export interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

export function runCli(args: string[]): CliRun {
  const r = spawnSync(process.execPath, [cliJs, ...args], { encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function runCliJson<T = unknown>(args: string[]): { status: number; envelope: CliEnvelope & { data?: T } } {
  const run = runCli([...args, "--json"]);
  let envelope: CliEnvelope & { data?: T };
  try {
    envelope = JSON.parse(run.stdout) as CliEnvelope & { data?: T };
  } catch {
    throw new Error(`--json output is not parseable:\n${run.stdout}\n${run.stderr}`);
  }
  return { status: run.status, envelope };
}

/** Recursively list every file/dir (relative paths) under root; dotfiles included. */
export function snapshotTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = path.relative(root, path.join(dir, entry.name)).split(path.sep).join("/");
      out.push(entry.isDirectory() ? `${rel}/` : rel);
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
  };
  walk(root);
  return out;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
