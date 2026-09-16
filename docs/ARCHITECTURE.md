# AssetHub architecture

Status: describes the implemented 0.1 system ([spec](../.kiro/specs/0.1-filesystem-hub/requirements.md))

Additive collection support: [COLLECTION.md](COLLECTION.md) specifies the optional envelope provenance and the source/demand presets.

## 1. Model

A record is one folder: `record.json` plus its attachments. Identity is the ULID inside `record.json`, so folders can be moved or renamed without breaking `get`. Nothing is indexed: every read walks the tree, every write touches exactly one record folder. There is no database, cache, or resident process anywhere.

## 2. Storage layout

```text
<root>/                          --data-dir > ASSETHUB_DATA_DIR > $XDG_DATA_HOME/assethub > ~/.local/share/assethub
├── schemas/                     global schema registry (not a namespace)
│   └── <id>.schema.json
└── <ns>/                        namespace: one project
    ├── .ns.json                 { name, goal, created_at }
    ├── .schemas/                project schema registry
    │   └── <id>.schema.json
    └── <any nesting>/<ulid>/    record folder
        ├── record.json          envelope (schemaVersion 1)
        └── <attachments>        registered in files[] with mime, bytes, sha256
```

Walking rule: a folder that contains `record.json` is a record and is not descended into; any other folder is a container. Dotfile entries (`.ns.json`, `.schemas/`, temp dirs) are skipped everywhere. `src/lib/walk.ts` implements the sorted walker shared by `get`, `query`, `validate`, upsert location, and the web viewer.

## 3. Module map

| File | Duty |
| --- | --- |
| `src/lib/paths.ts` | root resolution, namespace paths, segment validation, containment checks |
| `src/lib/ulid.ts` | `ulid()`, deterministic `ulidFromKey()` (sha256, zero time part) |
| `src/lib/errors.ts` / `types.ts` | `AppError` codes; envelope, attachment, CLI-envelope types |
| `src/lib/walk.ts` | sorted tree walker; record detection; namespace listing |
| `src/lib/schema.ts` | registry resolution (project → global → preset), Ajv compile cache keyed by content hash |
| `src/lib/format.ts` / `provenance.ts` | envelope parse/serialize/shape check, common provenance validation, atomic record writes, attachment ingestion, titles |
| `src/lib/hub.ts` | command orchestration: namespace/schema/put/get/query/delete/validate/idfor |
| `src/lib/demo.ts` | douyin-hub scenario seeder; local PNG generator (no network) |
| `src/lib/context.ts` | agent briefing |
| `src/cli.ts` | argument parsing, `--json` envelope, human output, command dispatch |
| `src/web/html.ts` | HTML rendering: layout, folder browser, the four views, URL/escaping guards |
| `src/web/server.ts` | loopback HTTP server, routes `/`, `/n/...`, `/raw/...`, traversal guards |

Presets live in `assets/schemas/` and are copied to `dist/assets/schemas/` at build time.

## 4. Schema resolution and validation

For a write into namespace `ns` with schema id `s`, `src/lib/schema.ts` resolves, in order:

1. `<root>/<ns>/.schemas/s.schema.json` — project (may shadow anything)
2. `<root>/schemas/s.schema.json` — global
3. `dist/assets/schemas/s.schema.json` — preset (`note`, `article`, `webpage`, `post`, `image`, `file`, `source`, `demand`)

Validation uses Ajv (draft-07 + ajv-formats), compiled once per schema file and cached by content hash. The `x-assethub.view` keyword (`record | card | gallery | article`) selects the web rendering and is ignored by validation. Presets set `note`/`article`/`webpage` → article, `post` → card, `image` → gallery; a missing or unknown declaration falls back to `record`. `schema add` compiles the schema before registering; a duplicate id in the same registry is `already_exists`.

## 5. Write path (`put`)

```text
put <ns> <dir> [--id <ulid>] --schema <id> --data ... [--file ...]
  1. validate ns id; namespace folder must exist            (not_found)
  2. parse <dir> into safe segments; resolve inside <root>/<ns>/   (invalid_argument on escape)
  3. locate existing record by envelope id across the root
       - found under another namespace                      (not_found)
       - found under this namespace → update in place, wherever it now sits
  4. resolve schema; validate data                          (not_found / invalid_data)
  5. ingest attachments (copy bytes, sha256, mime by extension, unique names)
  6. assemble `.<ulid>.tmp-<pid>/` sibling, then rename onto the target (atomic swap)
```

