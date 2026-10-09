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
 * - `Tally`'s per-figure href/verdict/tone is replaced by plain @/design
 *   `Stat` cells (label/value only); the "click to view" affordance and the
 *   loading/error-retry wiring on each figure are dropped.
 * - The lens switch (legacy `Tabs` controlled by `useUrlState("lens", ...)`)
 *   is replaced by @/design's `Tabs`, which is uncontrolled (`defaultValue`
 *   only, no onValueChange) — matching the Task 22 precedent in
 *   insights/process/page.tsx. The initial lens still reads `?lens=` from
 *   the URL (so the /mining and /relationships redirects land on the right
 *   tab), but switching tabs after that no longer updates the URL.
 * - The "domain" filter under Entity links, and the system/version/object
 *   selection under Mined dependencies, use plain `useState` instead of
 *   `useUrlState` for the same reason (no controlled-Tabs URL round trip to
 *   preserve them against).
 * - Brief said `getMiningRuns`/`isMiningAvailable` would be consumed; the
 *   real legacy component never calls either, so this port doesn't either.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  DataTable, EmptyState, ErrorState, Graph, Pill, Select, Skeleton, Stat, Tabs,
  type GraphEdge, type GraphNode, type PillTone,
} from "@/design";
import { getVersionProfile, type FieldDependency } from "@/lib/api/field-profile";
import { getMiningPatterns, getMiningSummary, type MiningPattern } from "@/lib/api/mining";
import { getRelationships } from "@/lib/api/relationships";
import { getSystemVersions } from "@/lib/api/system-objects";
import { getSystems } from "@/lib/api/systems";
import { formatModuleName, relativeTime, formatDate } from "@/lib/format";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import type { RecordRelationship } from "@/types/api";

const pct = (share: number, digits = 1) => `${(share * 100).toFixed(digits)} %`;
// ponytail: carried from the legacy component — past ~80 edges the force layout is unreadable, the table lists all.
const MAX_EDGES = 80;

const SEVERITY_TONE: Record<MiningPattern["severity"], PillTone> = {
  critical: "no-go", high: "no-go", medium: "at-risk", low: "neutral",
};
const SEVERITY_LABEL: Record<MiningPattern["severity"], string> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low",
};

function GraphTally() {
  const rel = useQuery({ queryKey: queryKeys.relationships({ include_inactive: true }), queryFn: () => getRelationships({ include_inactive: true }) });
  const sum = useQuery({ queryKey: queryKeys.miningSummary(30), queryFn: () => getMiningSummary(30) });
  const rels = rel.data?.relationships ?? [];
  const domains = new Set(rels.flatMap((r) => [r.from_domain, r.to_domain])).size;
  const anomalies = sum.data?.new_anomalies ?? 0;
  return (
    <div className="flex flex-row gap-8">
      <Stat label="Entities" value={rel.isLoading ? <Skeleton width={32} /> : domains} />
      <Stat label="Links" value={rel.isLoading ? <Skeleton width={32} /> : (rel.data?.total ?? rels.length)}
        delta={`${rels.filter((r) => r.ai_inferred).length.toLocaleString()} inferred`} />
      <Stat label="Patterns" value={sum.isLoading ? <Skeleton width={32} /> : (sum.data?.total_patterns ?? 0)}
        delta={`${(sum.data?.stable_patterns ?? 0).toLocaleString()} stable`} />
      <Stat label="New anomalies" value={sum.isLoading ? <Skeleton width={32} /> : anomalies}
        delta="Seen in the last 30 days" />
    </div>
  );
}

/* ------------------------------------------------------------ Entity links */

