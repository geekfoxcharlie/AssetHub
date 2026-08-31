export type ErrorCode =
  | "not_found"
  | "invalid_argument"
  | "invalid_data"
  | "invalid_schema"
  | "already_exists"
  | "invalid_record"
  | "io_error";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export function err(code: ErrorCode, message: string, details?: unknown): AppError {
  return new AppError(code, message, details);
}
