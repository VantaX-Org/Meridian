"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import {
  Button, DataTable, DrillLink, EmptyState, ErrorState, ExportMenu, Line, Mono, Pill, Skeleton, Stat,
  buildDrillHref,
} from "@/design";
import { exportRuleHistory, getRule, getRuleHistory, updateRule } from "@/lib/api/rules";
import { getRuleApplicability, type SystemApplicability } from "@/lib/api/config-load";
import { apiErrorMessage } from "@/lib/error";
import { checkClassLabel, formatDate, formatModuleName, labelOf } from "@/lib/format";
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

export default function RulePage() {
  const { ruleId } = useParams<{ ruleId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: queryKeys.ruleDetail(ruleId), queryFn: () => getRule(ruleId) });
  const history = useQuery({ queryKey: queryKeys.ruleHistory(ruleId), queryFn: () => getRuleHistory(ruleId, { limit: 20 }) });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => updateRule(ruleId, { enabled }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: queryKeys.ruleDetail(ruleId) }); qc.invalidateQueries({ queryKey: ["rules"] }); },
    onError: (e) => toast.error((e as Error).message || "Not saved"),
  });

  if (isLoading) return <Skeleton height={320} />;
  if (isError && isAxiosError(error) && error.response?.status === 404) {
    return (
      <EmptyState
        title="Rule not found."
        action={<Button render={<Link href="/rules">All rules</Link>} />}
      />
    );
  }
  if (isError || !data) return <ErrorState message={apiErrorMessage(error)} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Mono>{ruleId}</Mono>
          <strong>{data.name}</strong>
          <Pill tone={SEV_TONE[data.severity] ?? "neutral"}>{labelOf(data.severity)}</Pill>
          <Pill tone={data.enabled ? "go" : "neutral"}>{labelOf(data.enabled ? "enabled" : "disabled")}</Pill>
        </div>
        <ExportMenu options={[{ format: "xlsx", run: () => exportRuleHistory(ruleId, "xlsx") }]} />
      </header>
      {data.description ? <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>{data.description}</p> : null}

      <dl className="flex flex-col gap-1 text-[13px]">
        <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Object</dt><dd>{formatModuleName(data.module)}</dd></div>
        <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>System</dt><dd>{labelOf(data.category)}</dd></div>
        <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Source</dt><dd>{labelOf(SOURCE_LABEL[data.source] ?? data.source)}{data.source_yaml ? `, ${data.source_yaml}` : ""}</dd></div>
        <div className="flex justify-between"><dt style={{ color: "var(--m-ink-3)" }}>Last run</dt><dd>{data.last_pass_rate != null ? `${(data.last_pass_rate * (data.last_pass_rate <= 1 ? 100 : 1)).toFixed(1)} %` : "not run yet"}</dd></div>
      </dl>

      {data.tags?.length ? <div className="flex flex-wrap gap-1">{data.tags.map((t) => <Pill key={t} tone="neutral">{t}</Pill>)}</div> : null}

      <WhereItApplies checkId={data.id} module={data.module} />

      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold">Pass rate over runs</h2>
        <div className="flex gap-6">
          <Stat
            label="Last pass rate"
            value={data.last_pass_rate != null ? `${(data.last_pass_rate * (data.last_pass_rate <= 1 ? 100 : 1)).toFixed(1)} %` : "—"}
          />
          <Stat label="Last run" value={formatDate(data.last_run_at, "datetime")} />
        </div>
        {history.isLoading ? (
          <Skeleton height={120} />
        ) : !history.data || history.data.runs.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>This rule has not run yet.</p>
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
      </section>

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
        <DrillLink object={data.module} ruleId={data.id}>See failing records</DrillLink>
      </p>
    </div>
  );
}
