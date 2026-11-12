/**
 * Connectivity fixture, shaped like api/routes/connectivity.py. Writes only queue a job in the fixture; nothing leaves
 * the browser, and the calls made are kept so a test can prove a button asked nothing before it was confirmed.
 */
import type { ConfigSnapshot, SystemModule } from "../connectivity";

export const NONE_CONNECTIVITY = Symbol("not a connectivity path");

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

// module, row count, config pulled, hours since last sync (null: never), preview sources
const ROWS: [string, number, boolean, number | null, { source: string; reason: string }[]][] = [
  ["material_master", 184_220, true, 20, []],
  ["business_partner", 61_904, true, 26, [{ source: "BUT0ID", reason: "Table name not yet verified against a live system." }]],
  ["fi_gl", 0, false, null, []],
];

/** Writes the fixture has taken, newest last: a test reads it to see that nothing was asked before a confirm. */
export const connectivityCalls: { path: string; body: unknown }[] = [];
export const resetConnectivityFixture = (): void => { connectivityCalls.length = 0; };

const modules = (): SystemModule[] =>
  ROWS.map(([module, row_count, config_synced, h, preview_sources]) => ({
    module,
    system_type: "ecc",
    enabled: true,
    last_synced_at: h === null ? null : ago(h),
    last_sync_status: h === null ? null : "completed",
    row_count,
    config_synced,
    preview_sources,
  }));

const snapshot = (system_id: string, module: string): ConfigSnapshot => ({
  system_id,
  module,
  tables:
    module === "material_master"
      ? [
          { table: "T134", data: [{ MTART: "FERT", MTBEZ: "Finished product" }, { MTART: "ROH", MTBEZ: "Raw material" }], record_count: 2, source: "rfc", synced_at: ago(20) },
          { table: "T023", data: [{ MATKL: "001", WGBEZ: "Metal processing" }], record_count: 1, source: "rfc", synced_at: ago(20) },
        ]
      : [],
});

export function connectivityRead(path: string): unknown {
  const m = /^\/connectivity\/systems\/([^/]+)\/modules$/.exec(path);
  if (m) return modules();
  const c = /^\/connectivity\/config\/([^/]+)\/([^/]+)$/.exec(path);
  if (c) return snapshot(decodeURIComponent(c[1]), decodeURIComponent(c[2]));
  return NONE_CONNECTIVITY;
}

export function connectivityWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST") return NONE_CONNECTIVITY;
  if (path.startsWith("/connectivity/health-check/")) {
    connectivityCalls.push({ path, body });
    return { job_id: "fixture-health", status: "queued" };
  }
  if (path === "/connectivity/config-sync") {
    connectivityCalls.push({ path, body });
    return { job_id: "cfg-fixture", status: "queued" };
  }
  if (path === "/connectivity/extract") {
    connectivityCalls.push({ path, body });
    return { job_id: "dl-fixture", version_id: "fixture", status: "queued", modules: (body as { modules?: string[] })?.modules ?? [] };
  }
  return NONE_CONNECTIVITY;
}
