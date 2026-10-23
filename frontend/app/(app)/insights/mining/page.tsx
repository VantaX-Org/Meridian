"use client";

/**
 * Insights → Mining: entity relationships, mined field dependencies, and
 * mined drift/anomaly/duplicate patterns — three lenses on the same mined
 * graph. Ported from `components/process/graph.tsx` (`GraphSurface`) onto
 * @/design.
 *
 * Deviations from the legacy component (see task-24-report.md for the full
 * list):
 * - `ProcessGraph` (aurora, nodes carry `kind`/`alignment` styling) is
 *   replaced by @/design's force-directed `Graph`, which only varies node
 *   size — the kind/alignment visual encoding is dropped.
 * - The lens switch is now `?tab=` (controlled Tabs, whitelisted). A legacy
 *   `?lens=` is honoured only when `?tab=` is absent.
 * - The "domain" filter under Entity links, and the system/version/object
 *   selection under Mined dependencies, use plain `useState` instead of
 *   `useUrlState` for the same reason (no controlled-Tabs URL round trip to
 *   preserve them against).
 * - Brief said `getMiningRuns`/`isMiningAvailable` would be consumed; the
 *   real legacy component never calls either, so this port doesn't either.
 */

import { InsightFrame } from "../_components/InsightFrame";
import { oneOf, useUrlState } from "@/hooks/use-url-state";
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, EmptyState, ErrorState, ExportMenu, Graph, Pill, Select, Skeleton, Tabs, type GraphEdge, type GraphNode, Status } from "@/design";
import { apiErrorState } from "@/lib/error";
import { domainOf } from "@/design/tokens";
import { exportVersionProfile, getVersionProfile, type FieldDependency } from "@/lib/api/field-profile";
import { getMiningPatterns, getMiningSummary, type MiningPattern } from "@/lib/api/mining";
import { getRelationships } from "@/lib/api/relationships";
import { getSystemVersions } from "@/lib/api/system-objects";
import { useSystemScope } from "@/lib/permissions";
import { getSystems } from "@/lib/api/connectivity";
import { formatModuleName, labelOf, plural, relativeTime, formatDate } from "@/lib/format";
import { miningWhy } from "./sentences";
import { MineNow } from "../duplicates/mined-tabs";
import { useInsightScope } from "../_components/useInsightScope";
import { queryKeys } from "@/lib/query-keys";
import type { RecordRelationship } from "@/types/api";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";

const pct = (share: number, digits = 1) => `${(share * 100).toFixed(digits)}%`;

/** Mined pattern types as the steward reads them; never a module-style title case. */
export const PATTERN_TYPE_LABEL: Record<string, string> = {
  anomaly: "Anomaly",
  drift: "Drift",
  duplicate: "Duplicate",
  pii: "PII",
  dependency: "Field dependency",
  value_set: "Value set",
  format: "Format",
  range: "Numeric range",
};
export const patternTypeLabel = (t: string) => PATTERN_TYPE_LABEL[t] ?? labelOf(t);
// ponytail: carried from the legacy component — past ~80 edges the force layout is unreadable, the table lists all.
const MAX_EDGES = 80;


/* ------------------------------------------------------------ Entity links */

