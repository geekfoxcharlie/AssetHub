import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export const RECORD_FILE = "record.json";

export interface FoundRecord {
  /** Absolute path of the record folder. */
  dir: string;
  /** Path relative to the namespace, "/"-separated. */
  rel: string;
  /** First-level folder the record lives under. */
  namespace: string;
}

export interface NsEntry {
  id: string;
  dir: string;
}

function sortedDirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** First-level folders under the root; the global `schemas/` registry is not a namespace. */
export function listNamespaces(root: string): NsEntry[] {
  if (!existsSync(root)) return [];
  return sortedDirs(root)
    .filter((name) => name !== "schemas")
    .map((id) => ({ id, dir: path.join(root, id) }));
}

export function isRecordDir(dir: string): boolean {
  return existsSync(path.join(dir, RECORD_FILE));
}

function* walkUnder(dir: string, ns: string, rel: string): Generator<FoundRecord> {
  for (const name of sortedDirs(dir)) {
    const child = path.join(dir, name);
    const childRel = rel ? `${rel}/${name}` : name;
    if (isRecordDir(child)) {
      yield { dir: child, rel: childRel, namespace: ns };
    } else {
      yield* walkUnder(child, ns, childRel);
    }
  }
}

/** Walk every namespace under the root, yielding record folders in sorted order. */
export function* walkRecords(root: string): Generator<FoundRecord> {
  for (const ns of listNamespaces(root)) {
    yield* walkUnder(ns.dir, ns.id, "");
  }
}

export function* walkRecordsUnder(nsRoot: string, nsId: string): Generator<FoundRecord> {
  if (!existsSync(nsRoot)) return;
  yield* walkUnder(nsRoot, nsId, "");
}

export function countRecordsUnder(nsRoot: string, nsId: string): number {
  let n = 0;
  for (const _ of walkRecordsUnder(nsRoot, nsId)) n++;
  return n;
}

/** Locate a record folder anywhere under root (or one namespace) by envelope id. */
export function locateById(
  root: string,
  id: string,
  readEnvelope: (dir: string) => { ok: true; id: string } | { ok: false },
  ns?: string,
): FoundRecord | null {
  const iterator = ns ? walkRecordsUnder(path.join(root, ns), ns) : walkRecords(root);
  for (const found of iterator) {
    const parsed = readEnvelope(found.dir);
    if (parsed.ok && parsed.id === id) return found;
  }
  return null;
}
