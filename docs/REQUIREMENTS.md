# AssetHub product requirements

Status: baseline for the 0.1 rebuild

## 1. What AssetHub is

AssetHub stores structured data for local projects. It is a set of conventions plus a CLI and a web page, not a service:

- Every record is a folder: a `record.json` file plus whatever attachments belong to it.
- Records live under a namespace — a first-level folder in the data root, one per project — in whatever subfolder structure the project wants.
- Every write validates the record's `data` against a JSON Schema before anything touches the disk.
- A read-only web page walks the folders and renders records, images included.

There is no database, no index, and no background process. Reading means scanning folders; writing means creating or replacing one folder, atomically. If the data directory exists, everything else can be rebuilt from it — and because nothing else is stored, nothing else ever needs rebuilding.

## 2. Who it is for

A person running several local projects, collectors, and agents on one machine. A collector writes records through the CLI; the person opens the web page to read them. Projects never accidentally write into each other because every write is bound to a namespace.

## 3. Lasting requirements

### R1: Records are folders

A record MUST be a single directory containing `record.json` (envelope: id, namespace, schema, data, files, timestamps) and its attachments. The id — a ULID — is the record's identity and MUST NOT depend on the folder's location or name.

### R2: The namespace is the write boundary

Each project owns one first-level folder under the data root. Write commands MUST name the namespace and MUST NOT write outside it. Reads are unrestricted and span all namespaces by default. This is accident prevention, not access control.

### R3: Schemas validate data

A record's `data` MUST validate against a JSON Schema resolved in order: the namespace's own schemas, the global schemas, then the built-in presets. A schema MAY declare how the web page renders records of that schema. Writes that fail validation change nothing on disk.

### R4: The web page is the viewer

`assethub web` MUST serve a read-only, loopback page that browses namespaces and folders and renders records with their attachments. It MUST NOT be required for any CLI operation, and it MUST NOT write.

### R5: No hidden state

The data directory MUST fully describe the stored data. Any future cache or derived structure MUST be disposable and rebuildable by walking the tree.

## 4. Non-goals

Collecting content, calling LLMs, publishing; multi-user access, remote access, a public HTTP API; full-text search ranking; attachment deduplication or garbage collection; per-schema custom view templates; a database, index, or resident service.

## 5. Documentation ownership

- `README.md` — entry point, current status, links.
- `docs/REQUIREMENTS.md` — this file: what the product is, its lasting rules.
- `docs/ARCHITECTURE.md` — how the implemented system works; written with 0.1.
- `.kiro/specs/<version>-<name>/` — one iteration's requirements, design, and tasks.
