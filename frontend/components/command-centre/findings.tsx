"use client";

/**
 * Command Centre → Findings: every check failure in the estate. Version,
 * object, severity, dimension and check live in the URL so trends, versions
 * and the executive report can deep-link a slice. A drawer shows what the
 * check saw and every record it found in that version.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Banner, Button, Chip, DataTable, Drawer, EmptyState, Input, KpiRail, Pager, Panel, Stack, Stat, Text, useDrawerParam, type AuroraColumnMeta,
} from "@/components/aurora";
import { copyToClipboard, saveView } from "@/components/meridian/actions";
import { useRole } from "@/hooks/use-role";
import { getFindings } from "@/lib/api/findings";
import { getFindingRecords, getVersion } from "@/lib/api/versions";
import { checkClassLabel, formatModuleName } from "@/lib/format";
import type { Dimension, Finding } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const PAGE = 200;
const RECORDS_PAGE = 25;
const FILTER_KEYS = ["version_id", "module", "severity", "dimension", "check_id"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filter = Partial<Record<FilterKey, string>>;
const FILTER_LABEL: Record<FilterKey, string> = { version_id: "version", module: "object", severity: "severity", dimension: "dimension", check_id: "check" };
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
type Sev = (typeof SEVERITIES)[number];
const DIMENSIONS: Dimension[] = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"];
const sev = (s: string): Sev => ((SEVERITIES as readonly string[]).includes(s) ? (s as Sev) : "medium");
const cellText = (v: unknown): string => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
const title = (f: Finding) => f.details?.message ?? f.check_id;
const matches = (f: Finding, q: string) =>
  !q || [f.check_id, f.module, title(f), f.dimension, f.details?.field_checked ?? ""].join(" ").toLowerCase().includes(q.toLowerCase());

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

  const set = (patch: Filter) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries({ ...filter, ...patch })) { if (v) next.set(k, v); else next.delete(k); }
    next.delete("finding");
    setOffset(0);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
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
  const visible = findings.filter((f) => matches(f, search));
  const selected = drawer.value ? findings.find((f) => f.id === drawer.value) ?? null : null;
  const counts = useMemo(() => {
    const c: Record<Sev, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const mod: Record<string, number> = {};
    for (const f of findings) { c[sev(f.severity)] += 1; mod[f.module] = (mod[f.module] ?? 0) + 1; }
    return { sev: c, modules: Object.entries(mod).sort((a, b) => b[1] - a[1]) };
  }, [findings]);
  const affected = findings.reduce((a, f) => a + f.affected_count, 0);
  const rated = findings.filter((f) => f.pass_rate !== null);
  const meanPass = rated.length ? Math.round(rated.reduce((a, f) => a + (f.pass_rate ?? 0), 0) / rated.length) : null;

  const columns = useMemo<ColumnDef<Finding, unknown>[]>(() => [
    { id: "severity", header: "Severity", meta: meta({ sticky: "start", width: 100 }),
      cell: ({ row }) => <span className="aurora-workbench__severity" data-severity={sev(row.original.severity)}>{sev(row.original.severity)}</span> },
    { id: "finding", header: "Finding", cell: ({ row }) => (
      <span><strong>{title(row.original)}</strong>
        <Text variant="text-micro" tone="muted" as="div" className="aurora-number">{row.original.check_id}{row.original.details?.field_checked ? ` · ${row.original.details.field_checked}` : ""}
          {row.original.check_class ? <> · <span title={row.original.check_class}>{checkClassLabel(row.original.check_class)}</span></> : null}</Text></span>) },
    { id: "module", header: "Object", meta: meta({ width: 170 }), cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "dimension", header: "Dimension", meta: meta({ width: 120 }), cell: ({ row }) => row.original.dimension },
    { id: "records", header: "Records", meta: meta({ width: 100, align: "end", numeric: true }), cell: ({ row }) => row.original.affected_count.toLocaleString() },
    { id: "pass", header: "Pass rate", meta: meta({ width: 100, align: "end", numeric: true }),
      cell: ({ row }) => (row.original.pass_rate === null ? "—" : `${Math.round(row.original.pass_rate)}%`) },
  ], []);

  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Open" value={total} />
        <Stat label="Critical" value={counts.sev.critical} tone={counts.sev.critical ? "danger" : "neutral"} />
        <Stat label="High" value={counts.sev.high} tone={counts.sev.high ? "warning" : "neutral"} />
        <Stat label="Records affected" value={affected.toLocaleString()} />
        <Stat label="Objects" value={counts.modules.length} />
        <Stat label="Mean pass rate" value={meanPass ?? "—"} unit={meanPass === null ? undefined : "%"} />
      </KpiRail>

      {filter.version_id && filter.module ? (
        <ObjectScores versionId={filter.version_id} module={filter.module} dimension={filter.dimension} onDimension={(d) => set({ dimension: d })} />
      ) : null}

      <SeverityBar counts={counts.sev} total={findings.length} active={filter.severity} onPick={(s) => set({ severity: filter.severity === s ? undefined : s })} />

      <Stack direction="row" gap={2} wrap align="center">
        {!filter.module ? counts.modules.slice(0, 10).map(([m, n]) => (
          <Chip key={m} onClick={() => set({ module: m })}>{formatModuleName(m)} · {n}</Chip>
        )) : null}
        {active.map((k) => (
          <Chip key={k} tone="info" onDismiss={() => set({ [k]: undefined })}>
            {FILTER_LABEL[k]} · {k === "version_id" ? filter[k]?.slice(0, 8) : k === "module" ? formatModuleName(filter[k] ?? "") : filter[k]}
          </Chip>
        ))}
        {active.length ? <Button variant="ghost" size="sm" onClick={clearAll}>Clear all</Button> : null}
        <span style={{ flex: 1 }} />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter findings…" aria-label="Filter findings" style={{ width: 220 }} />
        <Button variant="ghost" size="sm" onClick={() => saveView("findings", filter)}>Save view</Button>
        {can("manage_rules") ? <Link href="/settings/rules" className="aurora-link">New rule →</Link> : null}
      </Stack>

      {q.isLoading ? <Text tone="muted">Reading findings.</Text>
        : q.error ? <Banner tone="danger" title="Findings could not be read">{(q.error as Error).message}</Banner>
        : visible.length ? (
          <Stack gap={3}>
            <DataTable columns={columns} data={visible} getRowId={(f) => f.id} onRowActivate={(f) => drawer.open(f.id)} ariaLabel="Findings" maxHeight="56vh" />
            <Pager offset={offset} total={total} pageSize={PAGE} noun="findings" onChange={setOffset} />
          </Stack>
        ) : (
          <EmptyState title={active.length || search ? "No findings match these filters." : "No findings yet."}
            body={active.length || search ? "Loosen a filter or clear the search." : "Run an analysis from Data → Import or Data → Systems; its findings land here."} />
        )}

      <Drawer open={!!selected} onClose={drawer.close} ariaLabel="Finding details"
        header={selected ? (
          <Stack direction="row" gap={2} align="center">
            <span className="aurora-workbench__severity" data-severity={sev(selected.severity)}>{sev(selected.severity)}</span>
            <Text variant="text-lead">{title(selected)}</Text>
          </Stack>) : null}>
        {selected ? <FindingDetail finding={selected} /> : null}
      </Drawer>
    </Stack>
  );
}

function SeverityBar({ counts, total, active, onPick }: { counts: Record<Sev, number>; total: number; active?: string; onPick: (s: Sev) => void }) {
  if (!total) return null;
  return (
    <div className="aurora-sevbar" role="group" aria-label="Findings by severity">
      <div className="aurora-sevbar__track">
        {SEVERITIES.map((s) => <span key={s} className="aurora-sevbar__seg" data-severity={s} style={{ width: `${(counts[s] / total) * 100}%` }} title={`${s}: ${counts[s]}`} />)}
      </div>
      <Stack direction="row" gap={2} wrap>
        {SEVERITIES.map((s) => (
          <Chip key={s} selected={active === s} onClick={() => onPick(s)}><span className="aurora-sevbar__dot" data-severity={s} />{s} · {counts[s]}</Chip>
        ))}
      </Stack>
    </div>
  );
}

/** One object in one version: its DQS and the six dimensions, each a filter. */
function ObjectScores({ versionId, module, dimension, onDimension }: { versionId: string; module: string; dimension?: string; onDimension: (d: string | undefined) => void }) {
  const { data: v, error } = useQuery({ queryKey: ["version", versionId], queryFn: () => getVersion(versionId) });
  const s = v?.dqs_summary?.[module];
  return (
    <Panel title={`${formatModuleName(module)} · ${v ? new Date(v.run_at).toLocaleString() : versionId.slice(0, 8)}`}
      action={v?.label ? <Text variant="text-small" tone="secondary">{v.label}</Text> : undefined}>
      {error ? <Text tone="muted">This version could not be read.</Text>
        : !v ? <Text tone="muted">Reading this version&rsquo;s scores…</Text>
        : !s ? <Text tone="muted">This version has no score for {formatModuleName(module)}.</Text>
        : (
          <Stack gap={3}>
            <KpiRail>
              <Stat label="DQS" value={s.composite_score.toFixed(1)} tone={s.capped ? "warning" : "neutral"} />
              {DIMENSIONS.map((d) => (
                <button key={d} type="button" className="text-left" aria-pressed={dimension === d} title={`Show only ${d} findings`}
                  onClick={() => onDimension(dimension === d ? undefined : d)}>
                  <Stat label={d} value={s.dimension_scores?.[d]?.toFixed(1) ?? "—"} tone={dimension === d ? "info" : "neutral"} />
                </button>
              ))}
            </KpiRail>
            {s.capped && s.cap_reason ? <Text variant="text-small" tone="secondary">Capped: {s.cap_reason}</Text> : null}
          </Stack>
        )}
    </Panel>
  );
}

