"use client";

/**
 * Process, Relationships & patterns: one graph surface over what links the
 * master data together.
 *
 *  • Entity links — record-to-record relationships (``/relationships``)
 *    rolled up to domains; edges carry the relationship type and count.
 *  • Mined dependencies — the "one field decides another" candidates the
 *    profiler found in an analysed version (``/systems/…/profile``). Each one
 *    links to the version's profile, where a steward turns it into a check.
 *  • Patterns — drift / anomaly / duplicate patterns from ``/mining``.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Tally } from "@/components/ui-core";
import {
  Banner, Chip, DataTable, Panel, ProcessGraph, Select, Stack, Tabs, Text,
  type AuroraColumnMeta, type ChipTone, type ProcessGraphProps,
} from "@/components/aurora";
import { useUrlState } from "@/hooks/use-url-state";
import { getVersionProfile, type FieldDependency } from "@/lib/api/field-profile";
import { getMiningPatterns, getMiningSummary, type MiningPattern } from "@/lib/api/mining";
import { getRelationships } from "@/lib/api/relationships";
import { getSystemVersions } from "@/lib/api/system-objects";
import { getSystems } from "@/lib/api/systems";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { RecordRelationship } from "@/types/api";

type Lens = "links" | "dependencies" | "patterns";
type GraphNodes = ProcessGraphProps["nodes"];
type GraphEdges = ProcessGraphProps["edges"];

const meta = (m: AuroraColumnMeta) => m;
const pct = (share: number, digits = 1) => `${(share * 100).toFixed(digits)} %`;
// ponytail: dagre lays out every node; past ~80 edges the canvas is unreadable. Table below lists all.
const MAX_EDGES = 80;

const SEVERITY_TONE: Record<MiningPattern["severity"], ChipTone> = {
  critical: "danger", high: "warning", medium: "info", low: "neutral",
};

export function GraphSurface() {
  const [lens, setLens] = useUrlState("lens", "links");
  return (
    <Stack gap={6} className="aurora-page">
      <Tabs<Lens>
        ariaLabel="Graph lens"
        value={lens as Lens}
        onValueChange={setLens}
        items={[
          { id: "links", label: "Entity links" },
          { id: "dependencies", label: "Mined dependencies" },
          { id: "patterns", label: "Patterns" },
        ]}
      />
      <GraphTally />
      {lens === "dependencies" ? <Dependencies /> : lens === "patterns" ? <Patterns /> : <EntityLinks />}
    </Stack>
  );
}

/** Same query keys as the lenses below, so the figures cost no extra requests. */
function GraphTally() {
  const rel = useQuery({ queryKey: ["relationships.list"], queryFn: () => getRelationships({ include_inactive: true }) });
  const sum = useQuery({ queryKey: ["mining.summary"], queryFn: () => getMiningSummary(30) });
  const rels = rel.data?.relationships ?? [];
  const domains = new Set(rels.flatMap((r) => [r.from_domain, r.to_domain])).size;
  const anomalies = sum.data?.new_anomalies ?? 0;
  const fig = { loading: rel.isLoading, error: rel.error ? { retry: () => void rel.refetch() } : undefined };
  return (
    <Tally level={4} label="Graph figures" figures={[
      { label: "Entities", value: domains, href: "/process?tab=relationships", verdict: domains ? "Domains with a recorded link." : "No domains linked.", ...fig },
      { label: "Links", value: rel.data?.total ?? rels.length, href: "/process?tab=relationships", verdict: `${rels.filter((r) => r.ai_inferred).length.toLocaleString()} inferred.`, ...fig },
      { label: "Patterns", value: sum.data?.total_patterns ?? null, href: "/process?tab=relationships&lens=patterns", verdict: `${(sum.data?.stable_patterns ?? 0).toLocaleString()} stable.`, loading: sum.isLoading, error: sum.error ? { retry: () => void sum.refetch() } : undefined },
      { label: "New anomalies", value: anomalies, href: "/process?tab=relationships&lens=patterns", tone: anomalies ? "warning" : undefined, verdict: anomalies ? "Seen in the last 30 days." : "No new anomalies.", loading: sum.isLoading },
    ]} />
  );
}

/* ------------------------------------------------------------ Entity links */

