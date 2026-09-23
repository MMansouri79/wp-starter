export type SqlDialect = "postgres" | "sqlite";

export type SqlParam = string | number | null | Uint8Array;

/**
 * Small driver-neutral surface. All statements are written with `?`
 * placeholders; the PostgreSQL driver rewrites them to `$1..$n`.
 *
 * Portability rules for every statement in this app:
 * - identifiers are TEXT (application-generated ids, never SERIAL)
 * - timestamps are TEXT ISO-8601 strings
 * - booleans are INTEGER 0/1
 */
export interface SqlDatabase {
  readonly dialect: SqlDialect;
  all<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): Promise<T | undefined>;
  run(sql: string, params?: readonly SqlParam[]): Promise<void>;
  /** Multi-statement script execution without parameters. */
  exec(sql: string): Promise<void>;
  transaction<T>(work: (tx: SqlDatabase) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function normalizeParams(params: readonly SqlParam[] | undefined): SqlParam[] {
  return (params ?? []).map((value) => (value === undefined ? null : value));
}

/**
 * Rewrites `?` placeholders into `$1..$n` while leaving string literals,
 * quoted identifiers, and line comments untouched.
 */
export function toPostgresPlaceholders(sql: string): string {
  let output = "";
  let index = 0;
  let position = 0;

  while (index < sql.length) {
    const char = sql[index];

    if (char === "'" || char === '"') {
      const quote = char;
      output += char;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            output += quote + quote;
            index += 2;
            continue;
          }
          output += quote;
          index += 1;
          break;
        }
        output += sql[index];
        index += 1;
      }
      continue;
    }

    if (char === "-" && sql[index + 1] === "-") {
      const end = sql.indexOf("\n", index);
      if (end === -1) {
        output += sql.slice(index);
        break;
      }
      output += sql.slice(index, end + 1);
      index = end + 1;
      continue;
    }

    if (char === "?") {
      position += 1;
      output += `$${position}`;
      index += 1;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}
