# AssetHub 0.1 filesystem hub tasks

Spec version: 0.1  
Status: Implemented

Tasks run in order; each section leaves the build and tests green.

## 1. Foundations

- [x] `src/lib/paths.ts`: root resolution (`--data-dir` / env / XDG), namespace dir, `.ns.json` path, `.schemas/` path, schema file names.
- [x] `src/lib/ulid.ts`: `ulid()`, `ulidFromKey(key)`, ULID pattern.
- [x] `src/lib/errors.ts` / `src/lib/types.ts`: AppError codes, `CliEnvelope`, record and attachment types.
- [x] `src/lib/walk.ts`: sorted recursive walker; a folder containing `record.json` is a record; skip dotfiles.

## 2. Schema registries

- [x] `src/lib/schema.ts`: resolve project → global → preset; Ajv compile cache keyed by file content.
- [x] `namespace add|list|show` (`.ns.json` create/read; folder exists = registered).
- [x] `schema add --file [--namespace]` with compile check and `already_exists` per registry; `schema list|show` marks the winning source.

## 3. Record format and writes

- [x] `src/lib/format.ts`: parse/serialize the envelope; write a record atomically (temp sibling dir + rename); ingest attachments (copy, sha256, mime by extension, bytes); `files[]` uniqueness.
- [x] `put <ns> <dir> --data [--data-inline] [--id] [--file]`: path containment check, schema validation, upsert semantics, keep attachments when no `--file`.
- [x] `delete <ns> <id>` and `delete <ns> <id> --file <name>`.

## 4. Reads and integrity

- [x] `get <id>` walk-locate; `query [text] [--namespace] [--schema] [--limit]` with value-only text matching and `created_at DESC, id DESC` ordering.
- [x] `validate [--namespace]`: envelope shape, schema resolution, data validation, attachment existence and hash, unregistered files, namespace/path match.
- [x] `idfor <key>`.

## 5. Web viewer

- [x] Routes `/`, `/n/<ns>...`, `/raw/...`; loopback; GET/HEAD only; traversal guards; dotfiles hidden.
- [x] Folder browser: breadcrumb, subfolders, record entries (title, schema, date).
- [x] Four views (`record` default, `card`, `gallery`, `article`) selected by `x-assethub.view`; images inline by mime; links restricted to http/https/mailto.

## 6. Demo and context

- [x] `src/lib/demo.ts`: douyin-hub scenario (two bloggers; project schemas `douyin_blogger` / `douyin_video`; generated placeholder images; ids from `idfor` so reruns replace).
- [x] `context`: storage-model briefing with namespaces and commands.

## 7. CLI polish and docs

- [x] `--json` envelope everywhere; unknown-option rejection; inline values stay strings; human output per command.
- [x] `docs/REQUIREMENTS.md` stays the lasting baseline; write `docs/ARCHITECTURE.md` from the implemented system.
- [x] README: model, quick start (`demo` + `web`), commands.

## 8. Definition of done

All acceptance items in `requirements.md` pass under `npm test` (57 tests over the format library, hub, CLI, and web viewer); no database file anywhere under the data root; the four web views render the demo scenario.
