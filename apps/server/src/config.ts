import path from "node:path";
import { fileURLToPath } from "node:url";
import { envFlag, envInteger, envString } from "./env.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** `apps/server` regardless of the working directory, for deterministic defaults. */
export const appRoot = path.resolve(here, "..");
/** Repository root, three levels up from the compiled `apps/server/dist` location. */
export const repoRoot = path.resolve(here, "../../..");

export type DatabaseConfig =
  | { driver: "sqlite"; file: string }
  | { driver: "postgres"; connectionString: string; ssl: boolean };

export interface ServerConfig {
  host: string;
  port: number;
  /** Canonical shared builder-core library; every account reads and writes this one directory. */
  dataDir: string;
  /** Server-specific client assets (login, admin). */
  clientDir: string;
  /** Reused local Builder UI assets. */
  guiPublicDir: string;
  /** MU-plugin shipped inside generated starter distributions. */
  bootstrapFile: string;
  database: DatabaseConfig;
  sessionSecret: string;
  sessionTtlHours: number;
  /** `Secure` cookies plus HSTS; enabled automatically for https base URLs. */
  secureCookies: boolean;
  baseUrl: string;
  trustProxy: boolean;
  maxJsonBytes: number;
  maxUploadBytes: number;
  /** Per-account ceiling on stored bytes across packages, snapshots, and builds. */
  accountQuotaBytes: number;
  /** Free space the shared file store must keep before writes are refused. */
  minimumFreeBytes: number;
  buildWorkers: number;
  buildJobRetentionHours: number;
  /** Closed by default: clients join only through an admin-issued invite code. */
  allowOpenRegistration: boolean;
  /** Optional one-time admin created on first boot when no account exists yet. */
  bootstrapAdmin: { email: string; password: string } | null;
  logLevel: "quiet" | "info" | "debug";
}

export interface ConfigOverrides {
  host?: string;
  port?: number;
  dataDir?: string;
  database?: DatabaseConfig;
  sessionSecret?: string;
  secureCookies?: boolean;
  baseUrl?: string;
  maxJsonBytes?: number;
  maxUploadBytes?: number;
  accountQuotaBytes?: number;
  minimumFreeBytes?: number;
  buildWorkers?: number;
  allowOpenRegistration?: boolean;
  bootstrapAdmin?: { email: string; password: string } | null;
  logLevel?: "quiet" | "info" | "debug";
}

const MEBIBYTE = 1024 * 1024;

function resolveDatabase(dataDir: string): DatabaseConfig {
  const url = envString("WP_STARTER_DATABASE_URL") ?? envString("DATABASE_URL");
  if (url) {
    if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
      return { driver: "postgres", connectionString: url, ssl: envFlag("WP_STARTER_DATABASE_SSL", false) };
    }
    if (url.startsWith("sqlite:")) {
      return { driver: "sqlite", file: path.resolve(url.slice("sqlite:".length)) };
    }
    throw new Error("WP_STARTER_DATABASE_URL must start with postgres://, postgresql://, or sqlite:.");
  }

  const driver = envString("WP_STARTER_DB_DRIVER") ?? "sqlite";
  if (driver === "postgres") {
    const connectionString = envString("WP_STARTER_PG_URL");
    if (!connectionString) {
      throw new Error("WP_STARTER_DB_DRIVER=postgres requires WP_STARTER_PG_URL (or WP_STARTER_DATABASE_URL).");
    }
    return { driver: "postgres", connectionString, ssl: envFlag("WP_STARTER_DATABASE_SSL", false) };
  }
  if (driver !== "sqlite") throw new Error(`Unsupported WP_STARTER_DB_DRIVER: ${driver}`);

  return { driver: "sqlite", file: envString("WP_STARTER_SQLITE_FILE") ?? path.join(dataDir, "server.sqlite") };
}

function resolveBootstrapAdmin(): { email: string; password: string } | null {
  const email = envString("WP_STARTER_ADMIN_EMAIL");
  const password = envString("WP_STARTER_ADMIN_PASSWORD");
  if (!email && !password) return null;
  if (!email || !password) {
    throw new Error("WP_STARTER_ADMIN_EMAIL and WP_STARTER_ADMIN_PASSWORD must be set together.");
  }
  return { email: email.toLowerCase(), password };
}

export function loadConfig(overrides: ConfigOverrides = {}): ServerConfig {
  const dataDir = path.resolve(overrides.dataDir ?? envString("WP_STARTER_DATA_DIR") ?? path.join(appRoot, "data"));
  const database = overrides.database ?? resolveDatabase(dataDir);
  const baseUrl = overrides.baseUrl ?? envString("WP_STARTER_BASE_URL") ?? `http://127.0.0.1:${overrides.port ?? envInteger("WP_STARTER_SERVER_PORT", 47900)}`;
  const secureCookies = overrides.secureCookies ?? envFlag("WP_STARTER_SECURE_COOKIES", baseUrl.startsWith("https://"));

  const sessionSecret = overrides.sessionSecret ?? envString("WP_STARTER_SESSION_SECRET") ?? "";
  if (sessionSecret.length < 32) {
    throw new Error(
      "WP_STARTER_SESSION_SECRET must be set to at least 32 characters. Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
    );
  }

  return {
    host: overrides.host ?? envString("WP_STARTER_SERVER_HOST") ?? "127.0.0.1",
    port: overrides.port ?? envInteger("WP_STARTER_SERVER_PORT", 47900),
    dataDir,
    clientDir: path.join(appRoot, "client"),
    guiPublicDir: path.join(repoRoot, "apps/gui/public"),
    bootstrapFile: path.join(repoRoot, "wordpress/bootstrap/site-starter-bootstrap.php"),
    database,
    sessionSecret,
    sessionTtlHours: envInteger("WP_STARTER_SESSION_TTL_HOURS", 24 * 14),
    secureCookies,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    trustProxy: envFlag("WP_STARTER_TRUST_PROXY", false),
    maxJsonBytes: overrides.maxJsonBytes ?? envInteger("WP_STARTER_MAX_JSON_BYTES", 8 * MEBIBYTE),
    maxUploadBytes: overrides.maxUploadBytes ?? envInteger("WP_STARTER_MAX_UPLOAD_BYTES", 1024 * MEBIBYTE),
    accountQuotaBytes: overrides.accountQuotaBytes ?? envInteger("WP_STARTER_ACCOUNT_QUOTA_BYTES", 20 * 1024 * MEBIBYTE),
    minimumFreeBytes: overrides.minimumFreeBytes ?? envInteger("WP_STARTER_MIN_FREE_BYTES", 2 * 1024 * MEBIBYTE),
    buildWorkers: overrides.buildWorkers ?? Math.min(Math.max(envInteger("WP_STARTER_BUILD_WORKERS", 2), 1), 2),
    buildJobRetentionHours: envInteger("WP_STARTER_BUILD_RETENTION_HOURS", 24 * 30),
    allowOpenRegistration: overrides.allowOpenRegistration ?? envFlag("WP_STARTER_ALLOW_OPEN_REGISTRATION", false),
    bootstrapAdmin: overrides.bootstrapAdmin !== undefined ? overrides.bootstrapAdmin : resolveBootstrapAdmin(),
    logLevel: overrides.logLevel ?? (envString("WP_STARTER_LOG_LEVEL") as ServerConfig["logLevel"] | undefined) ?? "info"
  };
}
