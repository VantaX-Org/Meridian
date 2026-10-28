"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { isAxiosError } from "axios";
import { Button, Card, DataTable, DrillLink, EmptyState, EntityTabs, ErrorState, Line, Mono, PageHeader, Pill, Skeleton, Stat, buildDrillHref, toast, Status, useBreadcrumbTitle } from "@/design";
import { exportRuleHistory, getRule, getRuleByCode, getRuleHistory, updateRule, type Rule, type RuleHistoryRun } from "@/lib/api/rules";
import { getReference } from "@/lib/api/process-designer";
import { processStepHref } from "@/components/process/shared";
import { useRole } from "@/hooks/use-role";
import { OwnerPicker } from "@/components/owners/OwnerPicker";
import { getRuleApplicability, type SystemApplicability } from "@/lib/api/config-load";
import { getRuleLineage } from "@/lib/api/lineage";
import { apiErrorState } from "@/lib/error";
import { checkClassLabel, formatDate, formatModuleName, formatPct, labelOf, plural } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { actionColumn, LedgerHead, RowLink } from "@/components/mdm/ledger";
import { ConditionList, ThresholdTable } from "../rule-ui";
import { RuleVersions } from "./rule-versions";
import { RuleVersionDiff } from "./rule-version-diff";

const APPLIES_TONE: Record<string, "go" | "no-go" | "neutral"> = {
  applies: "go",
  applies_by_default: "go",
  does_not_apply: "neutral",
  not_available: "neutral",
};
const APPLIES_LABEL: Record<string, string> = {
  applies: "Applies",
  applies_by_default: "Applies by default",
  does_not_apply: "Does not apply",
  not_available: "Not available",
};

const SOURCE_LABEL: Record<string, string> = { yaml: "built-in", hq: "HQ", mined: "mined", custom: "custom" };
const conditionList = (conditions: Record<string, unknown>[] | Record<string, unknown> | null) =>
  Array.isArray(conditions) ? conditions : conditions ? [conditions] : [];

function WhereItApplies({ checkId, module }: { checkId: string; module: string }) {
  const router = useRouter();
  const q = useQuery({
    queryKey: queryKeys.ruleApplicability(module, checkId),
    retry: false,
    meta: { ignoreError: true },
    queryFn: () => getRuleApplicability(checkId, module),
  });
  const systems = q.data?.systems ?? [];
  const columns: ColumnDef<SystemApplicability>[] = [
    { id: "system", header: "System", accessorFn: (s) => s.name ?? s.system_id },
    {
      id: "applies",
      header: "Applies",
      cell: ({ row }) => (
        <Pill tone={APPLIES_TONE[row.original.applicability] ?? "neutral"}>
          {APPLIES_LABEL[row.original.applicability] ?? row.original.applicability}
        </Pill>
      ),
    },
    { id: "reason", header: "Reason", accessorFn: (s) => s.reason ?? "—" },
    {
      id: "configured",
      header: "Configured in",
      cell: ({ row }) =>
        row.original.configured_in.length ? (
          <div className="flex flex-col gap-0.5">
            {row.original.configured_in.map((c, i) => (
              <div key={i} className="m-text-meta">
                {c.kind === "img" ? "IMG: " : ""}
                {c.path}
                {c.tcode ? <> (<Mono>{c.tcode}</Mono>)</> : null}
              </div>
            ))}
          </div>
        ) : (
          "—"
        ),
    },
    actionColumn((s) => <RowLink href={`/systems/${s.system_id}?tab=health`}>Open</RowLink>),
  ];

  return (
    <section aria-label="Where it applies">
      <LedgerHead title="Where it applies" meta={systems.length ? `${systems.length.toLocaleString()} ${systems.length === 1 ? "system" : "systems"}` : undefined} />
      {q.isLoading ? (
        <Skeleton height={120} />
      ) : q.isError ? (
        <ErrorState message="Where this rule applies could not be read." onRetry={() => q.refetch()} />
      ) : systems.length === 0 ? (
        <EmptyState
          title="No system connected"
          detail="Add a system and load its configuration to see where this rule applies"
          action={<Button render={<Link href="/systems">Add a system</Link>} />}
        />
      ) : (
        <DataTable
          columns={columns}
          data={systems}
          getRowId={(s) => s.system_id}
          onRowClick={(s) => router.push(`/systems/${s.system_id}?tab=health`)}
        />
      )}
    </section>
  );
}

