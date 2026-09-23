import type { SqlDatabase } from "./driver.js";

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

/**
 * Schema history. Statements are written in the portable subset described in
 * `driver.ts` so the same migration applies to PostgreSQL and SQLite.
 *
 * The database stores identity, ownership, and item metadata. Large payloads
 * (package/snapshot/build archives) stay in the shared file store, and the
 * existing builder-core file registries remain the on-disk source of truth.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "identity_and_access",
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        email_normalized TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT,
        last_login_at TEXT
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email_normalized)",
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        ip_address TEXT NOT NULL
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_unique ON sessions (token_hash)",
      "CREATE INDEX IF NOT EXISTS sessions_user_index ON sessions (user_id)",
      "CREATE INDEX IF NOT EXISTS sessions_expiry_index ON sessions (expires_at)",
      `CREATE TABLE IF NOT EXISTS invites (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        code_hint TEXT NOT NULL,
        email TEXT,
        role TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        used_by TEXT
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS invites_code_unique ON invites (code_hash)",
      "CREATE INDEX IF NOT EXISTS invites_creator_index ON invites (created_by)"
    ]
  },
  {
    version: 2,
    name: "shared_library_items",
    statements: [
      `CREATE TABLE IF NOT EXISTS packages (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        slug TEXT NOT NULL,
        version TEXT NOT NULL,
        variant TEXT NOT NULL,
        name TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        file_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        document_json TEXT NOT NULL,
        uploaded_by TEXT,
        created_at TEXT NOT NULL
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS packages_coordinate_unique ON packages (kind, slug, version, variant)",
      `CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        file_path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        wordpress_version TEXT NOT NULL,
        locale TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        document_json TEXT NOT NULL,
        uploaded_by TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        file_name TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        document_json TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      "CREATE UNIQUE INDEX IF NOT EXISTS profiles_file_unique ON profiles (file_name)"
    ]
  },
  {
    version: 3,
    name: "design_system_and_sample_resources",
    statements: [
      "CREATE TABLE IF NOT EXISTS typography_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, document_json TEXT NOT NULL, sha256 TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS color_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, document_json TEXT NOT NULL, sha256 TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS design_systems (id TEXT PRIMARY KEY, name TEXT NOT NULL, document_json TEXT NOT NULL, sha256 TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS font_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, document_json TEXT NOT NULL, sha256 TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS portable_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, document_json TEXT NOT NULL, sha256 TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS elementor_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, document_json TEXT NOT NULL, sha256 TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS sample_content (id TEXT PRIMARY KEY, resource TEXT NOT NULL, name TEXT NOT NULL, document_json TEXT NOT NULL, sha256 TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS sample_content_resource_index ON sample_content (resource)"
    ]
  },
  {
    version: 4,
    name: "builds",
    statements: [
      `CREATE TABLE IF NOT EXISTS builds (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        percent INTEGER NOT NULL,
        message TEXT NOT NULL,
        profile_id TEXT,
        profile_file TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        artifact_file TEXT,
        artifact_path TEXT,
        sha256 TEXT,
        size_bytes INTEGER NOT NULL,
        manifest_json TEXT,
        error_code TEXT,
        error_message TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      )`,
      "CREATE INDEX IF NOT EXISTS builds_status_index ON builds (status)",
      "CREATE INDEX IF NOT EXISTS builds_creator_index ON builds (created_by)"
    ]
  }
];

export async function migrate(database: SqlDatabase, log: (message: string) => void = () => undefined): Promise<number[]> {
  await database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const applied = await database.all<{ version: number }>("SELECT version FROM schema_migrations");
  const done = new Set(applied.map((row) => Number(row.version)));
  const executed: number[] = [];

  for (const migration of MIGRATIONS) {
    if (done.has(migration.version)) continue;
    await database.transaction(async (tx) => {
      for (const statement of migration.statements) await tx.run(statement);
      await tx.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", [
        migration.version,
        migration.name,
        new Date().toISOString()
      ]);
    });
    executed.push(migration.version);
    log(`Applied migration ${migration.version} (${migration.name})`);
  }

  return executed;
}
