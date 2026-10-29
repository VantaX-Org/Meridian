"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { buildDrillHref, Button, Card, DataTable, DimensionBars, DomainChip, DrillLink, EmptyState, ErrorState, ExportMenu, HomePage, Mono, ObjectMap, Pill, Select, Skeleton, Stat, type HeatmapCell, Status, Score, useMediaQuery } from "@/design";
import { RuleCell } from "@/components/fix/rule-cell";
import { getObjects } from "@/lib/api/v1/objects";
import { getFindings, getFindingsAggregate } from "@/lib/api/findings";
import { useRunListWith } from "@/hooks/use-run-list";
import { getShellCounts } from "@/lib/api/shell";
import { getWorkSummary } from "@/lib/api/work";
import { COUNT_DEFS } from "@/lib/counts";
import { getSystems } from "@/lib/api/connectivity";
import { usePermissions } from "@/lib/permissions";
import { getConfigLandscape } from "@/lib/api/config-load";
import { getExecutiveReportUrl } from "@/lib/api/reports";
import { downloadAuthenticated } from "@/lib/api/download";
import { useDayOne } from "@/hooks/use-day-one";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { exportFindings } from "@/lib/api/findings";
import { getQueueItems } from "@/lib/api/stewardship";
import { RunAnalysis } from "@/app/(app)/insights/_components/RunAnalysis";
import { useAiProposals } from "@/app/(app)/rules/drafts/ai-proposals";
import { HomeOnboarding } from "@/components/help/home-onboarding";
import { RouteInsight } from "@/components/insight/route-insight";
import { AttentionCard } from "@/components/attention/attention-card";
import { useAttentionCount } from "@/hooks/use-attention";
import { attentionAction } from "@/lib/attention";
import { dqsExplanation, useDqsInputs } from "@/components/insight/dqs-score";
import { verdictSentence, type NarrativeInput } from "@/lib/home-narrative";
import {
  runCap, capSentence, capSummary, cappedReason, dimensionHeatmapCells, runDqs, runDimensions, trend, readinessOf, isBelowTarget, BELOW_TARGET,
  worstObjectsFirst, DIMENSIONS,
} from "@/lib/home-metrics";
import {
  criticalHighHref, criticalHighTotal, isScored, latestPerLineage, runObjectsName, stateDqs, stateObjects, stateRows, stateScopeLine, stateSeries, stateSummary,
  type StateRow,
} from "@/lib/current-state";
import { formatModuleName, plural, round1 } from "@/lib/format";
import { useRuleNames } from "@/lib/rule-name";
import { taskDueText, taskTitle, unnamedTaskChecks } from "../inbox/task-source";
import { previousInLineage, runPageHref } from "@/lib/runs";
import { fixHref } from "@/lib/drill";
import { hrefWithRun, runName, runScopeLabel } from "@/lib/run-scope";
import { reportFilename } from "@/lib/report-filename";
import { StateScope } from "@/components/run-scope";
import { apiErrorState, isListFailure } from "@/lib/error";
import { openJobTray } from "@/lib/job-tray-bus";
import { queryKeys } from "@/lib/query-keys";
import { PERSONA_OPTIONS } from "@/lib/persona";
import { homeActionFor } from "@/lib/home-action";
import { getPredictiveAnalytics } from "@/lib/api/analytics";
import { forecastSentence, overallForecast } from "@/lib/score-forecast";
import { MINE_PARAM, useObjectOwners } from "@/hooks/use-object-owners";
import { OwnerName } from "@/components/owners/OwnerName";
import { FilterChips } from "@/app/(app)/objects/_header";
import type { Version } from "@/types/api";

/** The ledger shows this many objects, then a link to all of them; the heatmap draws the same rows. */
const TABLE_ROWS = 8;

// Chart bundles load after first paint; the skeleton has the chart's final height.
const TREND_HEIGHT = 140;
const HEAT_CELL = 24;
const ScoreTrend = dynamic(() => import("@/components/insight/score-trend").then((m) => m.ScoreTrend), { ssr: false, loading: () => <Skeleton height={TREND_HEIGHT} /> });
const Heatmap = dynamic(() => import("@/design/charts/Heatmap").then((m) => m.Heatmap), { ssr: false, loading: () => <Skeleton height={TABLE_ROWS * (HEAT_CELL + 4) + 32} /> });


/** Header label for a run: never a raw id (same formula as the run selector). */
const runLabel = (v: Version) => runScopeLabel(v);

