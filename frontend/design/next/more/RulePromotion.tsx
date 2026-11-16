"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applyPromotion, getPromotionModules, getPromotionPreview, promoteAnyway, revertPromotion, type PromotionBucket, type PromotionModule, type PromotionPreview, type PromotionRule } from "@/lib/api/v2/rule-promotion";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, Skeleton, StatCard, Stepper, useToast, type Column, type StepItem } from "../kit";
import { SegBar } from "../kit/viz";

/** A failure rate (0..1) as a percentage; tiny non-zero rates keep three decimals so they never read as zero. */
export const ratePct = (rate: number) => `${(rate * 100).toFixed(rate > 0 && rate < 0.001 ? 3 : 1)}%`;

const BUCKETS: PromotionBucket[] = ["promote", "review", "needs_value_set", "skip_unused"];
const BUCKET_TONE = { promote: "good", review: "warn", needs_value_set: "data", skip_unused: "quiet" } as const;

function bucketName(b: PromotionBucket): string {
  if (b === "promote") return t("Ready to promote");
  if (b === "review") return t("Needs review");
  if (b === "needs_value_set") return t("Needs a value set");
  return t("Skipped, unused");
}

function reasonText(reason: string): string {
  const map: Record<string, string> = {
    within_threshold: t("Failure rate is within the threshold"),
    failure_rate_high: t("Failure rate is above the threshold"),
    no_value_set: t("The system's live configuration has no value list for it"),
    not_extracted: t("The field was not extracted"),
    empty: t("The field is empty"),
    sparse: t("Too few records fill the field"),
    few_records: t("Too few records to judge"),
    not_evaluable: t("The rule could not be evaluated"),
  };
  return map[reason] ?? labelText(reason);
}

/**
 * Aletheia rule promotion, native: generated rules are dry-run on the latest extraction, sorted into buckets,
 * and only the ones that hold are promoted. Reads need `view`, every write needs `manage_rules`.
 */
