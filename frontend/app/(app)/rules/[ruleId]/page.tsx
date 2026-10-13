"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { isAxiosError } from "axios";
import {
  Button, Card, DataTable, DrillLink, EmptyState, EntityTabs, ErrorState, Line, Mono, PageHeader, Pill, SeverityDot, Skeleton, Stat,
  buildDrillHref, toast,
} from "@/design";
import { exportRuleHistory, getRule, getRuleHistory, updateRule } from "@/lib/api/rules";
import { OwnerPicker } from "@/components/owners/OwnerPicker";
import { getRuleApplicability, type SystemApplicability } from "@/lib/api/config-load";
import { getRuleLineage } from "@/lib/api/lineage";
import { apiErrorMessage } from "@/lib/error";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { ConditionList, ThresholdTable } from "../rule-ui";

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
  ];

  return (
    <Card title="Where it applies">
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
    </Card>
  );
}

function LineageRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt style={{ color: "var(--m-ink-3)" }}>{label}</dt>
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
    body = <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>Lineage is shown for built-in rules only.</p>;
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

export default function RulePage() {
  const { ruleId } = useParams<{ ruleId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: queryKeys.ruleDetail(ruleId), queryFn: () => getRule(ruleId) });
  const history = useQuery({ queryKey: queryKeys.ruleHistory(ruleId), queryFn: () => getRuleHistory(ruleId, { limit: 20 }) });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => updateRule(ruleId, { enabled }),
    onSuccess: (_d, enabled) => {
      const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: queryKeys.ruleDetail(ruleId) }), qc.invalidateQueries({ queryKey: ["rules"] })]);
      toast.undoable(enabled ? "Rule enabled" : "Rule disabled", { undo: async () => { await updateRule(ruleId, { enabled: !enabled }); await refresh(); } });
      void refresh();
    },
    onError: (e) => toast.error((e as Error).message || "Not saved"),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6" aria-busy="true">
        <Skeleton height={120} />
        <Skeleton height={96} />
        <Skeleton height={320} />
      </div>
    );
  }
  if (isError && isAxiosError(error) && error.response?.status === 404) {
    return (
      <EmptyState
        title="Rule not found"
        action={<Button render={<Link href="/rules">All rules</Link>} />}
      />
    );
  }
  if (isError || !data) return <ErrorState message={apiErrorMessage(error)} onRetry={() => refetch()} />;

  // Rule names are "{check id}: {message}"; data.id is the rules row UUID, not the check id.
  const checkId = data.name.split(":")[0];

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title={data.name}
        meta={<Mono>{ruleId}</Mono>}
        status={<span className="inline-flex items-center gap-2"><SeverityDot severity={data.severity === "info" ? "low" : data.severity} />{labelOf(data.severity)}<Pill tone={data.enabled ? "go" : "neutral"}>{labelOf(data.enabled ? "enabled" : "disabled")}</Pill></span>}
        actions={
          <Button variant={data.enabled ? "secondary" : "primary"} onClick={() => toggle.mutate(!data.enabled)} disabled={toggle.isPending}>
            {data.enabled ? "Disable rule" : "Enable rule"}
          </Button>
        }
      />
      <EntityTabs entityType="rules" entityId={data.id}
        exportOptions={[{ format: "xlsx", label: "Rule run history (.xlsx)", run: () => exportRuleHistory(ruleId, "xlsx") }]}
        history={history.data && history.data.runs.length > 0 ? (
          <DataTable
            columns={[
              { accessorKey: "run_at", header: "Run", cell: (i) => formatDate(i.getValue<string>(), "datetime") },
              { accessorKey: "module", header: "Object" },
              { accessorKey: "pass_rate", header: "Pass rate", meta: { numeric: true }, cell: (i) => { const v = i.getValue<number | null>(); return v == null ? "—" : `${(v * (v <= 1 ? 100 : 1)).toFixed(1)} %`; } },
            ]}
            data={history.data.runs}
            getRowId={(r) => r.version_id}
            tableId="rule-history"
            height={320}
          />
        ) : undefined}
        overview={<>
      {data.description ? <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>{data.description}</p> : null}

      <dl className="m-text-body flex flex-col gap-1">
        <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Object</dt><dd>{formatModuleName(data.module)}</dd></div>
        <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>System</dt><dd>{labelOf(data.category)}</dd></div>
        <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Source</dt><dd>{labelOf(SOURCE_LABEL[data.source] ?? data.source)}{data.source_yaml ? `, ${data.source_yaml}` : ""}</dd></div>
        <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Last run</dt><dd>{data.last_pass_rate != null ? <DrillLink object={data.module} ruleId={checkId}>{(data.last_pass_rate * (data.last_pass_rate <= 1 ? 100 : 1)).toFixed(1)} %</DrillLink> : "not run yet"}</dd></div>
      </dl>

      {data.tags?.length ? <div className="flex flex-wrap gap-1">{data.tags.map((t) => <Pill key={t} tone="neutral">{t}</Pill>)}</div> : null}

      <WhereItApplies checkId={checkId} module={data.module} />

      <LineageAndOwnership checkId={checkId} builtIn={data.source === "yaml"} />

      <Card title="Pass rate over runs"><div className="flex flex-col gap-2">
        <div className="flex gap-6">
          <Stat
            label="Last pass rate"
            href={buildDrillHref({ object: data.module, ruleId: checkId })}
            value={data.last_pass_rate != null ? `${(data.last_pass_rate * (data.last_pass_rate <= 1 ? 100 : 1)).toFixed(1)} %` : "—"}
          />
          <Stat label="Last run" value={formatDate(data.last_run_at, "datetime")} href={buildDrillHref({ object: data.module, ruleId: checkId })} />
        </div>
        {history.isLoading ? (
          <Skeleton height={120} />
        ) : !history.data || history.data.runs.length === 0 ? (
          <EmptyState title="Not run yet" detail="Pass rates appear after the first analysis" action={<Button variant="secondary" render={<Link href="/runs">View runs</Link>} />} />
        ) : (
          <Line
            data={[...history.data.runs].reverse().map((r) => ({
              x: formatDate(r.run_at, "date"),
              y: r.pass_rate != null ? r.pass_rate * (r.pass_rate <= 1 ? 100 : 1) : 0,
              object: r.module,
              ruleId: data.id,
              runId: r.version_id,
            }))}
            onPointClick={(p) => router.push(buildDrillHref({ object: p.object ?? data.module, ruleId: data.id, run: p.runId ?? "" }))}
          />
        )}
      </div></Card>

      {conditionList(data.conditions).length ? <Card title="Conditions"><ConditionList conditions={conditionList(data.conditions)} /></Card> : null}
      {data.thresholds ? <Card title="Thresholds"><ThresholdTable thresholds={data.thresholds} /></Card> : null}

      <p className="m-text-body">
        <DrillLink object={data.module} ruleId={checkId}>See failing records</DrillLink>
      </p>
      </>} />
    </div>
  );
}