Create uses a fresh ULID and `created_at = updated_at = now`. Update keeps `id`, `namespace`, `schema`, `created_at`, refreshes `updated_at`; the schema is immutable on update. `--file` replaces the attachment list; omitting it keeps the previous files (bytes are re-read from the old folder into the temp dir).

`--provenance` accepts an array or `@file.json`, validated separately from the content schema before writing. Omission preserves existing provenance, an array replaces it, and `[]` clears it. The field is optional in envelope version 1 for backwards compatibility.

`delete <ns> <id>` removes the whole record folder; `delete <ns> <id> --file <name>` unlinks one registered attachment and rewrites `record.json` via temp file + rename.

`idfor <key>` derives a ULID with the time part pinned to zero and the 80 random bits taken from the first 10 bytes of `sha256(key)` — collectors retry `put --id` without duplicating.

## 6. Read path

`get <id>` and `query [text]` walk namespaces with `readdirSync` in sorted order. Query text is a literal substring matched against the id plus the leaf values of `data` and `provenance` (strings, numbers, booleans; arrays and objects flattened) — never against JSON keys or attachment contents. Ordering is `created_at DESC, id DESC`, then `--limit` (default 100).

## 7. Integrity (`validate`)

Walks every record (or one namespace) and reports findings without writing:

| Finding | Meaning |
| --- | --- |
| `invalid_record` | unparseable `record.json`, bad envelope shape, `id` not matching the folder name, duplicate attachment names |
| `not_found` | schema id unresolvable in any registry |
| `invalid_data` | `data` failing its schema |
| `missing_file` | registered attachment absent on disk |
| `hash_mismatch` | attachment sha256 differs from the registry |
| `unregistered_file` | extra non-dotfile sitting in the record folder |
| `namespace_mismatch` | envelope `namespace` differs from the first-level folder it lives under |

## 8. Web viewer

`assethub web [--port]` binds `127.0.0.1` (default 4124) and serves GET/HEAD only — every other method is 405 and no route performs a write. Routes:

| Path | Renders |
| --- | --- |
| `/` | namespace cards with record counts |
| `/n/<ns>/<subpath...>` | folder browser (breadcrumb, subfolder schema mix, record entries). `?page=` paginates 100 at a time; `?schema=` filters when a folder mixes schemas. Homogeneous short-field folders render as a table. |
| `/n/<ns>/<path>/<folder>` | record page, view chosen by the schema's `x-assethub.view`. `card` without `platform` uses a catalog layout. Long text is pulled out of the field table; object arrays become cards; `.md`/`.txt` attachments are inlined. |
| `/q?q=&namespace=&schema=` | substring search via `Hub.query` (same matching as the CLI, default limit 100) |
| `/r/<ulid>` | 302 to the record's folder URL, so `source_id` values can be links |
| `/raw/<ns>/<path>/<folder>/<file>` | attachment bytes — inline for images, `attachment` otherwise |

Titles come from `title` → `display_name` → `full_name` → `name` → `key` → a body snippet, never the ULID when an identity field exists. List subtitles use excerpt/summary/url/status/tags. Record lists sort by `created_at` descending.

Safety: every path segment is decoded then validated (non-empty, no dotfiles — which also excludes `..`), the resolved path must stay under the root, only files registered in `files[]` are served, all user data is HTML-escaped, URL fields link only `http`/`https`/`mailto`, Markdown is a strict escaped subset (no raw HTML), and responses carry `Content-Security-Policy`, `nosniff`, and `no-store` headers. The pages contain zero client-side JavaScript and no external assets.

## 9. Error codes

`not_found`, `invalid_argument` (bad option, malformed ULID, path escape), `invalid_data`, `invalid_schema`, `already_exists`, `invalid_record`, `io_error`; validate finding codes in §7. Every command emits `{schemaVersion, command, generatedAt, data, errors}` under `--json` and exits 1 on any `AppError`.

## 10. Demo and tests

`assethub demo` seeds a `douyin-hub` namespace: two bloggers' worth of records across two project schemas (`douyin_blogger` → record view, `douyin_video` → card view), with locally generated PNG attachments and `idfor` ids, so reruns replace in place. The same fixtures drive `npm test` (`node --test`), which covers the format library, the hub flows, the CLI envelopes, and the web viewer — including the four views, traversal rejections, and no-write-on-refresh checks.