const Section = ({ title: t, children }: { title: string; children: ReactNode }) => (
  <Stack gap={2}><Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">{t}</Text>{children}</Stack>
);

function FindingDetail({ finding: f }: { finding: Finding }) {
  const router = useRouter();
  const samples = f.details?.sample_failing_records ?? [];
  const cols = Array.from(new Set(samples.flatMap((r) => Object.keys(r))));
  const invalid = Object.entries(f.details?.distinct_invalid_values ?? {}).sort((a, b) => b[1] - a[1]);
  const rows: [string, ReactNode][] = [
    ["Object", formatModuleName(f.module)], ["Check", f.check_id],
    ["Check type", f.check_class ? <span title={f.check_class}>{checkClassLabel(f.check_class)}</span> : "—"], ["Dimension", f.dimension], ["Field", f.details?.field_checked ?? "—"],
    ["Records", `${f.affected_count.toLocaleString()} of ${f.total_count.toLocaleString()}`],
    ["Pass rate", f.pass_rate === null ? "—" : `${Math.round(f.pass_rate)}%`], ["Version", f.version_id.slice(0, 8)],
  ];
  if (f.business_name) rows.unshift(["Business term", f.business_name]);
  return (
    <Stack gap={4}>
      <table className="aurora-exec__table"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="aurora-number">{v}</td></tr>)}</tbody></table>
      {f.business_definition ? <Text variant="text-small" tone="secondary">{f.business_definition}</Text> : null}
      {f.remediation_text ? <Section title="Remediation"><Text variant="text-small" tone="secondary">{f.remediation_text}</Text></Section> : null}
      {samples.length ? (
        <Section title="Sample failing records">
          <div style={{ overflowX: "auto" }}>
            <table className="aurora-exec__table">
              <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>{samples.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className="aurora-number">{cellText(r[c])}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </Section>
      ) : null}
      {invalid.length ? (
        <Section title="Invalid values">
          <Stack direction="row" gap={1} wrap>
            {invalid.slice(0, 20).map(([v, n]) => <Chip key={v}><span className="aurora-number">{v || "(blank)"}</span>&nbsp;× {n.toLocaleString()}</Chip>)}
          </Stack>
          {invalid.length > 20 ? <Text variant="text-micro" tone="muted">{invalid.length - 20} more values</Text> : null}
        </Section>
      ) : null}
      {f.affected_count > 0 ? <VersionRecords key={`${f.version_id}:${f.check_id}`} versionId={f.version_id} checkId={f.check_id} /> : null}
      <Stack direction="row" gap={2} wrap>
        {f.affected_count > 0 ? (
          <Button onClick={() => router.push(`/issues?${new URLSearchParams({ check_id: f.check_id, status: "open", version_id: f.version_id, module: f.module })}`)}>Failing records</Button>
        ) : null}
        <Button variant="ghost" onClick={() => copyToClipboard(f.check_id, "Check ID copied")}>Copy check ID</Button>
        <Button variant="ghost" onClick={() => copyToClipboard(f.id, "Finding ID copied")}>Copy finding ID</Button>
      </Stack>
    </Stack>
  );
}

/** Every record this check found failing in the finding's version. */
function VersionRecords({ versionId, checkId }: { versionId: string; checkId: string }) {
  const [offset, setOffset] = useState(0);
  const { data } = useQuery({
    queryKey: ["finding.records", versionId, checkId, offset],
    queryFn: () => getFindingRecords(versionId, checkId, { limit: RECORDS_PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  return (
    <Section title="Records in this version">
      {!data ? <Text variant="text-small" tone="muted">Reading record keys…</Text>
        : data.total === 0 ? <Text variant="text-small" tone="muted">No record keys were stored for this check in this version.</Text>
        : (
          <Stack gap={2}>
            <Stack direction="row" gap={1} wrap>{data.records.map((r) => <Chip key={r.record_key}><span className="aurora-number">{r.record_key}</span></Chip>)}</Stack>
            <Pager offset={offset} total={data.total} pageSize={RECORDS_PAGE} onChange={setOffset} noun="records" />
          </Stack>
        )}
    </Section>
  );
}