/** The reference model's L4 steps whose activities carry this check (sap/process_definitions.py), with their L1. */
function ProcessStepsRow({ checkId, module, run }: { checkId: string; module: string; run: string | undefined }) {
  const q = useQuery({ queryKey: queryKeys.processReference(), queryFn: getReference, retry: false, meta: { ignoreError: true } });
  const steps = (q.data?.l1 ?? []).flatMap((l1) => l1.l2.flatMap((l2) => l2.l3.flatMap((l3) => l3.l4
    .filter((l4) => l4.activities.some((a) => a.check_ids.includes(checkId) || a.fields.some((f) => f.check_id === checkId)))
    .map((l4) => ({ l1, l4 })))));
  if (!steps.length) return null;
  return (
    <div className="flex justify-between"><dt className="m-ink-3">Process steps it gates</dt>
      <dd className="text-right">
        {steps.map(({ l1, l4 }, i) => (
          <span key={l4.id}>
            {i ? ", " : ""}
            <Link className="underline underline-offset-2" href={processStepHref({ l1: l1.id, l4: l4.id, module, run })}>{l1.name}: {l4.name}</Link>
            {l4.tcode ? <> (<Mono>{l4.tcode}</Mono>)</> : null}
          </span>
        ))}
      </dd>
    </div>
  );
}

function LineageRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="m-ink-3">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function columnList(cols: string[]): ReactNode {
  if (!cols.length) return "—";
  return cols.map((c, i) => (
    <span key={c}>
      {i ? ", " : ""}
      <Mono>{c}</Mono>
    </span>
  ));
}

function LineageAndOwnership({ checkId, builtIn }: { checkId: string; builtIn: boolean }) {
  const q = useQuery({
    queryKey: queryKeys.ruleLineage(checkId),
    queryFn: () => getRuleLineage(checkId),
    enabled: builtIn,
    retry: false,
    meta: { ignoreError: true },
  });
  const objectOwner = q.data?.owners.find((o) => o.kind === "object");

  let body: ReactNode;
  if (!builtIn) {
    body = <p className="m-text-body m-ink-3">Lineage is shown for built-in rules only.</p>;
  } else if (q.isLoading) {
    body = <Skeleton height={96} />;
  } else if (q.isError || !q.data) {
    body = <ErrorState message="Lineage for this rule could not be read." onRetry={() => q.refetch()} />;
  } else {
    const l = q.data;
    body = (
      <dl className="m-text-body flex flex-col gap-1">
        <LineageRow label="Fields">{columnList(l.fields)}</LineageRow>
        <LineageRow label="Targets">{columnList(l.targets)}</LineageRow>
        <LineageRow label="Tables">{columnList(l.tables)}</LineageRow>
        <LineageRow label="Joins">
          {l.joins.length
            ? l.joins.map((j) => `${j.parent} → ${j.child} on ${j.on.map(([a, b]) => (a === b ? a : `${a} = ${b}`)).join(", ")}`).join("; ")
            : "—"}
        </LineageRow>
        <LineageRow label="Glossary terms">
          {l.glossary_terms.length
            ? l.glossary_terms.map((t, i) => (
                <span key={t.id}>
                  {i ? ", " : ""}
                  <Link href={`/mdm/glossary/${t.id}`}>{t.business_name}</Link>
                </span>
              ))
            : "—"}
        </LineageRow>
        <LineageRow label="Object owner">
          {objectOwner?.owner_name ?? objectOwner?.steward_name ?? "not set"}
        </LineageRow>
      </dl>
    );
  }

  return (
    <Card title="Lineage and ownership">
      <div className="flex flex-col gap-2">
        {body}
        <OwnerPicker kind="rule" refId={checkId} />
      </div>
    </Card>
  );
}

