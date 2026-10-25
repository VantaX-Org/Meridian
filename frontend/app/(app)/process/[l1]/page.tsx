"use client";

/**
 * Process › one L1 (process-discovery spec §7.1, §7.3, §7.4): the drill from L1 to L4 and its
 * L5 steps over one discovery run. URL: `/process/<l1>?system=&run=&tab=&node=&case=` plus filters.
 * Without `?run=` the page reads the catalogue's latest completed run.
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Button, EmptyState, Input, PageHeader, ErrorState, Field, InsightHeader, Mono, Notice, Pill, Select, Tabs, type TabItem,
} from "@/design";
import { useRole } from "@/hooks/use-role";
import { getCatalogue, getRun, getRunModel, type DiscoveryRunDetail, type ProcessFilterParams } from "@/lib/api/process-discovery";
import { getReference } from "@/lib/api/process-designer";
import { apiErrorState } from "@/lib/error";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { L4, ProcessModelDocument } from "@/types/process-model";
import { locate, type Level, type TreeItem } from "@/app/(app)/insights/process/designer/_components/doc";
import { LevelTable } from "@/app/(app)/insights/process/designer/_components/level-table";
import { BpmnView } from "../_components/bpmn-view";
import { CaseExplorer } from "../_components/case-explorer";
import { ConformanceView } from "../_components/conformance-view";
import { TABS, trail, useProcessDrill, type Tab } from "../_components/drill";
import { ExportDialog } from "../_components/export-dialog";
import { FlowView } from "../_components/flow-view";
import { L5Table } from "../_components/l5-table";
import { NoSystem, fitnessTone, fmtCount, fmtFitness, fmtSeconds, useProcessSystem } from "../_components/shared";
import { BodySkeleton, ProcessFrame } from "../_components/process-header";
import { VariantsTable } from "../_components/variants-table";

const TAB_LABEL: Record<Tab, string> = {
  flow: "Flow", bpmn: "BPMN", variants: "Variants", conformance: "Conformance", cases: "Cases", reference: "Reference",
};
const ALL = "all";
const AUTOMATED = [
  { value: ALL, label: "Manual and automated" }, { value: "true", label: "Automated only" }, { value: "false", label: "Manual only" },
];
const noop = () => {};
const READ_ONLY = { rename: noop, add: noop, remove: noop, move: noop };

export default function ProcessL1Page() {
  const { l1 } = useParams<{ l1: string }>();
  const { can } = useRole();
  const canExport = can("export_process");
  const drill = useProcessDrill();
  const { systems, system } = useProcessSystem();
  const [exporting, setExporting] = useState(false);

  const catalogue = useQuery({
    queryKey: queryKeys.processCatalogue(system?.id ?? ""), queryFn: () => getCatalogue(system!.id), enabled: !!system,
  });
  const row = catalogue.data?.find((r) => r.l1 === l1);
  const latest = row && row.coverage !== "reference" && row.last_run?.status === "completed" ? row.last_run.id : "";
  const runId = drill.run || latest;
  const run = useQuery({ queryKey: queryKeys.processRun(runId), queryFn: () => getRun(runId), enabled: !!runId });
  const discovered = run.data?.status === "completed" && run.data.coverage !== "reference";
  const model = useQuery({
    queryKey: queryKeys.processRunView(runId, "model"), queryFn: () => getRunModel(runId), enabled: !!runId && discovered,
  });
  const reference = useQuery({ queryKey: queryKeys.processReference(), queryFn: getReference });

  const wrap = (n: ReactNode) => <ProcessFrame>{n}</ProcessFrame>;
  if (systems.isError) return wrap(<ErrorState {...apiErrorState(systems.error)} onRetry={() => systems.refetch()} />);
  if (systems.isSuccess && !system) return wrap(<NoSystem />);
  for (const q of [catalogue, run, model, reference]) {
    if (q.isError) return wrap(<ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />);
  }
  if (!catalogue.data || !reference.data || (runId && !run.data) || (discovered && !model.data)) {
    return wrap(<><PageHeader title={row?.name ?? l1} /><BodySkeleton rows={4} /></>);
  }
  if (!row) {
    return wrap(<EmptyState title="This process is not in the catalogue for this system" detail={`${system!.name} lists no level-1 process ${l1}.`}
      action={<Button render={<Link href="/process">Open the catalogue</Link>} />} />);
  }

  const r = run.data;
  const isReference = row.coverage === "reference" || r?.coverage === "reference";
  const reason = row.reason ?? r?.stats.reason ?? null;
  const doc = model.data ?? reference.data;
  const crumbs = trail(doc, l1, drill.node);
  const here = crumbs[crumbs.length - 1];
  const node = here && here.id !== l1 ? here.id : null;
  const available = TABS.filter((t) => t !== "cases" || canExport);
  const fallback: Tab = isReference || !discovered ? "reference" : "flow";
  const tab: Tab = (available as readonly string[]).includes(drill.tab) ? (drill.tab as Tab) : fallback;
  const filters: ProcessFilterParams = drill.filters;

  const clearFilters = () => drill.set(Object.fromEntries(Object.keys(filters).map((k) => [k, null])));

  const notDiscovered = (
    <EmptyState title={isReference ? "Reference, not discovered" : "No completed discovery run yet"}
      detail={isReference ? (reason ?? "This system has no source tables for this process.") : "Run discovery for this process, then come back."}
      action={isReference ? undefined : <Button render={<Link href={`/process?system=${system!.id}`}>Open the catalogue</Link>} />} />
  );
  const mined = (content: ReactNode) => (discovered && r ? content : notDiscovered);
  const content: Record<Tab, ReactNode> = {
    flow: mined(<FlowView runId={runId} doc={doc} node={node} filters={filters} onDrill={(id) => drill.set({ node: id })}
      onUp={crumbs.length > 1 ? () => drill.set({ node: crumbs.length > 2 ? crumbs[crumbs.length - 2].id : null }) : undefined} />),
    bpmn: mined(<BpmnView doc={doc} node={node} onOpenFlow={() => drill.set({ tab: "flow", case: null })} />),
    variants: mined(<VariantsTable runId={runId} filters={filters} canExport={canExport} onClearFilters={clearFilters}
      onOpenCase={(id) => drill.set({ tab: "cases", case: id })} />),
    conformance: mined(<ConformanceView runId={runId} filters={filters} rework={r?.stats.rework} onClearFilters={clearFilters} />),
    cases: mined(<CaseExplorer runId={runId} filters={filters} caseId={drill.caseId} onClearFilters={clearFilters} onOpenCase={(id) => drill.set({ case: id })} />),
    reference: <ReferenceView doc={reference.data} l1={l1} node={node} onOpen={(id) => drill.set({ node: id })} />,
  };
  const items: TabItem[] = available.map((t) => ({ value: t, label: TAB_LABEL[t], content: content[t] }));

  return (
    <ProcessFrame>
      <Header l1={l1} name={row.name} systemName={system!.name} systemId={system!.id} run={discovered ? r : undefined}
        reason={isReference ? reason : null} canExport={canExport && discovered} onExport={() => setExporting(true)}
        canRun={can("run_process_discovery")} tab={tab} />
      <nav aria-label="Process levels">
        <ol className="flex flex-wrap items-center gap-1">
          {crumbs.map((c, i) => (
            <li key={c.id} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden className="m-ink-3">›</span>}
              {i === crumbs.length - 1
                ? <span aria-current="page" className="font-semibold">{c.name}</span>
                : <button type="button" className="ui-link-button" onClick={() => drill.set({ node: c.level === 1 ? null : c.id })}>{c.name}</button>}
            </li>
          ))}
        </ol>
      </nav>
      {discovered && r && <Filters run={r} filters={filters} set={drill.set} />}
      <div data-tour="process-tabs"><Tabs items={items} value={tab} onValueChange={(v) => drill.set({ tab: v, case: null })} /></div>
      {discovered && (
        <ExportDialog open={exporting} onOpenChange={setExporting} runId={runId} l1={l1} node={node}
          nodeName={here?.name ?? l1} filters={filters} />
      )}
    </ProcessFrame>
  );
}

/** The next step each tab offers (one sentence, a full stop). */
const NEXT: Record<Tab, string> = {
  flow: "Click a step to drill into it.",
  bpmn: "Read the diagram, then open the flow to see the cases behind each step.",
  variants: "Read the most frequent paths first; rare variants point to rework.",
  conformance: "Open the steps most often missing or out of order.",
  cases: "Open a case to follow its events in order.",
  reference: "Compare the reference steps with the discovered flow.",
};

