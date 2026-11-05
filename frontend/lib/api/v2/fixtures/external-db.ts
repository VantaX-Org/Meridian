/**
 * Fixture answers for the external database source (`?fixture=1`): /external-db/connections (GET, POST, DELETE),
 * .../test, .../tables, .../preview and .../load. One sample connection to a made-up inventory database.
 * No password is ever kept or returned.
 */
import type { DbConnection, DbConnections, DbLoaded, DbPreview, DbTable } from "../external-db";

export const NONE_EXTERNAL_DB = Symbol("no-external-db-fixture");

class Refused extends Error {
  response: { status: number; data: { detail: string } };
  constructor(status: number, detail: string) {
    super(detail);
    this.response = { status, data: { detail } };
  }
}

const TABLES: DbTable[] = [
  { schema: "public", name: "parts", kind: "table" },
  { schema: "public", name: "suppliers", kind: "table" },
  { schema: "public", name: "stock_levels", kind: "view" },
];

const COLUMNS = ["part_no", "descr", "uom", "plant_code"];
const ROWS: unknown[][] = [
  ["P-1001", "Hydraulic hose 25 mm", "EA", "1000"],
  ["P-1002", "Bearing 6204", "EA", "1000"],
  ["P-1003", "Grease cartridge 400 g", "PC", "2000"],
];

let seq = 0;
let conns: DbConnection[] | null = null;
const list = (): DbConnection[] =>
  (conns ??= [
    { id: "xdb-1", name: "Inventory replica", engine: "postgres", host: "inventory-db.example.test", port: 5432, database: "inventory", username: "meridian_ro", ssl_mode: "require", created_at: "2026-10-18T09:00:00Z", last_tested_at: "2026-10-19T09:00:00Z", last_test_ok: true, last_loaded_at: null },
  ]);
const one = (id: string): DbConnection => list().find((c) => c.id === id) ?? (() => { throw new Refused(404, "Connection not found"); })();

export function externalDbRead(path: string): unknown {
  if (path === "/external-db/connections") return { connections: structuredClone(list()), engines: ["postgres"], max_rows: 100000, timeout_s: 60 } satisfies DbConnections;
  const t = /^\/external-db\/connections\/([^/]+)\/tables$/.exec(path);
  if (t) return one(decodeURIComponent(t[1])) && { tables: structuredClone(TABLES) };
  return NONE_EXTERNAL_DB;
}

export function externalDbWrite(method: string, path: string, body: unknown): unknown {
  const b = (body ?? {}) as Record<string, unknown>;
  if (method === "POST" && path === "/external-db/connections") {
    const host = String(b.host ?? "");
    if (/^(169\.254\.|127\.|localhost)/.test(host)) throw new Refused(422, "That address is not allowed.");
    if (list().some((c) => c.name === b.name)) throw new Refused(409, "name_taken");
    const c: DbConnection = { id: `xdb-${++seq + 1}`, name: String(b.name), engine: "postgres", host, port: Number(b.port) || 5432, database: String(b.database), username: String(b.username), ssl_mode: b.ssl_mode as DbConnection["ssl_mode"], created_at: "2026-10-20T08:00:00Z", last_tested_at: null, last_test_ok: null, last_loaded_at: null };
    list().push(c);
    return structuredClone(c);
  }
  const m = /^\/external-db\/connections\/([^/]+)(\/test|\/preview|\/load)?$/.exec(path);
  if (!m) return NONE_EXTERNAL_DB;
  const c = one(decodeURIComponent(m[1]));
  if (method === "DELETE" && !m[2]) {
    conns = list().filter((x) => x !== c);
    return undefined;
  }
  if (method !== "POST") return NONE_EXTERNAL_DB;
  if (m[2] === "/test") {
    c.last_tested_at = "2026-10-20T08:00:00Z";
    c.last_test_ok = true;
    return { ok: true, error: null };
  }
  if (m[2] === "/preview") {
    if (typeof b.query === "string" && /;\s*\S/.test(b.query)) throw new Refused(422, "Only one SELECT statement is allowed.");
    return { columns: COLUMNS, rows: ROWS } satisfies DbPreview;
  }
  if (m[2] === "/load") {
    c.last_loaded_at = "2026-10-20T08:00:00Z";
    return { version_id: "fx-xdb-v1", job_id: null, status: "queued", rows: ROWS.length, truncated: false } satisfies DbLoaded;
  }
  return NONE_EXTERNAL_DB;
}