/** The rule in plain words: what it tests, why it matters, and how many records fail it now, with the way to them. */
function WhatItChecks({ rule, checkId, latest, historyLoading }: { rule: Rule; checkId: string; latest: RuleHistoryRun | undefined; historyLoading: boolean }) {
  const q = useQuery({
    queryKey: ["rules", "by-code", checkId, rule.module],
    queryFn: () => getRuleByCode(checkId, rule.module),
    enabled: !!checkId,
    retry: false,
    meta: { ignoreError: true },
  });
  const d = q.data;
  const records = buildDrillHref({ object: rule.module, ruleId: checkId });
  const what = d?.message ?? rule.name.slice(rule.name.indexOf(":") + 1).trim();
  const why = d?.why_it_matters ?? rule.description;
  let failing: ReactNode;
  if (historyLoading) failing = <Skeleton height={20} />;
  else if (!latest) failing = <span className="m-ink-3">No analysis has checked this rule yet. Run one to see which records fail.</span>;
  else if (latest.affected_count === 0) failing = <>Every one of the {latest.total_count.toLocaleString()} records checked passes, as of {formatDate(latest.run_at, "date")}.</>;
  else failing = (
    <>
      <DrillLink href={records}>{latest.affected_count.toLocaleString()}</DrillLink> of {latest.total_count.toLocaleString()} records fail, as of {formatDate(latest.run_at, "date")}.{" "}
      <Link className="m-ink-accent-ink hover:underline" href={records}>Fix them on the object</Link>
    </>
  );
  return (
    <Card title="What it checks">
      <dl className="m-text-body flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <dt className="m-text-label m-ink-3">The check</dt>
          <dd>
            {what}
            {d?.check_class || d?.field ? (
              <span className="m-ink-3"> ({d?.check_class ? checkClassLabel(d.check_class).toLowerCase() : "check"}{d?.field ? <> on <Mono>{d.field}</Mono></> : null})</span>
            ) : null}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="m-text-label m-ink-3">Why it matters</dt>
          <dd>{why || <span className="m-ink-3">No reason is written down for this rule yet.</span>}</dd>
        </div>
        {d?.sap_impact ? (
          <div className="flex flex-col gap-0.5">
            <dt className="m-text-label m-ink-3">What it breaks in SAP</dt>
            <dd>{d.sap_impact}</dd>
          </div>
        ) : null}
        <div className="flex flex-col gap-0.5">
          <dt className="m-text-label m-ink-3">Failing now</dt>
          <dd>{failing}</dd>
        </div>
      </dl>
    </Card>
  );
}

/** /rules/<check id> (the code every screen shows) opens the rule: it is resolved to the rule's id. */
function RuleByCode({ code }: { code: string }) {
  const router = useRouter();
  const q = useQuery({ queryKey: ["rules", "by-code", code], queryFn: () => getRuleByCode(code) });
  useEffect(() => {
    if (q.data?.rule_uuid) router.replace(`/rules/${q.data.rule_uuid}`);
  }, [q.data, router]);
  if (q.isError) return <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />;
  if (q.data && !q.data.rule_uuid) {
    return (
      <EmptyState title={`${code} has not run here yet`} detail="The rule exists in the library, but no run of this tenant has evaluated it."
        action={<Button render={<Link href={`/rules?module=${encodeURIComponent(q.data.module)}`}>Open the rules of this object</Link>} />} />
    );
  }
  return <Skeleton height={320} />;
}

