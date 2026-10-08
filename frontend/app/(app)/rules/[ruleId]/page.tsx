"use client";

import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, DrillLink, ErrorState, Mono, Pill, Skeleton } from "@/design";
import { getRule, updateRule } from "@/lib/api/rules";
import { checkClassLabel, formatModuleName, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const SEV_TONE: Record<string, "no-go" | "at-risk" | "neutral"> = { critical: "no-go", high: "no-go", medium: "at-risk", low: "neutral", info: "neutral" };
const SOURCE_LABEL: Record<string, string> = { yaml: "built-in", hq: "HQ", mined: "mined", custom: "custom" };
const conditionList = (conditions: Record<string, unknown>[] | Record<string, unknown> | null) =>
  Array.isArray(conditions) ? conditions : conditions ? [conditions] : [];

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
