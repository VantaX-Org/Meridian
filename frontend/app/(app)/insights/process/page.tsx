"use client";

/**
 * Insights → Process: readiness (L1-L5 process readiness, scored from DQ
 * status on each field) and map (mined activity graph for one module of the
 * latest complete version). Ported from the legacy `/business-process` and
 * `/process` Aurora pages onto @/design.
 *
 * Deviations from the legacy pages (see task-22-report.md for the full list):
 * - The L1-L5 hierarchy drill-down (aurora's `ProcessReport`) is replaced with
 *   a flat L3 "gates" table plus plain blocking-findings/recommendations
 *   lists, since no @/design equivalent exists for that component.
 * - The process map's `ProcessGraph`/`ProcessGraphEmergence` is replaced with
 *   @/design's force-directed `Graph`.
 */

import { oneOf, useUrlState } from "@/hooks/use-url-state";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, buildDrillHref, Card, DataTable, Drawer, EmptyState, ErrorState, Graph, Mono, Notice, Pill, Select, Skeleton, RowAction, RowActionButton, Stat, actionColumn, type InsightHeaderProps, Status } from "@/design";
import { LedgerHead } from "@/components/mdm/ledger";
import { HandToSteward, type HandoffTarget } from "@/components/process/handoff";
import { apiErrorState } from "@/lib/error";
import { PROCESS_MODULES, asIsHref, blockingSentence, currentProcessObjects, distinctReds, firstWithProcesses, redsByRule, isCompleteVersion, l1Fields, l4Fields, modulesOfL1, red, score, sev, systemOfVersion, useFindingHref, useLatestVersion, verdictOf } from "@/components/process/shared";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { useSystemScope } from "@/lib/permissions";
import { getBusinessProcess, getConfigImpact, getSystems } from "@/lib/api/connectivity";
import { getConfigAwareScore, type ConfigAwareL1, type ConfigAwareTally, type ConfiguredIn } from "@/lib/api/config-load";
import { getMiningGraph } from "@/lib/api/process-mining";
import { drillLabel, fixHref } from "@/lib/drill";
import { formatModuleName, plural } from "@/lib/format";
import { runName, runScopeLabel } from "@/lib/run-scope";
import { queryKeys } from "@/lib/query-keys";
import { useRunList } from "@/hooks/use-run-list";
import { useInsightScope, withScope } from "../_components/useInsightScope";
import { useCurrentState } from "../_components/useCurrentState";
import { PAGE_PURPOSE } from "../_components/InsightViews";

import type { BusinessProcessL3, ConfigImpactResult } from "@/types/api";

/** Loading body at final height: stat row, one card (the four-sentence header is the page frame's). */
function ViewSkeleton({ stats }: { stats: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <div className="flex gap-6 flex-wrap">
        {Array.from({ length: stats }, (_, i) => <Stat key={i} label="" value="" loading />)}
      </div>
      <CardSkeleton height={240} />
    </div>
  );
}

/** The four sentences a view publishes to the page frame. */
type ViewInsight = Pick<InsightHeaderProps, "situation" | "changed" | "why" | "next" | "loading">;

/**
 * Other finished runs whose objects carry a process definition, offered when the chosen run's object has none.
 * Selecting one follows `?run=` like every other insight page.
 */
