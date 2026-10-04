"use client";

/**
 * Command Centre findings register: every check failure in the estate.
 * Version, object, severity, dimension and check live in the URL so the
 * overview, trends and the executive report can deep-link a slice. j/k move,
 * Enter opens the drawer: what the check saw, the rule behind it, the SAP
 * features it blocks and every failing record key in that version.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Banner, Button, Chip, DataTable, DetailDrawer, EmptyState, FilterBar, KeyValue, Metric, MetricStrip, Mono,
  PageHeader, Pager, SectionCard, StatusBadge, TableSkeleton, useDrawerParam, type AuroraColumnMeta,
} from "@/components/ui-core";
import { copyToClipboard, saveView } from "@/components/meridian/actions";
import { useRole } from "@/hooks/use-role";
import { getConfigImpact } from "@/lib/api/connectivity";
import { getFindings } from "@/lib/api/findings";
import { getRules } from "@/lib/api/rules";
import { getFindingRecords, getVersion } from "@/lib/api/versions";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { Dimension, Finding, RuleContext } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const PAGE = 200;
const RECORDS_PAGE = 25;
const FILTER_KEYS = ["version_id", "module", "severity", "dimension", "check_id"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filter = Partial<Record<FilterKey, string>>;
const FILTER_LABEL: Record<FilterKey, string> = { version_id: "Run", module: "Object", severity: "Severity", dimension: "Dimension", check_id: "Check" };
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
type Sev = (typeof SEVERITIES)[number];
const DIMENSIONS: Dimension[] = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"];
const sev = (s: string): Sev => ((SEVERITIES as readonly string[]).includes(s) ? (s as Sev) : "medium");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const cellText = (v: unknown): string => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
const title = (f: Finding) => f.business_name ?? f.details?.message ?? f.check_id;
const matches = (f: Finding, q: string) =>
  !q || [f.check_id, f.module, title(f), f.dimension, f.details?.field_checked ?? ""].join(" ").toLowerCase().includes(q.toLowerCase());

/** What the rule is measured against: the three-way comparison, plus best practice. */
const BASIS: Record<RuleContext["rule_authority"], string> = {
  customer_configured: "Live config",
  sap_hard_constraint: "SAP standard",
  s4hana_migration: "S/4 target",
  best_practice: "Best practice",
};

function Basis({ ctx }: { ctx: RuleContext | null }) {
  const label = ctx ? BASIS[ctx.rule_authority] : undefined;
  if (!ctx || !label) return <span className="ui-micro">—</span>;
  return <span className="ui-basis" data-basis={ctx.rule_authority}>{label}</span>;
}

/** check_id → names of SAP features it blocks, per run. */
type BlockMap = Map<string, string[]>;
const blockKey = (versionId: string, checkId: string) => `${versionId}:${checkId}`;

