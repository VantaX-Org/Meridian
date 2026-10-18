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
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Drawer, EmptyState, ErrorState, Graph, Mono, Pill, Select, Skeleton, Stat, Tabs, type InsightHeaderProps, Status } from "@/design";
import { apiErrorState } from "@/lib/error";
import { isCompleteVersion, useFindingHref, useLatestVersion } from "@/components/process/shared";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { useSystemScope } from "@/lib/permissions";
import { getBusinessProcess, getConfigImpact, getSystems } from "@/lib/api/connectivity";
import { getConfigAwareScore, type ConfigAwareL1, type ConfigAwareTally, type ConfiguredIn } from "@/lib/api/config-load";
import { getMiningGraph } from "@/lib/api/process-mining";
import { formatModuleName, formatDate, plural, runOptionLabels } from "@/lib/format";
import { runScopeLabel } from "@/lib/run-scope";
import { queryKeys } from "@/lib/query-keys";
import { useRunList } from "@/hooks/use-run-list";
import { useInsightScope, withScope } from "../_components/useInsightScope";

/** Objects with an L1 to L5 definition (sap/process_definitions.py: procure to pay and order to cash). */
export const PROCESS_MODULES = new Set(["accounts_payable", "fi_gl", "material_master", "mm_purchasing", "accounts_receivable", "sd_customer_master", "sd_sales_orders"]);
import type {
  BusinessProcessL1, BusinessProcessL3, BusinessProcessL4, BusinessProcessL5Field, ConfigImpactResult,
} from "@/types/api";

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
  const names = runOptionLabels(withProcess);
  const options = withProcess
    .map((v) => ({ value: v.id, label: `${names.get(v.id) ?? formatDate(v.run_at, "datetime")}, ${Object.keys(v.dqs_summary ?? {}).filter((m) => PROCESS_MODULES.has(m)).map(formatModuleName).join(", ")}` }));
  if (q.isLoading) return <Skeleton height={32} width={280} />;
  if (!options.length) return <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>No finished run covers a procure to pay or order to cash object yet.</p>;
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

const openLink = (label: string, href: string) => <Button variant="secondary" render={<Link href={href}>{label}</Link>} />;

/* ---------- shared field-scoring helpers (ported from components/process/readiness.tsx) ---------- */

const l4Fields = (l4: BusinessProcessL4): BusinessProcessL5Field[] => l4.activities.flatMap((a) => a.fields);
function fields(l1: BusinessProcessL1): BusinessProcessL5Field[] {
  return l1.l2_groups.flatMap((l2) => l2.l3_processes.flatMap((l3) => l3.l4_subprocesses.flatMap(l4Fields)));
}
const score = (fs: BusinessProcessL5Field[]) =>
  fs.length ? Math.round((fs.filter((f) => f.dq_status === "green").length / fs.length) * 100) : 100;
const red = (fs: BusinessProcessL5Field[]) => fs.filter((f) => f.dq_status === "red").length;
const sev = (f: BusinessProcessL5Field): "critical" | "high" | "medium" =>
  f.mandatory ? "critical" : (f.pass_rate ?? 100) < 50 ? "high" : "medium";

const ORDER = { blocked: 0, degraded: 1, ok: 2 } as const;

/* ---------- Readiness ---------- */

