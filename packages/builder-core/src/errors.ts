export class BuilderError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BuilderError";
    this.code = code;
  }
}
