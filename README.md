# AssetHub

AssetHub is a local storage system for structured data. Every record is a plain folder on disk, records are grouped by project, data is checked against a schema on write, and a read-only web page lets you browse and read everything you have stored.

There is no database and no background service. The data directory is the whole system: you can back it up, sync it, or copy it, and AssetHub will read it as it is.

## How data is stored

A record is one folder, named by its id, containing a `record.json` and the files that belong to it:

```text
~/.local/share/assethub/           data root (--data-dir or ASSETHUB_DATA_DIR)
└── research/                      namespace: one project's data
    └── reading/                   any folders you want in between
        └── 01J8AAAA9TQZ.../       one record = one folder
            ├── record.json        the record itself
            ├── cover.jpg          its attachments: plain files
            └── notes.txt
```

`record.json` holds the envelope and the content:

```json
{
  "schemaVersion": 1,
  "id": "01J8AAAA9TQZ",
  "namespace": "research",
  "schema": "article",
  "data": {
    "title": "Indexing local files",
    "url": "https://example.com/articles/indexing-local-files",
    "tags": ["local-first"]
  },
  "files": [
    { "name": "cover.jpg", "mime": "image/jpeg", "bytes": 84213, "hash": "3f2a…" }
  ],
  "created_at": "2026-08-31T10:00:00.000Z",
  "updated_at": "2026-08-31T10:00:00.000Z"
}
```

- `data` is the content. It must validate against the schema named in `schema`.
- `files` lists the attachments sitting next to `record.json`.
- Optional `provenance` records original source URLs and access times independently of the content schema. It is visible in `get`, `query`, and the read-only viewer; existing records remain valid.
- The id inside `record.json` is the record's identity, so folders can be moved or renamed without breaking anything.

## Concepts

| Concept | What it is |
| --- | --- |
| Record | One folder: `record.json` plus attachments. Any folder containing `record.json` is a record; all other folders are containers. |
| Namespace | A first-level folder in the data root, one per project. Every write names its namespace and cannot write outside it. Reads cross projects by default. |
| Schema | A JSON Schema defining what `data` may contain. Resolved per project first, then globally, then from the built-ins (`note`, `article`, `webpage`, `post`, `image`, `file`, `source`, `demand`). |
| Viewer | `assethub web`: a read-only browser page that walks the folders and renders records — text, inline images, links, attachments. |

## Quick start

```console
$ npm install && npm run demo     # build, then seed the reference scenario into .demo/
$ npm run web                     # read-only viewer at http://127.0.0.1:4124
```

Browse `douyin-hub / zhangsan / posts` and open a video record: card layout, inline images, outbound link. Rerun `npm run demo` — records are replaced in place, never duplicated.

## Commands

```text
assethub namespace add <id> [--name <n>] [--goal <g>]    register a project namespace
assethub namespace list | namespace show <id>            read the tree
assethub schema add <id> --file <f.json> [--namespace]   register a schema (compiles first)
assethub schema list [--namespace] | schema show <id>    resolved source: project > global > preset
assethub put <ns> <dir> --data @file.json [--data-inline k=v]
           [--schema <id>] [--id <ulid>] [--file <path>]...
           [--provenance @sources.json]                     create or upsert a record
assethub get <id>                                        read one record, wherever it has moved
assethub query [text] [--namespace] [--schema] [--limit] substring search over values and ids
assethub delete <ns> <id> [--file <name>]                remove a record or one attachment
assethub idfor <key>                                     deterministic ULID for a natural key
assethub validate [--namespace]                          integrity report over the tree
assethub web [--port]                                    read-only viewer on loopback
assethub demo                                            seed the douyin-hub scenario
assethub context                                         agent briefing
```

Every command takes `--data-dir <dir>` (else `ASSETHUB_DATA_DIR`, then XDG) and `--json` for the `{schemaVersion, command, generatedAt, data, errors}` envelope. `assethub status` prints the resolved data directory and namespace counts.

## Status

0.1 is implemented and specified in the [0.1 filesystem hub spec](.kiro/specs/0.1-filesystem-hub/requirements.md). The additive collection-support update provides envelope provenance plus `source` and `demand` presets. Run `npm test` for the build and tests.

## Collecting reusable data

Use [collection support](docs/COLLECTION.md) for source dossiers, demand records and provenance. These are general infrastructure capabilities; no namespaces, sources, demands or business workflows are created automatically.

## Documentation

- [Product requirements](docs/REQUIREMENTS.md) — what the product is and is not.
- [Architecture](docs/ARCHITECTURE.md) — how the implemented system works.
- [0.1 spec](.kiro/specs/0.1-filesystem-hub/requirements.md) — requirements, design, and tasks for the current iteration.
