# AssetHub 0.1 filesystem hub design

Spec version: 0.1  
Status: Planned

## 1. Design principles

- Plain files, plain folders. A record is a directory with `record.json` in it; everything else is a container. No database, no cache, no resident process.
- Identity is the ULID inside `record.json`. Folders organize; they do not identify. Records stay findable after moves and renames.
- Writes are bound to a namespace: one first-level folder per project, named explicitly on every write.
- The browser is the viewer; directory names are ULIDs and are not meant for reading in a file manager.

## 2. Storage layout

```text
<root>/                                ($ASSETHUB_DATA_DIR / --data-dir)
├── schemas/                           global schemas, shared by all projects
│   └── <id>.schema.json
└── <ns>/                              namespace: first-level folder
    ├── .ns.json                       { "name": "...", "goal": "...", "created_at": "..." }
    ├── .schemas/                      project schemas (shadow global/preset ids)
    │   └── <id>.schema.json
    └── <any nesting the project wants>/
        └── <ulid>/                    record: one folder per record
            ├── record.json
            ├── cover.jpg              attachments, registered in files[]
            └── 01.png
```

Walking rule: a folder that contains `record.json` is a record and is not descended into; any other folder is a container and is traversed. Dotfile entries (`.ns.json`, `.schemas/`) are skipped.

## 3. record.json envelope

```json
{
  "schemaVersion": 1,
  "id": "01J8AAAA9TQZ8VZEWCSRGQKP2M",
  "namespace": "research",
  "schema": "article",
  "data": {
    "title": "Indexing local files",
    "url": "https://example.com/articles/indexing-local-files",
    "tags": ["local-first"]
  },
  "files": [
    { "name": "cover.jpg", "mime": "image/jpeg", "bytes": 84213, "hash": "3f2a9c…" }
  ],
  "created_at": "2026-08-31T10:00:00.000Z",
  "updated_at": "2026-08-31T10:00:00.000Z"
}
```

- `id` equals the record directory's name.
- `namespace` is fixed at write time; `validate` compares it with the actual path.
- `files[].name` is the file name inside the record folder; names are unique within a record.

## 4. Schema resolution

For a write into namespace `ns` with schema id `s`:

1. `<root>/<ns>/.schemas/s.schema.json` (source: project)
2. else `<root>/schemas/s.schema.json` (source: global)
3. else the preset shipped in `dist/assets/schemas/s.schema.json` (source: preset)
4. else `not_found`

`schema list` merges the three registries and marks the winner. Validation uses Ajv (draft-07, formats), compiled per resolved file and cached by content hash.

`x-assethub.view` selects the web rendering (`record` | `card` | `gallery` | `article`); unknown or missing falls back to `record`. The keyword is ignored by validation.

## 5. Writes

```text
put <ns> <dir> [--id]
  -> resolve <dir> inside <root>/<ns>/            (reject escape: invalid_argument)
  -> resolve schema; validate data                (invalid_data)
  -> existing = walk-locate --id under <ns>       (identity survives moves)
  -> assemble <ulid>.tmp-<pid>/ sibling directory  record.json + copied attachments
  -> rename onto the target record directory      (atomic swap)
```

- Create: fresh ULID, `created_at = updated_at = now`.
- Update: keep `id`, `namespace`, `schema`, `created_at`; refresh `updated_at`; `--file` replaces the attachment list, otherwise the previous `files[]` is kept.
- Attachment ingestion copies the file into the record folder and records `name`, `mime` (by extension), `bytes`, and sha256 `hash`. Attachments are never deduplicated across records.

```text
delete <ns> <id>
  -> locate the record under <ns>                 (not_found otherwise)
  -> remove the whole record directory

delete <ns> <id> --file <name>
  -> locate the record; find the files[] entry    (not_found otherwise)
  -> unlink the file; rewrite record.json         (temp + rename)
```

`idfor <key>`: ULID with the time part pinned to zero and the 80 random bits taken from the first 10 bytes of `sha256(key)`. Deterministic per key, so collectors derive the same id on every run.

## 6. Reads

