"use client";

/**
 * Analyse, findings: every failing check in the estate.
 * Run, object, severity, dimension, check, type and order (`sort=column:direction`,
 * set from the column headers) live in the URL, so
 * Home, trends and Object 360 deep-link a slice. The Tally filters by severity
 * in place. A row opens Finding detail.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Banner, Menu, MenuItem, MenuLabel, MenuSeparator, RowHoverPreview } from "@/components/aurora";
import {
  Button, Chip, DataTable, EmptyState, FilterBar, Input, Mono, Pager, PageHeader, StatusBadge, Tally, TableSkeleton,
  type AuroraColumnMeta,
} from "@/components/ui-core";
import { deleteSavedView, getFindings, getFindingsAggregate, listSavedViews, saveNamedView } from "@/lib/api/findings";
type SavedView = Awaited<ReturnType<typeof listSavedViews>>[number];
import { checkClassLabel, formatModuleName, relativeTime } from "@/lib/format";
import type { Dimension, Finding } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const PAGE = 200;
const FILTER_KEYS = ["version_id", "module", "severity", "dimension", "check_id", "baseline", "type", "sort"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filter = Partial<Record<FilterKey, string>>;
const FILTER_LABEL: Record<FilterKey, string> = { version_id: "Run", module: "Object", severity: "Severity", dimension: "Dimension", check_id: "Check", baseline: "Judged against", type: "Type", sort: "Order" };
/** Filters the aggregate endpoint understands (baseline, type and order do not change its totals). */
const AGG_KEYS = ["version_id", "module", "severity", "dimension", "check_id"] as const;
/** Filters with their own control, so no dismissible token. */
const OWN: FilterKey[] = ["severity", "module", "dimension", "baseline", "type", "sort"];
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
type Sev = (typeof SEVERITIES)[number];
const DIMENSIONS: Dimension[] = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"];
const SEV_RANK: Record<Sev, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const sev = (s: string): Sev => ((SEVERITIES as readonly string[]).includes(s) ? (s as Sev) : "medium");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const title = (f: Finding) => f.business_name ?? f.details?.message ?? f.check_id;
const money = (n: number) => n.toLocaleString(undefined, { notation: n >= 100_000 ? "compact" : "standard", maximumFractionDigits: n >= 100_000 ? 1 : 0 });
const matches = (f: Finding, q: string) =>
  !q || [f.check_id, f.module, title(f), f.dimension, f.details?.field_checked ?? ""].join(" ").toLowerCase().includes(q.toLowerCase());
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

const sameFilter = (a: Record<string, string>, b: Filter) => FILTER_KEYS.every((k) => (a[k] ?? "") === (b[k] ?? ""));