function WorkRow({ children }: { children: ReactNode }) {
  return <div className="m-stat-grid">{children}</div>;
}

/** Failed or degraded: "unknown" means not tested yet, which is not a failure. */
const isFailing = (s: { health_status?: string | null }) => s.health_status != null && s.health_status !== "healthy" && s.health_status !== "unknown";

/** A ledger row: the object's state row, the rule blocking it (id and plain words) and whether the rule's records can be fixed by a proposal. */
type ObjectRow = StateRow & { blocking?: string; blockingWords?: string; fixable: boolean };

/** Shared by the persona pages (lead/steward/basis): fetches every source the home page needs in parallel
 * and hands the derived pieces to the `HomePage` frame. Without `?run=` every number is the current state: each
 * object at the latest finished run of its lineage (lib/current-state.ts); a `?run=` deep link pins one run.
 * `lists` fills the persona-independent list slot
 * (Basis's `LiveSection`, visible even before the first run finishes). */
export function PersonaHomePage({ role, lists = null }: { role: NarrativeInput["role"]; lists?: ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const dayOne = useDayOne();
  const { active } = useJobs();
  const { can } = useRole();
  const { scopeFilter } = usePermissions();
  const wantsFindings = role !== "basis";
  // A phone: the ledger's verdict is its dot and short label, and the score its figure alone, so the row's name,
  // score, verdict and action all fit the card with nothing under the pinned action.
  const phone = useMediaQuery("(max-width: 639px)");

  // No ?run=: the current state of every object. A ?run= deep link pins one run. The objects list answers the
  // tenant's score bands (and the page's loading and error state).
  const search = useSearchParams();
  const pinnedId = search.get("run");
  const run = pinnedId ?? "latest";
  const objectsQ = useQuery({ queryKey: queryKeys.objects(run), queryFn: () => getObjects(run) });
  const { list: versionsQ, versions: allVersions, resolving } = useRunListWith(pinnedId);
  // Same key as the rail's counts, so this is not a second request; Basis has no inbox tile.
  const shellCountsQ = useQuery({ queryKey: queryKeys.shellCounts(), queryFn: getShellCounts, enabled: wantsFindings });
  // The work list's records to fix per object. Once built it replaces rule failures in the ledger and the map; the key
  // is the one the object screens read (objects/_work.ts), so this is not a second request. An unbuilt or failed
  // read leaves the page on rule failures.
  const workQ = useQuery({
    queryKey: ["work", "summary", pinnedId ?? "latest"],
    queryFn: () => getWorkSummary(pinnedId ?? undefined),
    enabled: wantsFindings,
    staleTime: 30_000,
    retry: false,
    meta: { ignoreError: true },
  });
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const landscapeQ = useQuery({ queryKey: queryKeys.configLandscape(), queryFn: getConfigLandscape });
  // The steward's queue leads the page: the five open items due first.
  const queueQ = useQuery({ queryKey: ["home-inbox-top"], queryFn: () => getQueueItems({ status: "open", limit: 5 }), enabled: role === "steward", meta: { ignoreError: true } });
  const inboxRuleName = useRuleNames(unnamedTaskChecks(queueQ.data?.items ?? []), role === "steward");
  // A reviewer of AI rules who does not write rules (the AI reviewer): their next action is the proposals waiting.
  const reviewsAiRules = can("review_ai_rules") && !can("manage_rules");
  const proposalsQ = useAiProposals(reviewsAiRules);
  const pendingProposals = reviewsAiRules ? proposalsQ.data?.total ?? 0 : 0;
  // The viewer's top to-do item (the card's first row) is the verdict button and the "do next" sentence when it is
  // blocked work, a regression or freshness. The steward's home leads with the queue, so it keeps its own action.
  const attentionTop = useAttentionCount().data?.top ?? null;
  const toDo = role === "steward" ? undefined : attentionAction(attentionTop);
  const toDoNext = toDo && attentionTop ? { sentence: attentionTop.title.replace(/\.$/, ""), href: toDo.href, label: toDo.label } : undefined;
  const finished = allVersions
    .filter(isScored)
    .sort((a, b) => new Date(b.run_at).getTime() - new Date(a.run_at).getTime());
  const pinned = pinnedId ? finished.find((v) => v.id === pinnedId) : undefined;
  // The runs the page summarises, newest first: the pinned run, or the latest run of every lineage.
  const scopeRuns = pinned ? [pinned] : latestPerLineage(finished);
  const newest = scopeRuns[0];
  // Without version_id both endpoints answer the same current state (the latest run of every lineage).
  const findingsQ = useQuery({
    queryKey: ["home-top-findings", pinned?.id ?? "current"],
    queryFn: () => getFindings({ ...(pinned ? { version_id: pinned.id } : {}), sort: "impact", limit: 100 }),
    enabled: wantsFindings && !!newest,
  });
  // Each object's list from its own run, the requests (and cache entries) the Objects page reads: the blocking rule
  // the ledger names is the objects API's, so Home and Objects never name two different rules for one object.
  const objectListsQ = useQueries({
    queries: scopeRuns.map((r) => ({ queryKey: queryKeys.objects(r.id), queryFn: () => getObjects(r.id), retry: false, meta: { ignoreError: true } })),
  });
  const aggregateQ = useQuery({
    queryKey: queryKeys.findingsAggregate(pinned?.id ?? "current"),
    queryFn: () => getFindingsAggregate(pinned?.id),
    enabled: wantsFindings && !!newest,
  });
  // The forecast behind the trend's band (Insights > Forecast): every object's projection, current state only.
  const forecastQ = useQuery({ queryKey: queryKeys.analyticsPredictive(), queryFn: () => getPredictiveAnalytics(), enabled: !pinnedId, retry: false, meta: { ignoreError: true } });
  const owners = useObjectOwners();
  const mine = search.get(MINE_PARAM) === "1";
  // The weights and costliest rules the hero's "Data quality score ⓘ" breakdown reads (components/insight/dqs-score.tsx).
  const dqsInputs = useDqsInputs(pinned?.id, !!aggregateQ.data);

  // Seed the run-keyed objects list so opening an object from home needs no second fetch.
  const runId = objectsQ.data?.run_id;
  useEffect(() => {
    if (runId && objectsQ.data) qc.setQueryData(queryKeys.objects(runId), objectsQ.data);
  }, [qc, runId, objectsQ.data]);

  const loading = dayOne.status === "loading" || objectsQ.isLoading;
  const erroring = dayOne.status === "error" || isListFailure(objectsQ);
  // The message comes from whichever read failed; Retry reads all four again (objects, runs, systems, landscape).
  const failure = isListFailure(objectsQ) ? objectsQ.error : dayOne.error;

  if (loading) return <HomePage persona={role} state="loading" />;
  if (erroring) {
    return (
      <HomePage
        persona={role}
        state="error"
        error={{ error: failure, onRetry: () => { void objectsQ.refetch(); void versionsQ.refetch(); void systemsQ.refetch(); void landscapeQ.refetch(); } }}
      />
    );
  }

  if (dayOne.step !== null) {
    const versions = allVersions;
    return (
      <HomePage
        persona={role}
        state="empty"
        journey={{
          systemsConnected: (systemsQ.data ?? []).length > 0,
          configLoaded: (landscapeQ.data?.loaded ?? 0) > 0,
          extracted: versions.length > 0,
          complete: false,
          step: dayOne.step,
        }}
        lists={lists}
        onboarding={<HomeOnboarding />}
        cells={<RouteInsight doNext={toDoNext} />}
        emptyActions={<>
          {can("upload") && dayOne.step.secondary?.href !== "/import" && dayOne.step.href !== "/import"
            ? <Button variant="secondary" render={<Link href="/import">Import a file</Link>} /> : null}
          {(systemsQ.data ?? []).length > 0 ? <RunAnalysis variant="secondary" /> : null}
          {(systemsQ.data ?? []).length > 0 && can("run_process_discovery")
            ? <Button variant="secondary" render={<Link href="/process/runs?new=1">Run process discovery</Link>} /> : null}
        </>}
      />
    );
  }

  // dayOne says a finished run exists but it hasn't landed in this cache yet: treat as loading rather than crash.
  // A ?run= older than the run list is still being read by id: wait for it rather than show the current state.
  if (!newest || (pinnedId && !pinned && resolving)) return <HomePage persona={role} state="loading" />;

  // A module-scoped user sees only in-scope objects (and so only those heatmap rows, scores and counts).
  const state = stateObjects(scopeRuns, scopeFilter.modules);
  const merged = stateSummary(state);
  const runOf = new Map(state.map((o) => [o.module, o.run]));
  const runIdOf = (module: string) => runOf.get(module)?.id ?? newest.id;
  const bands = objectsQ.data?.thresholds;
  const objects = stateRows(state, bands, aggregateQ.data, finished);
  const sentence = verdictSentence(objects);
  // The objects list and its filters: the pinned run, or (no ?run=) the objects page's own latest.
  const objectsHref = (params: Record<string, string> = {}) => {
    const q = new URLSearchParams({ ...(pinned ? { run: pinned.id } : {}), ...params }).toString();
    return q ? `/objects?${q}` : "/objects";
  };

  // The previous state swaps the newest run for the one before it in its own lineage (same system, or uploads of
  // the same objects), so the delta is the change that run made and never compares one object with another.
  const previous = previousInLineage(newest, finished);
  const dqs = runDqs(merged);
  const previousDqs = previous ? stateDqs(stateObjects(scopeRuns.map((r) => (r.id === newest.id ? previous : r)), scopeFilter.modules)) : null;
  // Pinned: the run's lineage. Current state: every object at its latest run as of each run, so the last step is the delta.
  const trendPoints = pinned ? trend(finished, pinned) : stateSeries(finished, scopeFilter.modules);
  const cap = runCap(merged);
  const findings = (findingsQ.data?.findings ?? []).filter((f) => (!scopeFilter.modules || scopeFilter.modules.has(f.module)) && f.version_id === runOf.get(f.module)?.id);
  const scored = worstObjectsFirst(objects);
  const worst = scored[0];
  // Objects below target: at risk or no-go (go only at the target); "not ready" is kept for wave readiness.
  const belowTarget = objects.filter(isBelowTarget);
  const belowTargetTone = objects.some((o) => o.readiness === "fail") ? "no-go" : belowTarget.length ? "at-risk" : "go";
  const systems = systemsQ.data ?? [];
  const activeSystems = systems.filter((s) => s.is_active);

  const action = pendingProposals > 0 && !toDo
    ? { label: `Review ${plural(pendingProposals, "proposal")}`, href: "/rules/drafts?tab=ai" }
    : homeActionFor({
    persona: role,
    can,
    belowTarget: belowTarget.length,
    objectsHref: (filtered) => objectsHref(filtered ? { readiness: BELOW_TARGET } : {}),
    worstHref: worst ? `/objects/${worst.module}?run=${worst.run_id}` : undefined,
    systemFailing: activeSystems.some(isFailing),
    attention: toDo,
  });
  // The ledger's row action fixes only for a role that can work a fix (apply it, or approve it); else it opens.
  const canFix = can("apply") || can("approve");

  const capReason = cappedReason(merged);
  // The cap in the one unit every page uses (lib/home-metrics.ts capSentence): the critical failing rules over
  // tolerance, each once, and the objects they cap out of those measured. "M more" comes from the same total.
  const capInfo = capSummary(merged);
  const reasonRules = capInfo.named;
  // A reason that names no rule (older runs) names the distinct critical rules of the loaded findings instead.
  const criticalRules = reasonRules.length
    ? reasonRules
    : [...new Map(findings.filter((f) => f.severity === "critical").map((f) => [f.check_id, { check_id: f.check_id, module: f.module }])).values()];
  const capHead = capSentence(capInfo);
  const namedRules = criticalRules.slice(0, 2);
  const moreRules = capInfo.rules - namedRules.length;
  const capLine = capHead ? (
    <>
      {capHead}
      {namedRules.length > 0 && (
        <>
          {": "}
          {namedRules.map((f, i) => (
            <span key={f.check_id}>
              {i > 0 && ", "}
              <DrillLink href={buildDrillHref({ object: f.module, ruleId: f.check_id, run: runIdOf(f.module) })}><Mono>{f.check_id}</Mono></DrillLink>
            </span>
          ))}
          {moreRules > 0 && ` and ${moreRules} more`}
        </>
      )}
    </>
  ) : undefined;

  const dims = runDimensions(merged);
  const dimensionStrip = (
    <div data-testid="home-dimensions">
      <h2 className="m-text-meta m-ink-3 pb-1">Dimensions</h2>
      <DimensionBars
        label="Dimension scores"
        items={DIMENSIONS.map((d) => ({
          key: d,
          label: formatModuleName(d),
          score: dims?.[d] ?? null,
          href: dims?.[d] == null ? undefined : objectsHref({ dimension: d }),
        }))}
      />
    </div>
  );

  // Each object's blocking rule is the one the Objects page names: the objects API's `blocking_rule_id` from the list
  // of the object's own run. Only while that list has not loaded (or failed) does Home fall back to the first rule
  // its cap reason names, then its highest-impact critical finding. The words are the finding's message, else the
  // list's rule name.
  const listed = new Map<string, NonNullable<typeof objectsQ.data>["objects"][number]>();
  scopeRuns.forEach((r, i) => {
    for (const o of objectListsQ[i]?.data?.objects ?? []) if (runOf.get(o.module)?.id === r.id) listed.set(o.module, o);
  });
  const blockingByModule = new Map<string, string>();
  for (const [module, o] of listed) if (o.blocking_rule_id) blockingByModule.set(module, o.blocking_rule_id);
  for (const r of reasonRules) if (!listed.has(r.module) && !blockingByModule.has(r.module)) blockingByModule.set(r.module, r.check_id);
  for (const f of findings) if (f.severity === "critical" && !listed.has(f.module) && !blockingByModule.has(f.module)) blockingByModule.set(f.module, f.check_id);
  const findingOf = (module: string, checkId: string) => findings.find((f) => f.module === module && f.check_id === checkId);
  const wordsOf = (module: string, checkId: string): string | undefined => {
    const words = findingOf(module, checkId)?.details?.message ?? (listed.get(module)?.blocking_rule_id === checkId ? listed.get(module)?.blocking_rule_name : undefined);
    return words?.replace(/\.$/, "") || undefined;
  };
  const isFixable = (module: string, checkId: string | undefined): boolean => {
    const f = checkId ? findingOf(module, checkId) : undefined;
    return !!f && (Object.keys(f.value_fix_map ?? {}).length > 0 || (f.record_fixes ?? []).length > 0);
  };
  // The ledger: what moves the score. Ranked by records to fix once the work list is built, else by rule failures
  // (an object whose records are not attributed sorts last), then by score.
  const workBuilt = workQ.data?.built === true;
  const toFixOf = new Map((workQ.data?.objects ?? []).map((w) => [w.module, w.statuses.to_fix ?? 0]));
  const measure = (o: { module: string; affected_records: number | null }): number | null => (workBuilt ? toFixOf.get(o.module) ?? 0 : o.affected_records);
  const measureDef = workBuilt ? COUNT_DEFS.records_to_fix : COUNT_DEFS.rule_failures;
  const ranked = (role === "steward" ? objects.filter((o) => o.failing_checks > 0) : objects)
    .filter((o) => o.composite_score !== null && (!mine || owners.isMine(o.module)))
    .sort((a, b) => (measure(b) ?? -1) - (measure(a) ?? -1) || (a.composite_score ?? 0) - (b.composite_score ?? 0));
  const rows: ObjectRow[] = ranked.slice(0, TABLE_ROWS).map((o) => {
    const blocking = blockingByModule.get(o.module);
    return { ...o, blocking, blockingWords: blocking ? wordsOf(o.module, blocking) : undefined, fixable: isFixable(o.module, blocking) };
  });
  const systemName = (v: Version) => systems.find((x) => x.id === v.metadata?.system_id)?.name;
  const objectHref = (o: Pick<StateRow, "module" | "run_id">) => `/objects/${o.module}?run=${o.run_id}`;

  const columns: ColumnDef<ObjectRow>[] = [
    {
      accessorKey: "label", header: "Object",
      cell: ({ row: { original: o } }) => <span className="inline-flex items-center gap-2 sm:whitespace-nowrap">{o.label}<span className="max-sm:hidden"><DomainChip moduleId={o.module} /></span></span>,
    },
    {
      id: "blocking", header: "Blocking rule", enableSorting: false, meta: { priority: "low" },
      // The shared RuleCell: the id whole on its own line (never broken mid-id), the words under it in two lines.
      cell: ({ row: { original: o } }) => o.blocking ? (
        <RuleCell id={o.blocking} fallback={o.blockingWords} href={buildDrillHref({ object: o.module, ruleId: o.blocking, run: o.run_id })} className="[max-width:46ch]" />
      ) : "—",
    },
    {
      id: "owner", header: "Owner", meta: { priority: "low" }, accessorFn: (o) => owners.nameOf(o.module) ?? "",
      cell: ({ row: { original: o } }) => <OwnerName name={owners.nameOf(o.module)} status={owners.status} />,
    },
    // Records to fix once the work list is built (distinct records). Before that, rule failures: summed over the
    // object's failing rules, so a record failing two rules counts twice.
    { id: "affected_records", header: measureDef.label, accessorFn: (o) => measure(o) ?? -1, meta: { numeric: true, priority: "low" }, cell: ({ row: { original: o } }) => measure(o)?.toLocaleString() ?? "—" },
    {
      id: "dqs", header: COUNT_DEFS.score.label, meta: { numeric: true },
      accessorFn: (o) => o.composite_score ?? -1,
      cell: ({ row: { original: o } }) => o.composite_score === null ? "—" : phone
        ? <span className="m-numeric">{o.composite_score.toFixed(1)}</span>
        : <Score size="sm" value={o.composite_score} bands={bands} />,
    },
    {
      id: "readiness", header: COUNT_DEFS.verdict.label,
      accessorFn: (o) => o.composite_score ?? -1,
      cell: ({ row: { original: o } }) => o.composite_score === null ? <Pill>Not analysed</Pill> : <Status kind="verdict" value={readinessOf(o.composite_score, bands)} variant={phone ? "dot" : "soft"} />,
    },
    {
      id: "action", header: "", enableSorting: false,
      cell: ({ row: { original: o } }) => o.fixable && canFix
        // The blocking rule's records in the run that found them, the rule this row names.
        ? <Link href={fixHref({ run: o.run_id, module: o.module, check: o.blocking })} className="m-ink-accent" aria-label={`Fix ${o.label}`}>Fix</Link>
        : <Link href={objectHref(o)} className="m-ink-accent" aria-label={`Open ${o.label}`}>Open</Link>,
    },
  ];

  const objectsCard = role === "basis" ? undefined : (
    <Card
      title="What moves the score"
      meta={workBuilt
        ? `Ranked by ${COUNT_DEFS.records_to_fix.label.toLowerCase()}, now that the work list is built. It replaces ${COUNT_DEFS.rule_failures.label.toLowerCase()}: ${COUNT_DEFS.rule_failures.hint.charAt(0).toLowerCase()}${COUNT_DEFS.rule_failures.hint.slice(1)}`
        : `Ranked by ${COUNT_DEFS.rule_failures.label.toLowerCase()}`}
      padding="sm"
      actions={owners.hasMine || mine ? (
        <FilterChips label="Show" value={mine ? "1" : null} options={[{ value: "1", label: "My objects" }]} onChange={(v) => {
          const params = new URLSearchParams(search.toString());
          if (v) params.set(MINE_PARAM, "1"); else params.delete(MINE_PARAM);
          const q = params.toString();
          router.replace(q ? `/home/${role}?${q}` : `/home/${role}`);
        }} />
      ) : undefined}
    >
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(o) => o.module}
        onRowClick={(o) => router.push(objectHref(o))}
        rowHref={objectHref}
        height="auto"
        dense
        hideSearch
        hideToolbar
        tableId="home-objects"
      />
      <div className="m-text-body px-3 pt-2">
        <Link href={objectsHref(mine ? { [MINE_PARAM]: "1" } : {})} className="m-ink-accent">{mine ? "All my objects" : `All ${objects.length.toLocaleString()} objects`}</Link>
      </div>
    </Card>
  );

  // The object map: one tile per object, its area what is failing (the ledger's count: records to fix, else rule failures), so the
  // objects with the most to fix are the largest and come first; its colour the verdict, its number the score.
  const mapItems = objects.map((o) => {
    const failing = measure(o) ?? 0;
    return {
      id: o.module,
      label: o.label,
      href: objectHref(o),
      score: o.composite_score,
      records: failing,
      verdict: o.composite_score == null ? ("neutral" as const) : readinessOf(o.composite_score, bands),
      meta: plural(failing, measureDef.unit),
    };
  });
  const objectMap = mapItems.length ? <ObjectMap items={mapItems} columns={8} rowHeight={52} label={`Objects by ${measureDef.label.toLowerCase()} and verdict`} unit={workBuilt ? "records" : "rule failures"} /> : undefined;

  // Every object with a scored run (not only the ledger's top rows): the grid is the whole picture by dimension.
  const heatRows = scored;
  const heatCells = dimensionHeatmapCells(heatRows, merged, bands);
  // The grid prints each score and tints it by readiness: the number carries the meaning, the hue repeats it.
  const heatTone = new Map(heatCells.map((c) => [`${c.row}:${c.col}`, c.tone]));
  // The hero's trend: the score over runs with the target and, in the current state, the forecast's band.
  const forecast = pinned ? [] : overallForecast(forecastQ.data?.forecasts ?? [], new Map(state.flatMap((o) => (o.summary.composite_score == null ? [] : [[o.module, o.summary.composite_score] as const]))));
  const forecastLine = forecastSentence(forecast);
  const trendCard = (
    <div className="flex flex-col gap-1">
      <p className="m-text-meta m-ink-3">
        {pinned ? "Score over runs of the same source" : "Score over runs, all objects each at its latest run by then"}
        {forecastLine ? `. ${forecastLine}` : ""}
      </p>
      {trendPoints.length < 2 ? (
        <EmptyState variant="inline" title="The trend starts with the second run" action={can("trigger_sync") ? <Link href="/systems" className="m-ink-accent">Run extraction</Link> : undefined} />
      ) : (
        <ScoreTrend
          points={trendPoints}
          target={bands?.target}
          forecast={forecast}
          onPointClick={(point) => { if (point.runId) router.push(runPageHref(point.runId)); }}
          height={TREND_HEIGHT}
          label={pinned ? "DQS over runs" : "DQS of all objects over runs"}
        />
      )}
    </div>
  );
  const heatmapCard = role !== "basis" && heatCells.length > 0 ? (
        <Card title="Dimensions by object" meta="– Not measured" padding="sm">
          <Heatmap
            rows={heatRows.map((o) => o.label)}
            cols={DIMENSIONS.map(formatModuleName)}
            cells={heatCells.map((c) => ({ row: c.row, col: c.col, value: c.value }))}
            tone={(c) => heatTone.get(`${c.row}:${c.col}`)}
            cellSize={HEAT_CELL}
            onPointClick={(cell: HeatmapCell) => {
              const object = heatRows.find((o) => o.label === cell.row);
              const dimension = DIMENSIONS.find((d) => formatModuleName(d) === cell.col);
              if (object) router.push(buildDrillHref({ object: object.module, dimension, run: object.run_id }));
            }}
          />
        </Card>
  ) : undefined;

  const counts = shellCountsQ.data;
  const unhealthy = activeSystems.filter(isFailing).length;
  const notLoaded = Math.max((landscapeQ.data?.total ?? 0) - (landscapeQ.data?.loaded ?? 0), 0);
  // Failing critical and high checks of every object in scope ("blocking" is the insights overview's own set).
  const criticalHigh = criticalHighTotal(state);
  // The findings behind the count: one run's findings tab, or the current-state findings on the Insights overview.
  const criticalHighLink = criticalHighHref(scopeRuns);
  const countsReady = !!counts;
  const queueItems = queueQ.data?.items ?? [];
  const inboxCard = role === "steward" ? (
    <Card title="Inbox" meta={countsReady ? `${plural(counts.inbox, "open item")}` : undefined} padding="sm">
      {queueQ.isLoading ? <Skeleton height={120} /> : queueQ.isError ? (
        <div data-testid="home-inbox-error">
          <ErrorState title="The inbox did not load" message={apiErrorState(queueQ.error).title} onRetry={() => void queueQ.refetch()} />
        </div>
      ) : queueItems.length === 0 ? (
        <EmptyState variant="inline" title="Nothing waits in the inbox" action={<Link href="/fix?sugg=1" className="underline-offset-2 hover:underline">{`Open records ${COUNT_DEFS.suggested.label.toLowerCase()}`}</Link>} />
      ) : (
        <ul className="flex flex-col" data-testid="home-inbox-items">
          {queueItems.map((it) => {
            const due = taskDueText(it);
            return (
              <li key={it.id} className="flex items-center gap-3 border-b py-2 [border-color:var(--m-line)] m-text-body">
                <Link href={`/inbox?focus=${encodeURIComponent(it.id)}`} className="flex-1 underline-offset-2 hover:underline">{taskTitle(it, null, inboxRuleName)}</Link>
                {due.overdue ? <Pill tone="no-go">{due.text}</Pill> : <span className="m-ink-3">{due.text}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  ) : null;
  const work =
    role === "lead" ? (
      <WorkRow>
        <Stat label={COUNT_DEFS.objects_below_target.label} value={belowTarget.length} hint={`of ${objects.length}`} tone={belowTargetTone} href={objectsHref({ readiness: BELOW_TARGET })} />
        <Stat label={COUNT_DEFS.blocking_rules.label} value={criticalHigh.toLocaleString()} hint={criticalHigh ? undefined : "none"} tone={criticalHigh ? "no-go" : "go"} href={criticalHighLink} />
        <Stat label={COUNT_DEFS.inbox_open.label} value={countsReady ? counts.inbox : "—"} hint={countsReady && !counts.inbox ? "clear" : undefined} href="/inbox" />
      </WorkRow>
    ) : role === "steward" ? (
      <>
        <WorkRow>
          <Stat label={COUNT_DEFS.inbox_open.label} value={countsReady ? counts.inbox : "—"} hint={countsReady && !counts.inbox ? "clear" : undefined} href="/inbox" />
          {/* counts.fix is the latest run's records to fix, or null when no work list is built: then the tile opens Fix work, which offers to build it. */}
          <Stat
            label={COUNT_DEFS.records_to_fix.label}
            value={countsReady && counts.fix != null ? counts.fix.toLocaleString() : "—"}
            hint={!countsReady ? undefined : counts.fix == null ? "no work list for the latest run" : !counts.fix ? "clear" : undefined}
            href="/fix"
          />
          <Stat
            label="Worst object"
            value={worst?.composite_score?.toFixed(1) ?? "—"}
            hint={worst?.label}
            tone={worst?.composite_score != null ? readinessOf(worst.composite_score, bands) : undefined}
            href={worst ? `/objects/${worst.module}?run=${worst.run_id}` : undefined}
          />
        </WorkRow>
        {inboxCard}
      </>
    ) : (
      <WorkRow>
        <Stat label="Systems unhealthy" value={unhealthy} hint={`of ${activeSystems.length} active`} tone={unhealthy ? "no-go" : "go"} href="/systems" />
        <Stat label="Configuration missing" value={notLoaded} hint={`of ${landscapeQ.data?.total ?? 0} systems`} tone={notLoaded ? "at-risk" : "go"} href="/systems?config=not_loaded" />
        <Stat label="Jobs running" value={active.length} hint={active.length ? undefined : "idle"} onClick={openJobTray} />
      </WorkRow>
    );

  return (
    <HomePage
      persona={role}
      state="ready"
      workFirst={role === "steward"}
      opsFirst={role === "basis"}
      explain={dqsExplanation({ agg: aggregateQ.data, versionId: pinned?.id, cap: cap?.cap, capReason }, dqsInputs)?.explain}
      verdict={{
        dqs,
        cap: cap?.cap,
        criticals: cap ? capInfo.rules : undefined,
        bands,
        delta: dqs != null && previousDqs != null ? round1(dqs - previousDqs) : null,
        previousLabel: previous ? (pinned ? runLabel(previous) : "before the latest run") : undefined,
        firstRun: !previous,
        firstRunLabel: pinned ? undefined : `First run of ${runObjectsName(newest)}`,
        sentence,
        capLine,
        action,
      }}
      run={{ id: newest.id, label: pinned ? runLabel(pinned) : stateScopeLine(objects.length, newest.run_at), runAt: newest.run_at }}
      scope={
        <StateScope
          runs={latestPerLineage(finished)}
          pinned={pinned}
          objectCount={objects.length}
          systemName={systemName}
          hrefFor={(id) => hrefWithRun(`/home/${role}`, search, id)}
        />
      }
      aside={objectMap}
      dimensions={dimensionStrip}
      objects={objectsCard}
      trend={trendCard}
      heatmap={heatmapCard}
      work={work}
      lists={lists}
      onboarding={<HomeOnboarding />}
      cells={<RouteInsight doNext={toDoNext} />}
      nextAction={<AttentionCard />}
      headerActions={<>
        <RunAnalysis variant="secondary" />
        <Select
          label="View as"
          value={role}
          onValueChange={(r) => router.push(hrefWithRun(`/home/${r}`, search, pinnedId))}
          options={PERSONA_OPTIONS}
        />
        {can("export") ? (
          <span data-tour="home-export" className="inline-flex"><ExportMenu
            options={[
              ...(role === "steward" ? [{ format: "xlsx" as const, label: "Failing records (Excel)", run: () => exportFindings("xlsx", { ...(pinned ? { version_id: pinned.id } : {}), sort: "severity" }) }] : []),
              // The executive report is one run's: without ?run= it is the newest run's, and says so.
              {
                format: "pdf",
                label: pinned ? "Executive report (PDF)" : "Executive report, latest run (PDF)",
                run: () => downloadAuthenticated(getExecutiveReportUrl(newest.id), reportFilename("executive", runName(newest))),
              },
            ]}
          /></span>
        ) : null}
      </>}
    />
  );
}