export function FindingsSurface() {
  const { can } = useRole();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const drawer = useDrawerParam("finding");
  const filter = useMemo(() => {
    const f: Filter = {};
    for (const k of FILTER_KEYS) { const v = params.get(k); if (v) f[k] = v; }
    return f;
  }, [params]);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");

  const hrefWith = (patch: Filter) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    next.delete("finding");
    return `${pathname}?${next.toString()}`;
  };
  const set = (patch: Filter) => {
    setOffset(0);
    router.replace(hrefWith(patch), { scroll: false });
  };
  const clearAll = () => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])) as Filter);
  const active = FILTER_KEYS.filter((k) => filter[k]);

  const q = useQuery({
    queryKey: ["findings.list", filter, offset],
    queryFn: () => getFindings({ ...filter, limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  const findings = useMemo(() => q.data?.findings ?? [], [q.data]);
  const total = q.data?.total ?? findings.length;
  const complete = findings.length >= total;
  const visible = findings.filter((f) => matches(f, search));
  const selected = drawer.value ? findings.find((f) => f.id === drawer.value) ?? null : null;

  // Feature impact is stored per run; a page rarely spans more than a few.
  const runIds = useMemo(() => [...new Set(findings.map((f) => f.version_id))].slice(0, 5), [findings]);
  const impacts = useQueries({
    queries: runIds.map((id) => ({
      queryKey: ["config-impact", id], queryFn: () => getConfigImpact(id), retry: false, meta: { ignoreError: true },
    })),
  });
  const impactData = impacts.map((r) => r.data);
  const blocks = useMemo<BlockMap>(() => {
    const m: BlockMap = new Map();
    impactData.forEach((d, i) => {
      for (const r of d?.results ?? []) {
        if (r.status !== "blocked") continue;
        for (const b of r.blocking_findings) {
          const k = blockKey(runIds[i], b.check_id);
          m.set(k, [...(m.get(k) ?? []), r.feature]);
        }
      }
    });
    return m;
    // impactData is a fresh array each render; its members are stable query results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIds, ...impactData]);

  const counts = useMemo(() => {
    const c: Record<Sev, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const mod: Record<string, number> = {};
    for (const f of findings) { c[sev(f.severity)] += 1; mod[f.module] = (mod[f.module] ?? 0) + 1; }
    return { sev: c, modules: Object.entries(mod).sort((a, b) => b[1] - a[1]) };
  }, [findings]);

  const columns = useMemo<ColumnDef<Finding, unknown>[]>(() => [
    { id: "severity", header: "Severity", meta: meta({ sticky: "start", width: 104 }),
      cell: ({ row }) => <StatusBadge status={sev(row.original.severity)} /> },
    { id: "finding", header: "Finding", meta: meta({ minWidth: 280 }), cell: ({ row }) => (
      <span className="ui-cell-stack">
        <span className="ui-cell-stack__main">{title(row.original)}</span>
        <span className="ui-cell-stack__sub">
          <Mono>{row.original.check_id}</Mono>
          {row.original.details?.field_checked ? <Mono>{row.original.details.field_checked}</Mono> : null}
        </span>
      </span>) },
    { id: "basis", header: "Basis", meta: meta({ width: 116 }), cell: ({ row }) => <Basis ctx={row.original.rule_context} /> },
    { id: "module", header: "Object", meta: meta({ width: 160 }), cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "dimension", header: "Dimension", meta: meta({ width: 116 }), cell: ({ row }) => cap(row.original.dimension) },
    { id: "records", header: "Records", meta: meta({ width: 96, align: "end", numeric: true }), cell: ({ row }) => row.original.affected_count.toLocaleString() },
    { id: "pass", header: "Pass rate", meta: meta({ width: 92, align: "end", numeric: true }),
      cell: ({ row }) => (row.original.pass_rate === null ? "—" : `${Math.round(row.original.pass_rate)}%`) },
    { id: "blocks", header: "Blocks", meta: meta({ width: 180 }), cell: ({ row }) => {
      const b = blocks.get(blockKey(row.original.version_id, row.original.check_id));
      return b?.length ? <span title={b.join("\n")}>{b[0]}{b.length > 1 ? ` and ${b.length - 1} more` : ""}</span> : <span className="ui-micro">—</span>;
    } },
    { id: "age", header: "Found", meta: meta({ width: 84, align: "end" }), cell: ({ row }) => relativeTime(row.original.created_at) },
  ], [blocks]);

  const searching = active.length > 0 || search !== "";

  return (
    <div className="ui-page">
      <PageHeader
        title="Findings"
        summary={q.data ? (
          complete
            ? `${total.toLocaleString()} open${active.length ? " in this slice" : ""}. ${counts.sev.critical.toLocaleString()} critical and ${counts.sev.high.toLocaleString()} high across ${counts.modules.length} object${counts.modules.length === 1 ? "" : "s"}.`
            : `${total.toLocaleString()} open${active.length ? " in this slice" : ""}, shown ${PAGE} at a time.`
        ) : undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => saveView("findings", filter)}>Save view</Button>
            {can("manage_rules") ? <Button variant="ghost" onClick={() => router.push("/settings/rules")}>New rule</Button> : null}
          </>
        }
      />

      {filter.version_id && filter.module ? (
        <ObjectScores versionId={filter.version_id} module={filter.module} dimension={filter.dimension} hrefWith={hrefWith} />
      ) : null}

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Search findings" }}
        onClear={active.length ? clearAll : undefined}
      >
        {SEVERITIES.map((s) => (
          <Chip key={s} selected={filter.severity === s} onClick={() => set({ severity: filter.severity === s ? undefined : s })}>
            {cap(s)}{complete ? <span className="aurora-number ui-chip-count">{counts.sev[s]}</span> : null}
          </Chip>
        ))}
        {active.filter((k) => k !== "severity").map((k) => (
          <Chip key={k} tone="info" onDismiss={() => set({ [k]: undefined })}>
            {FILTER_LABEL[k]}: {k === "version_id" || k === "check_id" ? <Mono>{k === "version_id" ? filter[k]?.slice(0, 8) : filter[k]}</Mono>
              : k === "module" ? formatModuleName(filter[k] ?? "") : cap(filter[k] ?? "")}
          </Chip>
        ))}
        {!filter.module ? counts.modules.slice(0, 6).map(([m, n]) => (
          <Chip key={m} onClick={() => set({ module: m })}>
            {formatModuleName(m)}<span className="aurora-number ui-chip-count">{n}</span>
          </Chip>
        )) : null}
      </FilterBar>

      {q.isLoading ? <TableSkeleton rows={10} label="Loading findings" />
        : q.error ? <Banner tone="danger" title="Findings could not be read">{(q.error as Error).message}</Banner>
        : visible.length ? (
          <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
            <DataTable columns={columns} data={visible} getRowId={(f) => f.id} onRowActivate={(f) => drawer.open(f.id)}
              ariaLabel="Findings. Use j and k to move, Enter to open." maxHeight="62vh" />
            <Pager offset={offset} total={total} pageSize={PAGE} noun="findings" onChange={setOffset} />
          </div>
        ) : (
          <EmptyState action={searching
            ? <button type="button" className="ui-link-button" onClick={() => { setSearch(""); clearAll(); }}>Clear filters</button>
            : <Link className="ui-link" href="/data?tab=systems">Connect a system</Link>}>
            {searching ? "No findings match these filters." : "No findings yet. Findings appear here after the first analysis run."}
          </EmptyState>
        )}

      <DetailDrawer open={!!selected} onClose={drawer.close} ariaLabel="Finding details"
        header={selected ? (
          <div className="ui-drawer-head">
            <StatusBadge status={sev(selected.severity)} />
            <h2 className="ui-drawer-head__title">{title(selected)}</h2>
          </div>) : null}>
        {selected ? (
          <FindingDetail finding={selected}
            blocks={blocks.get(blockKey(selected.version_id, selected.check_id)) ?? []} />
        ) : null}
      </DetailDrawer>
    </div>
  );
}

/** One object in one run: DQS and the six dimensions, each a filter link. */
function ObjectScores({ versionId, module, dimension, hrefWith }: {
  versionId: string; module: string; dimension?: string; hrefWith: (p: Filter) => string;
}) {
  const { data: v, error } = useQuery({ queryKey: ["version", versionId], queryFn: () => getVersion(versionId) });
  const s = v?.dqs_summary?.[module];
  return (
    <SectionCard title={formatModuleName(module)}
      meta={v ? `Run of ${new Date(v.run_at).toLocaleString()}${v.label ? `, ${v.label}` : ""}` : undefined}>
      {error ? <EmptyState>This run could not be read.</EmptyState>
        : !v ? <TableSkeleton rows={2} label="Loading scores" />
        : !s ? <EmptyState>This run has no score for {formatModuleName(module)}.</EmptyState>
        : (
          <>
            <MetricStrip label={`${formatModuleName(module)} scores`}>
              <Metric label="DQS" value={s.composite_score.toFixed(1)} tone={s.capped ? "warning" : "default"}
                href={hrefWith({ dimension: undefined })} />
              {DIMENSIONS.map((d) => (
                <Metric key={d} label={dimension === d ? `${cap(d)}, selected` : cap(d)}
                  value={s.dimension_scores?.[d]?.toFixed(1) ?? null}
                  href={hrefWith({ dimension: dimension === d ? undefined : d })} />
              ))}
            </MetricStrip>
            {s.capped && s.cap_reason ? <p className="ui-note" style={{ marginTop: "var(--aurora-space-3)" }}>Capped: {s.cap_reason}</p> : null}
          </>
        )}
    </SectionCard>
  );
}

const Part = ({ title: t, children }: { title: string; children: ReactNode }) => (
  <section className="ui-detail-part"><h3 className="ui-detail-part__title">{t}</h3>{children}</section>
);

function FindingDetail({ finding: f, blocks }: { finding: Finding; blocks: string[] }) {
  const router = useRouter();
  const samples = f.details?.sample_failing_records ?? [];
  const cols = Array.from(new Set(samples.flatMap((r) => Object.keys(r))));
  const invalid = Object.entries(f.details?.distinct_invalid_values ?? {}).sort((a, b) => b[1] - a[1]);
  const ctx = f.rule_context;
  const rows: { k: string; v: ReactNode; mono?: boolean }[] = [
    { k: "Object", v: formatModuleName(f.module) },
    { k: "Check", v: f.check_id, mono: true },
    { k: "Field", v: f.details?.field_checked ?? "—", mono: !!f.details?.field_checked },
    { k: "Dimension", v: cap(f.dimension) },
    { k: "Basis", v: <Basis ctx={ctx} /> },
    { k: "Records", v: `${f.affected_count.toLocaleString()} of ${f.total_count.toLocaleString()}` },
    { k: "Pass rate", v: f.pass_rate === null ? "—" : `${Math.round(f.pass_rate)}%` },
    { k: "Run", v: f.version_id.slice(0, 8), mono: true },
    { k: "Found", v: new Date(f.created_at).toLocaleString() },
  ];
  if (f.business_name) rows.unshift({ k: "Business term", v: f.business_name });
  return (
    <div className="ui-detail">
      <KeyValue rows={rows} />
      {f.business_definition ? <p className="ui-note">{f.business_definition}</p> : null}
      {ctx ? (
        <Part title="Why it matters">
          <p className="ui-note">{ctx.why_it_matters}</p>
          {ctx.sap_impact ? <p className="ui-note"><strong>In SAP:</strong> {ctx.sap_impact}</p> : null}
        </Part>
      ) : null}
      {blocks.length ? (
        <Part title={`Blocks ${blocks.length} SAP feature${blocks.length === 1 ? "" : "s"}`}>
          <ul className="ui-plain-list">{blocks.map((b) => <li key={b}>{b}</li>)}</ul>
        </Part>
      ) : null}
      {f.remediation_text ? <Part title="How to fix"><p className="ui-note">{f.remediation_text}</p></Part> : null}
      {samples.length ? (
        <Part title="Sample failing records">
          <div className="ui-matrix-scroll">
            <table className="ui-mini-table">
              <thead><tr>{cols.map((c) => <th key={c} scope="col"><Mono>{c}</Mono></th>)}</tr></thead>
              <tbody>{samples.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}><Mono>{cellText(r[c])}</Mono></td>)}</tr>)}</tbody>
            </table>
          </div>
        </Part>
      ) : null}
      {invalid.length ? (
        <Part title="Invalid values">
          <div className="ui-filterbar__chips">
            {invalid.slice(0, 20).map(([v, n]) => (
              <Chip key={v}><Mono>{v || "(blank)"}</Mono><span className="aurora-number ui-chip-count">{n.toLocaleString()}</span></Chip>
            ))}
          </div>
          {invalid.length > 20 ? <p className="ui-micro">{invalid.length - 20} more values</p> : null}
        </Part>
      ) : null}
      {f.affected_count > 0 ? <VersionRecords key={`${f.version_id}:${f.check_id}`} versionId={f.version_id} checkId={f.check_id} /> : null}
      <RuleSource checkId={f.check_id} module={f.module} />
      <div className="ui-page-header__actions">
        {f.affected_count > 0 ? (
          <Button onClick={() => router.push(`/issues?${new URLSearchParams({ check_id: f.check_id, status: "open", version_id: f.version_id, module: f.module })}`)}>
            Work failing records
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => copyToClipboard(f.check_id, "Check ID copied")}>Copy check ID</Button>
      </div>
    </div>
  );
}

/** The rule behind the check: its source file and the conditions it evaluates. */
function RuleSource({ checkId, module }: { checkId: string; module: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["rules.for-check", module, checkId],
    queryFn: () => getRules({ module, search: checkId, limit: 10 }),
    retry: false, meta: { ignoreError: true },
  });
  const rule = data?.rules.find((r) => r.name.split(":")[0] === checkId);
  return (
    <Part title="Rule">
      {isLoading ? <p className="ui-micro">Reading the rule.</p>
        : error || !rule ? <p className="ui-note">The rule for <Mono>{checkId}</Mono> is not in this tenant&rsquo;s rule set.</p>
        : (
          <>
            <KeyValue rows={[
              { k: "Source", v: rule.source === "yaml" ? (rule.source_yaml ? `checks/rules/${rule.source_yaml}` : "Shipped rule") : "Defined in HQ", mono: rule.source === "yaml" && !!rule.source_yaml },
              { k: "Rule severity", v: cap(rule.severity) },
              { k: "Enabled", v: rule.enabled ? "Yes" : "No" },
            ]} />
            {rule.conditions.length ? (
              <pre className="ui-code" aria-label="Rule conditions">{rule.conditions.map((c) =>
                Object.entries(c as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined)
                  .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join("\n")).join("\n---\n")}</pre>
            ) : null}
          </>
        )}
    </Part>
  );
}

/** Every record this check found failing in the finding's run. */
function VersionRecords({ versionId, checkId }: { versionId: string; checkId: string }) {
  const [offset, setOffset] = useState(0);
  const { data, error } = useQuery({
    queryKey: ["finding.records", versionId, checkId, offset],
    queryFn: () => getFindingRecords(versionId, checkId, { limit: RECORDS_PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  return (
    <Part title="Record keys in this run">
      {error ? <p className="ui-note">Record keys could not be read: {(error as Error).message}</p>
        : !data ? <p className="ui-micro">Reading record keys.</p>
        : data.total === 0 ? <p className="ui-note">No record keys were stored for this check in this run.</p>
        : (
          <>
            <ul className="ui-keys">{data.records.map((r) => <li key={r.record_key}><Mono>{r.record_key}</Mono></li>)}</ul>
            <Pager offset={offset} total={data.total} pageSize={RECORDS_PAGE} onChange={setOffset} noun="records" />
          </>
        )}
    </Part>
  );
}
