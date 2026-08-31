# AssetHub 0.1 filesystem hub requirements

Spec version: 0.1  
Status: Implemented

## 1. Purpose

Build AssetHub's first version around one storage rule: a record is a folder on disk. `record.json` holds the envelope and the content; attachments sit next to it as plain files. Projects keep records under their own namespace folder, in any nesting they choose, and every write is validated against a JSON Schema before it touches the disk. A CLI performs all writes; a read-only web page walks the folders and renders records for reading.

There is no database or index anywhere in this design. This is a fresh start; the previous SQLite-catalog design is retired and nothing is migrated.

## 2. Iteration goals

### Requirement 1: Data root and namespaces

- One user-level data root, resolved from `--data-dir`, then `ASSETHUB_DATA_DIR`, then `$XDG_DATA_HOME/assethub`, then `~/.local/share/assethub`.
- A namespace is a first-level folder under the root and is the unit of project ownership. `namespace add <id>` creates the folder and writes `.ns.json` (display name, goal). A namespace that exists as a folder is registered.
- `namespace list` and `namespace show <id>` read from the tree.
- Every write command MUST name the namespace, and every write target MUST resolve inside `<root>/<ns>/`; otherwise the command fails with `invalid_argument`.

### Requirement 2: Schemas (formats)

- A record's `data` is constrained by a JSON Schema (draft-07) file.
- Schemas come from three registries, resolved in order **project → global → preset**; a project schema may shadow a global or preset id:
  - preset: six schemas shipped with the program — `note`, `article`, `webpage`, `post`, `image`, `file` (fields defined in `assets/schemas/`)
  - global: `<root>/schemas/<id>.schema.json`, shared by all projects
  - project: `<root>/<ns>/.schemas/<id>.schema.json`, private to that namespace
- `schema add <id> --file <f.json> [--namespace <ns>]` registers a schema after verifying it compiles; a duplicate id in the same registry is `already_exists`.
- `schema list` / `schema show <id>` show the resolved schema and which registry provided it.
- A schema MAY declare `"x-assethub": { "view": "record | card | gallery | article" }` to choose how the web page renders its records. A missing or unknown declaration falls back to `record`.

### Requirement 3: Records

- A record is a directory named by its ULID, containing `record.json` and the record's attachments.
- `record.json` envelope, schemaVersion 1: `id` (ULID, equals the directory name), `namespace`, `schema`, `data`, `files`, `created_at`, `updated_at`.
- Attachments MUST be registered in `files[]` with `name`, `mime`, `bytes`, and `hash` (sha256). `validate` flags registered files missing from disk, hash mismatches, and unregistered extra files.
- The envelope `namespace` MUST match the namespace folder the record actually lives under; a mismatch is a validate finding (`namespace_mismatch`).
- Writes are atomic per record: assemble a sibling temp directory, then rename it into place.
- A folder containing `record.json` is a record; every other folder is a container. Dotfile entries (`.ns.json`, `.schemas/`) are skipped everywhere.

### Requirement 4: Record CLI

- `put <ns> <dir> --data @file.json [--data-inline k=v ...] [--id <ulid>] [--file <path> ...]`
  - `<dir>` is relative to the namespace root, created when missing, and must resolve inside the namespace.
  - Without `--id`: create a new record with a fresh ULID. With `--id`: upsert — replace `data` and `files` of that record wherever it sits under the namespace, keeping `id`, `namespace`, `schema`, and `created_at`. A `--id` that does not exist under the namespace creates it; a `--id` belonging to another namespace is `not_found`.
  - `data` is validated against the resolved schema before anything is written (`invalid_data`).
  - On update, `--file` replaces the attachment list; no `--file` keeps the previous attachments.
- `get <id>` walks the root and returns the record, wherever it has moved.
- `query [text] [--namespace <ns>] [--schema <id>] [--limit <n>]` walks the tree; text matches field values and the id, never JSON keys; ordering is `created_at DESC, id DESC`.
- `delete <ns> <id>` removes the whole record directory, attachments included.
- `delete <ns> <id> --file <name>` removes one registered attachment and rewrites `record.json`; an unregistered name is `not_found`.
- `idfor <key>` prints a deterministic ULID derived from an arbitrary natural key (a url, an id), so collectors can retry `put --id` without duplicating.
- Every command supports `--json` with the envelope `{schemaVersion, command, generatedAt, data, errors}` and stable error codes. Unknown options are `invalid_argument`. `--data-inline` values stay strings.

### Requirement 5: Web viewer

- `assethub web [--port]` serves a read-only viewer on loopback (default 4124). No page ever writes.
- `/` lists namespaces with record counts. `/n/<ns>` and deeper paths are folder browsers: breadcrumb, subfolder list, and record entries (title, schema, date). Dotfile metadata is not listed; path traversal is rejected.
- A record page renders according to the schema's view:
  - `record` (default): title, field table, body text, attachment list — images inline
  - `card`: social-post layout — author/platform/time, body, image grid, outbound link
  - `gallery`: image-first grid with metadata below
  - `article`: long-form reading layout
- Images render inline by mime type; other attachments download. URL fields link only `http`/`https`/`mailto`.

### Requirement 6: Integrity

- `validate [--namespace]` walks records and reports: unparseable `record.json`, bad envelope shape, unresolvable schema, `data` failing validation, missing or hash-mismatched attachments, unregistered extra files, and envelope-namespace/path mismatch.
- Nothing is indexed, so nothing can drift and nothing needs rebuilding.

### Requirement 7: Demo and agent context

- `demo [--data-dir]` seeds a reference scenario into a `douyin-hub` namespace: two bloggers, each with a profile record and several video records carrying image attachments. The scenario uses two project schemas (`douyin_blogger`, `douyin_video`) to demonstrate the project registry and the `card` view.
- `context` prints a short agent briefing: the storage model, current namespaces, and the command surface.

## 3. Non-goals

- No SQLite, index, cache, or catalog of any kind; no `reindex`
- No collection, LLM calls, task orchestration, or publishing
- No attachment deduplication or garbage collection
- No full-text search engine or ranking
- No custom view templates (four built-in views only), no theming
- No multi-user, remote access, or public HTTP API
- No migration from the retired SQLite-catalog format

## 4. Acceptance

1. The demo scenario stores as designed; in the web viewer, browsing `douyin-hub / zhangsan / posts` and opening a video record shows its text, inline images, and outbound link.
2. `put --id` rerun replaces the record in place; a collector retry never duplicates.
3. A write targeting a path outside `<root>/<ns>/` is rejected; `delete` without the owning namespace is rejected.
4. `delete <ns> <id> --file <name>` removes exactly that attachment; `delete <ns> <id>` removes the record.
5. `validate` flags each condition in Requirement 6, including a record moved into another namespace.
6. `query "zhangsan"` hits only that blogger's records; a JSON key name matches nothing.
7. No database file exists anywhere under the data root.
8. `npm test` covers the record format library, the CLI, and the web viewer.
