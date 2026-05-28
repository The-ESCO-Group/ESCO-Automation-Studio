/** Base error type for all ESCO Automation Studio domain errors. */
export class EscoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EscoError";
    this.code = code;
  }
}

export class NotFoundError extends EscoError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends EscoError {
  constructor(message: string) {
    super("VALIDATION", message);
    this.name = "ValidationError";
  }
}