function EntityLinks() {
  const [domain, setDomain] = useUrlState("domain", "");
  const q = useQuery({ queryKey: ["relationships.list"], queryFn: () => getRelationships({ include_inactive: true }) });
  const rels = useMemo(() => q.data?.relationships ?? [], [q.data]);

  const { nodes, edges } = useMemo(() => {
    const stats = new Map<string, { out: number; in: number; inactive: number }>();
    const pairs = new Map<string, { from: string; to: string; type: string; n: number; inactive: number }>();
    const touch = (d: string) => stats.get(d) ?? stats.set(d, { out: 0, in: 0, inactive: 0 }).get(d)!;
    for (const r of rels) {
      touch(r.from_domain).out += 1;
      touch(r.to_domain).in += 1;
      const key = `${r.from_domain}>${r.to_domain}>${r.relationship_type}`;
      const p = pairs.get(key) ?? pairs.set(key, { from: r.from_domain, to: r.to_domain, type: r.relationship_type, n: 0, inactive: 0 }).get(key)!;
      p.n += 1;
      if (!r.active) {
        p.inactive += 1;
        touch(r.from_domain).inactive += 1;
      }
    }
    const nodes: GraphNodes = Array.from(stats, ([d, s]) => ({
      id: d,
      data: {
        label: formatModuleName(d), kind: s.in === 0 ? "source" : s.out === 0 ? "sink" : "transform",
        alignment: s.inactive ? "drifting" : "aligned",
        secondary: `${s.out.toLocaleString()} out, ${s.in.toLocaleString()} in${s.inactive ? `, ${s.inactive} inactive` : ""}`,
      },
    }));
    const edges: GraphEdges = Array.from(pairs.values()).sort((a, b) => b.n - a.n).slice(0, MAX_EDGES).map((p) => ({
      id: `${p.from}>${p.to}>${p.type}`, source: p.from, target: p.to,
      label: `${p.type}, ${p.n.toLocaleString()}`,
    }));
    return { nodes, edges };
  }, [rels]);

  const shown = domain ? rels.filter((r) => r.from_domain === domain || r.to_domain === domain) : rels;
  const columns = useMemo<ColumnDef<RecordRelationship, unknown>[]>(() => [
    { id: "from", header: "From", meta: meta({ width: 220 }), cell: ({ row }) => (
      <Stack gap={1}><span>{formatModuleName(row.original.from_domain)}</span>
        <span className="aurora-number text-[12px] text-[var(--aurora-fg-tertiary)]">{row.original.from_key}</span></Stack>
    ) },
    { id: "to", header: "To", meta: meta({ width: 220 }), cell: ({ row }) => (
      <Stack gap={1}><span>{formatModuleName(row.original.to_domain)}</span>
        <span className="aurora-number text-[12px] text-[var(--aurora-fg-tertiary)]">{row.original.to_key}</span></Stack>
    ) },
    { id: "type", header: "Type", meta: meta({ width: 170 }), cell: ({ row }) => <span className="aurora-number">{row.original.relationship_type}</span> },
    { id: "source", header: "Source", meta: meta({ width: 130 }), cell: ({ row }) => row.original.ai_inferred
      ? <Chip tone="info">inferred{row.original.ai_confidence != null ? `, ${pct(row.original.ai_confidence, 0)}` : ""}</Chip>
      : <Chip>{row.original.sap_link_table ?? "SAP"}</Chip> },
    { id: "state", header: "State", meta: meta({ width: 100 }), cell: ({ row }) =>
      <Chip tone={row.original.active ? "success" : "warning"}>{row.original.active ? "active" : "inactive"}</Chip> },
    { id: "found", header: "Discovered", meta: meta({ width: 120 }), cell: ({ row }) => relativeTime(row.original.discovered_at) },
  ], []);

  if (q.error) return <Banner tone="danger" title="Relationships could not be loaded." />;

  return (
    <Stack gap={6}>
      <Panel title="Entity map" action={
        <Text variant="text-small" tone="tertiary">Click a domain to list its links{domain ? `, showing ${formatModuleName(domain)}` : ""}</Text>
      }>
        {q.isLoading ? <Text tone="muted">Reading relationships…</Text>
          : nodes.length ? <ProcessGraph nodes={nodes} edges={edges} height={440} onNodeClick={(n) => setDomain(n.id === domain ? "" : n.id)} />
          : <Text tone="muted">No relationships recorded yet. They appear once an analysis has linked records across domains.</Text>}
      </Panel>
      <DataTable<RecordRelationship>
        ariaLabel="Relationships"
        columns={columns}
        data={shown}
        getRowId={(r) => r.id}
        maxHeight={480}
        empty={q.isLoading ? "Loading…" : "No relationships."}
      />
    </Stack>
  );
}

