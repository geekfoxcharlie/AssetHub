# Collection support

This is an additive extension to the filesystem model. AssetHub still makes no network requests and has no scheduler. Projects create their own schemas, records and workflows when they use it.

## Provenance for any content schema

`put --provenance @sources.json` attaches a JSON array to the record envelope, beside `data` and `files`. It works with built-in and custom schemas without adding fields to each schema.

```json
[
  {
    "url": "https://example.org/original",
    "fetched_at": "2026-09-07T01:00:00Z",
    "author": "Original author",
    "published_at": "2026-09-01T00:00:00Z",
    "notes": "Explain which evidence was used and what the agent added."
  }
]
```

Only `url` (URI) and `fetched_at` (date-time) are required for each entry. Optional fields are `author`, `published_at`, `source_id` (ULID of a source record), and `notes`. Multiple sources are allowed. Unknown fields, malformed URLs and dates are rejected before writing. Do not invent an unknown publication date or author.

When updating, omitting `--provenance` preserves previous sources; a supplied array replaces them; `[]` explicitly clears them. `created_at` remains the record's creation time, not a substitute for access or publication time. Existing records and local notes may omit provenance and need no migration. New collected material should supply it; AssetHub checks its shape, while the workflow checks whether the sources actually support the content.

`get` returns provenance, `query` searches its values along with content, `validate` reports malformed provenance, and the read-only viewer displays a Sources section. Attachments are not full-text indexed: keep search terms and a useful summary in `data`.

## Source dossiers

Use the built-in `source` schema. Required: `name`, `url`, `access` (how an agent can access it), `status` (`active`, `paused`, `retired`). Optional: `tags`, `notes`, `reviewed_at`, `items_seen`, `items_used`, `retired_at`, `retirement_reason`.

Keep source dossiers in the same project namespace as the records that cite them. A separate shared `sources` space is optional when several consumers truly share one list; it is not created automatically. Consumers reference source ids rather than copying lists. Agents maintain review notes/counts when asked; the storage system does not score, subscribe or retire sources itself.

## Demand records

Use the built-in `demand` schema. Required: `title`, `topic`, `output`, `status` (`active`, `paused`, `completed`, `retired`). Optional: `cadence`, `workflow` (an AssetCollector skill name), `source_ids`, `tags`, `notes`.

`cadence` is descriptive text such as `manual`; it never creates a job. References are ids/names, not enforced foreign keys. Check their existence with `get` or `assetcollector show` in the using workflow. Project-specific metadata belongs in a custom schema registered through the existing `schema add` command.

## Stable identity

Include the namespace and a stable source key in `idfor`, for example `consumer:material:https://example.org/original`. Then use that id with `put --id` for retries. Distinct namespaces must not reuse the same id. URL normalization and deciding whether a new version is a separate record belong to the workflow.

## Validation evidence

`npm test` covers old-record compatibility, custom-schema provenance, create/update/preserve/clear, searches, invalid writes making no changes, manual corruption detection, source/demand validation, CLI roundtrips, and escaped source rendering in all viewer modes.

`validate` remains a report command: inspect `data.findings`, not just its exit code. It reports data integrity, not the truth or quality of collected evidence.