function Header({ l1, name, systemName, systemId, run, reason, canExport, onExport, canRun, tab }: {
  l1: string; name: string; systemName: string; systemId: string; run: DiscoveryRunDetail | undefined; reason: string | null;
  canExport: boolean; onExport: () => void; canRun: boolean; tab: Tab;
}) {
  const runLink = canRun
    ? <Button render={<Link href={`/process/runs?system=${systemId}&new=1&l1=${l1}`}>Run discovery</Link>} /> : null;
  if (!run) {
    return (
      <>
        <PageHeader title={name} meta={`${l1} on ${systemName}`} actions={runLink} />
        <InsightHeader
          situation={{ sentence: `${name} on ${systemName} has no discovered flow.` }}
          changed={{ sentence: "No completed discovery run." }}
          why={{ sentence: reason ?? "Discovery has not run for this process yet." }}
          next={{ sentence: "Read the reference model below." }} />
      </>
    );
  }
  const s = run.stats;
  const fitness = s.conformance?.fitness ?? null;
  return (
    <>
      <PageHeader title={name}
        meta={`${fmtCount(s.cases)} cases, ${fmtCount(s.variants)} variants, fitness ${fmtFitness(fitness)}`}
        status={<Pill tone={fitnessTone(fitness)}>{fmtFitness(fitness)}</Pill>}
        actions={<>
          {canExport && <Button variant="secondary" onClick={onExport} data-tour="process-export">Export</Button>}
          {runLink}
        </>} />
      <InsightHeader
        situation={{ sentence: `${name} on ${systemName}: ${fmtCount(s.cases)} cases, ${fmtCount(s.variants)} variants.` }}
        changed={{ sentence: run.finished_at ? `Discovered ${relativeTime(run.finished_at)}.` : "Discovery in progress." }}
        why={{ sentence: `Fitness ${fmtFitness(fitness)} against the reference, median ${fmtSeconds(s.throughput?.median_seconds)} end to end.`,
          tone: fitnessTone(fitness) }}
        next={{ sentence: NEXT[tab] }} />
    </>
  );
}

