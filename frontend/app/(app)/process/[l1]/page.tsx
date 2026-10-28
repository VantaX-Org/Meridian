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
  Button, EmptyState, Input, PageHeader, ErrorState, Field, InsightHeader, Mono, Notice, Pill, Select, Tabs, type TabItem, useBreadcrumbTitle } from "@/design";
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
import { DiscoveryStart, NOT_MINABLE, canMine } from "../_components/discovery-start";
import { useRuleNames } from "@/lib/rule-name";
import { readinessHref, useProcessReadiness } from "@/components/process/shared";
import { HandToSteward } from "@/components/process/handoff";
import { NoSystem, fitnessTone, fmtCount, fmtFitness, fmtSeconds, l1Href, useProcessSystem } from "../_components/shared";
import { BodySkeleton, PROCESS_PURPOSE, ProcessFrame, ProcessHeaderTiles, processMeta } from "../_components/process-header";
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
  // Reading cases is viewing (the cases API needs `view`): every role that runs discovery opens them; export stays export_process.
  const canCases = can("view");
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
  // The process is the page's h1, under Processes.
  useBreadcrumbTitle(row && system ? { label: row.name, parent: { label: "As-is processes", href: `/process?system=${encodeURIComponent(system.id)}` } } : null);

  const wrap = (n: ReactNode) => <ProcessFrame>{n}</ProcessFrame>;
  if (systems.isError) return wrap(<ErrorState {...apiErrorState(systems.error)} onRetry={() => systems.refetch()} />);
  if (systems.isSuccess && !system) return wrap(<NoSystem />);
  for (const q of [catalogue, run, model, reference]) {
    if (q.isError) return wrap(<ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />);
  }
  if (!catalogue.data || !reference.data || (runId && !run.data) || (discovered && !model.data)) {
    return wrap(<><PageHeader title={row?.name ?? l1} meta={processMeta(PROCESS_PURPOSE.l1)} /><BodySkeleton rows={4} /></>);
  }
  if (!row) {
    return wrap(<EmptyState title="Process not in the catalogue" detail={`There is no end-to-end process with the code ${l1}. It may have been renamed.`}
      action={<Button render={<Link href={`/process?system=${encodeURIComponent(system!.id)}`}>Open the catalogue</Link>} />} />);
  }

  const r = run.data;
  const isReference = row.coverage === "reference" || r?.coverage === "reference";
  const reason = row.reason ?? r?.stats.reason ?? null;
  const doc = model.data ?? reference.data;
  const crumbs = trail(doc, l1, drill.node);
  const here = crumbs[crumbs.length - 1];
  const node = here && here.id !== l1 ? here.id : null;
  const available = TABS.filter((t) => t !== "cases" || canCases);
  const fallback: Tab = isReference || !discovered ? "reference" : "flow";
  const tab: Tab = (available as readonly string[]).includes(drill.tab) ? (drill.tab as Tab) : fallback;
  const filters: ProcessFilterParams = drill.filters;

  const clearFilters = () => drill.set(Object.fromEntries(Object.keys(filters).map((k) => [k, null])));

  const canRun = can("run_process_discovery");
  // Day one for this process on a system that can mine it, or a system with nothing to mine: the start panel (one
  // action) sits under the header, and a tab with no mined result points back to it.
  const minable = canMine(catalogue.data);
  // An L1 never run reads "reference" in the catalogue too; only a §10 reason means it has no source here.
  const start = !minable || (!row.reason && !row.last_run && !row.in_progress);
  const startPanel = <DiscoveryStart system={system!} rows={catalogue.data} only={l1} />;
  const notDiscovered = isReference && minable && !start ? (
    <EmptyState title="Reference only, not discovered"
      detail={reason ?? "This system has no source tables for this process, so only the SAP reference is shown."}
      action={<Button variant="secondary" onClick={() => drill.set({ tab: "reference" })}>Open the reference</Button>} />
  ) : (
    <EmptyState title="No completed discovery run yet"
      detail={minable ? "Discovery has not produced a flow for this process yet. Read the SAP reference meanwhile." : `${NOT_MINABLE}.`}
      action={<Button variant="secondary" onClick={() => drill.set({ tab: "reference" })}>Open the reference</Button>} />
  );
  const mined = (content: ReactNode) => (discovered && r ? content : notDiscovered);
  const content: Record<Tab, ReactNode> = {
    flow: mined(<FlowView runId={runId} doc={doc} node={node} filters={filters} onDrill={(id) => drill.set({ node: id })}
      onUp={crumbs.length > 1 ? () => drill.set({ node: crumbs.length > 2 ? crumbs[crumbs.length - 2].id : null }) : undefined} />),
    bpmn: mined(<BpmnView doc={doc} node={node} onOpenFlow={() => drill.set({ tab: "flow", case: null })} />),
    variants: mined(<VariantsTable runId={runId} filters={filters} canOpenCases={canCases} onClearFilters={clearFilters}
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
        canRun={canRun && !start} readyHref={readinessHref({ l1 })} />
      {!start && <ProcessHeaderTiles systemId={system!.id} l1={l1} />}
      {start && startPanel}
      <BlockingRule l1={l1} systemId={system!.id} name={row.name} />
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

/**
 * The rule that blocks this process most (the red field failing the most records in the system's latest DQ run),
 * on every tab, with the process owner's one action: hand it to a steward. Nothing when no rule blocks it.
 */
function BlockingRule({ l1, systemId, name }: { l1: string; systemId: string; name: string }) {
  const { byL1, latest } = useProcessReadiness(systemId);
  const ready = byL1.get(l1);
  const w = ready?.worst;
  // The rule's words by the one precedence (lib/rule-name.ts): catalogue name, the readiness row's description, generated.
  const nameOf = useRuleNames([w?.check_id]);
  if (!ready || !w?.check_id) return null;
  const words = nameOf(w.check_id, w.description);
  return (
    <Notice tone="warning" title="Data blocks this process"
      action={<HandToSteward variant="secondary" target={{ checkId: w.check_id, module: ready.module, versionId: latest?.id, process: name, field: w.field }} />}>
      <Mono>{w.check_id}</Mono> fails on {ready.failing.toLocaleString()} {ready.failing === 1 ? "record" : "records"}
      {words ? `: ${words}` : ""}
    </Notice>
  );
}

/** "Data readiness for this process": the DQ-driven readiness of the same L1, in running text. */
function ReadinessLink({ href }: { href: string | undefined }) {
  if (!href) return null;
  return <>. <Link href={href} className="m-ink-accent-ink underline underline-offset-2">Data readiness for this process</Link></>;
}

function Header({ l1, name, systemName, systemId, run, reason, canExport, onExport, canRun, readyHref }: {
  l1: string; name: string; systemName: string; systemId: string; run: DiscoveryRunDetail | undefined; reason: string | null;
  canExport: boolean; onExport: () => void; canRun: boolean;
  /** The readiness page of this L1 (`readinessHref`); undefined when the L1 has no readiness definition. */
  readyHref: string | undefined;
}) {
  const runLink = canRun
    ? <Button render={<Link href={`/process/runs?system=${systemId}&new=1&l1=${l1}`}>Run discovery</Link>} /> : null;
  if (!run) {
    return (
      <>
        <PageHeader title={name} meta={processMeta(PROCESS_PURPOSE.l1, <><Mono>{l1}</Mono> on {systemName}<ReadinessLink href={readyHref} /></>)} actions={runLink} />
        <InsightHeader
          situation={{ sentence: `${name} on ${systemName} has no discovered flow.` }}
          changed={{ sentence: "No completed discovery run." }}
          why={{ sentence: reason ?? "Discovery has not run for this process yet." }}
          next={{ sentence: canRun ? "Run discovery, or read the SAP reference below." : "Read the SAP reference below." }} />
      </>
    );
  }
  const s = run.stats;
  const fitness = s.conformance?.fitness ?? null;
  return (
    <>
      <PageHeader title={name}
        meta={processMeta(PROCESS_PURPOSE.l1, <><Mono>{l1}</Mono> on {systemName}{run.finished_at ? `, discovered ${relativeTime(run.finished_at)}` : ""}<ReadinessLink href={readyHref} /></>)}
        status={<Pill tone={fitnessTone(fitness)}>{`Fits the reference ${fmtFitness(fitness)}`}</Pill>}
        actions={<>
          {canExport && <Button variant="secondary" onClick={onExport} data-tour="process-export">Export</Button>}
          {runLink}
        </>} />
      <InsightHeader
        situation={{ sentence: `${name} on ${systemName}: ${fmtCount(s.cases)} cases, ${fmtCount(s.variants)} variants.` }}
        changed={{ sentence: run.finished_at ? `Discovered ${relativeTime(run.finished_at)}.` : "Discovery in progress." }}
        why={{ sentence: `Cases follow the SAP reference ${fmtFitness(fitness)} of the way (fitness); a typical case takes ${fmtSeconds(s.throughput?.median_seconds)} end to end.`,
          tone: fitnessTone(fitness) }}
        next={{ sentence: "Select a step in the flow to drill into it, or see where cases leave the reference",
          action: { label: "Open conformance", href: l1Href(l1, systemId, run.id, "conformance") } }} />
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
  if (hit.level === 4) return <L5Table l4={hit.item as L4} />;
  return (
    <>
      <Notice tone="info" title="Reference model">The SAP best-practice steps this process is measured against.</Notice>
      <LevelTable doc={doc} parent={hit.item as TreeItem} parentLevel={hit.level as Level} colour={() => undefined}
        actions={READ_ONLY} onOpen={onOpen} editable={false} onBlocked={noop} canDesign={false} />
    </>
  );
}
