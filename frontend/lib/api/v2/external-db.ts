/**
 * Client of the external database source (api/routes/external_db.py): a read-only connection to a non-SAP database,
 * a table or one SELECT, and a load that runs through the same path as a file upload.
 *
 *   GET, POST /external-db/connections, DELETE /external-db/connections/{id}
 *   POST /external-db/connections/{id}/test, GET .../tables, POST .../preview, POST .../load
 * The password goes out once, on create. No call returns it.
 */
import { v2Get, v2Send } from "./client";

export type SslMode = "disable" | "require" | "verify-ca" | "verify-full";

export interface DbConnection {
  id: string;
  name: string;
  engine: string;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl_mode: SslMode;
  created_at: string;
  last_tested_at: string | null;
  last_test_ok: number | null; // integer column: 1 passed, 0 failed
  last_loaded_at: string | null;
}

export interface DbConnections {
  connections: DbConnection[];
  engines: string[];
  max_rows: number;
  timeout_s: number;
}

export interface DbTable {
  schema: string;
  name: string;
  kind: string;
}

/** A source is a table or one SELECT. */
export type DbSource = { table: { schema: string; name: string } } | { query: string };

export interface DbPreview {
  columns: string[];
  rows: unknown[][];
}

export interface DbLoaded {
  version_id: string;
  job_id: string | null;
  status: string;
  rows: number;
  truncated: boolean;
}

const base = (id: string) => `/external-db/connections/${encodeURIComponent(id)}`;

export const listDbConnections = (): Promise<DbConnections> => v2Get("/external-db/connections");
export const createDbConnection = (body: { name: string; host: string; port: number; database: string; username: string; password: string; ssl_mode: SslMode }): Promise<DbConnection> =>
  v2Send("POST", "/external-db/connections", body);
export const deleteDbConnection = (id: string): Promise<void> => v2Send("DELETE", base(id));
export const testDbConnection = (id: string): Promise<{ ok: boolean; error: string | null }> => v2Send("POST", `${base(id)}/test`);
export const listDbTables = (id: string): Promise<{ tables: DbTable[] }> => v2Get(`${base(id)}/tables`);
export const previewDb = (id: string, source: DbSource): Promise<DbPreview> => v2Send("POST", `${base(id)}/preview`, source);
export const loadDb = (id: string, body: DbSource & { module: string; column_mapping: Record<string, string>; system_id?: string | null }): Promise<DbLoaded> =>
  v2Send("POST", `${base(id)}/load`, body);