export function FindingsSurface() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filter = useMemo(() => {
    const f: Filter = {};
    for (const k of FILTER_KEYS) { const v = params.get(k); if (v) f[k] = v; }
    return f;
  }, [params]);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [passing, setPassing] = useState(false);
  const { data: views = [] } = useQuery({ queryKey: ["saved-views", "findings"], queryFn: () => listSavedViews("findings") });
  const currentView = views.find((v) => sameFilter(v.filters, filter));

  const hrefWith = (patch: Filter) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    return `${pathname}?${next.toString()}`;
  };
  const set = (patch: Filter) => { setOffset(0); router.replace(hrefWith(patch), { scroll: false }); };
  const clearAll = () => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, undefined])) as Filter);
  const active = FILTER_KEYS.filter((k) => filter[k]);

  const q = useQuery({
    queryKey: ["findings.list", filter, offset],
    queryFn: () => getFindings({
      ...filter,
      type: filter.type === "anomaly" || filter.type === "rule" ? filter.type : undefined,
      // the server picks which 200 findings come first; the header sort orders them
      sort: filter.sort?.split(":")[0] === "severity" ? "severity" : undefined,
      limit: PAGE, offset,
    }),
    placeholderData: keepPreviousData,
  });
  const findings = useMemo(() => q.data?.findings ?? [], [q.data]);
  const aggFilter = useMemo(() => Object.fromEntries(AGG_KEYS.filter((k) => filter[k] && k !== "severity").map((k) => [k, filter[k]])), [filter]);
  const agg = useQuery({ queryKey: ["findings.aggregate", aggFilter], queryFn: () => getFindingsAggregate(aggFilter), placeholderData: keepPreviousData });
  const total = q.data?.total ?? findings.length;
  const visible = findings.filter((f) => matches(f, search) && (passing || f.affected_count > 0));
  const hasCost = findings.some((f) => f.cost_at_risk != null);
  // the aggregate ignores baseline and type: its counts describe the slice only when neither is set
  const counted = !!agg.data && !filter.type && !filter.baseline;
  const sevCount = agg.data?.severity ?? { critical: 0, high: 0, medium: 0, low: 0 };
  const records = agg.data?.affected_records ?? 0;
  const issuesHref = `/issues?${new URLSearchParams({ ...(filter.module ? { module: filter.module } : {}), ...(filter.version_id ? { version_id: filter.version_id } : {}), status: "open" })}`;
  const figErr = agg.error ? { retry: () => void agg.refetch() } : undefined;
  const objects = agg.data?.by_module.length ?? 0;
  const fig = (s: Sev, tone?: "danger" | "high") => ({
    label: cap(s), value: counted ? sevCount[s] : null, tone, loading: agg.isLoading, error: figErr,
    href: hrefWith({ severity: filter.severity === s ? undefined : s }),
    verdict: filter.severity === s ? `Showing ${plural(sevCount[s], "check")}. Select again to clear.` : `${plural(sevCount[s], "check")} at this severity.`,
  });

  const columns = useMemo<ColumnDef<Finding, unknown>[]>(() => [
    { id: "severity", header: "Severity", accessorFn: (f) => SEV_RANK[sev(f.severity)], meta: meta({ sticky: "start", width: 104 }),
      cell: ({ row }) => <StatusBadge status={sev(row.original.severity)}>{cap(row.original.severity)}</StatusBadge> },
    { id: "finding", header: "Finding", accessorFn: (f) => title(f), meta: meta({ minWidth: 300, clamp: 2 }), cell: ({ row }) => {
      const f = row.original;
      return (
        <RowHoverPreview preview={<span>{f.details?.message ?? title(f)} {f.affected_count.toLocaleString()} of {f.total_count.toLocaleString()} records fail.</span>}>
          <Link className="ui-link" href={`/analyse/finding/${f.id}?v=${f.version_id}`} onClick={(e) => e.stopPropagation()}>{title(f)}</Link>
        </RowHoverPreview>
      );
    } },
    { id: "check", header: "Check", accessorFn: (f) => f.check_id, meta: meta({ width: 168 }), cell: ({ row }) => {
      const f = row.original;
      return (
        <span className="ui-cell-stack" title={f.check_class ? checkClassLabel(f.check_class) : undefined}>
          <span className="ui-cell-stack__main"><Mono>{f.check_id}</Mono></span>
          {f.details?.field_checked ? <span className="ui-cell-stack__sub"><Mono>{f.details.field_checked}</Mono></span> : null}
        </span>
      );
    } },
    { id: "module", header: "Object", accessorFn: (f) => formatModuleName(f.module), meta: meta({ width: 160 }), cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "dimension", header: "Dimension", accessorFn: (f) => f.dimension, meta: meta({ width: 116 }), cell: ({ row }) => cap(row.original.dimension) },
    { id: "records", header: "Records", accessorFn: (f) => f.affected_count, meta: meta({ width: 96, align: "end", numeric: true }), cell: ({ row }) => row.original.affected_count.toLocaleString() },
    ...(hasCost ? [{ id: "cost", header: "At risk", accessorFn: (f: Finding) => f.cost_at_risk ?? -1, meta: meta({ width: 104, align: "end", numeric: true }),
      cell: ({ row }) => (row.original.cost_at_risk == null ? <span className="ui-micro">—</span> : <span title={row.original.cost_formula ?? undefined}>{money(row.original.cost_at_risk)}</span>) } as ColumnDef<Finding, unknown>] : []),
    { id: "pass", header: "Pass rate", accessorFn: (f) => f.pass_rate ?? -1, meta: meta({ width: 92, align: "end", numeric: true }),
      cell: ({ row }) => (row.original.pass_rate === null ? "—" : `${Math.round(row.original.pass_rate)}%`) },
    { id: "age", header: "Found", accessorFn: (f) => f.created_at, meta: meta({ width: 84, align: "end" }), cell: ({ row }) => relativeTime(row.original.created_at) },
    { id: "fix", header: "Fix", enableSorting: false, meta: meta({ width: 190, clamp: 2 }),
      accessorFn: (f) => (f.affected_count > 0 ? `Open ${plural(f.affected_count, "record")}${f.severity === "critical" || f.severity === "high" ? ", assign" : ""}` : "Passing"), cell: ({ row }) => {
      const f = row.original;
      const href = `/analyse/finding/${f.id}?tab=records&v=${f.version_id}`;
      return (
        <span className="ui-cell-stack__sub" onClick={(e) => e.stopPropagation()}>
          {f.affected_count > 0 ? <Link className="ui-link" href={href}>Open {plural(f.affected_count, "record")}</Link> : <span className="ui-micro">Passing</span>}
          {f.affected_count > 0 && (f.severity === "critical" || f.severity === "high") ? <Link className="ui-link" href={`${href}&assign=1`}>Assign</Link> : null}
        </span>
      );
    } },
  ], [hasCost]);

  const searching = active.length > 0 || search !== "";
  const groups = (() => {
    // the aggregate is already narrowed by a chosen object or dimension, so its counts only describe the other filter
    const moduleOptions = new Map((agg.data?.by_module ?? []).map((m) => [m.module, m.findings]));
    if (filter.module) moduleOptions.set(filter.module, moduleOptions.get(filter.module) ?? 0);
    const dimCount = new Map((agg.data?.by_dimension ?? []).map((d) => [d.dimension, d.findings]));
    const counts = !!agg.data && !filter.type && !filter.baseline;
    return [
      { id: "module", label: "Object", value: filter.module ?? "", onChange: (v: string) => set({ module: v || undefined }), allLabel: "All objects",
        options: [...moduleOptions].map(([m, n]) => ({ value: m, label: formatModuleName(m), count: counts && !filter.module ? n : undefined })) },
      { id: "dimension", label: "Dimension", value: filter.dimension ?? "", onChange: (v: string) => set({ dimension: v || undefined }), allLabel: "All dimensions",
        options: DIMENSIONS.map((d) => ({ value: d, label: cap(d), count: counts && !filter.dimension ? dimCount.get(d) ?? 0 : undefined })) },
    ];
  })();

  return (
    <div className="ui-page">
      <PageHeader title="Findings"
        summary={q.data ? `${plural(total, "failing check")}${active.length ? " in this slice" : ""}${total > PAGE ? `, shown ${Math.min(PAGE, total)}` : ""}.${currentView ? ` Showing view '${currentView.name}'.` : ""}` : undefined}
        actions={<SavedViews views={views} current={currentView} filter={filter} onApply={(f) => set(Object.fromEntries(FILTER_KEYS.map((k) => [k, f[k]])) as Filter)} />} />

      <Tally level={2} label="Findings by severity" figures={[
        { ...fig("critical", "danger"), verdict: sevCount.critical >= 2 ? "Cap the score at 70." : sevCount.critical === 1 ? "Cap the score at 85." : "No cap." },
        fig("high", "high"),
        { label: "Records failing", value: counted ? records : null, href: issuesHref, loading: agg.isLoading, error: figErr,
          verdict: `${plural(records, "record")} fail at least one check.` },
        { label: "Objects affected", value: counted ? objects : null, href: hrefWith({ module: undefined }), loading: agg.isLoading, error: figErr,
          verdict: `Across ${plural(objects, "object")}.` },
      ]} />

      <FilterBar search={{ value: search, onChange: setSearch, placeholder: "Search findings" }} groups={groups} onClear={active.length ? clearAll : undefined}>
        <Chip selected={passing} onClick={() => setPassing((v) => !v)}>Include passing checks</Chip>
        <Chip selected={filter.type === "anomaly"} onClick={() => set({ type: filter.type === "anomaly" ? undefined : "anomaly" })}>Anomalies</Chip>
        <Chip selected={filter.type === "rule"} onClick={() => set({ type: filter.type === "rule" ? undefined : "rule" })}>Rules</Chip>
        <Chip selected={filter.baseline === "sap_standard"} onClick={() => set({ baseline: filter.baseline === "sap_standard" ? undefined : "sap_standard" })}>Baseline only</Chip>
        {active.filter((k) => !OWN.includes(k)).map((k) => (
          <Chip key={k} tone="info" onDismiss={() => set({ [k]: undefined })}>
            {FILTER_LABEL[k]}: <Mono>{k === "version_id" ? filter[k]?.slice(0, 8) : filter[k]}</Mono>
          </Chip>
        ))}
      </FilterBar>

      {q.isLoading ? <TableSkeleton rows={10} label="Loading findings" />
        : q.error ? (
          <Banner tone="danger" title="Findings could not be read" action={<Button size="sm" variant="secondary" onClick={() => void q.refetch()}>Retry</Button>}>
            {(q.error as Error).message}
          </Banner>
        ) : visible.length ? (
          <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
            <DataTable columns={columns} data={visible} getRowId={(f) => f.id} onRowActivate={(f) => router.push(`/analyse/finding/${f.id}?v=${f.version_id}`)}
              ariaLabel="Findings. Use j and k to move, Enter to open." maxHeight="62vh"
              sort={filter.sort ?? ""} onSortChange={(v) => set({ sort: v || undefined })} />
            <Pager offset={offset} total={total} pageSize={PAGE} noun="findings" onChange={setOffset} />
          </div>
        ) : (
          <EmptyState action={searching
            ? <button type="button" className="ui-link-button" onClick={() => { setSearch(""); clearAll(); }}>Clear filters</button>
            : <Link className="ui-link" href="/data?tab=systems">Connect a system</Link>}>
            {searching ? "No findings match these filters." : "No findings yet. Findings appear here after the first analysis run."}
          </EmptyState>
        )}
    </div>
  );
}