const fmt1 = (n: number) => n.toFixed(1);
const records = (n: number) => plural(n, "record");

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
      <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
        Does not apply ({t.not_applicable.toLocaleString()}): {t.not_applicable_reasons.map((x) => `${x.reason} (${x.count})`).join("; ")}.
      </p>
    ) : null;
  }
  const shown = expanded ? t.not_applicable_rules : t.not_applicable_rules.slice(0, NOT_APPLICABLE_PREVIEW);
  return (
    <div className="flex flex-col gap-1">
      <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>Does not apply ({t.not_applicable.toLocaleString()}):</p>
      <ul className="flex flex-col gap-1">
        {shown.map((na) => (
          <li key={na.check_id} className="flex items-center gap-3">
            {na.severity ? <Status kind="severity" value={na.severity} /> : <Pill>Unrated</Pill>}
            <Link className="flex-1 underline" href={findingHref(na.module, na.check_id) ?? "/analyse"}>
              <Mono>{na.check_id}</Mono>
            </Link>
            <span className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
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

function RulesBlock({ title, t, findingHref, configuredIn }: {
  title: string; t: ConfigAwareTally; findingHref: (module: string, checkId: string) => string | undefined;
  configuredIn?: ConfiguredIn[];
}) {
  const failing = t.applicable - t.passes;
  return (
    <div className="flex flex-col gap-1">
      <h4 className="font-medium">{title}</h4>
      <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
        {t.score === null ? "No rules apply" : `${fmt1(t.score)}%, ${t.passes.toLocaleString()} of ${t.applicable.toLocaleString()} apply`}, {failing.toLocaleString()} failing
      </p>
      {configuredIn?.length ? (
        <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
          Where this is configured: <ConfiguredInText items={configuredIn} />
        </p>
      ) : null}
      {t.top_failing.length ? (
        <ul className="flex flex-col gap-1" aria-label={`Top failing rules, ${title}`}>
          {t.top_failing.slice(0, 5).map((f) => (
            <li key={f.check_id} className="flex items-center gap-3">
              {f.severity ? <Status kind="severity" value={f.severity} /> : <Pill>Unrated</Pill>}
              <Link className="flex-1 underline" href={findingHref(f.module, f.check_id) ?? "/analyse"}>
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
          <li key={`${r.system}:${r.feature}`} className="flex items-center gap-3 border-b py-2" style={{ borderColor: "var(--m-line)" }}>
            <Status kind="verdict" value={r.status} />
            <span className="flex-1">{r.feature}</span>
            <span className="m-text-body" style={{ color: "var(--m-ink-2)" }}>{r.system}</span>
            <span className="m-text-body">{records(r.total_affected_records)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReadinessView({ onInsight }: { onInsight: (i: ViewInsight | null) => void }) {
  const dayOne = useDayOne();
  const { latest, isLoading: versionsLoading, error: versionsError, refetch: refetchVersions } = useLatestVersion();
  const modules = useMemo(() => (latest?.dqs_summary ? Object.keys(latest.dqs_summary) : []), [latest]);
  const [objectChoice, setObject] = useState("");
  const object = objectChoice || modules[0] || "";
  const [l1Choice, setL1] = useState("");

  const bp = useQuery({
    queryKey: queryKeys.businessProcess(latest?.id, object),
    queryFn: () => getBusinessProcess(latest!.id, object),
    enabled: !!latest && !!object,
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
  const [systemChoice, setSystem] = useState("all");
  const systemId = systemChoice === "all" ? undefined : systemChoice;
  const aware = useQuery({
    queryKey: queryKeys.configAwareScore(latest?.id, systemId),
    queryFn: () => getConfigAwareScore({ version_id: latest!.id, system_id: systemId }),
    enabled: !!latest,
    retry: false,
    meta: { ignoreError: true },
  });

  const processes = useMemo(() => bp.data ?? [], [bp.data]);
  const l1 = processes.find((p) => p.l1_id === l1Choice) ?? processes[0];

  // Derived once here so the page frame's four sentences can be published from an effect below.
  const all = useMemo(() => (l1 ? fields(l1) : []), [l1]);
  const pct = score(all);
  const passing = all.filter((f) => f.dq_status === "green").length;
  const blocking = red(all);
  const gates = useMemo<{ l3: BusinessProcessL3; score: number; blocking: number }[]>(() => (l1 ? l1.l2_groups.flatMap((l2) =>
    l2.l3_processes.map((l3) => {
      const f3 = l3.l4_subprocesses.flatMap(l4Fields);
      return { l3, score: score(f3), blocking: red(f3) };
    })) : []), [l1]);
  const blockedGates = gates.filter((g) => g.blocking).length;
  const blockingFindings = useMemo(() => (l1 ? l1.l2_groups.flatMap((l2) => l2.l3_processes.flatMap((l3) =>
    l3.l4_subprocesses.flatMap((l4) => l4Fields(l4).filter((f) => f.dq_status === "red").map((f) => ({
      id: `${l3.l3_id}-${l4.l4_id}-${f.field}`, severity: sev(f), checkId: f.check_id ?? f.field,
      title: f.finding_message || f.description, gate: l3.l3_name, affected: f.affected_count,
      href: f.check_id ? findingHref(object, f.check_id) : undefined,
    }))))).sort((a, b) => b.affected - a.affected) : []), [l1, object, findingHref]);
  const failing = blockingFindings.reduce((a, b) => a + b.affected, 0);
  const firstHref = blockingFindings.find((b) => b.href)?.href;
  const worst = [...gates].sort((a, b) => b.blocking - a.blocking)[0];
  const loading = versionsLoading || bp.isLoading || dayOne.status === "loading";

  useEffect(() => {
    if (loading) { onInsight({ loading: true, situation: { sentence: "" }, changed: { sentence: "" }, why: { sentence: "" }, next: { sentence: "" } }); return; }
    if (!latest || !l1) {
      onInsight({
        situation: { sentence: !latest ? "No finished run to read process readiness from." : `${formatModuleName(object)} has no L1 to L5 process definition.`, tone: "neutral" },
        changed: { sentence: "Readiness is scored per step from the run you choose." },
        why: { sentence: "Only procure to pay and order to cash objects carry a process definition." },
        next: { sentence: !latest ? "Run an analysis first." : "Pick a run that covers a process object.", action: !latest ? { label: "Open runs", href: "/runs" } : undefined },
      });
      return;
    }
    onInsight({
      situation: {
        sentence: `${blockedGates} of ${plural(gates.length, "gate")} blocked, ${pct}% of fields pass in ${l1.l1_name}. Readiness is scored per step from the chosen run.`,
        tone: blockedGates ? "no-go" : pct >= 90 ? "go" : "at-risk",
      },
      changed: { sentence: `Reading ${latest.label || formatDate(latest.run_at, "datetime")}; change appears when the next run of these objects finishes.` },
      why: { sentence: blocking ? `${plural(blocking, "blocking field fails", "blocking fields fail")} on ${records(failing)}.` : "No field blocks go-live.", tone: blocking ? "no-go" : "go" },
      next: blockedGates && worst
        ? { sentence: `Clear the failing fields in ${worst.l3.l3_name}.`, action: { label: "Open findings", href: firstHref ?? "/inbox" } }
        : { sentence: "No gate is blocked.", action: { label: "Open rules", href: "/rules" } },
    });
  }, [loading, latest, l1, object, blockedGates, gates.length, pct, blocking, failing, worst, firstHref, onInsight]);

  if (loading) return <ViewSkeleton stats={4} />;
  if (versionsError) return <ErrorState message={versionsError.message} onRetry={() => void refetchVersions()} />;
  if (!latest) {
    return <EmptyState title="No process readiness yet" detail={dayOne.step?.detail ?? "Readiness is read from the latest completed analysis. Sync a system and run an analysis."}
      action={<DayOneAction step={dayOne.step} fallbackHref="/systems" fallbackLabel="Open systems" />} />;
  }

  const objectPicker = (
    <Select label="Object" value={object} options={modules.map((m) => ({ value: m, label: formatModuleName(m) }))}
      onValueChange={(m) => { setObject(m); setL1(""); }} />
  );

  if (!l1) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-3 items-center flex-wrap">{objectPicker}<RunsWithProcess exclude={latest.id} /></div>
        <EmptyState
          title={`${formatModuleName(object)} has no process definition`}
          detail="Readiness covers objects with an L1 to L5 definition: procure to pay (vendors, purchasing, materials, general ledger) and order to cash (customers, sales orders, receivables). Choose one of the runs above that covers such an object."
          action={<Button variant="secondary" render={<Link href="/runs">Open runs</Link>} />}
        />
      </div>
    );
  }

  const awareL1: ConfigAwareL1 | undefined = aware.data?.processes.find((p) => p.l1 === l1.l1_id || p.name === l1.l1_name);

  const recommendations = l1.l2_groups.flatMap((l2) => l2.l3_processes
    .filter((l3) => l3.overall_readiness !== "green")
    .map((l3) => {
      const f3 = l3.l4_subprocesses.flatMap(l4Fields);
      const reds = f3.filter((f) => f.dq_status === "red");
      const recs = reds.reduce((a, f) => a + f.affected_count, 0);
      return {
        id: l3.l3_id,
        label: reds.length ? `Clear ${reds.length} failing field${reds.length === 1 ? "" : "s"} in ${l3.l3_name}`
          : `Review the amber fields in ${l3.l3_name}`,
        rationale: reds.length
          ? `${recs.toLocaleString()} records fail ${Array.from(new Set(reds.map((f) => f.check_id).filter(Boolean))).join(", ")}`
          : "No field is red; amber fields have partial pass rates.",
      };
    }));

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
        <span className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>
          Version {latest.label ?? latest.id.slice(0, 8)}, run {formatDate(latest.run_at, "datetime")}
        </span>
      </div>

      <div className="flex gap-6 flex-wrap">
        <Stat label="Fields passing" value={`${passing} / ${all.length}`} delta={`${pct}%`} />
        <Stat label="Blocking fields" value={blocking} href={`/objects/${object}`} />
        <Stat label="Gates blocked" value={blockedGates} />
        <Stat label="Records failing" value={failing.toLocaleString()} href={`/objects/${object}`} />
      </div>

      <Card title="Gates" meta={l1.l1_name}>
        <ul className="flex flex-col gap-2">
          {gates.map((g) => (
            <li key={g.l3.l3_id} className="flex items-center gap-3 border-b py-2" style={{ borderColor: "var(--m-line)" }}>
              <Pill tone={g.blocking ? "no-go" : g.score >= 90 ? "go" : "at-risk"}>
                {g.blocking ? "Blocked" : g.score >= 90 ? "Ready" : "At risk"}
              </Pill>
              <span className="flex-1">{g.l3.l3_name}</span>
              <span className="m-text-body">{g.score}%</span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Blocking findings">
          {blockingFindings.length ? (
            <ul className="flex flex-col gap-2">
              {blockingFindings.slice(0, 10).map((b) => (
                <li key={b.id} className="flex items-center gap-3 border-b py-2" style={{ borderColor: "var(--m-line)" }}>
                  <Status kind="severity" value={b.severity} />
                  <span className="flex-1">{b.href ? <Link className="underline" href={b.href}>{b.title}</Link> : b.title}</span>
                  <span className="m-text-body" style={{ color: "var(--m-ink-2)" }}>{b.gate}</span>
                  <span className="m-text-body">{records(b.affected)}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Nothing blocks go-live" />}
        </Card>
        <Card title="Recommendations">
          {recommendations.length ? (
            <ul className="flex flex-col gap-2">
              {recommendations.map((r) => (
                <li key={r.id} className="border-b py-2" style={{ borderColor: "var(--m-line)" }}>
                  <div>{r.label}</div>
                  <div className="m-text-body" style={{ color: "var(--m-ink-2)" }}>{r.rationale}</div>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No open recommendations" action={<Button variant="secondary" render={<Link href="/rules">Open rules</Link>} />} />}
        </Card>
      </div>

      {awareL1 ? (
        <Card title="Rules by step">
          <div id="applicability" className="flex flex-col gap-3">
            {!aware.data?.config_load ? (
              <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
                All {awareL1.applicable.toLocaleString()} rules apply by default. Load configuration to narrow this.
              </p>
            ) : null}
            <RulesBlock title={awareL1.name} t={awareL1} findingHref={findingHref} />
            {awareL1.l2.map((l2) => (
              <RulesBlock key={l2.l2} title={l2.name} t={l2} findingHref={findingHref} configuredIn={l2.configured_in} />
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

  const graphNodes = useMemo(() => (graphQ.data?.activities ?? []).map((a) => ({ id: a.id, size: a.affected_records })), [graphQ.data]);
  const graphEdges = useMemo(() => (graphQ.data?.transitions ?? []).map((t, i) => ({
    id: `${t.from}-${t.to}-${i}`, source: t.from, target: t.to, label: t.weight.toLocaleString(),
  })), [graphQ.data]);
  const failingRecords = bottlenecks.reduce((a, b) => a + b.affected_records, 0);
  const worstStep = bottlenecks[0];

  useEffect(() => {
    if (isLoading || dayOne.status === "loading" || graphQ.isLoading) { onInsight({ loading: true, situation: { sentence: "" }, changed: { sentence: "" }, why: { sentence: "" }, next: { sentence: "" } }); return; }
    if (!latest || !modules.length) {
      onInsight({
        situation: { sentence: !latest ? "No finished run to mine a process map from." : "No analysed object has a process map.", tone: "neutral" },
        changed: { sentence: "The map is mined from the run you choose." },
        why: { sentence: "Purchasing, sales, vendor, customer, material and G/L objects carry a map." },
        next: { sentence: "Analyse one of those objects.", action: { label: "Open runs", href: "/runs" } },
      });
      return;
    }
    onInsight({
      situation: {
        sentence: `${plural(activities.length, "step")} mapped for ${formatModuleName(active ?? "")}, ${blockedSteps} blocked and ${degradedSteps} degraded, across ${plural(variants.length, "variant")}. The map is mined from the chosen run.`,
        tone: blockedSteps ? "no-go" : degradedSteps ? "at-risk" : "go",
      },
      changed: { sentence: `Reading ${latest.label || formatDate(latest.run_at, "datetime")}.` },
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
        <ErrorState message={(graphQ.error as Error).message} onRetry={() => void graphQ.refetch()} />
      ) : (
        <>
          <div className="flex gap-6 flex-wrap">
            <Stat label="Steps mapped" value={activities.length} />
            <Stat label="Blocked" value={blockedSteps} onClick={bottlenecks[0] ? () => setNode(bottlenecks[0].id) : undefined} />
            <Stat label="Degraded" value={degradedSteps} />
            <Stat label="Variants" help="variant" value={variants.length} />
          </div>

          {activities.length ? (
            <Graph nodes={graphNodes} edges={graphEdges} onNodeClick={setNode} height={420} />
          ) : <EmptyState title="No mined activities for this module" action={openLink("Open runs", "/runs")} />}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Failing steps">
              {bottlenecks.length ? (
                <ol className="flex flex-col gap-2">
                  {bottlenecks.slice(0, 8).map((b) => (
                    <li key={b.id} className="flex items-center gap-3 border-b py-2" style={{ borderColor: "var(--m-line)" }}>
                      <Status kind="verdict" value={b.step_status} />
                      <span className="flex-1">{b.label}</span>
                      <span className="m-text-body">{records(b.affected_records)}</span>
                    </li>
                  ))}
                </ol>
              ) : <EmptyState title="Every step passes its checks" action={openLink("Open rules", "/rules")} />}
            </Card>
            <Card title="Variants">
              {variants.length ? (
                <ul className="flex flex-col gap-2">
                  {variants.slice(0, 8).map((v) => (
                    <li key={v.id} className="flex items-center gap-3 border-b py-2" style={{ borderColor: "var(--m-line)" }}>
                      <Status kind="verdict" value={v.readiness} />
                      <span className="flex-1">{v.label}</span>
                      <span className="m-text-body">{plural(v.activity_count, "step")}</span>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="No variants found for this module" action={openLink("Open objects", "/objects")} />}
            </Card>
          </div>
        </>
      )}

      <Drawer open={!!picked} onOpenChange={(o) => { if (!o) setNode(null); }} title={picked?.label ?? "Step"}>
        {picked ? (
          <div className="flex flex-col gap-2">
            <Status kind="verdict" value={picked.step_status} />
            <p>
              {picked.tcode ? <><Mono>{picked.tcode}</Mono>, </> : null}{picked.affected_records.toLocaleString()} affected records, {picked.finding_count.toLocaleString()} findings
              {picked.avg_pass_rate != null ? `, ${Math.round(picked.avg_pass_rate)}% pass rate` : ""}.
            </p>
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
  const { run } = useInsightScope();
  const { latest } = useLatestVersion();
  // The active view publishes its four sentences; the frame renders them once, above the tabs.
  const [insight, setInsight] = useState<ViewInsight | null>(null);
  const onInsight = useCallback((i: ViewInsight | null) => setInsight(i), []);
  const placeholder: ViewInsight = { loading: true, situation: { sentence: "" }, changed: { sentence: "" }, why: { sentence: "" }, next: { sentence: "" } };
  return (
    <InsightFrame
      title="Process"
      meta={latest ? `As of ${runScopeLabel(latest)}` : "Latest completed run"}
      run={latest?.id ?? run}
      insight={insight ?? placeholder}
    >
      <Tabs value={tab} onValueChange={setTab} items={[
        { value: "readiness", label: "Readiness", content: <ReadinessView onInsight={onInsight} /> },
        { value: "map", label: "Map", content: <MapView onInsight={onInsight} /> },
      ]} />
    </InsightFrame>
  );
}
