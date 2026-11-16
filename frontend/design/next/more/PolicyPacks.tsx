"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { applyPolicyPack, unapplyPolicyPack, type PolicyPack, type PolicyRuleEvidence } from "@/lib/api/v2/step10";
import { errorSentence } from "@/lib/api/v2/client";
import { formatDate } from "@/lib/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { useRunList } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { passRateText } from "@/lib/v2/step10";
import { refreshStep10, usePolicyEvidence, usePolicyPacks } from "@/lib/v2/step10-queries";
import { Button, Chip, Code, Confirm, DataTable, EmptyState, ErrorState, Skeleton, StatCard, useToast, type Column } from "../kit";

const SEVERITY = (): Record<string, string> => ({ critical: t("Critical"), high: t("High"), medium: t("Medium"), low: t("Low"), info: t("Info") });
const SEV_TONE: Record<string, "bad" | "warn" | "neutral"> = { critical: "bad", high: "bad", medium: "warn" };

/** Applied or not, with who and when, in words. */
export function appliedWords(p: PolicyPack): string {
  if (p.applied) return p.applied_at ? t("Applied {when} by {who}", { when: formatDate(p.applied_at, "date"), who: p.applied_by ?? "—" }) : t("Applied");
  return p.unapplied_at ? t("Not applied since {when}", { when: formatDate(p.unapplied_at, "date") }) : t("Not applied");
}

function Coverage({ p }: { p: PolicyPack }) {
  const c = p.coverage;
  return (
    <div className="nx-statgrid" data-testid="pack-coverage">
      <StatCard label={t("Fields classified")} value={c.fields_classified} format={int} />
      <StatCard label={t("Rules evidencing")} value={c.rules_evidencing} format={int} />
      <StatCard label={t("Rules measured")} value={c.rules_measured} format={int} />
      <StatCard label={t("Failing records")} value={c.failing_records} format={int} />
      <StatCard label={t("Classes breached")} value={c.classes_breached} format={int} />
    </div>
  );
}

