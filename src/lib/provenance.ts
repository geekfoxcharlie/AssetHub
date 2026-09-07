import { validateData } from "./schema.js";

const schema = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["url", "fetched_at"],
    properties: {
      url: { type: "string", format: "uri" },
      fetched_at: { type: "string", format: "date-time" },
      author: { type: "string", minLength: 1 },
      published_at: { type: "string", format: "date-time" },
      source_id: { type: "string", pattern: "^[0-7][0-9A-HJKMNP-TV-Z]{25}$" },
      notes: { type: "string" },
    },
  },
};

/** Envelope metadata is checked independently of project-defined content schemas. */
export function provenanceProblems(value: unknown): string[] {
  return validateData(schema, value).map(message => `provenance ${message}`);
}
