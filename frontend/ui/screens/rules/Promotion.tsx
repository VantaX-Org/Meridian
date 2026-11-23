"use client";

import "./rules.css";
import { useState } from "react";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { applyPromotion, promoteAnyway, revertPromotion, type PromotionBucket, type PromotionRule } from "@/lib/api/v2/rule-promotion";
import { formatModuleName } from "@/lib/format";
import { describeField } from "@/lib/v2/sap-fields";
import { Button, Card, DataTable, EmptyState, ErrorState, Field, FieldChip, Input, PageHeader, Select, Skeleton, StatTile, useAletheia, useAletheiaScope, type Column } from "@/ui/kit";
import { compactCount, pct, sevLabel } from "./format";
import { useAct, usePromotionModules, usePromotionPreview } from "./queries";

const BUCKETS: PromotionBucket[] = ["promote", "review", "skip_unused", "needs_value_set"];
const bucketLabel = (b: PromotionBucket) => (b === "promote" ? t("Ready to switch on") : b === "review" ? t("Needs a look") : b === "skip_unused" ? t("Field not used") : t("Needs a value set"));

/** Journey J5 step five: switch on the generated rules that earned it, with the evidence beside each. */
export function Promotion() {
  useInterfaceLang();
  const fx = useFixture();
  const chat = useAletheia();
  const mods = usePromotionModules();
  const list = mods.data?.modules ?? [];
  const [pick, setPick] = useState("");
  const mod = pick || list[0]?.module || null;
  const prev = usePromotionPreview(mod);
  const [reason, setReason] = useState("");
  const [bucket, setBucket] = useState<PromotionBucket | "all">("all");
  const p = prev.data;
  const apply = useAct((m: string) => applyPromotion(m), () => t("Rules switched on"));
  const anyway = useAct((a: { m: string; ids: string[] }) => promoteAnyway(a.m, a.ids, reason), () => t("Rules switched on by hand"));
  const revert = useAct((m: string) => revertPromotion(m), () => t("Rules switched back off"));

  useAletheiaScope({
    key: `promotion/${mod ?? "all"}`,
    label: t("Asking about promotion"),
    suggestions: [t("Which rules are ready?")],
    answer: () => ({
      text: p ? p.narrative : t("Pick an object to see which generated rules are ready."),
      evidence: p ? BUCKETS.map((b) => `${bucketLabel(b)}: ${p.counts[b] ?? 0}`) : [],
      actions: [],
    }),
  });

  const rows = (p?.rules ?? []).filter((r) => bucket === "all" || r.bucket === bucket);
  const cols: Column<PromotionRule>[] = [
    { key: "id", label: t("Rule"), render: (r) => <code className="mx-code">{r.id}</code> },
    { key: "field", label: t("Field"), render: (r) => <FieldChip code={r.field} description={r.field_text || describeField(r.field) || ""} /> },
    { key: "severity", label: t("Severity"), render: (r) => sevLabel(r.severity) },
    { key: "bucket", label: t("Verdict"), render: (r) => bucketLabel(r.bucket) },
    { key: "failing", label: t("Failing"), align: "end", render: (r) => `${compactCount(r.failing)} / ${compactCount(r.total)}` },
    { key: "rate", label: t("Failure rate"), align: "end", render: (r) => pct(r.rate) },
    { key: "reason", label: t("Why"), render: (r) => r.reason },
  ];

  const review = (p?.rules ?? []).filter((r) => r.bucket === "review" && !r.promoted).map((r) => r.id);

  return (
    <>
      <PageHeader
        title={t("Rule promotion")}
        context={t("Generated rules wait switched off until the evidence says they are safe.")}
        actions={<>
          <Button variant="secondary" href={withFixture("/rules?view=drafts", fx)}>{t("Back to drafts")}</Button>
          <Button variant="secondary" href={withFixture("/admin/scoring", fx)}>{t("Scoring weights and thresholds")}</Button>
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
      />
      {mods.isLoading ? <Skeleton lines={6} label={t("Loading the objects")} /> : mods.isError ? <ErrorState heading={t("Promotion could not be loaded")} retryLabel={t("Try again")} onRetry={() => void mods.refetch()} /> : !list.length ? <EmptyState heading={t("No object has generated rules")} body={t("Run rule generation for an object to see its rules here.")} /> : (
        <div className="mx-col">
          <Card title={t("Objects with generated rules")}>
            <DataTable
              label={t("Objects with generated rules")}
              rowKey={(m) => m.module}
              rows={list}
              height={240}
              selected={mod ?? undefined}
              onSelect={(m) => setPick(m.module)}
              columns={[
                { key: "module", label: t("Object"), render: (m) => <FieldChip code={m.module} description={formatModuleName(m.module)} /> },
                { key: "generated", label: t("Generated"), align: "end", render: (m) => compactCount(m.generated) },
                { key: "promoted", label: t("Switched on"), align: "end", render: (m) => compactCount(m.promoted) },
              ]}
            />
          </Card>
          {prev.isLoading ? <Skeleton lines={6} label={t("Loading the evidence")} /> : p ? (
            <Card title={t("Evidence for {module}", { module: p.module })} sub={p.narrative}>
              <dl className="mx-tiles">
                {BUCKETS.map((b) => <StatTile key={b} label={bucketLabel(b)} value={compactCount(p.counts[b] ?? 0)} />)}
                <StatTile label={t("Already on")} value={compactCount(p.promoted)} />
              </dl>
              <div className="mx-rules-row">
                <Select aria-label={t("Show")} value={bucket} onChange={(e) => setBucket(e.target.value as PromotionBucket | "all")} options={[{ value: "all", label: t("All verdicts") }, ...BUCKETS.map((b) => ({ value: b, label: bucketLabel(b) }))]} />
                <Button variant="primary" disabled={!p.counts.promote || apply.isPending} onClick={() => apply.mutate(p.module)}>{t("Switch on the ready rules")}</Button>
                <Button variant="ghost" disabled={!p.promoted || revert.isPending} onClick={() => revert.mutate(p.module)}>{t("Switch them back off")}</Button>
              </div>
              <DataTable label={t("Generated rules")} rowKey={(r) => r.id} rows={rows} columns={cols} height={320} />
              {review.length ? (
                <div className="mx-rules-row">
                  <Field label={t("Reason for switching on by hand")}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                  <Button variant="secondary" disabled={!reason.trim() || anyway.isPending} onClick={() => anyway.mutate({ m: p.module, ids: review })}>{t("Switch on {n} rules anyway", { n: review.length })}</Button>
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