- `get <id>` and `query` walk the root (or one namespace), recursing with `readdirSync`, names sorted for stable output, record folders detected by `record.json`.
- Search text per record = the id plus the leaf values of `data` (strings, numbers, booleans; arrays and objects flattened). Substring match; `%`, `_`, `\` are literal.
- Ordering: `created_at DESC, id DESC`.

## 7. Web

Routes (GET/HEAD only, loopback only):

| Path | Renders |
| --- | --- |
| `/` | namespace cards: id, name, goal, record count |
| `/n/<ns>/<subpath...>` | folder browser: breadcrumb, subfolders, record entries (title, schema, date) |
| `/n/<ns>/<subpath...>/<ulid>` | record page, rendered by the schema's view |
| `/raw/<ns>/<subpath...>/<ulid>/<file>` | attachment bytes (images inline by mime, others download) |

- Every path segment is validated (namespace pattern, ULID or safe-name pattern) and the resolved path must stay under the root.
- Views — `record`: field table, body text, attachment list; `card`: author/platform/time header, body, image grid, outbound link; `gallery`: image grid first, metadata below; `article`: reading layout. All HTML-escape user data; url fields link only http/https/mailto.
- Zero client-side JavaScript, no external assets.

## 8. Demo scenario

`demo` seeds a `douyin-hub` namespace to exercise the whole design:

```text
douyin-hub/                        .ns.json goal "抖音博主内容采集"
├── .schemas/
│   ├── douyin_blogger.schema.json  x-assethub.view: record
│   └── douyin_video.schema.json    x-assethub.view: card
├── zhangsan/
│   ├── <ulid>/                     douyin_blogger: name, url, followers + avatar.jpg
│   └── posts/
│       ├── <ulid>/                 douyin_video: 文案 + video url + metrics + cover.jpg, 01.png
│       └── <ulid>/                 douyin_video, no images
└── lisi/
    └── posts/<ulid>/               douyin_video with one image
```

Project schemas (not presets) are used on purpose, to demonstrate the project registry. Images are generated placeholder bytes written by the seeder — no network. Record ids come from `idfor`, so rerunning `demo` replaces rather than duplicates. The same fixtures feed `npm test`.

## 9. Failure boundary

- Unknown namespace / record / schema / attachment: `not_found`
- `data` failing its schema: `invalid_data`
- Schema file that does not compile: `invalid_schema`
- Duplicate namespace, or duplicate schema id in the same registry: `already_exists`
- Write path escaping the namespace, malformed ULID, unknown option, missing argument: `invalid_argument`
- validate findings: `invalid_record`, `missing_file`, `hash_mismatch`, `unregistered_file`, `namespace_mismatch`

## 10. Module map

| File | Duty |
| --- | --- |
| `src/lib/paths.ts` | root resolution, namespace paths, record path helpers |
| `src/lib/walk.ts` | sorted tree walker; record detection; skips dotfiles |
| `src/lib/format.ts` | record read/write: envelope parse, atomic rename, attachment ingestion |
| `src/lib/schema.ts` | registry resolution (project → global → preset), Ajv cache |
| `src/lib/hub.ts` | command orchestration: put/get/query/delete/validate/status |
| `src/lib/ulid.ts` | `ulid()`, `ulidFromKey()`, ULID pattern |
| `src/lib/errors.ts`, `src/lib/types.ts` | AppError and codes; envelope and record types |
| `src/lib/context.ts`, `src/lib/demo.ts` | agent briefing; scenario seeder |
| `src/cli.ts` | argument parsing, JSON envelope, human output |
| `src/web/server.ts` | routes, folder browser, the four views |

## 11. Test points

- put creates the record tree; `--id` rerun replaces in place; a moved record is still found by `get` and updated where it now sits.
- Write escapes (`../`, absolute paths) rejected; cross-namespace `delete` rejected.
- `delete --file` removes exactly one attachment and rewrites `record.json`.
- Schema shadowing: project over global over preset; unresolvable id is `not_found`.
- `query` matches values only; deterministic order.
- `validate` detects every Requirement 6 condition, including a record copied into another namespace.
- web: folder browsing, all four views, inline images, traversal 404, no writes on refresh.
- demo is idempotent.

## 12. Explicitly not this iteration

Everything in the requirements' non-goals, plus: pagination for large folders, watch mode, import/export.
