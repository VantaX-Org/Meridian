"use client";

/**
 * One rule, natively, for the object page's rule sheet: its facts, definition, authority, scope, the S/4 features it
 * blocks and its run history, read from GET /rules/{id}/scope, the receipts of the objects it runs on, the object's
 * rules (value at risk) and /rules/{id}/history. Versions, contracts, proving in SAP, suppress and hand-off stay on
 * the full rule page ("Open as page").
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Chip, Code, Confirm, EmptyState, ErrorState, NxLink, Skeleton, Sparkline, useToast } from "@/design/next/kit";
import { useSheets } from "@/design/next/shell/SheetHost";
import { useFixture } from "@/lib/api/v2/fixture";
import { getObjectRules, getReceipt } from "@/lib/api/v2/landscape";
import { errorSentence } from "@/lib/api/v2/client";
import { setRuleEnabled } from "@/lib/api/v2/rulelib";
import { checkClassLabel, formatDate } from "@/lib/format";
import { useRuleAccuracy } from "@/lib/v2/admin-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { t, tx } from "@/lib/v2/i18n";
import { labelText, moneyCompactText } from "@/lib/v2/labels";
import { useRuleHistory, useRuleScope } from "@/lib/v2/object-queries";
import { v2Keys } from "@/lib/v2/queries";
import { describeField } from "@/lib/v2/sap-fields";
import { int, moduleSlug, pct1, systemSlug } from "@/lib/v2/score";
import { findingRecordsId } from "./RecordSheets";
import { Dash, ItemLink, SevChip } from "./tabs/tabs-g-parts";
import "../runs/runs.css";

const DIM_WORD = (d: string | null | undefined): string => (d ? d.charAt(0).toUpperCase() + d.slice(1) : "");
const AUTHORITY_WORD = (a: string): string => (({
  sap_hard_constraint: t("SAP hard constraint"),
  s4hana_migration: t("S/4HANA migration"),
  best_practice: t("Best practice"),
  customer_configured: t("Customer configured"),
}) as Record<string, string>)[a] ?? a;
const pct2 = (n: number): string => `${(Math.round(n * 100) / 100).toFixed(2)}%`;

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

export function RuleEvidence({ id }: { id: string }) {
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const session = useV2Session();
  const { open } = useSheets();
  const scopeQ = useRuleScope(id);
  const s = scopeQ.data;
  const modules = useMemo(() => Array.from(new Set((s?.objects ?? []).map((o) => o.module))).slice(0, 6), [s]);
  const receiptQs = useQueries({ queries: modules.map((m) => ({ queryKey: v2Keys.receipt(fx, m, null), queryFn: () => getReceipt(m, null), staleTime: 30_000, retry: false })) });
  const primary = s?.module ?? modules[0] ?? "";
  const rulesQ = useQuery({ queryKey: v2Keys.rules(fx, primary, null, 0), queryFn: () => getObjectRules(primary, null), staleTime: 30_000, enabled: Boolean(primary) });
  const proof = useRuleAccuracy().data?.rules.find((r) => r.rule_id === id);
  const hist = useRuleHistory(id);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);

  if (scopeQ.isLoading) return <Skeleton lines={6} label={t("Loading the rule")} />;
  if (scopeQ.isError || !s) {
    return (
      <ErrorState
        error={scopeQ.error}
        fallback={t("This rule could not be read. It may not run on any object yet.")}
        onRetry={() => void scopeQ.refetch()}
      />
    );
  }

  const receipts = receiptQs.map((q) => q.data).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const d = s.definition;
  const severity = d.severity ?? s.objects[0]?.severity ?? null;
  const row = (rulesQ.data ?? []).find((r) => r.check_id === id);
  const currency = receipts[0]?.currency ?? null;
  const tol = receipts[0]?.tolerance ?? null;
  const overTolerance = receipts.length === 0 ? (severity === "critical" ? null : false) : severity === "critical" ? receipts.some((r) => r.breaches.some((b) => b.check_id === id)) : false;
  const checked = s.objects.reduce((n, o) => n + (o.checked ?? 0), 0);
  const failingPct = checked > 0 ? (s.failing_records / checked) * 100 : null;
  const oneObject = s.objects.length === 1 ? s.objects[0].label : null;
  const params = Object.entries(d.params ?? {});
  const runId = s.objects.find((o) => o.module === primary)?.run_id ?? s.objects[0]?.run_id ?? null;
  const own = s.tenant_rule ?? null;
  const canToggle = session.can("manage_rules") && Boolean(own);

  // Failing records per run, oldest first, summed over the objects the rule runs on.
  const byRun = new Map<string, { at: string; n: number }>();
  for (const r of hist.data ?? []) byRun.set(r.version_id, { at: r.run_at, n: (byRun.get(r.version_id)?.n ?? 0) + r.affected_count });
  const trend = [...byRun.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-8);

  const toggle = async (on: boolean) => {
    if (!own) return;
    setBusy(true);
    try {
      await setRuleEnabled(own.id, on);
      toast({ text: on ? t("{id} is enabled; the next run checks it.", { id }) : t("{id} is disabled; the next run skips it.", { id }), tone: "good" });
      await qc.invalidateQueries({ queryKey: ["v2"] });
    } catch (e) {
      toast({ text: errorSentence(e, t("The rule could not be changed.")), tone: "bad" });
    } finally {
      setBusy(false);
      setConfirmOff(false);
    }
  };

  return (
    <div data-testid="rule-evidence">
      <p data-testid="rule-name">{s.name ?? d.message ?? t("Rule")}</p>

      <h3 className="nx-rn-h3">{t("Facts")}</h3>
      <dl className="nx-paired-row">
        <Fact label={t("Severity")}>{severity ? <SevChip severity={severity} /> : <Dash />}</Fact>
        <Fact label={t("Dimension")}>{d.dimension ? DIM_WORD(d.dimension) : <Dash />}</Fact>
        <Fact label={t("Field")}>{d.field ? <Code code={d.field} text={row?.field_description ?? describeField(d.field) ?? undefined} /> : <Dash />}</Fact>
        <Fact label={t("Tolerance")}>{severity === "critical" && tol ? t("{rows} rows", { rows: int(tol.rows) }) : <Dash why={t("Only critical rules carry a tolerance")} />}</Fact>
        <Fact label={t("Over tolerance")}>{overTolerance == null ? <Dash /> : overTolerance ? t("Yes") : t("No")}</Fact>
        <Fact label={t("Failing records")}>
          <span className="nx-num">{oneObject ? t("{failing_records} in {oneObject}", { failing_records: int(s.failing_records), oneObject }) : t("{failing_records} across {objectsCount} objects", { failing_records: int(s.failing_records), objectsCount: s.objects.length })}</span>
        </Fact>
        <Fact label={t("Failing %")}>{failingPct == null ? <Dash /> : <span className="nx-num">{t("{pct2} of {checked} records checked", { pct2: pct2(failingPct), checked: int(checked) })}</span>}</Fact>
        <Fact label={t("Value at risk")}>{row?.value_at_risk == null ? <Dash why={t("Not priced in this run")} /> : <span className="nx-num">{moneyCompactText(row.value_at_risk, currency)}</span>}</Fact>
      </dl>

      <div className="nx-rn-sub">
        <Button variant="secondary" size={32} onClick={() => open({ kind: "rule-reads", id })}>{t("What it reads")}</Button>
        {runId ? <Button variant="secondary" size={32} onClick={() => open({ kind: "finding-records", id: findingRecordsId(runId, id) })}>{t("Every failing record")}</Button> : null}
        <NxLink className="nx-btn nx-btn-secondary" href={`/issues?rule=${encodeURIComponent(id)}${primary ? `&module=${encodeURIComponent(primary)}` : ""}`}>{t("Open its issues")}</NxLink>
        {canToggle && own ? (
          own.enabled
            ? <Button variant="danger" size={32} loading={busy} onClick={() => setConfirmOff(true)}>{t("Disable rule")}</Button>
            : <Button variant="secondary" size={32} loading={busy} onClick={() => void toggle(true)}>{t("Enable rule")}</Button>
        ) : null}
      </div>

      <h3 className="nx-rn-h3">{t("Definition")}</h3>
      <dl className="nx-paired-row">
        {proof ? <Fact label={t("Test-proven")}>{t("Precision {precision}, recall {recall}", { precision: pct1(proof.precision), recall: pct1(proof.recall) })}</Fact> : null}
        <Fact label={t("Check class")}>{d.check_class ? <Code code={d.check_class} text={tx(checkClassLabel(d.check_class))} /> : <Dash />}</Fact>
        <Fact label={t("Expression")}>{d.expression ? <Code code={d.expression} /> : <Dash why={t("The rule has no stored expression")} />}</Fact>
        {params.map(([k, v]) => (
          <Fact key={k} label={labelText(k)}><Code code={typeof v === "string" ? v : JSON.stringify(v)} /></Fact>
        ))}
        <Fact label={t("Source")}>{d.source === "tenant" ? t("Written by your team") : d.source === "shipped" ? t("Shipped with Meridian") : <Dash />}</Fact>
      </dl>
      {d.message && d.message !== s.name ? <p className="nx-rn-note">{d.message}</p> : null}

      <h3 className="nx-rn-h3">{t("Authority")}</h3>
      {s.authority.rule_authority ? <p><Chip tone="accent">{AUTHORITY_WORD(s.authority.rule_authority)}</Chip></p> : <p className="nx-muted">{t("The rule does not state an authority.")}</p>}
      {s.authority.why_it_matters ? <p>{s.authority.why_it_matters}</p> : null}
      {s.authority.sap_impact && s.authority.sap_impact !== s.authority.why_it_matters ? <p>{t("In SAP: {sap_impact}", { sap_impact: s.authority.sap_impact })}</p> : null}

      <h3 className="nx-rn-h3">{t("Scope: {objectsCount} {objectsCount, plural, one {object} other {objects}}, {systemsCount} {systemsCount, plural, one {system} other {systems}}", { objectsCount: s.objects.length, systemsCount: s.systems.length })}</h3>
      {s.objects.length === 0 ? (
        <EmptyState heading={t("No run has measured this rule yet.")} />
      ) : (
        <ul className="nx-rn-sub">
          {s.objects.map((o) => (
            <li key={`${o.system_id}:${o.module}`}>
              <NxLink className="nx-link" href={`/o/${systemSlug(o.system_name ?? o.system_id)}/${moduleSlug(o.module)}`}>{o.label}</NxLink>{" "}
              <span className="nx-muted">{t("{system_name}{value}, {failing} failing", { system_name: o.system_name ?? "", value: o.run_at ? t(", run {run_at}", { run_at: formatDate(o.run_at, "date") }) : "", failing: int(o.failing) })}</span>
            </li>
          ))}
        </ul>
      )}
      {s.systems.length > 0 ? (
        <ul className="nx-rn-sub">
          {s.systems.map((sys) => (
            <li key={sys.id}>
              <ItemLink kind="system" id={sys.id}>{sys.name ?? t("System")}</ItemLink>{" "}
              <span className="nx-muted">{t("{failing} failing in {objects} {objects, plural, one {object} other {objects}}", { failing: int(sys.failing), objects: sys.objects })}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <h3 className="nx-rn-h3">{t("Blocks: {fCount} S/4 {fCount, plural, one {feature} other {features}}", { fCount: s.features.length })}</h3>
      {s.features.length === 0 ? (
        <p className="nx-muted">{t("No S/4 feature is mapped to this rule yet.")}</p>
      ) : (
        <ul className="nx-rn-sub">
          {s.features.map((f) => (
            <li key={`${f.feature}:${f.status}`}>
              <ItemLink kind="feature" id={f.feature} /> <Chip tone={f.status === "blocked" ? "bad" : "warn"}>{f.status === "blocked" ? t("Blocked") : t("Degraded")}</Chip>
            </li>
          ))}
        </ul>
      )}

      <h3 className="nx-rn-h3">{t("History")}</h3>
      {hist.isLoading ? <Skeleton lines={2} label={t("Loading the history")} /> : hist.isError ? (
        <ErrorState fallback={t("The run history could not be read for this rule.")} error={hist.error} onRetry={() => void hist.refetch()} />
      ) : trend.length === 0 ? (
        <p className="nx-muted">{t("No run has measured this rule yet.")}</p>
      ) : (
        <div className="nx-rn-sub">
          <Sparkline points={trend.map((x) => x.n)} label={t("Failing records over the last {count} runs: {first} to {last}", { count: trend.length, first: int(trend[0].n), last: int(trend[trend.length - 1].n) })} />
          <span className="nx-muted">{t("Failing records, last {count} runs", { count: trend.length })}</span>
        </div>
      )}

      <Confirm
        open={confirmOff}
        title={t("Disable rule")}
        consequence={t("Disable {id}? The next run skips it, so its failures stop counting in the score. You can enable it again.", { id })}
        confirmLabel={t("Disable rule")}
        danger
        onConfirm={() => void toggle(false)}
        onCancel={() => setConfirmOff(false)}
      />
    </div>
  );
}
