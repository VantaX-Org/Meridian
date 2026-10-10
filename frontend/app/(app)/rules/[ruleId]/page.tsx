"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, DrillLink, EmptyState, ErrorState, Mono, Pill, Skeleton } from "@/design";
import { OwnerPicker } from "@/components/owners/OwnerPicker";
import { getRule, updateRule } from "@/lib/api/rules";
import { getRuleApplicability, type SystemApplicability } from "@/lib/api/config-load";
import { getRuleLineage } from "@/lib/api/lineage";
import { checkClassLabel, formatModuleName, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

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

const SEV_TONE: Record<string, "no-go" | "at-risk" | "neutral"> = { critical: "no-go", high: "no-go", medium: "at-risk", low: "neutral", info: "neutral" };
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
              <div key={i} className="text-[12px]">
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
    <section>
      <h2 className="text-[13px] font-semibold">Where it applies</h2>
      {q.isLoading ? (
        <Skeleton height={120} />
      ) : q.isError ? (
        <ErrorState message="Where this rule applies could not be read." onRetry={() => q.refetch()} />
      ) : systems.length === 0 ? (
        <EmptyState title="No system is connected. Add a system and load its configuration to see where this rule applies." />
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
    body = <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Lineage is shown for built-in rules only.</p>;
  } else if (q.isLoading) {
    body = <Skeleton height={96} />;
  } else if (q.isError || !q.data) {
    body = <ErrorState message="Lineage for this rule could not be read." onRetry={() => q.refetch()} />;
  } else {
    const l = q.data;
    body = (
      <dl className="flex flex-col gap-1 text-[13px]">
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
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold">Lineage and ownership</h2>
      {body}
      <OwnerPicker kind="rule" refId={checkId} />
    </section>
  );
}

export default function RulePage() {
  const { ruleId } = useParams<{ ruleId: string }>();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: queryKeys.ruleDetail(ruleId), queryFn: () => getRule(ruleId) });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => updateRule(ruleId, { enabled }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: queryKeys.ruleDetail(ruleId) }); qc.invalidateQueries({ queryKey: ["rules"] }); },
    onError: (e) => toast.error((e as Error).message || "Not saved"),
  });

  if (isLoading) return <Skeleton height={320} />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || "Could not load this rule."} onRetry={() => refetch()} />;

  // Rule names are "{check id}: {message}"; data.id is the rules row UUID, not the check id.
  const checkId = data.name.split(":")[0];

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center gap-3">
        <Mono>{ruleId}</Mono>
        <strong>{data.name}</strong>
        <Pill tone={SEV_TONE[data.severity] ?? "neutral"}>{labelOf(data.severity)}</Pill>
        <Pill tone={data.enabled ? "go" : "neutral"}>{labelOf(data.enabled ? "enabled" : "disabled")}</Pill>
      </header>
      {data.description ? <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>{data.description}</p> : null}

      <dl className="flex flex-col gap-1 text-[13px]">
        <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Object</dt><dd>{formatModuleName(data.module)}</dd></div>
        <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>System</dt><dd>{labelOf(data.category)}</dd></div>
        <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Source</dt><dd>{labelOf(SOURCE_LABEL[data.source] ?? data.source)}{data.source_yaml ? `, ${data.source_yaml}` : ""}</dd></div>
        <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Last run</dt><dd>{data.last_pass_rate != null ? `${(data.last_pass_rate * (data.last_pass_rate <= 1 ? 100 : 1)).toFixed(1)} %` : "not run yet"}</dd></div>
      </dl>

      {data.tags?.length ? <div className="flex flex-wrap gap-1">{data.tags.map((t) => <Pill key={t} tone="neutral">{t}</Pill>)}</div> : null}

      <WhereItApplies checkId={checkId} module={data.module} />

      <LineageAndOwnership checkId={checkId} builtIn={data.source === "yaml"} />

      {conditionList(data.conditions).length ? (
        <section>
          <h2 className="text-[13px] font-semibold">Conditions</h2>
          {conditionList(data.conditions).some((c) => typeof c.check_class === "string") ? (
            <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
              {conditionList(data.conditions).map((c) => (typeof c.check_class === "string" ? checkClassLabel(c.check_class) : null)).filter(Boolean).join(", ")}
            </p>
          ) : null}
          <pre className="text-[12px] overflow-auto">{JSON.stringify(data.conditions, null, 2)}</pre>
        </section>
      ) : null}
      {data.thresholds ? (
        <section>
          <h2 className="text-[13px] font-semibold">Thresholds</h2>
          <pre className="text-[12px] overflow-auto">{JSON.stringify(data.thresholds, null, 2)}</pre>
        </section>
      ) : null}

      <Button variant={data.enabled ? "secondary" : "primary"} onClick={() => toggle.mutate(!data.enabled)} disabled={toggle.isPending}>
        {data.enabled ? "Disable rule" : "Enable rule"}
      </Button>

      <p className="text-[13px]">
        <DrillLink object={data.module} ruleId={checkId}>See failing records</DrillLink>
      </p>
    </div>
  );
}