export function RulePromotion() {
  const fixture = useFixture();
  const modules = useQuery({ queryKey: ["rule-promotion", fixture, "modules"], queryFn: getPromotionModules, staleTime: 30 * 1000 });
  const [picked, setPicked] = useState<string | null>(null);
  const list = modules.data?.modules ?? [];
  const object = picked ?? list[0]?.module ?? null;
  const total = list.reduce((s, m) => s + m.generated, 0);
  const promoted = list.reduce((s, m) => s + m.promoted, 0);

  if (modules.isPending) return <Skeleton lines={6} />;
  if (modules.isError) return <ErrorState sentence={errorSentence(modules.error, t("The generated rules could not be read."))} onRetry={() => void modules.refetch()} />;

  const columns: Column<PromotionModule>[] = [
    { id: "object", label: t("Object"), cell: (m) => moduleText(m.module), compare: (a, b) => a.module.localeCompare(b.module) },
    { id: "generated", label: t("Generated"), align: "end", cell: (m) => int(m.generated), compare: (a, b) => a.generated - b.generated },
    { id: "promoted", label: t("Promoted"), align: "end", cell: (m) => int(m.promoted), compare: (a, b) => a.promoted - b.promoted },
    ...BUCKETS.map((b): Column<PromotionModule> => ({
      id: b,
      label: bucketName(b),
      align: "end",
      cell: (m) => (m.summary ? int(m.summary[b]) : <span className="nx-sub">{t("Not evaluated yet. Press Preview.")}</span>),
    })),
    {
      id: "open",
      label: t("Open"),
      cell: (m) => (
        <span data-testid={`promo-module-${m.module}`}>
          <Button variant={m.module === object ? "secondary" : "quiet"} aria-pressed={m.module === object} onClick={() => setPicked(m.module)}>{t("Open")}</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="nx-body" data-testid="rule-promotion-screen">
      <section className="nx-card" data-testid="rule-promotion">
        <h2>{t("{n, plural, one {# generated rule} other {# generated rules}} wait to be proved on your data", { n: Math.max(0, total - promoted) })}</h2>
        <p className="nx-sub">{t("Aletheia generated these rules from the SAP data dictionary. Pick an object, preview what each rule does on your data, then approve the ones that hold.")}</p>
        <p className="nx-sub">{t("Each rule is dry-run on your latest extraction first. Only rules that hold on your data are promoted, and every promotion is audited and can be reverted.")}</p>
        <div className="nx-statgrid">
          <StatCard label={t("Promoted")} value={promoted} format={int} />
          <StatCard label={t("Generated")} value={total} format={int} />
        </div>
        <ul className="nx-sub">
          <li>{t("Rules switched on after proving themselves on your data.")}</li>
          <li>{t("All rules Aletheia wrote for the objects below.")}</li>
        </ul>
        {total > 0 ? (
          <SegBar format={int} segs={[
            { key: "promoted", label: t("Promoted"), value: promoted, tone: "good" },
            { key: "waiting", label: t("Generated"), value: Math.max(0, total - promoted), tone: "quiet" },
          ]} />
        ) : null}
      </section>

      <section className="nx-card" data-testid="rule-promotion-modules">
        <h2>{t("Objects")}</h2>
        <p className="nx-sub">{t("Bucket counts from the last evaluation.")}</p>
        <DataTable rows={list} columns={columns} rowKey={(m) => m.module} rowLabel={(m) => moduleText(m.module)} caption={t("Objects")} empty={{ heading: t("No object has generated rules.") }} />
      </section>

      {object ? <ObjectPanel key={object} object={object} /> : null}
    </div>
  );
}

function ObjectPanel({ object }: { object: string }) {
  const fixture = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useV2Session();
  const allowed = can("manage_rules");
  const [run, setRun] = useState(false);
  const q = useQuery({ queryKey: ["rule-promotion", fixture, "preview", object], queryFn: () => getPromotionPreview(object), enabled: run, staleTime: 0 });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["rule-promotion", fixture] });
  const fail = (e: unknown) => toast({ text: errorSentence(e, t("The change could not be saved.")), tone: "bad" });
  const apply = useMutation({
    mutationFn: () => applyPromotion(object),
    onSuccess: (r) => { toast({ text: t("{n, plural, one {# rule promoted} other {# rules promoted}}", { n: r.enabled.length }), tone: "good" }); refresh(); },
    onError: fail,
  });
  const revert = useMutation({
    mutationFn: (ids?: string[]) => revertPromotion(object, ids),
    onSuccess: (r) => { toast({ text: t("{n, plural, one {# rule reverted} other {# rules reverted}}", { n: r.reverted.length }), tone: "good" }); refresh(); },
    onError: fail,
  });

  const data = q.data;
  const ready = data?.counts.promote ?? 0;
  const current = !data ? 1 : ready > 0 ? 2 : 3;
  const labels = [t("Pick an object"), t("Preview on your data"), t("Approve the ready rules"), t("Watch for drift")];
  const steps: StepItem[] = labels.map((label, i) => ({ id: String(i), label, state: i < current ? "done" : i === current ? "current" : "future" }));
  const name = moduleText(object);

  return (
    <section className="nx-card" data-testid="rule-promotion-detail">
      <h2>{t("{object} rules", { object: name })}</h2>
      <p className="nx-sub">{t("Preview changes nothing. Apply promotes the ready rules.")}</p>
      <div data-testid="promo-steps"><Stepper steps={steps} label={t("Promotion steps")} /></div>
      <div className="nx-row nx-wrap">
        <Button variant={data ? "secondary" : "primary"} loading={q.isFetching} loadingLabel={t("Working…")} onClick={() => (run ? void q.refetch() : setRun(true))} data-testid="promo-preview">
          {t("Preview")}
        </Button>
        {allowed && data ? (
          <>
            <Button variant="primary" disabled={ready === 0} loading={apply.isPending} onClick={() => apply.mutate()} data-testid="promo-apply">
              {t("{n, plural, one {Approve the top candidate: promote # rule} other {Approve the top candidates: promote # rules}}", { n: ready })}
            </Button>
            <Button variant="quiet" disabled={data.promoted === 0} loading={revert.isPending} onClick={() => revert.mutate(undefined)} data-testid="promo-revert">
              {t("Revert all promotions")}
            </Button>
          </>
        ) : null}
      </div>
      {!allowed ? <p className="nx-sub" data-testid="promo-gate">{t("Managing rules needs the manage rules permission.")}</p> : null}
      {allowed && data && ready > 0 ? (
        <p className="nx-banner" data-tone="warn">
          {t("Approving switches on {n, plural, one {# rule} other {# rules}} for {object}. From the next run each raises an issue on every record it fails. Revert switches them off again.", { n: ready, object: name })}
        </p>
      ) : null}
      {!run ? (
        <p className="nx-sub">{t("Press Preview to dry-run the generated rules on the latest extraction.")}</p>
      ) : q.isPending ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={errorSentence(q.error, t("The rules could not be evaluated."))} onRetry={() => void q.refetch()} />
      ) : data ? (
        <Evaluated data={data} object={object} allowed={allowed} onRevert={(id) => revert.mutate([id])} onDone={refresh} />
      ) : null}
    </section>
  );
}

