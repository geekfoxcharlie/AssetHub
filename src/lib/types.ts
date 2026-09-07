export interface Attachment {
  name: string;
  mime: string;
  bytes: number;
  hash: string;
}

export interface ProvenanceEntry {
  url: string;
  fetched_at: string;
  author?: string;
  published_at?: string;
  source_id?: string;
  notes?: string;
}

export interface RecordEnvelope {
  schemaVersion: 1;
  id: string;
  namespace: string;
  schema: string;
  data: Record<string, unknown>;
  files: Attachment[];
  /** Optional for existing/local records. Each externally collected source has its own access time. */
  provenance?: ProvenanceEntry[];
  created_at: string;
  updated_at: string;
}

export interface CliError {
  code: string;
  message: string;
}

export interface CliEnvelope {
  schemaVersion: number;
  command: string;
  generatedAt: string;
  data?: unknown;
  errors: CliError[];
}

export interface Finding {
  code: string;
  path: string;
  message: string;
}

export interface NamespaceInfo {
  id: string;
  name: string;
  goal: string;
  records: number;
  created_at: string | null;
  path: string;
}