function EntityLinks() {
  const [domain, setDomain] = useState("");
  const dayOne = useDayOne();
  const q = useQuery({ queryKey: queryKeys.relationships({ include_inactive: true }), queryFn: () => getRelationships({ include_inactive: true }) });
  const rels = useMemo(() => q.data?.relationships ?? [], [q.data]);

  const { nodes, edges } = useMemo(() => {
    const stats = new Map<string, { out: number; in: number }>();
    const pairs = new Map<string, { from: string; to: string; type: string; n: number }>();
    const touch = (d: string) => stats.get(d) ?? stats.set(d, { out: 0, in: 0 }).get(d)!;
    for (const r of rels) {
      touch(r.from_domain).out += 1;
      touch(r.to_domain).in += 1;
      const key = `${r.from_domain}>${r.to_domain}>${r.relationship_type}`;
      const p = pairs.get(key) ?? pairs.set(key, { from: r.from_domain, to: r.to_domain, type: r.relationship_type, n: 0 }).get(key)!;
      p.n += 1;
    }
    const nodes: GraphNode[] = Array.from(stats, ([d, s]) => ({ id: d, size: s.out + s.in, label: formatModuleName(d), domain: domainOf(d) }));
    const edges: GraphEdge[] = Array.from(pairs.values()).sort((a, b) => b.n - a.n).slice(0, MAX_EDGES).map((p) => ({
      id: `${p.from}>${p.to}>${p.type}`, source: p.from, target: p.to, label: `${p.type}, ${p.n.toLocaleString()}`,
    }));
    return { nodes, edges };
  }, [rels]);

  const shown = domain ? rels.filter((r) => r.from_domain === domain || r.to_domain === domain) : rels;
  const columns = useMemo<ColumnDef<RecordRelationship>[]>(() => [
    { id: "from", header: "From", cell: ({ row }) => formatModuleName(row.original.from_domain) },
    { id: "fromKey", header: "From key", cell: ({ row }) => row.original.from_key },
    { id: "to", header: "To", cell: ({ row }) => formatModuleName(row.original.to_domain) },
    { id: "toKey", header: "To key", cell: ({ row }) => row.original.to_key },
    { id: "type", header: "Type", cell: ({ row }) => row.original.relationship_type },
    { id: "source", header: "Source", cell: ({ row }) => row.original.ai_inferred
      ? <Pill tone="at-risk">inferred{row.original.ai_confidence != null ? `, ${pct(row.original.ai_confidence, 0)}` : ""}</Pill>
      : <Pill>{row.original.sap_link_table ?? "SAP"}</Pill> },
    { id: "state", header: "State", cell: ({ row }) => <Pill tone={row.original.active ? "go" : "at-risk"}>{row.original.active ? "active" : "inactive"}</Pill> },
    { id: "found", header: "Discovered", cell: ({ row }) => relativeTime(row.original.discovered_at) },
  ], []);

  if (q.error) {
    return (
      <ErrorState
        {...apiErrorState(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="m-text-body m-ink-2">
          Click a domain to list its links{domain ? `, showing ${formatModuleName(domain)}` : ""}.
        </p>
        {q.isLoading || dayOne.status === "loading" ? <Skeleton height={320} />
          : nodes.length ? <Graph nodes={nodes} edges={edges} height={320} onNodeClick={(id) => setDomain(id === domain ? "" : id)} />
          : (
            <EmptyState
              title="No relationships recorded yet"
              detail={dayOne.step?.detail ?? "They appear once an analysis has linked records across domains."}
              action={<DayOneAction step={dayOne.step} fallbackHref="/systems" fallbackLabel="Open systems" />}
            />
          )}
      </div>
      <DataTableWithMaybeEmpty columns={columns} data={shown} getRowId={(r) => r.id} loading={q.isLoading} empty="No relationships." action={<Button render={<Link href="/systems">Open systems</Link>} />} />
    </div>
  );
}

/* ------------------------------------------------------- Mined dependencies */

function Dependencies() {
  const router = useRouter();
  const dayOne = useDayOne();
  const [systemId, setSystemId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [object, setObject] = useState("");

  const systemScope = useSystemScope();
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, select: systemScope });
  const sid = systemId || systems.data?.[0]?.id || "";
  const versions = useQuery({
    queryKey: queryKeys.systemVersions(sid), queryFn: () => getSystemVersions(sid), enabled: !!sid,
    select: (d) => d.versions,
  });
  const vid = versionId || versions.data?.[0]?.id || "";
  const profile = useQuery({
    queryKey: queryKeys.versionProfile(sid, vid, object),
    queryFn: () => getVersionProfile(sid, vid, object || undefined),
    enabled: !!sid && !!vid,
  });
  const obj = profile.data?.object ?? object;
  const deps = useMemo(() => profile.data?.dependencies ?? [], [profile.data]);
  const profileHref = `/runs/${vid}?tab=profile${obj ? `&object=${encodeURIComponent(obj)}` : ""}`;

  const { nodes, edges } = useMemo(() => {
    const top = [...deps].sort((a, b) => b.violations - a.violations).slice(0, MAX_EDGES);
    const fields = new Set<string>();
    for (const d of top) { fields.add(d.determinant); fields.add(d.dependent); }
    const nodes: GraphNode[] = Array.from(fields, (f) => ({ id: f, size: 4, label: f.split(".").slice(1).join(".") || f }));
    const edges: GraphEdge[] = top.map((d) => ({
      id: `${d.determinant}>${d.dependent}`, source: d.determinant, target: d.dependent,
      label: `${pct(d.support)}, ${d.violations.toLocaleString()} disagree`,
    }));
    return { nodes, edges };
  }, [deps]);

  const columns = useMemo<ColumnDef<FieldDependency>[]>(() => [
    { id: "rule", header: "Candidate rule", cell: ({ row }) => `${row.original.determinant} decides ${row.original.dependent}` },
    { id: "support", header: "Holds for", cell: ({ row }) => pct(row.original.support, 2) },
    { id: "rows", header: "Records", cell: ({ row }) => row.original.rows.toLocaleString() },
    { id: "violations", header: "Disagree", cell: ({ row }) => row.original.violations.toLocaleString() },
    { id: "samples", header: "Sample records", cell: ({ row }) => row.original.sample_keys.slice(0, 3).join(", ") },
    { id: "review", header: "", cell: () => <Link href={profileHref} className="underline">Review in profile</Link> },
  ], [profileHref]);

  if (systems.data && !systems.data.length) {
    if (dayOne.status === "loading") return <Skeleton height={440} />;
    return (
      <EmptyState
        title="No SAP systems yet"
        detail={dayOne.step?.detail ?? "Connect a system and analyse a download to mine its dependencies."}
        action={<DayOneAction step={dayOne.step} fallbackHref="/systems" fallbackLabel="Open systems" />}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-row gap-3 items-center flex-wrap">
        <Select label="System" value={sid} options={(systems.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          onValueChange={(v) => { setSystemId(v); setVersionId(""); setObject(""); }} />
        <Select label="Analysis run" value={vid} options={(versions.data ?? []).map((v) => ({ value: v.id, label: `${formatDate(v.run_at, "datetime")}${v.label ? `, ${v.label}` : ""}` }))}
          onValueChange={(v) => { setVersionId(v); setObject(""); }} />
        <Select label="Object" value={obj} options={(profile.data?.objects ?? (obj ? [obj] : [])).map((o) => ({ value: o, label: formatModuleName(o) }))}
          onValueChange={setObject} />
        {sid && vid ? <Link href={profileHref} className="m-text-body underline">Open profile</Link> : null}
        {sid && vid ? (
          <ExportMenu options={[{ format: "xlsx", run: () => exportVersionProfile(sid, vid, "xlsx", obj || undefined) }]} />
        ) : null}
      </div>
      {profile.error ? (
        <ErrorState
          {...apiErrorState(profile.error)}
          onRetry={() => void profile.refetch()}
        />
      ) : null}
      <div>
        <p className="m-text-body m-ink-2">
          One field decides another in at least 99 % of records. Click a field to open its profile.
        </p>
        {profile.isLoading || systems.isLoading || versions.isLoading ? <Skeleton height={320} />
          : nodes.length ? <Graph nodes={nodes} edges={edges} height={320} onNodeClick={() => router.push(profileHref)} />
          : <EmptyState title="No candidate rules in this object's data" action={<Button render={<Link href="/runs">Open runs</Link>} />} />}
      </div>
      <DataTableWithMaybeEmpty columns={columns} data={deps} getRowId={(d) => `${d.determinant}>${d.dependent}`} loading={profile.isLoading} empty="No candidate rules." action={<Button render={<Link href="/runs">Open runs</Link>} />} />
    </div>
  );
}

/* ---------------------------------------------------------------- Patterns */

function Patterns({ run }: { run?: string }) {
  const [type, setType] = useState("");
  const summary = useQuery({ queryKey: queryKeys.miningSummary(30), queryFn: () => getMiningSummary(30) });
  const patterns = useQuery({
    queryKey: queryKeys.miningPatterns({ type }),
    queryFn: () => getMiningPatterns({ pattern_type: type || undefined, limit: 200 }),
  });
  const list = patterns.data?.patterns ?? [];

  const columns = useMemo<ColumnDef<MiningPattern>[]>(() => [
    { id: "name", header: "Pattern", cell: ({ row }) => row.original.name },
    { id: "type", header: "Type", cell: ({ row }) => <Pill>{patternTypeLabel(row.original.pattern_type)}</Pill> },
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "severity", header: "Severity", cell: ({ row }) => <Status kind="severity" value={row.original.severity} /> },
    { id: "confidence", header: "Confidence", accessorFn: (p) => p.confidence, meta: { numeric: true, heat: "seq", heatRange: [0, 1] }, cell: ({ row }) => pct(row.original.confidence, 0) },
    { id: "occurrences", header: "Occurrences", cell: ({ row }) => row.original.occurrences.toLocaleString() },
    { id: "seen", header: "Last seen", cell: ({ row }) => relativeTime(row.original.last_seen) },
    { id: "rule", header: "", cell: ({ row }) => row.original.promoted_to_rule ? <Pill tone="go">is a rule</Pill> : null },
  ], []);

  if (summary.error || patterns.error) {
    const err = patterns.error ?? summary.error;
    return (
      <ErrorState
        {...apiErrorState(err)}
        onRetry={() => { void summary.refetch(); void patterns.refetch(); }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Select
        label="Pattern type"
        placeholder="All types" value={type} onValueChange={setType}
        options={["anomaly", "drift", "duplicate", "pii"].map((t) => ({ value: t, label: patternTypeLabel(t) }))} />
      <DataTableWithMaybeEmpty columns={columns} data={list} getRowId={(p) => p.id} loading={patterns.isLoading} empty="No patterns mined yet" detail={run ? "Mining runs over a finished analysis; start it on the current run." : "Patterns are mined from a finished analysis."} action={<MineNow run={run} />} />
    </div>
  );
}

/* ---------------------------------------------------------------------- Table helper */

/** `@/design`'s DataTable has no `empty` prop; this wraps it with the legacy loading/empty text. */
function DataTableWithMaybeEmpty<T>({ columns, data, getRowId, loading, empty, detail, action }: {
  columns: ColumnDef<T>[]; data: T[]; getRowId: (row: T) => string; loading: boolean; empty: string; detail?: string; action: ReactNode;
}) {
  if (loading) return <Skeleton height={200} />;
  if (!data.length) return <EmptyState title={empty} detail={detail} action={action} />;
  return <DataTable<T> columns={columns} data={data} getRowId={getRowId} />;
}

export default function MiningPage() {
  const { run } = useInsightScope();
  const [tabRaw, setTab] = useUrlState("tab", "");
  const TABS = ["links", "dependencies", "patterns"] as const;
  // Legacy bookmarks used ?lens=; honour it only when ?tab= is absent, through the same whitelist.
  const lens = useSearchParams().get("lens") ?? "";
  const tab = oneOf(tabRaw, TABS, oneOf(lens, TABS, "links"));
  const rel = useQuery({ queryKey: queryKeys.relationships({ include_inactive: true }), queryFn: () => getRelationships({ include_inactive: true }) });
  const sum = useQuery({ queryKey: queryKeys.miningSummary(30), queryFn: () => getMiningSummary(30) });
  const rels = rel.data?.relationships ?? [];
  const links = rel.data?.total ?? rels.length;
  const domains = new Set(rels.flatMap((r) => [r.from_domain, r.to_domain])).size;
  const inferred = rels.filter((r) => r.ai_inferred).length;
  const anomalies = sum.data?.new_anomalies ?? 0;
  const patternsTotal = sum.data?.total_patterns ?? 0;
  return (
    <InsightFrame
      title="Patterns"
      scope
      meta="Links and patterns from every mined run; Mine now mines the run shown"
      run={run}
      insight={{
        loading: rel.isLoading || sum.isLoading,
        situation: { sentence: links ? `${plural(links, "link")} across ${plural(domains, "entity", "entities")}` : "No links found yet", tone: anomalies ? "at-risk" : "go" },
        changed: { sentence: anomalies ? `${plural(anomalies, "new anomaly", "new anomalies")} in the last 30 days` : "No new anomalies in the last 30 days" },
        why: { sentence: miningWhy(links, inferred, patternsTotal) },
        next: anomalies
          ? { sentence: "Review the new anomalies", action: { label: "Open patterns", onClick: () => setTab("patterns") } }
          : links
            ? { sentence: "Review the entity links", action: { label: "Open links", onClick: () => setTab("links") } }
            : { sentence: "Mine the run to find links", action: { label: "Open links", onClick: () => setTab("links") } },
      }}
    >
      <Tabs value={tab} onValueChange={setTab} items={[
        { value: "links", label: "Entity links", content: <EntityLinks /> },
        { value: "dependencies", label: "Mined dependencies", content: <Dependencies /> },
        { value: "patterns", label: "Patterns", content: <Patterns run={run} /> },
      ]} />
    </InsightFrame>
  );
}