function Evaluated({ data, object, allowed, onRevert, onDone }: { data: PromotionPreview; object: string; allowed: boolean; onRevert: (id: string) => void; onDone: () => void }) {
  const [filter, setFilter] = useState<PromotionBucket | "promoted">("promote");
  const [anyway, setAnyway] = useState<PromotionRule | null>(null);
  const th = data.thresholds;
  const c = data.counts;
  const rows = data.rules.filter((r) => (filter === "promoted" ? r.promoted : !r.promoted && r.bucket === filter));
  const ruleText = new Map(data.rules.map((r) => [r.id, r.message]));

  const columns: Column<PromotionRule>[] = [
    { id: "rule", label: t("Rule"), cell: (r) => <Code code={r.id} text={r.message} />, compare: (a, b) => a.id.localeCompare(b.id) },
    { id: "field", label: t("Field"), cell: (r) => <Code code={r.field} text={r.field_text} />, compare: (a, b) => a.field.localeCompare(b.field) },
    { id: "check", label: t("Check"), cell: (r) => labelText(r.check_class) },
    {
      id: "rate",
      label: t("Failure rate"),
      align: "end",
      compare: (a, b) => (a.rate ?? -1) - (b.rate ?? -1),
      cell: (r) => (r.rate === null ? <span className="nx-sub">{reasonText(r.reason)}</span> : (
        <span className="nx-cell-stack"><span>{ratePct(r.rate)}</span><span className="nx-sub">{t("{n} failing", { n: int(r.failing) })}</span></span>
      )),
    },
    { id: "filled", label: t("Filled"), align: "end", compare: (a, b) => (a.populated_pct ?? -1) - (b.populated_pct ?? -1), cell: (r) => (r.populated_pct === null ? <span className="nx-sub">{reasonText(r.reason)}</span> : `${r.populated_pct}%`) },
    { id: "records", label: t("Records"), align: "end", compare: (a, b) => a.total - b.total, cell: (r) => int(r.total) },
    {
      id: "bucket",
      label: t("Bucket"),
      cell: (r) => (
        <span className="nx-cell-stack">
          <span>{r.promoted ? t("Promoted") : bucketName(r.bucket)}</span>
          <span className="nx-sub">{reasonText(r.reason)}</span>
          {r.bucket === "review" && !r.promoted && r.sample_keys.length > 0 ? <span className="nx-sub nx-mono">{t("Sample records")}: {r.sample_keys.join(", ")}</span> : null}
        </span>
      ),
    },
    {
      id: "action",
      label: t("Action"),
      cell: (r) =>
        allowed && r.promoted ? (
          <Button variant="quiet" onClick={() => onRevert(r.id)} data-testid={`revert-${r.id}`}>{t("Revert")}</Button>
        ) : allowed && r.bucket === "review" ? (
          <Button variant="secondary" onClick={() => setAnyway(r)} data-testid={`anyway-${r.id}`}>{t("Promote anyway")}</Button>
        ) : null,
    },
  ];

  return (
    <div className="nx-body">
      <p data-testid="promo-narrative">
        {t("{ready} ready to promote, {review} need review, {value} wait for a value set, {skipped} skipped.", { ready: int(c.promote), review: int(c.review), value: int(c.needs_value_set), skipped: int(c.skip_unused) })}{" "}
        {t("Promote when at least {pop}% of records fill the field, at most {fail} fail, and at least {n} records are checked.", { pop: th.min_populated_pct, fail: ratePct(th.max_failure_rate), n: int(th.min_records) })}
      </p>

      {data.drift.length > 0 ? (
        <div className="nx-banner" data-tone="bad" role="alert" data-testid="promo-drift">
          <strong>{t("{n, plural, one {# promoted rule is failing more than when it was promoted} other {# promoted rules are failing more than when they were promoted}}", { n: data.drift.length })}</strong>
          <ul className="nx-checklist">
            {data.drift.map((d) => (
              <li key={d.id} data-testid={`drift-${d.id}`} className="nx-cell-stack">
                <Code code={d.id} text={ruleText.get(d.id)} />
                <span className="nx-sub">{t("{from} then, {to} now, {failing} of {total} records", { from: ratePct(d.baseline_rate), to: ratePct(d.current_rate), failing: int(d.failing), total: int(d.total) })}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="nx-sub">{t("Rules by outcome of the preview")}</p>
      <SegBar testid="promo-buckets" format={int} segs={BUCKETS.map((b) => ({ key: b, label: bucketName(b), value: c[b], tone: BUCKET_TONE[b] }))} />

      <div className="nx-row nx-wrap" role="group" aria-label={t("Bucket")}>
        {[...BUCKETS, "promoted" as const].map((b) => (
          <span key={b} data-testid={`promo-chip-${b}`}>
            <Chip onClick={() => setFilter(b)} pressed={filter === b} count={b === "promoted" ? data.promoted : c[b]}>
              {b === "promoted" ? t("Promoted") : bucketName(b)}
            </Chip>
          </span>
        ))}
      </div>

      {anyway ? <AnywayForm rule={anyway} object={object} onClose={() => setAnyway(null)} onDone={() => { setAnyway(null); onDone(); }} /> : null}

      <div data-testid="promo-rules">
        {rows.length === 0 ? (
          <EmptyState heading={t("No rule is in this bucket.")} />
        ) : (
          <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} rowLabel={(r) => r.id} caption={t("Rules by outcome of the preview")} />
        )}
      </div>
    </div>
  );
}

function AnywayForm({ rule, object, onClose, onDone }: { rule: PromotionRule; object: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => promoteAnyway(object, [rule.id], reason.trim()),
    onSuccess: () => { toast({ text: t("Rule promoted. The reason is in the audit log."), tone: "good" }); onDone(); },
    onError: (e) => toast({ text: errorSentence(e, t("The rule could not be promoted.")), tone: "bad" }),
  });
  return (
    <section className="nx-card" data-testid="promo-anyway">
      <Code code={rule.id} text={rule.message} />
      <p>{t("This rule fails {rate} of records. Promoting it raises an issue on each. Say why it is right to promote it.", { rate: ratePct(rule.rate ?? 0) })}</p>
      <div className="nx-form">
        <label className="nx-field">
          <span>{t("Reason")}</span>
          <textarea className="nx-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="promo-anyway-reason" />
          <small className="nx-sub">{t("At least 5 characters. Kept in the audit log with the evidence.")}</small>
        </label>
      </div>
      <div className="nx-row nx-wrap">
        <Button variant="primary" disabled={reason.trim().length < 5} loading={m.isPending} onClick={() => m.mutate()} data-testid="promo-anyway-confirm">{t("Promote anyway")}</Button>
        <Button variant="quiet" onClick={onClose}>{t("Cancel")}</Button>
      </div>
    </section>
  );
}