/* ------------------------------------------------------- Mined dependencies */

function Dependencies() {
  const router = useRouter();
  const [systemId, setSystemId] = useUrlState("system", "");
  const [versionId, setVersionId] = useUrlState("version", "");
  const [object, setObject] = useUrlState("object", "");

  const systems = useQuery({ queryKey: ["systems"], queryFn: getSystems });
  const sid = systemId || systems.data?.[0]?.id || "";
  const versions = useQuery({
    queryKey: ["system-versions", sid], queryFn: () => getSystemVersions(sid), enabled: !!sid,
    select: (d) => d.versions,
  });
  const vid = versionId || versions.data?.[0]?.id || "";
  const profile = useQuery({
    queryKey: ["version-profile", sid, vid, object],
    queryFn: () => getVersionProfile(sid, vid, object || undefined),
    enabled: !!sid && !!vid,
  });
  const obj = profile.data?.object ?? object;
  const deps = useMemo(() => profile.data?.dependencies ?? [], [profile.data]);
  const profileHref = `/data/runs/${vid}?tab=profile${obj ? `&object=${encodeURIComponent(obj)}` : ""}`;

  // A version change can drop the selected object; let the API pick the default again.
  useEffect(() => {
    if (object && profile.data && !profile.data.objects.includes(object)) setObject("");
  }, [object, profile.data, setObject]);

  const { nodes, edges } = useMemo(() => {
    const top = [...deps].sort((a, b) => b.violations - a.violations).slice(0, MAX_EDGES);
    const fields = new Map<string, "source" | "transform">();
    for (const d of top) {
      if (!fields.has(d.determinant)) fields.set(d.determinant, "source");
      fields.set(d.dependent, "transform");
    }
    const nodes: GraphNodes = Array.from(fields, ([f, kind]) => ({
      id: f,
      data: { label: f.split(".").slice(1).join(".") || f, stepId: f.split(".")[0], kind, alignment: kind === "transform" ? "drifting" : "aligned" },
    }));
    const edges: GraphEdges = top.map((d) => ({
      id: `${d.determinant}>${d.dependent}`, source: d.determinant, target: d.dependent,
      label: `${pct(d.support)}, ${d.violations.toLocaleString()} disagree`,
    }));
    return { nodes, edges };
  }, [deps]);

  const columns = useMemo<ColumnDef<FieldDependency, unknown>[]>(() => [
    { id: "rule", header: "Candidate rule", meta: meta({ width: 320 }), cell: ({ row }) => (
      <span className="aurora-number">{row.original.determinant} decides {row.original.dependent}</span>
    ) },
    { id: "support", header: "Holds for", meta: meta({ width: 110, numeric: true, align: "end" }), cell: ({ row }) => pct(row.original.support, 2) },
    { id: "rows", header: "Records", meta: meta({ width: 110, numeric: true, align: "end" }), cell: ({ row }) => row.original.rows.toLocaleString() },
    { id: "violations", header: "Disagree", meta: meta({ width: 110, numeric: true, align: "end" }), cell: ({ row }) => row.original.violations.toLocaleString() },
    { id: "samples", header: "Sample records", meta: meta({ width: 220 }), cell: ({ row }) => (
      <span className="aurora-number text-[12px]">{row.original.sample_keys.slice(0, 3).join(", ")}</span>
    ) },
    { id: "review", header: "", meta: meta({ width: 160 }), cell: () => (
      <Link href={profileHref} className="text-[var(--aurora-accent-400)] hover:underline">Review in profile</Link>
    ) },
  ], [profileHref]);

  if (systems.data && !systems.data.length) {
    return <Banner tone="info" title="No SAP systems yet. Connect a system and analyse a download to mine its dependencies." />;
  }
  return (
    <Stack gap={6}>
      <Stack direction="row" gap={3} align="center" wrap>
        <Select aria-label="System" value={sid}
          options={(systems.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          onValueChange={(v) => { setSystemId(v); setVersionId(""); setObject(""); }} />
        <Select aria-label="Version" value={vid}
          options={(versions.data ?? []).map((v) => ({ value: v.id, label: `${new Date(v.run_at).toLocaleString()}${v.label ? `, ${v.label}` : ""}` }))}
          onValueChange={(v) => { setVersionId(v); setObject(""); }} />
        <Select aria-label="Object" value={obj}
          options={(profile.data?.objects ?? (obj ? [obj] : [])).map((o) => ({ value: o, label: formatModuleName(o) }))}
          onValueChange={setObject} />
        {sid && vid ? <Link href={profileHref} className="text-[13px] text-[var(--aurora-accent-400)] hover:underline">Open profile</Link> : null}
      </Stack>
      {profile.error ? <Banner tone="danger" title="The profile for this version could not be loaded." /> : null}
      <Panel title="Dependency map" action={
        <Text variant="text-small" tone="tertiary">One field decides another in at least 99 % of records. Click a field to review it.</Text>
      }>
        {profile.isLoading || systems.isLoading || versions.isLoading ? <Text tone="muted">Reading the profile…</Text>
          : nodes.length ? <ProcessGraph nodes={nodes} edges={edges} height={480} onNodeClick={() => router.push(profileHref)} />
          : <Text tone="muted">No candidate rules in this object&apos;s data.</Text>}
      </Panel>
      <DataTable<FieldDependency>
        ariaLabel="Mined dependencies"
        columns={columns}
        data={deps}
        getRowId={(d) => `${d.determinant}>${d.dependent}`}
        maxHeight={480}
        empty={profile.isLoading ? "Loading…" : "No candidate rules."}
      />
    </Stack>
  );
}

/* ---------------------------------------------------------------- Patterns */

function Patterns() {
  const [type, setType] = useUrlState("type", "");
  const summary = useQuery({ queryKey: ["mining.summary"], queryFn: () => getMiningSummary(30) });
  const patterns = useQuery({
    queryKey: ["mining.patterns", { type }],
    queryFn: () => getMiningPatterns({ pattern_type: type || undefined, limit: 200 }),
  });
  const list = patterns.data?.patterns ?? [];

  const columns = useMemo<ColumnDef<MiningPattern, unknown>[]>(() => [
    { id: "name", header: "Pattern", meta: meta({ width: 300 }), cell: ({ row }) => row.original.name },
    { id: "type", header: "Type", meta: meta({ width: 110 }), cell: ({ row }) => <Chip>{row.original.pattern_type}</Chip> },
    { id: "module", header: "Module", meta: meta({ width: 170 }), cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "severity", header: "Severity", meta: meta({ width: 110 }), cell: ({ row }) =>
      <Chip tone={SEVERITY_TONE[row.original.severity]}>{row.original.severity}</Chip> },
    { id: "confidence", header: "Confidence", meta: meta({ width: 110, numeric: true, align: "end" }), cell: ({ row }) => pct(row.original.confidence, 0) },
    { id: "occurrences", header: "Occurrences", meta: meta({ width: 120, numeric: true, align: "end" }), cell: ({ row }) => row.original.occurrences.toLocaleString() },
    { id: "seen", header: "Last seen", meta: meta({ width: 120 }), cell: ({ row }) => relativeTime(row.original.last_seen) },
    { id: "rule", header: "", meta: meta({ width: 110 }), cell: ({ row }) => row.original.promoted_to_rule ? <Chip tone="success">is a rule</Chip> : null },
  ], []);

  if (summary.error || patterns.error) return <Banner tone="danger" title="Patterns could not be loaded." />;
  return (
    <Stack gap={6}>
      <Select aria-label="Pattern type" placeholder="All types" value={type} onValueChange={setType}
        options={["anomaly", "drift", "duplicate", "pii"].map((t) => ({ value: t, label: formatModuleName(t) }))} />
      <DataTable<MiningPattern>
        ariaLabel="Mined patterns"
        columns={columns}
        data={list}
        getRowId={(p) => p.id}
        maxHeight={560}
        empty={patterns.isLoading ? "Loading…" : "No patterns mined yet."}
      />
    </Stack>
  );
}
