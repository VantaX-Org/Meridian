/**
 * Recorded responses whose counting rule the API has since changed, rewritten to what the API answers now, from
 * figures the recording itself holds. Applied once, where the recording is unpacked (fixtures.ts `harFor`), so every
 * spec and every mock that reads the recording sees the same corrected answer; nothing is shadowed by a route.
 *
 *  - GET /findings/aggregate (api/routes/findings.py). The recording (0.0.449) counted every evaluated rule, passing
 *    ones included, so the system page said "172" failing rules beside its one object's 29, and Home "2,661" beside
 *    the objects list's 1,366. It now counts failing rules only: per object, the run's `dqs_summary` severity counts
 *    (the runs list's numbers). Without `version_id` (the current state) it read every lineage's latest run, so
 *    accounts payable counted twice (the ERP-SIM system run of 2 October and the upload of 16 October): 343,209 rule
 *    failures beside an objects list summing to 343,176. It now reads each object once, from its own latest run, the
 *    objects the recorded current state lists (GET /insights/cleansing?scope=current `objects`).
 *  - GET /insights/cleansing?scope=current (api/services/insights_aggregate.py `distinct_failing_records`). Its first
 *    step counted rule failures and called them failing records; it now counts distinct failing records per object
 *    (`dqs_summary.clean_records.failing_records` where every rule is attributed to the object's records, else the
 *    object's rule failures, an upper bound).
 *
 * `by_dimension[].findings` keeps the recorded counts: the recording holds no per-dimension split of failing rules
 * and no page reads that field.
 */

type Entry = { request: { method: string; url: string }; response: { content: { text?: string; encoding?: string; size?: number } } };
type Har = { log: { entries: Entry[] } };
type ModuleSummary = {
  critical_count?: number; high_count?: number; medium_count?: number; low_count?: number;
  clean_records?: { failing_records?: number | null; unattributed_rules?: string[] } | null;
};
type Aggregate = {
  version_ids: string[]; total: number; affected_records: number; cost_at_risk?: number;
  severity: Record<string, number>;
  by_module: { module: string; findings: number; affected: number; critical: number; high: number; medium: number; low: number; cost_at_risk?: number }[];
};

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

function read(e: Entry): unknown {
  const { text, encoding } = e.response.content;
  if (!text) return undefined;
  return JSON.parse(encoding === "base64" ? Buffer.from(text, "base64").toString("utf8") : text);
}

function write(e: Entry, body: unknown): void {
  const text = JSON.stringify(body);
  e.response.content.text = text;
  delete e.response.content.encoding;
  e.response.content.size = Buffer.byteLength(text);
}

const urlOf = (e: Entry) => new URL(e.request.url);
const isGet = (e: Entry, path: string) => e.request.method === "GET" && urlOf(e).pathname === `/api/v1${path}`;

export function correctRecording(har: Har): void {
  const entries = har.log.entries;
  // Each run's per-object score summary, from the recorded run list.
  const summaries = new Map<string, Record<string, ModuleSummary>>();
  for (const e of entries.filter((x) => isGet(x, "/versions"))) {
    for (const v of (read(e) as { versions?: { id: string; dqs_summary: Record<string, ModuleSummary> | null }[] })?.versions ?? []) {
      if (v.dqs_summary) summaries.set(v.id, v.dqs_summary);
    }
  }
  // Each run's per-object rule failures, from the recorded objects lists.
  const affected = new Map<string, number>();
  for (const e of entries.filter((x) => isGet(x, "/objects"))) {
    const run = urlOf(e).searchParams.get("run");
    const body = read(e) as { run_id?: string; objects?: { module: string; affected_records: number }[] };
    for (const o of body?.objects ?? []) affected.set(`${body.run_id ?? run}|${o.module}`, o.affected_records);
  }
  // The current state the recording lists: each object and the run it is read from.
  const cleansingEntry = entries.find((x) => isGet(x, "/insights/cleansing") && urlOf(x).searchParams.get("scope") === "current");
  const cleansing = cleansingEntry ? read(cleansingEntry) as { objects: { module: string; version_id: string }[]; steps: { key: string; records: number }[]; by_module: { module: string; failing: number }[] } : undefined;
  const current = new Map((cleansing?.objects ?? []).map((o) => [o.module, o.version_id]));

  const aggregates = entries.filter((x) => isGet(x, "/findings/aggregate"));
  // One run's recorded aggregate per module, to take a superseded run's cost back out of the current state's.
  const perRun = new Map<string, Aggregate>();
  for (const e of aggregates) {
    const v = urlOf(e).searchParams.get("version_id");
    if (v && [...urlOf(e).searchParams.keys()].length === 1) perRun.set(v, read(e) as Aggregate);
  }

  for (const e of aggregates) {
    const q = urlOf(e).searchParams;
    if ([...q.keys()].some((k) => k !== "version_id")) continue; // a filtered aggregate: none recorded
    const body = read(e) as Aggregate;
    const version = q.get("version_id");
    const runOf = (module: string) => (version ?? current.get(module));
    const modules = body.by_module.filter((m) => runOf(m.module));
    for (const m of modules) {
      const run = runOf(m.module)!;
      const s = summaries.get(run)?.[m.module];
      if (!s) continue;
      for (const sev of SEVERITIES) m[sev] = s[`${sev}_count`] ?? 0;
      m.findings = SEVERITIES.reduce((a, sev) => a + m[sev], 0);
      m.affected = affected.get(`${run}|${m.module}`) ?? m.affected;
      if (!version) {
        // Take back out what the superseded runs of the module added to its cost.
        const others = body.version_ids.filter((id) => id !== run && summaries.get(id)?.[m.module]);
        const extra = others.reduce((a, id) => a + (perRun.get(id)?.by_module.find((x) => x.module === m.module)?.cost_at_risk ?? 0), 0);
        if (m.cost_at_risk != null) m.cost_at_risk = Math.round((m.cost_at_risk - extra) * 100) / 100;
      }
    }
    body.by_module = modules;
    body.severity = Object.fromEntries(SEVERITIES.map((sev) => [sev, modules.reduce((a, m) => a + m[sev], 0)]));
    body.total = modules.reduce((a, m) => a + m.findings, 0);
    body.affected_records = modules.reduce((a, m) => a + m.affected, 0);
    if (body.cost_at_risk != null) body.cost_at_risk = Math.round(modules.reduce((a, m) => a + (m.cost_at_risk ?? 0), 0) * 100) / 100;
    if (!version) body.version_ids = body.version_ids.filter((id) => modules.some((m) => runOf(m.module) === id));
    write(e, body);
  }

  if (cleansingEntry && cleansing) {
    for (const m of cleansing.by_module) {
      const cr = summaries.get(current.get(m.module) ?? "")?.[m.module]?.clean_records;
      if (cr && typeof cr.failing_records === "number" && !(cr.unattributed_rules ?? []).length) m.failing = cr.failing_records;
    }
    const first = cleansing.steps.find((s) => s.key === "failing");
    if (first) first.records = cleansing.by_module.reduce((a, m) => a + m.failing, 0);
    write(cleansingEntry, cleansing);
  }
}