/** The user's named filter sets, stored server-side, as a menu chip. */
function SavedViews({ views, current, filter, onApply }: { views: SavedView[]; current?: SavedView; filter: Filter; onApply: (f: Record<string, string>) => void }) {
  const qc = useQueryClient();
  const key = ["saved-views", "findings"];
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const save = useMutation({
    mutationFn: () => saveNamedView("findings", name.trim(), filter as Record<string, string>),
    onSuccess: (v) => { toast.success(`View “${v.name}” saved`); setNaming(false); setName(""); void qc.invalidateQueries({ queryKey: key }); },
    onError: (e: Error) => toast.error("Could not save view", { description: e.message }),
  });
  const remove = useMutation({
    mutationFn: deleteSavedView,
    onSuccess: () => { toast.success("View deleted"); void qc.invalidateQueries({ queryKey: key }); },
    onError: (e: Error) => toast.error("Could not delete view", { description: e.message }),
  });
  if (naming) {
    return (
      <form className="ui-page-header__actions" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="View name" aria-label="View name" maxLength={80} style={{ width: 180 }} />
        <Button type="submit" variant="secondary" disabled={!name.trim() || save.isPending}>Save view</Button>
        <Button variant="ghost" onClick={() => setNaming(false)}>Keep unsaved</Button>
      </form>
    );
  }
  return (
    <Menu label="Saved views" trigger="Saved views" triggerClassName="aurora-chip" width={260}>
      {views.length ? <MenuLabel>Views</MenuLabel> : null}
      {views.map((v) => <MenuItem key={v.id} aria-current={v.id === current?.id} onClick={() => onApply(v.filters)}>{v.name}</MenuItem>)}
      {views.length ? <MenuSeparator /> : null}
      <MenuItem onClick={() => { setName(current?.name ?? ""); setNaming(true); }}>Save current filters as a view</MenuItem>
      {current ? <MenuItem disabled={remove.isPending} onClick={() => remove.mutate(current.id)}>Delete view</MenuItem> : null}
    </Menu>
  );
}