function EntityLinks() {
  const [domain, setDomain] = useState("");
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
    const nodes: GraphNode[] = Array.from(stats, ([d, s]) => ({ id: d, size: s.out + s.in, label: formatModuleName(d) }));
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
        message={apiErrorMessage(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
          Click a domain to list its links{domain ? `, showing ${formatModuleName(domain)}` : ""}.
        </p>
        {q.isLoading ? <Skeleton height={440} />
          : nodes.length ? <Graph nodes={nodes} edges={edges} height={440} onNodeClick={(id) => setDomain(id === domain ? "" : id)} />
          : <EmptyState title="No relationships recorded yet. They appear once an analysis has linked records across domains." />}
      </div>
      <DataTableWithMaybeEmpty columns={columns} data={shown} getRowId={(r) => r.id} loading={q.isLoading} empty="No relationships." />
    </div>
  );
}

/* ------------------------------------------------------- Mined dependencies */

function Dependencies() {
  const router = useRouter();
  const [systemId, setSystemId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [object, setObject] = useState("");

  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
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
  const profileHref = `/data/runs/${vid}?tab=profile${obj ? `&object=${encodeURIComponent(obj)}` : ""}`;

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
    return <EmptyState title="No SAP systems yet. Connect a system and analyse a download to mine its dependencies." />;
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-row gap-3 items-center flex-wrap">
        <Select value={sid} options={(systems.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          onValueChange={(v) => { setSystemId(v); setVersionId(""); setObject(""); }} />
        <Select value={vid} options={(versions.data ?? []).map((v) => ({ value: v.id, label: `${formatDate(v.run_at, "datetime")}${v.label ? `, ${v.label}` : ""}` }))}
          onValueChange={(v) => { setVersionId(v); setObject(""); }} />
        <Select value={obj} options={(profile.data?.objects ?? (obj ? [obj] : [])).map((o) => ({ value: o, label: formatModuleName(o) }))}
          onValueChange={setObject} />
        {sid && vid ? <Link href={profileHref} className="text-[13px] underline">Open profile</Link> : null}
      </div>
      {profile.error ? (
        <ErrorState
          message={apiErrorMessage(profile.error)}
          onRetry={() => void profile.refetch()}
        />
      ) : null}
      <div>
        <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
          One field decides another in at least 99 % of records. Click a field to open its profile.
        </p>
        {profile.isLoading || systems.isLoading || versions.isLoading ? <Skeleton height={480} />
          : nodes.length ? <Graph nodes={nodes} edges={edges} height={480} onNodeClick={() => router.push(profileHref)} />
          : <EmptyState title="No candidate rules in this object's data." />}
      </div>
      <DataTableWithMaybeEmpty columns={columns} data={deps} getRowId={(d) => `${d.determinant}>${d.dependent}`} loading={profile.isLoading} empty="No candidate rules." />
    </div>
  );
}

/* ---------------------------------------------------------------- Patterns */

function Patterns() {
  const [type, setType] = useState("");
  const summary = useQuery({ queryKey: queryKeys.miningSummary(30), queryFn: () => getMiningSummary(30) });
  const patterns = useQuery({
    queryKey: queryKeys.miningPatterns({ type }),
    queryFn: () => getMiningPatterns({ pattern_type: type || undefined, limit: 200 }),
  });
  const list = patterns.data?.patterns ?? [];

  const columns = useMemo<ColumnDef<MiningPattern>[]>(() => [
    { id: "name", header: "Pattern", cell: ({ row }) => row.original.name },
    { id: "type", header: "Type", cell: ({ row }) => <Pill>{row.original.pattern_type}</Pill> },
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "severity", header: "Severity", cell: ({ row }) => <Pill tone={SEVERITY_TONE[row.original.severity]}>{SEVERITY_LABEL[row.original.severity]}</Pill> },
    { id: "confidence", header: "Confidence", cell: ({ row }) => pct(row.original.confidence, 0) },
    { id: "occurrences", header: "Occurrences", cell: ({ row }) => row.original.occurrences.toLocaleString() },
    { id: "seen", header: "Last seen", cell: ({ row }) => relativeTime(row.original.last_seen) },
    { id: "rule", header: "", cell: ({ row }) => row.original.promoted_to_rule ? <Pill tone="go">is a rule</Pill> : null },
  ], []);

  if (summary.error || patterns.error) {
    const err = patterns.error ?? summary.error;
    return (
      <ErrorState
        message={apiErrorMessage(err)}
        onRetry={() => { void summary.refetch(); void patterns.refetch(); }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Select placeholder="All types" value={type} onValueChange={setType}
        options={["anomaly", "drift", "duplicate", "pii"].map((t) => ({ value: t, label: formatModuleName(t) }))} />
      <DataTableWithMaybeEmpty columns={columns} data={list} getRowId={(p) => p.id} loading={patterns.isLoading} empty="No patterns mined yet." />
    </div>
  );
}

/* ---------------------------------------------------------------------- Table helper */

/** `@/design`'s DataTable has no `empty` prop; this wraps it with the legacy loading/empty text. */
function DataTableWithMaybeEmpty<T>({ columns, data, getRowId, loading, empty }: {
  columns: ColumnDef<T>[]; data: T[]; getRowId: (row: T) => string; loading: boolean; empty: string;
}) {
  if (loading) return <Skeleton height={200} />;
  if (!data.length) return <EmptyState title={empty} />;
  return <DataTable<T> columns={columns} data={data} getRowId={getRowId} />;
}

export default function MiningPage() {
  const sp = useSearchParams();
  const initialLens = sp.get("lens") === "patterns" ? "patterns" : sp.get("lens") === "dependencies" ? "dependencies" : "links";
  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-[22px] font-semibold">Mining</h2>
        <p style={{ color: "var(--m-ink-2)" }}>What links the master data together: entity relationships, mined field dependencies and mined patterns.</p>
      </div>
      <GraphTally />
      <Tabs defaultValue={initialLens} items={[
        { value: "links", label: "Entity links", content: <EntityLinks /> },
        { value: "dependencies", label: "Mined dependencies", content: <Dependencies /> },
        { value: "patterns", label: "Patterns", content: <Patterns /> },
      ]} />
    </div>
  );
}