/** Apply and remove, with manage_rules. Removing asks first: the breaches it counted stop counting at once. */
function PackActions({ p }: { p: PolicyPack }) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useV2Session().can("manage_rules");
  const [confirming, setConfirming] = useState(false);
  const fail = (e: unknown) => toast({ tone: "bad", text: errorSentence(e, t("It did not go through")) });
  const apply = useMutation({
    mutationFn: () => applyPolicyPack(p.id),
    onSuccess: async (r) => {
      await refreshStep10(qc, "packs");
      toast({ tone: "good", text: `${t("{name} applied", { name: p.name })}. ${t("{n} {n, plural, one {class} other {classes}} now count as policy breaches when one of their critical rules fails.", { n: r.classes ?? p.classes.length })}` });
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => unapplyPolicyPack(p.id),
    onSuccess: async () => {
      await refreshStep10(qc, "packs");
      setConfirming(false);
      toast({ tone: "good", text: t("{name} removed", { name: p.name }) });
    },
    onError: fail,
  });
  if (!can) return <p className="nx-sub" data-testid="pack-gate">{t("Applying or removing a pack needs the manage rules permission.")}</p>;
  return (
    <>
      {p.applied ? (
        <Button variant="secondary" disabled={remove.isPending} onClick={() => setConfirming(true)} data-testid={`pack-remove-${p.id}`}>{t("Remove the pack")}</Button>
      ) : (
        <Button variant="primary" loading={apply.isPending} onClick={() => apply.mutate()} data-testid={`pack-apply-${p.id}`}>{apply.isPending ? t("Applying…") : t("Apply the pack")}</Button>
      )}
      <Confirm
        open={confirming}
        title={t("Remove {name}", { name: p.name })}
        consequence={t("Its classes stop counting as policy breaches on the landscape and the receipt. The rules keep running; you can apply the pack again at any time.")}
        confirmLabel={t("Remove the pack")}
        danger
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

/** The evidence of a pack per class, for the current state or one run: authority, fields, and each rule's numbers. */
function Evidence({ id }: { id: string }) {
  const [run, setRun] = useState("");
  const runs = useRunList();
  const q = usePolicyEvidence(id, run || null);
  const sev = SEVERITY();
  const columns: Column<PolicyRuleEvidence>[] = [
    { id: "rule", label: t("Rule"), cell: (r) => <Link className="nx-link" href={`/more/rules/${encodeURIComponent(r.check_id)}`}><Code code={r.check_id} text={r.name ?? undefined} /></Link>, compare: (a, b) => a.check_id.localeCompare(b.check_id) },
    { id: "severity", label: t("Severity"), cell: (r) => (r.measured && r.severity ? <Chip tone={SEV_TONE[r.severity] ?? "neutral"}>{sev[r.severity] ?? r.severity}</Chip> : <span className="nx-sub">{t("Not measured")}</span>) },
    { id: "rate", label: t("Pass rate"), align: "end", cell: (r) => passRateText(r.pass_rate) ?? t("Not measured"), compare: (a, b) => (a.pass_rate ?? -1) - (b.pass_rate ?? -1) },
    { id: "failing", label: t("Failing"), align: "end", cell: (r) => (r.measured ? t("{failing} of {total}", { failing: int(r.failing_records), total: int(r.total_records) }) : t("Not measured")), compare: (a, b) => a.failing_records - b.failing_records },
  ];
  return (
    <section className="nx-body" data-testid={`pack-evidence-${id}`}>
      <h4>{t("Evidence")}</h4>
      <label className="nx-field">
        <span>{t("Evidence of")}</span>
        <select className="nx-input" value={run} onChange={(e) => setRun(e.target.value)} data-testid="pack-evidence-run">
          <option value="">{t("The current state")}</option>
          {(runs.data?.versions ?? []).map((v) => (
            <option key={v.id} value={v.id}>{t("Run {run_at}", { run_at: formatDate(v.run_at, "datetime") })}</option>
          ))}
        </select>
        <small className="nx-sub">{t("The current state reads every object at its latest run; a run reads that run only.")}</small>
      </label>
      {q.isPending ? (
        <Skeleton lines={4} />
      ) : q.isError ? (
        <ErrorState sentence={errorSentence(q.error, t("The evidence could not be read."))} onRetry={() => void q.refetch()} />
      ) : (
        <ul className="nx-pick" data-testid="pack-classes">
          {q.data.classes.map((c) => (
            <li key={c.id} className="nx-card" data-testid={`class-${c.id}`}>
              <div className="nx-row nx-wrap">
                <strong className="nx-row-main">{c.label}</strong>
                {c.breached ? <Chip tone="bad">{t("Breached")}</Chip> : c.rules_measured > 0 ? <Chip tone="good">{t("Evidenced")}</Chip> : <Chip>{t("No rule measured")}</Chip>}
              </div>
              <p className="nx-sub">{c.authority}</p>
              <p className="nx-sub">{t("{measured} of {count} rules measured, pass rate {rate}, {failing} failing records", { measured: c.rules_measured, count: c.rules_count, rate: passRateText(c.pass_rate) ?? "—", failing: int(c.failing_records) })}</p>
              <div className="nx-row nx-wrap" aria-label={t("Fields of {label}", { label: c.label })}>
                {c.fields.map((f) => <Code key={f} code={f} />)}
              </div>
              {c.rules.length ? (
                <DataTable rows={c.rules} columns={columns} rowKey={(r) => r.check_id} rowLabel={(r) => r.check_id} caption={t("Rules evidencing {label}", { label: c.label })} density="compact" />
              ) : (
                <p className="nx-sub">{t("No catalogue rule checks these fields yet: the class is listed so the gap is visible.")}</p>
              )}
              {c.failing_records > 0 ? (
                <Link className="nx-link" href={`/work?policy=${encodeURIComponent(`${id}:${c.id}`)}&filter=open`}>{t("Open the failing records in Work")}</Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Pack({ p }: { p: PolicyPack }) {
  const [open, setOpen] = useState(false);
  const breached = p.applied && p.coverage.classes_breached > 0;
  return (
    <li className="nx-card" data-testid={`pack-${p.id}`}>
      <div className="nx-row nx-wrap">
        <h3 className="nx-row-main">{p.name}</h3>
        <Chip tone={p.applied ? "good" : "neutral"}>{p.applied ? t("Applied") : t("Not applied")}</Chip>
        {breached ? (
          <span title={t("{count} policy {count, plural, one {class} other {classes}} breached: a critical rule evidencing an applied policy pack fails", { count: p.coverage.classes_breached })}>
            <Chip tone="bad" count={p.coverage.classes_breached}>{t("Classes breached")}</Chip>
          </span>
        ) : null}
      </div>
      <p className="nx-sub">{p.authority}</p>
      <p>{p.description}</p>
      <Coverage p={p} />
      <p className="nx-sub">{appliedWords(p)}</p>
      <div className="nx-row nx-wrap">
        <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid={`pack-open-${p.id}`}>{t("Open the classes and evidence")}</Button>
        <PackActions p={p} />
      </div>
      {open ? <Evidence id={p.id} /> : null}
    </li>
  );
}

/** Policy packs, native: every pack with its coverage, applied or not, apply or remove, and its classes with their evidence. */
export function PolicyPacks() {
  const { can } = useV2Session();
  const allowed = can("view") || can("manage_rules");
  const q = usePolicyPacks(allowed);
  if (!allowed) return <EmptyState heading={t("Policy packs")}>{t("Reading policy packs needs the view permission.")}</EmptyState>;
  return (
    <section className="nx-body" data-testid="policy-packs-screen">
      <p className="nx-sub">
        {q.data
          ? t("{applied} of {n} packs applied. An applied pack's classes count as policy breaches on the landscape and the receipt when one of their critical rules fails. Authorities are cited by article or section.", { applied: q.data.applied, n: q.data.packs.length })
          : t("GxP, SOX and GDPR field classes, the authority each answers to, and the rules that evidence them.")}
      </p>
      {q.isPending ? (
        <Skeleton lines={6} />
      ) : q.isError ? (
        <ErrorState sentence={errorSentence(q.error, t("The policy packs could not be read."))} onRetry={() => void q.refetch()} />
      ) : q.data.packs.length === 0 ? (
        <EmptyState heading={t("Policy packs")}>{t("No policy pack ships with this version.")}</EmptyState>
      ) : (
        <ul className="nx-pick" data-testid="policy-packs">
          {q.data.packs.map((p) => <Pack key={p.id} p={p} />)}
        </ul>
      )}
    </section>
  );
}