function Filters({ run, filters, set }: {
  run: DiscoveryRunDetail; filters: ProcessFilterParams; set: (patch: Record<string, string | null>) => void;
}) {
  const text = (k: string) => (typeof filters[k] === "string" ? (filters[k] as string) : "");
  const caseTypes = Object.keys(run.stats.case_types ?? {});
  const org = Object.entries(filters).filter(([k]) => k.startsWith("org."));
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="From"><Input type="date" value={text("from")} onChange={(e) => set({ from: e.target.value || null })} /></Field>
      <Field label="To"><Input type="date" value={text("to")} onChange={(e) => set({ to: e.target.value || null })} /></Field>
      <Field label="Document type">
        <Input value={text("doc_type")} placeholder="Every type" onChange={(e) => set({ doc_type: e.target.value || null })} />
      </Field>
      {caseTypes.length > 1 && (
        <Select label="Case type" value={text("case_type") || ALL} onValueChange={(v) => set({ case_type: v === ALL ? null : v })}
          options={[{ value: ALL, label: "Main case type" }, ...caseTypes.map((c) => ({ value: c, label: c }))]} />
      )}
      <Select label="Automation" value={text("automated") || ALL} onValueChange={(v) => set({ automated: v === ALL ? null : v })}
        options={AUTOMATED} />
      {org.map(([k, v]) => (
        <Button key={k} variant="ghost" onClick={() => set({ [k]: null })}>
          Remove <Mono>{`${k.slice(4)} ${String(v)}`}</Mono>
        </Button>
      ))}
    </div>
  );
}

function ReferenceView({ doc, l1, node, onOpen }: {
  doc: ProcessModelDocument; l1: string; node: string | null; onOpen: (id: string) => void;
}) {
  const hit = locate(doc, node ?? l1);
  if (!hit) return <EmptyState title="Not in the reference model" detail="This step exists only in the discovered flow."
      action={<Button render={<Link href="/insights/process/designer">Open designer</Link>} />} />;
  if (hit.level === 4) return <L5Table l4={hit.item as L4} onOpen={noop} />;
  return (
    <>
      <Notice tone="info" title="Reference model">The SAP best-practice steps this process is measured against.</Notice>
      <LevelTable doc={doc} parent={hit.item as TreeItem} parentLevel={hit.level as Level} colour={() => undefined}
        actions={READ_ONLY} onOpen={onOpen} editable={false} onBlocked={noop} canDesign={false} />
    </>
  );
}
