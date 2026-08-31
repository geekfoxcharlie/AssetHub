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
- The id inside `record.json` is the record's identity, so folders can be moved or renamed without breaking anything.

## Concepts

| Concept | What it is |
| --- | --- |
| Record | One folder: `record.json` plus attachments. Any folder containing `record.json` is a record; all other folders are containers. |
| Namespace | A first-level folder in the data root, one per project. Every write names its namespace and cannot write outside it. Reads cross projects by default. |
| Schema | A JSON Schema defining what `data` may contain. Resolved per project first, then globally, then from the built-ins (`note`, `article`, `webpage`, `post`, `image`, `file`). |
| Viewer | `assethub web`: a read-only browser page that walks the folders and renders records — text, inline images, links, attachments. |

## Status

Design phase; implementation is specified in the [0.1 filesystem hub spec](.kiro/specs/0.1-filesystem-hub/requirements.md).

## Documentation

- [Product requirements](docs/REQUIREMENTS.md) — what the product is and is not.
- [0.1 spec](.kiro/specs/0.1-filesystem-hub/requirements.md) — requirements, design, and tasks for the current iteration.