export default function RulePage() {
  const { ruleId } = useParams<{ ruleId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const canManage = useRole().can("manage_rules");
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: queryKeys.ruleDetail(ruleId), queryFn: () => getRule(ruleId) });
  // Rule names are "{check id}: {message}"; data.id is the rules row UUID, not the check id.
  const checkId = data?.name.split(":")[0] ?? "";
  // Findings are stored by check id, which is also what the glossary reads: asking by the row UUID finds no runs.
  const history = useQuery({ queryKey: queryKeys.ruleHistory(checkId), queryFn: () => getRuleHistory(checkId, { limit: 20 }), enabled: !!checkId });
  const toggleGen = useRef(0);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => updateRule(ruleId, { enabled }),
    onMutate: () => ({ gen: ++toggleGen.current }),
    onSuccess: (_d, enabled, ctx) => {
      const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: queryKeys.ruleDetail(ruleId) }), qc.invalidateQueries({ queryKey: ["rules"] })]);
      // A stale undo must not overwrite a newer change to this rule.
      toast.undoable(enabled ? "Rule enabled" : "Rule disabled", { undo: async () => {
        if (toggleGen.current !== ctx?.gen) { toast.info("Rule changed again since, nothing undone"); return; }
        await updateRule(ruleId, { enabled: !enabled }); await refresh();
      } });
      void refresh();
    },
    onError: (e) => toast.error((e as Error).message || "Not saved"),
  });

  // The rule is the page's h1, under Rules.
  useBreadcrumbTitle(data ? { label: data.name, parent: { label: "Rules", href: "/rules" } } : null);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton height={120} />
        <Skeleton height={96} />
        <Skeleton height={320} />
      </div>
    );
  }
  // The rules API takes the rule's id; a check id (what every screen shows) answers 400: resolve it instead.
  if (isError && isAxiosError(error) && error.response?.status === 400) return <RuleByCode code={decodeURIComponent(ruleId)} />;
  if (isError && isAxiosError(error) && error.response?.status === 404) {
    return (
      <EmptyState
        title="Rule not found"
        action={<Button render={<Link href="/rules">All rules</Link>} />}
      />
    );
  }
  if (isError || !data) return <ErrorState {...apiErrorState(error)} onRetry={() => refetch()} />;

  const rate = data.last_pass_rate == null ? null : data.last_pass_rate * (data.last_pass_rate <= 1 ? 100 : 1);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={data.name}
        meta={`Checks ${formatModuleName(data.module)} records. ${data.enabled ? "Runs on every analysis." : "Switched off, so it does not run."}`}
        status={<span className="inline-flex items-center gap-2"><Status kind="severity" value={data.severity} /><Pill tone={data.enabled ? "go" : "neutral"}>{labelOf(data.enabled ? "enabled" : "disabled")}</Pill></span>}
        actions={<>
          {canManage && (
            <Button variant="secondary" onClick={() => toggle.mutate(!data.enabled)} disabled={toggle.isPending}>
              {data.enabled ? "Disable rule" : "Enable rule"}
            </Button>
          )}
          <Button render={<Link href={buildDrillHref({ object: data.module, ruleId: checkId })}>See failing records</Link>} />
        </>}
      />
      <EntityTabs entityType="rules" entityId={data.id}
        exportOptions={[{ format: "xlsx", label: "Rule run history (.xlsx)", run: () => exportRuleHistory(checkId, "xlsx") }]}
        history={
          <div className="flex flex-col gap-6">
            {history.data && history.data.runs.length > 0 ? (
            <DataTable
            columns={[
              { accessorKey: "run_at", header: "Run", cell: (i) => formatDate(i.getValue<string>(), "datetime") },
              { accessorKey: "module", header: "Object", cell: (i) => formatModuleName(i.getValue<string>()) },
              { accessorKey: "pass_rate", header: "Pass rate", meta: { numeric: true }, cell: (i) => { const v = i.getValue<number | null>(); return formatPct(v == null ? null : v * (v <= 1 ? 100 : 1)); } },
            ]}
            data={history.data.runs}
            getRowId={(r) => r.version_id}
            tableId="rule-history"
            height={320}
            />
            ) : null}
            <RuleVersionDiff ruleId={checkId} />
          </div>
        }
        overview={<>
      <WhatItChecks rule={data} checkId={checkId} latest={history.data?.runs[0]} historyLoading={history.isLoading || (history.isPending && !!checkId)} />

      <div className="m-stat-grid">
        <Stat
          label="Last pass rate"
          href={buildDrillHref({ object: data.module, ruleId: checkId })}
          value={formatPct(rate)}
          bar={rate ?? undefined}
          rule={rate != null ? { target: 100 } : undefined}
        />
        <Stat label="Last run" value={formatDate(data.last_run_at, "datetime")} href={buildDrillHref({ object: data.module, ruleId: checkId })} />
      </div>

      <dl className="m-text-body flex flex-col gap-1">
        <div className="flex justify-between"><dt className="m-ink-3">Object</dt><dd>{formatModuleName(data.module)}</dd></div>
        <div className="flex justify-between"><dt className="m-ink-3">System</dt><dd>{labelOf(data.category)}</dd></div>
        <div className="flex justify-between"><dt className="m-ink-3">Source</dt><dd>{labelOf(SOURCE_LABEL[data.source] ?? data.source)}{data.source_yaml ? <>, <Mono>{data.source_yaml}</Mono></> : null}</dd></div>
        <ProcessStepsRow checkId={checkId} module={data.module}
          run={history.data?.runs.find((r) => r.module === data.module && r.pass_rate != null)?.version_id} />
      </dl>

      {data.tags?.length ? <div className="flex flex-wrap gap-1">{data.tags.map((t) => <Pill key={t} tone="neutral">{t}</Pill>)}</div> : null}

      <WhereItApplies checkId={checkId} module={data.module} />

      <LineageAndOwnership checkId={checkId} builtIn={data.source === "yaml"} />

      <RuleVersions ruleId={checkId} />

      <Card title="Pass rate over runs"><div className="flex flex-col gap-2">
        {history.isLoading ? (
          <Skeleton height={120} />
        ) : !history.data || history.data.runs.length === 0 ? (
          <EmptyState title="Not run yet" detail="Pass rates appear after the first analysis" action={<Button variant="secondary" render={<Link href="/runs">View runs</Link>} />} />
        ) : (() => {
          // A run that did not evaluate the rule has no pass rate: it is left off the line, never drawn as 0%.
          const evaluated = history.data.runs.filter((r): r is RuleHistoryRun & { pass_rate: number } => r.pass_rate != null);
          const skipped = history.data.runs.length - evaluated.length;
          const note = skipped
            ? `${skipped.toLocaleString()} ${skipped === 1 ? "run" : "runs"} did not evaluate this rule and ${skipped === 1 ? "is" : "are"} left off the line.`
            : null;
          if (!evaluated.length) return <p className="m-text-body m-ink-2">{`No run has evaluated this rule yet (${plural(skipped, "run")} so far), so there is no line to draw.`}</p>;
          return (<>
            <p className="m-text-meta m-ink-3">{`Pass rate of each run that evaluated this rule, oldest first.${note ? ` ${note}` : ""}`}</p>
            <Line
              label="Pass rate over runs"
              data={[...evaluated].reverse().map((r) => ({
                x: formatDate(r.run_at, "date"),
                y: r.pass_rate * (r.pass_rate <= 1 ? 100 : 1),
                object: r.module,
                ruleId: checkId,
                runId: r.version_id,
              }))}
              onPointClick={(p) => router.push(buildDrillHref({ object: p.object ?? data.module, ruleId: checkId, run: p.runId ?? "" }))}
            />
          </>);
        })()}
      </div></Card>

      {conditionList(data.conditions).length ? <Card title="Conditions"><ConditionList conditions={conditionList(data.conditions)} /></Card> : null}
      {data.thresholds ? <Card title="Thresholds"><ThresholdTable thresholds={data.thresholds} /></Card> : null}

      </>} />
    </div>
  );
}
