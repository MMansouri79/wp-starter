/**
 * Error carrying the HTTP status the API layer should return. Anything that is
 * not an `HttpError` is reported as `500 internal_error` without leaking
 * internals to the client.
 */
export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(code: string, message: string, details?: unknown): HttpError {
  return new HttpError(400, code, message, details);
}

export function unauthorized(message = "Sign in to continue."): HttpError {
  return new HttpError(401, "unauthorized", message);
}

export function forbidden(code: string, message: string): HttpError {
  return new HttpError(403, code, message);
}

export function notFound(code: string, message: string): HttpError {
  return new HttpError(404, code, message);
}

export function conflict(code: string, message: string): HttpError {
  return new HttpError(409, code, message);
}