function RunsWithProcess({ exclude }: { exclude?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const q = useRunList();
  const withProcess = (q.data?.versions ?? [])
    .filter((v) => v.id !== exclude && isCompleteVersion(v) && Object.keys(v.dqs_summary ?? {}).some((m) => PROCESS_MODULES.has(m)));
  const options = withProcess
    .map((v) => ({ value: v.id, label: `${runName(v)}, ${Object.keys(v.dqs_summary ?? {}).filter((m) => PROCESS_MODULES.has(m)).map(formatModuleName).join(", ")}` }));
  if (q.isLoading) return <Skeleton height={32} width={280} />;
  if (!options.length) {
    return <EmptyState title="No finished run covers a procure to pay or order to cash object yet" action={openLink("Open runs", "/runs")} />;
  }
  return (
    <Select
      label="Runs with a process definition"
      placeholder="Choose a run"
      value=""
      options={options}
      onValueChange={(id) => router.replace(withScope(`${pathname}?${search.toString()}`, { run: id }))}
    />
  );
}

/**
 * The rule library at the rule's object, for a check with no finding to open in this run. `/rules/<id>` takes the
 * rules row id, not a check id, so it is not a target here.
 */
const ruleHref = (module: string) => `/rules?${new URLSearchParams({ module })}`;

const openLink = (label: string, href: string) => <Button variant="secondary" render={<Link href={href}>{label}</Link>} />;

const ORDER = { blocked: 0, degraded: 1, ok: 2 } as const;

/* ---------- Readiness ---------- */

const fmt1 = (n: number) => n.toFixed(1);
const records = (n: number) => plural(n, "record");
/** "A", "A and B", "A, B and C". */
const andList = (xs: readonly string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** "87%" or, with nothing mapped to score, the reason. */
const pctLabel = (n: number | null) => (n == null ? "No fields mapped" : `${n}%`);

function ConfiguredInText({ items }: { items: ConfiguredIn[] }) {
  return (
    <>
      {items.map((c, i) => (
        <span key={i}>
          {i > 0 ? "; " : ""}
          {c.kind === "img" ? "IMG: " : ""}
          {c.path}
          {c.tcode ? <> (<Mono>{c.tcode}</Mono>)</> : null}
        </span>
      ))}
    </>
  );
}

const NOT_APPLICABLE_PREVIEW = 3;

/** Shared across every `NotApplicableList` on the page, so the deep link and the back button restore which blocks were expanded. */
function useExpandedBlocks() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const expandedTitles = useMemo(() => new Set((search.get("na") ?? "").split(",").filter(Boolean)), [search]);
  const toggle = (title: string) => {
    const next = new Set(expandedTitles);
    if (next.has(title)) next.delete(title); else next.add(title);
    const params = new URLSearchParams(search.toString());
    if (next.size) params.set("na", Array.from(next).join(",")); else params.delete("na");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  return { expandedTitles, toggle };
}

function NotApplicableList({ title, t, findingHref }: {
  title: string; t: ConfigAwareTally; findingHref: (module: string, checkId: string) => string | undefined;
}) {
  const { expandedTitles, toggle } = useExpandedBlocks();
  const expanded = expandedTitles.has(title);
  if (!t.not_applicable_rules.length) {
    return t.not_applicable ? (
      <p className="m-text-body m-ink-2">
        Does not apply ({t.not_applicable.toLocaleString()}): {t.not_applicable_reasons.map((x) => `${x.reason} (${x.count})`).join("; ")}.
      </p>
    ) : null;
  }
  const shown = expanded ? t.not_applicable_rules : t.not_applicable_rules.slice(0, NOT_APPLICABLE_PREVIEW);
  return (
    <div className="flex flex-col gap-1">
      <p className="m-text-body m-ink-2">Does not apply ({t.not_applicable.toLocaleString()}):</p>
      <ul className="flex flex-col gap-1">
        {shown.map((na) => (
          <li key={na.check_id} className="flex items-center gap-3">
            {na.severity ? <Status kind="severity" value={na.severity} /> : <Pill>Unrated</Pill>}
            <Link className="flex-1 underline" href={findingHref(na.module, na.check_id) ?? ruleHref(na.module)}>
              <Mono>{na.check_id}</Mono>
            </Link>
            <span className="m-text-body m-ink-2">
              {na.reason ?? "Not used by the loaded configuration"}
            </span>
          </li>
        ))}
      </ul>
      {t.not_applicable_rules.length > NOT_APPLICABLE_PREVIEW ? (
        <button type="button" className="m-text-body underline self-start" onClick={() => toggle(title)}>
          {expanded ? "Show fewer" : `Show all ${t.not_applicable_rules.length}`}
        </button>
      ) : null}
    </div>
  );
}

function RulesBlock({ title, t, findingHref, configuredIn, run }: {
  title: string; t: ConfigAwareTally; findingHref: (module: string, checkId: string) => string | undefined;
  configuredIn?: ConfiguredIn[];
  /** The run the tally scores, so a failing rule opens its records in that run. */
  run?: string;
}) {
  const failing = t.applicable - t.passes;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-text-h font-semibold m-ink">{title}</h3>
      <p className="m-text-body m-ink-2">
        {t.score === null ? "No rules apply" : `${fmt1(t.score)}% pass: ${t.passes.toLocaleString()} of ${t.applicable.toLocaleString()} rules that apply`}, {failing.toLocaleString()} failing
      </p>
      {configuredIn?.length ? (
        <p className="m-text-body m-ink-2">
          Where this is configured: <ConfiguredInText items={configuredIn} />
        </p>
      ) : null}
      {t.top_failing.length ? (
        <ul className="flex flex-col gap-1" aria-label={`Top failing rules, ${title}`}>
          {t.top_failing.slice(0, 5).map((f) => (
            <li key={f.check_id} className="flex items-center gap-3">
              {f.severity ? <Status kind="severity" value={f.severity} /> : <Pill>Unrated</Pill>}
              <Link
                className="flex-1 underline"
                href={fixHref({ run, module: f.module, check: f.check_id })}
                aria-label={drillLabel({ count: f.affected_count, what: "failing records", check: f.check_id, module: f.module })}
              >
                <Mono>{f.check_id}</Mono>
              </Link>
              <span className="m-text-body">{records(f.affected_count)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <NotApplicableList title={title} t={t} findingHref={findingHref} />
    </div>
  );
}

interface BlockingRow { id: string; severity: ReturnType<typeof sev>; checkId: string | null; fields: string[]; title: string; steps: string[]; affected: number; href: string;
  /** The rule as a hand-off to a steward (process owners hold handoff_rule, not apply); none for a field with no rule. */
  handoff: HandoffTarget | null }
const blockingColumns: ColumnDef<BlockingRow>[] = [
  { id: "severity", header: "Severity", cell: ({ row }) => <Status kind="severity" value={row.original.severity} variant="solid" /> },
  // One row per rule: its id, and the fields it fails (each once) beneath it.
  {
    id: "rule", header: "Rule", accessorFn: (b) => b.checkId ?? "",
    cell: ({ row }) => (
      <span className="flex flex-col">
        <Mono>{row.original.checkId ?? row.original.fields[0]}</Mono>
        {row.original.checkId ? <span className="m-text-meta m-ink-3">{row.original.fields.map((f, i) => <span key={f}>{i > 0 ? ", " : null}<Mono>{f}</Mono></span>)}</span> : null}
      </span>
    ),
  },
  { id: "finding", header: "What fails", cell: ({ row }) => <span className="line-clamp-2 [min-width:14rem]" title={row.original.title}>{row.original.title}</span> },
  { id: "gate", header: "Process steps", accessorFn: (b) => b.steps.join(", ") },
  { accessorKey: "affected", header: "Failing records", meta: { numeric: true }, cell: ({ row }) => row.original.affected.toLocaleString() },
  actionColumn<BlockingRow>((b) => (
    <span className="flex items-center gap-1">
      {b.href ? <RowAction href={b.href} label={`Fix ${b.checkId ?? b.fields[0]}`}>Fix</RowAction> : null}
      {b.handoff ? <HandToSteward target={b.handoff} /> : null}
    </span>
  ), ""),
];

function FeaturesList({ results }: { results: ConfigImpactResult[] }) {
  const sorted = useMemo(
    () => [...results].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.total_affected_records - a.total_affected_records),
    [results],
  );
  if (!sorted.length) return <EmptyState title="No features assessed yet" detail="Features are assessed after a configuration load." action={<Button variant="secondary" render={<Link href="/systems">Open systems</Link>} />} />;
  return (
    <Card title="SAP features at risk">
      <ul className="flex flex-col gap-2">
        {sorted.slice(0, 20).map((r) => (
          <li key={`${r.system}:${r.feature}`} className="flex items-center gap-3 border-b py-2 [border-color:var(--m-line)]">
            <Status kind="verdict" value={r.status} />
            <span className="flex-1">{r.feature}</span>
            <span className="m-text-body m-ink-2">{r.system}</span>
            <span className="m-text-body">{records(r.total_affected_records)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReadinessView({ onInsight }: { onInsight: (i: ViewInsight | null) => void }) {
  const dayOne = useDayOne();
  const { latest: pinnedRun, isLoading: runLoading, error: versionsError, refetch: refetchVersions } = useLatestVersion();
  // No ?run=: the current state, every object at its own latest run (Home's scope), so every process object is on
  // offer and each is read from its own run. ?run= reads that run's objects.
  const { mode } = useInsightScope();
  const isCurrent = mode === "current";
  const state = useCurrentState();
  const versionsLoading = isCurrent ? state.loading : runLoading;
  const processObjects = useMemo(() => (isCurrent ? currentProcessObjects(state.objects) : []), [isCurrent, state.objects]);
  const modules = useMemo(
    () => (isCurrent ? processObjects.map((o) => o.module) : pinnedRun?.dqs_summary ? Object.keys(pinnedRun.dqs_summary) : []),
    [isCurrent, processObjects, pinnedRun],
  );
  const [objectChoice, setObject] = useUrlState("object", "");
  const [l1Choice, setL1] = useUrlState("l1", "");
  // The current state without a chosen object reads every process object (each from its own run, the same reads the
  // page makes for one) and opens on the first that has a process document.
  const probe = isCurrent && !objectChoice && !l1Choice;
  const probes = useQueries({
    queries: (probe ? processObjects : []).map((o) => ({
      queryKey: queryKeys.businessProcess(o.run.id, o.module),
      queryFn: () => getBusinessProcess(o.run.id, o.module),
      retry: false,
      meta: { ignoreError: true },
    })),
  });
  const firstReady = probe ? firstWithProcesses(modules, probes) : undefined;
  // `?l1=` names the L1; the object read must carry that L1's definition, since the API returns one object's processes.
  // A `?object=` of another L1 (or one this run lacks) moves to the first object of that L1 the run covers.
  const l1Objects = useMemo(() => (l1Choice ? modulesOfL1(l1Choice, modules) : []), [l1Choice, modules]);
  const object = l1Objects.length
    ? oneOf(objectChoice, l1Objects, l1Objects[0])
    : oneOf(objectChoice, modules, (probe ? firstReady : undefined) ?? (modules.find((m) => PROCESS_MODULES.has(m)) || modules[0] || ""));
  const probing = probe && firstReady === undefined && modules.length > 0;
  // The run the object is read from: its own latest run in the current state, else the pinned run.
  const latest = isCurrent ? processObjects.find((o) => o.module === object)?.run : pinnedRun;

  const bp = useQuery({
    queryKey: queryKeys.businessProcess(latest?.id, object),
    queryFn: () => getBusinessProcess(latest!.id, object),
    enabled: !!latest && !!object && !probing,
    retry: false,
    meta: { ignoreError: true },
  });
  const impact = useQuery({
    queryKey: queryKeys.configImpact(latest?.id),
    queryFn: () => getConfigImpact(latest!.id),
    enabled: !!latest,
    retry: false,
    meta: { ignoreError: true },
  });
  const findingHref = useFindingHref(latest?.id);
  const systemScope = useSystemScope();
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, meta: { ignoreError: true }, select: systemScope });
  const [systemChoice, setSystem] = useUrlState("system", "all");
  const systemId = systemChoice === "all" ? undefined : systemChoice;
  const aware = useQuery({
    queryKey: queryKeys.configAwareScore(latest?.id, systemId),
    queryFn: () => getConfigAwareScore({ version_id: latest!.id, system_id: systemId }),
    enabled: !!latest,
    retry: false,
    meta: { ignoreError: true },
  });

  const processes = useMemo(() => bp.data ?? [], [bp.data]);
  // A named L1 the loaded object does not carry is never swapped for another L1: the page says so instead.
  const l1Missing = !!l1Choice && processes.length > 0 && !processes.some((p) => p.l1_id === l1Choice);
  const l1 = l1Choice ? processes.find((p) => p.l1_id === l1Choice) : processes[0];

  // Derived once here so the page frame's four sentences can be published from an effect below.
  const all = useMemo(() => (l1 ? l1Fields(l1) : []), [l1]);
  const pct = score(all);
  const blocking = red(all);
  const gates = useMemo<{ l3: BusinessProcessL3; score: number | null; blocking: number }[]>(() => (l1 ? l1.l2_groups.flatMap((l2) =>
    l2.l3_processes.map((l3) => {
      const f3 = l3.l4_subprocesses.flatMap(l4Fields);
      return { l3, score: score(f3), blocking: red(f3) };
    })) : []), [l1]);
  const blockedGates = gates.filter((g) => g.blocking).length;
  const rulesHref = `/objects/${object}?run=${encodeURIComponent(latest?.id ?? "")}&tab=rules`;
  // One row per failing rule (components/process/shared.ts redsByRule): a rule several steps write is listed once,
  // naming its steps and fields, never once per step with the same records.
  const blockingRules = useMemo<BlockingRow[]>(() => (l1 ? redsByRule(l1).map((r) => ({
    id: r.key, severity: r.severity, checkId: r.checkId, fields: r.fields, title: r.title, steps: r.steps, affected: r.affected,
    href: r.checkId ? findingHref(object, r.checkId) ?? buildDrillHref({ object, ruleId: r.checkId, run: latest?.id }) : rulesHref,
    handoff: r.checkId ? { checkId: r.checkId, module: object, versionId: latest?.id, process: l1.l1_name, field: r.fields[0] } : null,
  })) : []), [l1, object, findingHref, latest?.id, rulesHref]);
  // Each blocking field once, however many steps write it (components/process/shared.ts distinctReds).
  const blockingWhy = blockingSentence(all);
  const firstHref = blockingRules[0]?.href ?? rulesHref;
  const worst = [...gates].sort((a, b) => b.blocking - a.blocking)[0];
  const loading = versionsLoading || probing || bp.isLoading || dayOne.status === "loading";

  useEffect(() => {
    if (loading) { onInsight({ loading: true, situation: { sentence: "" }, changed: { sentence: "" }, why: { sentence: "" }, next: { sentence: "" } }); return; }
    if (!latest || !l1) {
      const noProcessObject = isCurrent && !modules.length;
      onInsight({
        situation: {
          sentence: noProcessObject ? "No object of the current state carries a process definition."
            : !latest ? "No finished run to read process readiness from."
            : bp.isError ? `${formatModuleName(object)}'s process readiness could not be read.`
            : l1Missing ? `This run has no ${l1Choice} object, so ${l1Choice} readiness cannot be read from it.`
              : `${formatModuleName(object)} has no L1 to L5 process definition.`,
          tone: "neutral",
        },
        changed: { sentence: isCurrent ? "Readiness is scored per step from each object's own latest run." : "Readiness is scored per step from the run you choose." },
        why: { sentence: "Only procure to pay and order to cash objects carry a process definition." },
        next: noProcessObject || !latest
          ? { sentence: "Run an analysis of a procure to pay or order to cash object.", action: { label: "Open runs", href: "/runs" } }
          : { sentence: isCurrent ? "Choose another process object." : "Pick a run that covers a process object." },
      });
      return;
    }
    onInsight({
      situation: {
        sentence: `${blockedGates} of ${plural(gates.length, "process step")} blocked, ${pct == null ? "no fields mapped" : `${pct}% of fields pass`} in ${l1.l1_name}.`,
        tone: verdictOf(blockedGates, pct),
      },
      changed: { sentence: `From ${runScopeLabel(latest)}; it changes when the next run of this object finishes.` },
      why: { sentence: blockingWhy ?? "No field blocks go-live.", tone: blockingWhy ? "no-go" : "go" },
      next: blockedGates && worst
        ? { sentence: `Clear the failing fields in ${worst.l3.l3_name}.`, action: { label: "Open failing records", href: firstHref ?? withScope(`/objects/${object}`, { run: latest.id, tab: "rules" }) } }
        : { sentence: "No step is blocked; keep an eye on the amber fields.", action: { label: "Open failing rules", href: withScope("/insights/rules", { run: latest.id, module: object }) } },
    });
  }, [loading, isCurrent, modules.length, bp.isError, latest, l1, l1Missing, l1Choice, object, blockedGates, gates.length, pct, blockingWhy, worst, firstHref, onInsight]);

  if (loading) return <ViewSkeleton stats={4} />;
  if (versionsError) return <ErrorState {...apiErrorState(versionsError)} onRetry={() => void refetchVersions()} />;
  if (!latest && dayOne.status === "error") return <ErrorState {...apiErrorState(dayOne.error)} onRetry={dayOne.refetch} />;
  if (isCurrent && !modules.length && state.objects.length) {
    return <EmptyState title="No process object in the current state" detail="Readiness covers objects with an L1 to L5 definition: procure to pay (vendors, purchasing, materials, general ledger) and order to cash (customers, sales orders, receivables). Run an analysis of one of them."
      action={<Button variant="secondary" render={<Link href="/runs">Open runs</Link>} />} />;
  }
  if (!latest) {
    return <EmptyState title="No process readiness yet" detail={dayOne.step?.detail ?? "Readiness is read from the latest completed analysis. Sync a system and run an analysis."}
      action={<DayOneAction step={dayOne.step} fallbackHref="/systems" fallbackLabel="Open systems" />} />;
  }

  const objectPicker = (
    <Select label="Object" value={object} options={modules.map((m) => ({ value: m, label: formatModuleName(m) }))}
      onValueChange={(m) => { setObject(m); setL1(""); }} />
  );

  // In the current state every process object is already on offer, each from its own run: no run to choose.
  const pickers = <div className="flex gap-3 items-center flex-wrap">{objectPicker}{isCurrent ? null : <RunsWithProcess exclude={latest.id} />}</div>;

  if (bp.isError) {
    return (
      <div className="flex flex-col gap-4">
        {pickers}
        <ErrorState {...apiErrorState(bp.error)} onRetry={() => void bp.refetch()} />
      </div>
    );
  }

  if (l1Missing) {
    return (
      <div className="flex flex-col gap-4">
        {pickers}
        <Notice tone="warning" title={`No ${l1Choice} object in this run`}>
          {`${runScopeLabel(latest)} covers ${formatModuleName(object)}, which carries ${processes.map((p) => p.l1_name).join(" and ")}, not ${l1Choice}. Choose a run above that covers a ${l1Choice} object, or read the process this object carries.`}
        </Notice>
        <div>
          <Button variant="secondary" onClick={() => setL1("")}>{`Show ${processes[0].l1_name}`}</Button>
        </div>
      </div>
    );
  }

  if (!l1) {
    const other = isCurrent ? modules.find((m) => m !== object) : undefined;
    return (
      <div className="flex flex-col gap-4">
        {pickers}
        <EmptyState
          title={`${formatModuleName(object)} has no process definition`}
          detail={isCurrent
            ? `${runScopeLabel(latest)} produced no process document for ${formatModuleName(object)}. Choose another process object above; each is read from its own latest run.`
            : "Readiness covers objects with an L1 to L5 definition: procure to pay (vendors, purchasing, materials, general ledger) and order to cash (customers, sales orders, receivables). Choose one of the runs above that covers such an object."}
          action={other
            ? <Button variant="secondary" onClick={() => { setObject(other); setL1(""); }}>{`Show ${formatModuleName(other)}`}</Button>
            : <Button variant="secondary" render={<Link href="/runs">Open runs</Link>} />}
        />
      </div>
    );
  }

  const awareL1: ConfigAwareL1 | undefined = aware.data?.processes.find((p) => p.l1 === l1.l1_id || p.name === l1.l1_name);

  // One item per failing rule, most records first, naming the steps it blocks and the fields it fails; a rule three
  // steps write is cleared once. Steps with no red field but amber ones follow as reviews.
  const amberSteps = l1.l2_groups.flatMap((l2) => l2.l3_processes
    .filter((l3) => l3.overall_readiness !== "green" && distinctReds(l3.l4_subprocesses.flatMap(l4Fields)).length === 0));
  const recommendations = [
    ...redsByRule(l1).map((r) => ({
      id: r.key,
      label: `Clear ${r.checkId ?? r.fields[0]} in ${andList(r.steps)}`,
      // The rule's failing records (the same records in every step that writes the field), and the fields it fails.
      rationale: `${records(r.affected)} ${r.affected === 1 ? "fails" : "fail"} it on ${andList(r.fields)}`,
    })),
    ...amberSteps.map((l3) => ({ id: l3.l3_id, label: `Review the amber fields in ${l3.l3_name}`, rationale: "No field is red; amber fields have partial pass rates." })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3 items-center flex-wrap">
        {objectPicker}
        {processes.length > 1 ? (
          <Select label="Process" value={l1.l1_id} options={processes.map((p) => ({ value: p.l1_id, label: p.l1_name }))} onValueChange={setL1} />
        ) : null}
        {(systems.data?.length ?? 0) > 1 ? (
          <Select
            label="System"
            value={systemChoice}
            options={[{ value: "all", label: "All systems" }, ...(systems.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
            onValueChange={setSystem} />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Status kind="verdict" value={verdictOf(blocking, pct)} variant="solid" />
        <span className="m-text-h font-semibold m-ink">{l1.l1_name}</span>
        <span className="m-text-body m-ink-2">
          L1 is the end-to-end process, L2 to L4 the areas and steps inside it, L5 the fields each step writes; a blocked
          step cannot run while one of its fields fails.{" "}
          <Link href={asIsHref(l1.l1_id, systemId ?? (latest ? systemOfVersion(latest) : undefined))}
            className="m-ink-accent-ink underline underline-offset-2">See how this process actually runs</Link>
        </span>
      </div>

      {/* The ledger: the blocking rules ranked by failing records, each once with its steps, and its one action. The table is its own sheet, never a card in a card. */}
      <section aria-label="Blocking rules" data-tour="process-readiness">
        <LedgerHead title="Blocking rules" meta={`Rules whose fields stop a process step, each once with the steps it blocks, most records first${blockingRules.length > 10 ? `; top 10 of ${blockingRules.length.toLocaleString()}` : ""}`} />
        {blockingRules.length ? (
          <DataTable columns={blockingColumns} data={blockingRules.slice(0, 10)} getRowId={(b) => b.id} hideToolbar height="auto" />
        ) : <Card><EmptyState title="Nothing blocks go-live" detail="No mandatory field fails in this process." action={<Button variant="secondary" render={<Link href={withScope("/insights/rules", { run: latest.id, module: object })}>Open failing rules</Link>} />} /></Card>}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Process steps" meta={`${l1.l1_name}: the share of fields passing in each step`}>
          <ul className="flex flex-col gap-2">
            {gates.map((g) => (
              <li key={g.l3.l3_id} className="flex items-center gap-3 border-b py-2 [border-color:var(--m-line)]">
                <Status kind="verdict" value={verdictOf(g.blocking, g.score)} />
                <span className="flex-1">{g.l3.l3_name}</span>
                <span className="m-text-body">{pctLabel(g.score)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="What to clear first">
          {recommendations.length ? (
            <ul className="flex flex-col gap-2">
              {recommendations.map((r) => (
                <li key={r.id} className="border-b py-2 [border-color:var(--m-line)]">
                  <div>{r.label}</div>
                  <div className="m-text-body m-ink-2">{r.rationale}</div>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Nothing to clear" detail="Every step is green." action={<Button variant="secondary" render={<Link href={withScope("/insights/rules", { run: latest.id, module: object })}>Open failing rules</Link>} />} />}
        </Card>
      </div>

      {awareL1 ? (
        <Card title="Rules by step" meta="How many rules apply to each part of the process, and which fail">
          <div id="applicability" className="flex flex-col gap-3">
            {!aware.data?.config_load ? (
              <p className="m-text-body m-ink-2">
                All {awareL1.applicable.toLocaleString()} rules apply by default. Load the system&apos;s configuration to leave out rules it does not use.{" "}
                <Link href="/systems" className="m-ink-accent underline underline-offset-2">Open systems</Link>
              </p>
            ) : null}
            <RulesBlock title={awareL1.name} t={awareL1} findingHref={findingHref} run={latest?.id} />
            {awareL1.l2.map((l2) => (
              <RulesBlock key={l2.l2} title={l2.name} t={l2} findingHref={findingHref} configuredIn={l2.configured_in} run={latest?.id} />
            ))}
          </div>
        </Card>
      ) : null}

      {impact.data ? <FeaturesList results={impact.data.results} /> : null}
    </div>
  );
}

/* ---------- Map ---------- */

const MAPPED = new Set(["accounts_payable", "accounts_receivable", "fi_gl", "material_master", "mm_purchasing", "sd_customer_master", "sd_sales_orders"]);

function MapView({ onInsight }: { onInsight: (i: ViewInsight | null) => void }) {
  const dayOne = useDayOne();
  const { latest, isLoading, error, refetch } = useLatestVersion();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const analysed = useMemo(() => (latest?.dqs_summary ? Object.keys(latest.dqs_summary) : []), [latest]);
  const modules = useMemo(() => analysed.filter((m) => MAPPED.has(m)), [analysed]);
  const moduleParam = search.get("module");
  const active = oneOf(moduleParam ?? "", modules, modules[0] ?? "") || null;
  const setModule = (m: string) => {
    const next = new URLSearchParams(search.toString());
    next.set("module", m);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const node = search.get("node");
  const setNode = (id: string | null) => {
    const next = new URLSearchParams(search.toString());
    if (id) next.set("node", id); else next.delete("node");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const graphQ = useQuery({
    queryKey: queryKeys.processMiningGraph(latest?.id, active),
    queryFn: () => getMiningGraph(latest!.id, active!),
    enabled: !!latest && !!active,
  });
  const activities = graphQ.data?.activities ?? [];
  const variants = graphQ.data?.variants ?? [];
  const bottlenecks = activities.filter((a) => a.step_status !== "green").sort((a, b) => b.affected_records - a.affected_records);
  const blockedSteps = activities.filter((a) => a.step_status === "red").length;
  const degradedSteps = activities.filter((a) => a.step_status === "amber").length;
  const picked = node ? activities.find((a) => a.id === node) ?? null : null;

  const graphNodes = useMemo(() => (graphQ.data?.activities ?? []).map((a) => ({ id: a.id, label: a.label, size: a.affected_records })), [graphQ.data]);
  const graphEdges = useMemo(() => (graphQ.data?.transitions ?? []).map((t, i) => ({
    id: `${t.from}-${t.to}-${i}`, source: t.from, target: t.to, label: t.weight.toLocaleString(),
  })), [graphQ.data]);
  const failingRecords = bottlenecks.reduce((a, b) => a + b.affected_records, 0);
  const worstStep = bottlenecks[0];

  useEffect(() => {
    if (isLoading || dayOne.status === "loading" || graphQ.isLoading) { onInsight({ loading: true, situation: { sentence: "" }, changed: { sentence: "" }, why: { sentence: "" }, next: { sentence: "" } }); return; }
    if (!latest || !modules.length) {
      onInsight({
        situation: { sentence: !latest ? "No finished run to build a process map from." : "No analysed object has a process map.", tone: "neutral" },
        changed: { sentence: "The map is mined from the run you choose." },
        why: { sentence: "Purchasing, sales, vendor, customer, material and G/L objects carry a map." },
        next: { sentence: "Analyse one of those objects.", action: { label: "Open runs", href: "/runs" } },
      });
      return;
    }
    onInsight({
      situation: {
        sentence: `${plural(activities.length, "step")} mapped for ${formatModuleName(active ?? "")}, ${blockedSteps} blocked and ${degradedSteps} degraded, across ${plural(variants.length, "variant")}.`,
        tone: blockedSteps ? "no-go" : degradedSteps ? "at-risk" : "go",
      },
      changed: { sentence: `From ${runScopeLabel(latest)}; it changes when the next run of this object finishes.` },
      why: { sentence: bottlenecks.length ? `${records(failingRecords)} fail in ${plural(bottlenecks.length, "step")}.` : "Every mapped step passes its checks.", tone: bottlenecks.length ? "no-go" : "go" },
      next: worstStep
        ? { sentence: `Open ${worstStep.label}, the worst step.`, action: { label: "Open step", onClick: () => setNode(worstStep.id) } }
        : { sentence: "No step needs work.", action: { label: "Open objects", href: "/objects" } },
    });
    // setNode is derived from router state and stable enough for this effect's purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, dayOne.status, graphQ.isLoading, latest, modules.length, active, activities.length, blockedSteps, degradedSteps, variants.length, bottlenecks.length, failingRecords, worstStep?.id, onInsight]);

  if (isLoading || dayOne.status === "loading") return <ViewSkeleton stats={4} />;
  if (error) return <ErrorState {...apiErrorState(error)} onRetry={() => void refetch()} />;
  if (!latest && dayOne.status === "error") return <ErrorState {...apiErrorState(dayOne.error)} onRetry={dayOne.refetch} />;
  if (!latest) {
    return <EmptyState title="No process map yet"
      detail={dayOne.step?.detail ?? "The map is mined from a completed analysis."}
      action={<DayOneAction step={dayOne.step} fallbackHref="/systems" fallbackLabel="Open systems" />} />;
  }
  if (!modules.length) {
    return <EmptyState title="No object with a process map" detail="Analyse a purchasing, sales, vendor, customer, material or G/L object to see one." action={<Button variant="secondary" render={<Link href="/runs">Open runs</Link>} />} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {modules.length > 1 ? (
        <Select label="Object" value={active ?? ""} options={modules.map((m) => ({ value: m, label: formatModuleName(m) }))} onValueChange={setModule} />
      ) : null}

      {graphQ.isLoading ? <ViewSkeleton stats={4} /> : graphQ.error ? (
        <ErrorState {...apiErrorState(graphQ.error)} onRetry={() => void graphQ.refetch()} />
      ) : (
        <>
          {activities.length ? (
            <Graph nodes={graphNodes} edges={graphEdges} onNodeClick={setNode} height={320} />
          ) : <EmptyState title="No process steps found for this object" detail="The run holds no documents to build the map from." action={openLink("Open runs", "/runs")} />}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Failing steps" meta={`Steps whose records fail checks, most records first${bottlenecks.length > 8 ? `; top 8 of ${bottlenecks.length.toLocaleString()}` : ""}`}>
              {bottlenecks.length ? (
                <DataTable
                  columns={[
                    { id: "status", header: "Status", cell: ({ row }) => <Status kind="verdict" value={row.original.step_status} /> },
                    { id: "step", header: "Step", accessorFn: (b) => b.label },
                    { id: "records", header: "Records", meta: { numeric: true }, accessorFn: (b) => b.affected_records, cell: ({ row }) => records(row.original.affected_records) },
                    actionColumn<(typeof bottlenecks)[number]>((b) => <RowActionButton label={`Open ${b.label}`} onClick={() => setNode(b.id)}>Open</RowActionButton>, ""),
                  ] as ColumnDef<(typeof bottlenecks)[number]>[]}
                  data={bottlenecks.slice(0, 8)}
                  getRowId={(b) => b.id}
                  hideToolbar height="auto"
                />
              ) : <EmptyState title="Every step passes its checks" detail="No record in a mapped step fails a rule." action={openLink("Open failing rules", withScope("/insights/rules", { run: latest.id, module: active ?? undefined }))} />}
            </Card>
            <Card title="Variants" meta="The different paths a document takes through the process">
              {variants.length ? (
                <ul className="flex flex-col gap-2">
                  {variants.slice(0, 8).map((v) => (
                    <li key={v.id} className="flex items-center gap-3 border-b py-2 [border-color:var(--m-line)]">
                      <Status kind="verdict" value={v.readiness} />
                      <span className="flex-1">{v.label}</span>
                      <span className="m-text-body">{plural(v.activity_count, "step")}</span>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="No variants found for this object" detail="Every document followed the same path, or none was found." action={openLink("Open the object", withScope(`/objects/${active ?? ""}`, { run: latest.id }))} />}
            </Card>
          </div>
        </>
      )}

      <Drawer open={!!picked} onOpenChange={(o) => { if (!o) setNode(null); }} title={picked?.label ?? "Step"}>
        {picked ? (
          <div className="flex flex-col gap-2">
            <Status kind="verdict" value={picked.step_status} />
            <p>
              {picked.tcode ? <><Mono>{picked.tcode}</Mono>, </> : null}{picked.affected_records.toLocaleString()} rule failures, {picked.finding_count.toLocaleString()} failing rules
              {picked.avg_pass_rate != null ? `, ${Math.round(picked.avg_pass_rate)}% pass rate` : ""}.
            </p>
            {active ? (
              <p><Link href={withScope(`/objects/${active}`, { run: latest.id, tab: "rules" })} className="m-ink-accent underline underline-offset-2">Open the failing rules</Link></p>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

/* ---------- Page ---------- */

export default function ProcessInsightsPage() {
  const [tabRaw, setTab] = useUrlState("tab", "readiness");
  const tab = (["readiness", "map"] as string[]).includes(tabRaw) ? tabRaw : "readiness";
  const { run, mode } = useInsightScope();
  const { latest } = useLatestVersion();
  // The active view publishes its four sentences; the frame renders them once, above the tabs.
  const [insight, setInsight] = useState<ViewInsight | null>(null);
  const onInsight = useCallback((i: ViewInsight | null) => setInsight(i), []);
  const placeholder: ViewInsight = { loading: true, situation: { sentence: "" }, changed: { sentence: "" }, why: { sentence: "" }, next: { sentence: "" } };
  // Readiness takes the frame's scope: the current state (each object at its own run) or one run. The map mines the
  // latest run alone, so it names that run.
  const readiness = tab === "readiness";
  return (
    <InsightFrame
      title="Process data readiness"
      purpose={PAGE_PURPOSE["/insights/process"]}
      scope={readiness}
      meta={readiness ? undefined : latest ? `As of ${runScopeLabel(latest)}` : "No finished run yet"}
      run={readiness && mode === "current" ? undefined : run ?? latest?.id}
      insight={insight ?? placeholder}
    >
      {/* The frame already draws the view's tab strip; Readiness and Map switch with a pair of toggle buttons, not a second strip. */}
      <div className="flex flex-col gap-4">
        <div role="group" aria-label="Show" className="flex items-center gap-2">
          {([["readiness", "Readiness"], ["map", "Map"]] as const).map(([value, label]) => (
            <Button key={value} size="sm" variant={tab === value ? "secondary" : "ghost"} aria-pressed={tab === value} onClick={() => setTab(value)}>
              {label}
            </Button>
          ))}
        </div>
        {tab === "map" ? <MapView onInsight={onInsight} /> : <ReadinessView onInsight={onInsight} />}
      </div>
    </InsightFrame>
  );
}
