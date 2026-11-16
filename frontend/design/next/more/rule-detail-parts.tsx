"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { t } from "@/lib/v2/i18n";
import { int, f1 } from "@/lib/v2/score";
import { describeField } from "@/lib/v2/sap-fields";
import { moduleText, moneyCompactText } from "@/lib/v2/labels";
import { useV2Session } from "@/lib/v2/hooks";
import { useFindingRootCause, useRuleFailuresBy, useStewards } from "@/lib/v2/object-queries";
import { useMoney } from "@/lib/v2/step9-queries";
import { BLAST_COLUMNS, blastModel, pathThrough, type BlastColumn } from "@/lib/v2/blast-radius";
import { useFixture } from "@/lib/api/v2/fixture";
import { getBlastRadius, getRuleLineage } from "@/lib/api/v2/lineage";
import { exportFindingRecords } from "@/lib/api/findings";
import { handOffRule, suppressRule, type RootCauseOrigin } from "@/lib/api/v2/object";
import { setRuleEnabled } from "@/lib/api/v2/rulelib";
import { errorSentence } from "@/lib/api/v2/client";
import { Button, Code, Confirm, DataTable, EmptyState, ErrorState, NxLink, PartBar, Skeleton, useToast, type Column } from "../kit";
import { useSheets } from "../shell/SheetHost";
import { findingRecordsId } from "../object/RecordSheets";
import { Fact } from "../shell/inspector/frame";
import { Dash, Note, Sec } from "../shell/inspector/work-common";
import type { RuleView } from "../shell/inspector/rule";

const firstRun = (v: RuleView): string | null => v.scope.objects.find((o) => o.run_id)?.run_id ?? null;
const moduleOf = (v: RuleView): string => v.scope.module ?? v.scope.objects[0]?.module ?? "";

/** Where the failures sit: one bar per grouping field the API returns, top eight values. */
export function RuleFailuresBy({ id }: { id: string }) {
  const q = useRuleFailuresBy(id);
  if (q.isPending) return <Skeleton lines={3} label={t("Loading the failing records")} />;
  if (q.isError) return <ErrorState sentence={t("Where the failures sit could not be read.")} onRetry={() => void q.refetch()} />;
  const groups = q.data?.groups ?? [];
  if (!groups.length) return <EmptyState heading={t("No breakdown yet")}>{t("The failing records of this rule are not split by plant or another field yet.")}</EmptyState>;
  return (
    <>
      {groups.map((g) => {
        const top = [...g.values].sort((a, b) => b.records - a.records).slice(0, 8);
        return (
          <section key={g.field} className="nx-ib-sec" data-testid={`rule-by-${g.field}`}>
            <h3>{g.field === "WERKS" ? t("Plant") : <Code code={g.field} text={describeField(g.field) ?? undefined} />}</h3>
            {top.length > 1 ? <PartBar segments={top.map((x) => ({ label: x.value, value: x.records }))} label={t("Failing records by {field}", { field: g.field })} format={int} /> : null}
            <ul className="nx-ib-list">
              {top.map((x) => (
                <li key={x.value} className="nx-row">
                  <Code code={x.value} text={g.field === "WERKS" ? t("Plant") : describeField(g.field) ?? undefined} />
                  <span className="nx-sub">{t("{n} failing", { n: int(x.records) })}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

const ORIGIN: Record<RootCauseOrigin["origin"], () => string> = {
  interface: () => t("Interface or batch user"),
  dialog: () => t("Person in a dialog transaction"),
  migration: () => t("Migration load before go-live"),
  unknown: () => t("No change document"),
};

/** Who set the failing values, from SAP change documents. */
export function RuleRootCause({ view }: { view: RuleView }) {
  const run = view.scope.objects[0]?.run_id ?? null;
  const q = useFindingRootCause(view.id, run);
  const title = t("Who set these values");
  if (!run) return <Sec title={title}><Note>{t("This rule has no run yet.")}</Note></Sec>;
  if (q.isError) return <Sec title={title}><ErrorState sentence={t("Who set the values of this rule could not be read.")} onRetry={() => void q.refetch()} /></Sec>;
  if (q.isPending) return <Sec title={title}><Skeleton lines={3} label={title} /></Sec>;
  const rc = q.data;
  if (rc.status === "not_computed") return <Sec title={title}><Note>{t("Not worked out for this run. It is read from SAP change documents after an analysis of a connected SAP system.")}</Note></Sec>;
  if (rc.status !== "computed") return <Sec title={title}><Note>{rc.detail || t("Not available for this rule.")}</Note></Sec>;
  const columns: Column<RootCauseOrigin>[] = [
    { id: "origin", label: t("Origin"), cell: (r) => ORIGIN[r.origin]?.() ?? r.origin },
    { id: "user", label: t("SAP user"), cell: (r) => r.username || <Dash /> },
    { id: "tcode", label: t("Transaction"), cell: (r) => (r.tcode ? <Code code={r.tcode} text={t("Transaction")} /> : <Dash />) },
    { id: "records", label: t("Records"), align: "end", cell: (r) => int(r.records), compare: (a, b) => a.records - b.records },
    { id: "share", label: t("Share"), align: "end", cell: (r) => `${f1(r.share)}%`, compare: (a, b) => a.share - b.share },
  ];
  return (
    <Sec title={title} testId="rule-root-cause">
      <p data-testid="root-cause-sentence">{rc.summary}</p>
      {rc.field ? (
        <p className="nx-sub">
          <Code code={rc.field} text={describeField(rc.field) ?? undefined} /> {t("{analysed} of {total} failing records traced.", { analysed: int(rc.analysed), total: int(rc.total) })}
        </p>
      ) : null}
      {rc.origins.length > 1 ? <PartBar segments={rc.origins.map((o) => ({ label: ORIGIN[o.origin]?.() ?? o.origin, value: o.records }))} label={t("Failing records by who set the value")} format={int} /> : null}
      <DataTable
        rows={rc.origins}
        columns={columns}
        rowKey={(r) => `${r.origin}-${r.username}-${r.tcode}`}
        rowLabel={(r) => `${ORIGIN[r.origin]?.() ?? r.origin} ${r.username}`}
        caption={title}
        empty={{ heading: t("No origin traced"), text: t("No change document names who set these values.") }}
      />
    </Sec>
  );
}

const HEADINGS: Record<BlastColumn, () => string> = {
  field: () => t("Fields read"),
  step: () => t("Process steps"),
  feature: () => t("S/4HANA features"),
  kpi: () => t("KPIs"),
};

/** What the rule's failures reach: fields, the process steps they feed, the S/4HANA features and the KPIs. */
export function BlastRadius({ view, onFix }: { view: RuleView; onFix: () => void }) {
  const checkId = view.id;
  const versionId = view.scope.objects[0]?.run_id ?? null;
  const failing = view.scope.failing_records;
  const f = useFixture();
  const graph = useQuery({ queryKey: ["v2", "lineage", "graph", f, checkId], queryFn: () => getRuleLineage(checkId), staleTime: 300_000, retry: false });
  const blast = useQuery({
    queryKey: ["v2", "lineage", "blast", f, versionId, checkId],
    queryFn: () => getBlastRadius(versionId as string, checkId),
    staleTime: 60_000,
    retry: false,
    enabled: Boolean(versionId) && failing > 0,
  });
  const money = useMoney("landscape", null);
  const [sel, setSel] = useState<string | null>(null);
  const model = useMemo(() => {
    if (!graph.data) return null;
    const mine = (money.data?.features ?? []).filter((m) => m.blocking_rules.includes(checkId));
    return blastModel(graph.data, blast.data ?? null, mine);
  }, [graph.data, blast.data, money.data, checkId]);
  const lit = useMemo(() => (sel && model ? pathThrough(model, sel) : null), [sel, model]);

  if (graph.isPending) return <Skeleton lines={6} label={t("Loading the blast radius")} />;
  if (graph.isError || !model) return <ErrorState sentence={t("The lineage of this rule could not be read. The lineage model may not cover it yet.")} onRetry={() => void graph.refetch()} />;
  if (!model.nodes.some((n) => n.col !== "field")) return <EmptyState heading={t("Nothing mapped")}>{t("The lineage model maps no process step or feature to the fields this rule reads.")}</EmptyState>;

  const currency = money.data?.currency ?? null;
  const steps = model.nodes.filter((n) => n.col === "step");
  const touched = steps.filter((n) => (n.documents ?? 0) > 0).length;
  return (
    <div className="nx-rd" data-testid="blast-radius">
      <dl className="nx-ib-facts nx-rd-figs">
        <Fact label={t("Failing records")}>{int(failing)}</Fact>
        <Fact label={t("Documents in flight")}>{model.documents == null ? <Dash /> : int(model.documents)}</Fact>
        <Fact label={t("Process steps touched")}>{model.documents == null ? <Dash /> : t("{n} of {total}", { n: int(touched), total: int(steps.length) })}</Fact>
        <Fact label={t("Features blocked")}>{money.data ? int(model.blocked) : <Dash />}</Fact>
        <Fact label={t("Cost a month")}>{model.perMonth == null ? <Dash /> : moneyCompactText(model.perMonth, currency)}</Fact>
      </dl>
      {failing > 0 ? (
        <div>
          <Button variant="secondary" onClick={onFix}>{t("Fix the {n} failing records", { n: int(failing) })}</Button>
        </div>
      ) : null}
      <div className="nx-rd-blast">
        {BLAST_COLUMNS.map((col) => (
          <section key={col} className="nx-ib-sec" aria-label={HEADINGS[col]()}>
            <h3>{HEADINGS[col]()}</h3>
            <ul>
              {model.nodes
                .filter((n) => n.col === col)
                .map((n) => (
                  <li key={n.id} data-node={n.id} data-on={lit ? String(lit.has(n.id)) : undefined}>
                    <Button size={40} variant={lit?.has(n.id) ? "secondary" : "quiet"} aria-pressed={sel === n.id} onClick={() => setSel((s) => (s === n.id ? null : n.id))}>
                      {n.label}
                    </Button>
                    {col === "field" ? <Code code={n.label} text={n.sub ?? describeField(n.label) ?? undefined} /> : n.sub ? <span className="nx-sub">{n.sub}</span> : null}
                    {n.documents != null ? <span className="nx-sub">{t("{n} documents", { n: int(n.documents) })}</span> : null}
                    {n.status ? (
                      <span className="nx-sub">
                        {n.status === "blocked" ? t("Blocked") : t("Degraded")}
                        {n.perMonth != null ? <> {t("{v} a month", { v: moneyCompactText(n.perMonth, currency) })}</> : null}
                      </span>
                    ) : null}
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
      <Note>
        {t("Select a field, step or feature to trace its path. Documents in flight are the open documents the failing records touch, joined in SAP on their keys.")}
        {blast.data?.keys_truncated ? <> {t("The failing records were sampled for the join.")}</> : null}
      </Note>
    </div>
  );
}

/** The failing records: export, open each run's records in a sheet, what the rule reads, and the work queue. */
export function FailingRecords({ view }: { view: RuleView }) {
  const session = useV2Session();
  const toast = useToast();
  const sheets = useSheets();
  const [busy, setBusy] = useState(false);
  const runs = view.scope.objects
    .filter((o): o is typeof o & { run_id: string } => Boolean(o.run_id))
    .filter((o, i, all) => all.findIndex((x) => x.run_id === o.run_id) === i);
  const mod = moduleOf(view);
  const work = new URLSearchParams({ rule: view.id });
  if (mod) work.set("module", mod);
  const exportAll = async () => {
    if (session.fixture) return toast({ text: t("Fixture mode: no file is produced"), tone: "good" });
    setBusy(true);
    try {
      for (const r of runs) await exportFindingRecords(r.run_id, view.id, "xlsx");
      toast({ text: t("Findings downloading"), tone: "good" });
    } catch (e) {
      toast({ text: errorSentence(e, t("The export failed.")), tone: "bad" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sec title={t("Failing records")} testId="rule-failing">
      {runs.length === 0 ? (
        <EmptyState heading={t("No run yet")}>{t("This rule has no run yet.")}</EmptyState>
      ) : (
        <ul className="nx-ib-list">
          {runs.map((r) => (
            <li key={r.run_id} className="nx-row">
              <span className="nx-row-main">{moduleText(r.module)}</span>
              <Button variant="secondary" size={40} onClick={() => sheets.open({ kind: "finding-records", id: findingRecordsId(r.run_id, view.id) })}>
                {t("Every failing record")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="nx-ib-acts">
        <Button variant="secondary" size={40} onClick={() => sheets.open({ kind: "rule-reads", id: view.id })}>{t("What it reads")}</Button>
        {runs.length ? (
          <Button variant="secondary" size={40} loading={busy} loadingLabel={t("Exporting")} disabled={!session.can("export")} reason={session.can("export") ? undefined : t("Your role cannot export records.")} onClick={() => void exportAll()}>
            {t("Export the failing records")}
          </Button>
        ) : null}
        <NxLink href={`/work?${work.toString()}`} className="nx-btn">{t("Open the work queue for this rule")}</NxLink>
      </div>
    </Sec>
  );
}

type Panel = "suppress" | "handoff" | null;

function SuppressForm({ view, onDone }: { view: RuleView; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("30");
  const m = useMutation({ mutationFn: () => suppressRule(view.id, reason.trim(), new Date(Date.now() + Number(days) * 86_400_000).toISOString()), onSuccess: onDone });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length >= 3) m.mutate();
  };
  return (
    <form className="nx-wk-form" onSubmit={submit} aria-label={t("Suppress {id}", { id: view.id })}>
      <label>
        {t("Reason")}
        <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={2000} />
      </label>
      <label>
        {t("For")}
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="30">{t("30 days")}</option>
          <option value="60">{t("60 days")}</option>
          <option value="90">{t("90 days")}</option>
        </select>
      </label>
      <Note>{t("The rule stays out of the score until the date. It takes effect on the next run.")}</Note>
      {m.isError ? <p role="alert" className="nx-wk-alert">{t("The suppression could not be saved.")}</p> : null}
      <div className="nx-ib-acts">
        <Button type="submit" size={40} variant="secondary" loading={m.isPending} disabled={m.isPending || reason.trim().length < 3}>{t("Suppress rule")}</Button>
      </div>
    </form>
  );
}

function HandoffForm({ view, onDone }: { view: RuleView; onDone: () => void }) {
  const stewards = useStewards(true);
  const [who, setWho] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState(() => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  const m = useMutation({
    mutationFn: () => handOffRule({ check_id: view.id, module: moduleOf(view), assignee_id: who, note: note.trim(), due_date: due, version_id: view.scope.objects[0]?.run_id }),
    onSuccess: onDone,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (who && note.trim()) m.mutate();
  };
  return (
    <form className="nx-wk-form" onSubmit={submit} aria-label={t("Hand {id} to a steward", { id: view.id })}>
      <label>
        {t("Steward")}
        <select value={who} onChange={(e) => setWho(e.target.value)} required>
          <option value="">{t("Choose")}</option>
          {(stewards.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name ?? s.email}</option>
          ))}
        </select>
      </label>
      <label>
        {t("Note")}
        <input value={note} onChange={(e) => setNote(e.target.value)} required maxLength={2000} />
      </label>
      <label>
        {t("Due")}
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
      </label>
      {m.isError ? <p role="alert" className="nx-wk-alert">{t("The hand-off could not be created.")}</p> : null}
      <div className="nx-ib-acts">
        <Button type="submit" size={40} variant="secondary" loading={m.isPending} disabled={m.isPending || !who || !note.trim()}>{t("Hand over")}</Button>
      </div>
    </form>
  );
}

/** Suppress, enable or disable, edit in authoring, dry run, hand to a steward, and the rule's issues. */
export function RuleActionsNative({ view }: { view: RuleView }) {
  const { can } = useV2Session();
  const params = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [panel, setPanel] = useState<Panel>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const mod = moduleOf(view);
  const canSuppress = can("approve");
  const canEdit = can("manage_rules");
  const canHandoff = can("handoff_rule") || can("assign");
  const own = view.scope.tenant_rule;
  const finish = (msg: string) => {
    setDone(msg);
    setPanel(null);
    void qc.invalidateQueries({ queryKey: ["v2", "rule-scope"] });
  };
  const issues = new URLSearchParams({ rule: view.id });
  if (mod) issues.set("module", mod);
  if (params?.get("system")) issues.set("system", params.get("system")!);
  const flip = useMutation({
    mutationFn: (on: boolean) => setRuleEnabled(own!.id, on),
    onSuccess: (_r, on) => finish(on ? t("{id} is enabled; the next run checks it.", { id: view.id }) : t("{id} is disabled; the next run skips it.", { id: view.id })),
    onError: (e) => toast({ text: errorSentence(e, t("The rule could not be changed.")), tone: "bad" }),
  });
  return (
    <Sec title={t("Actions")} testId="rule-actions">
      <div className="nx-ib-acts">
        <NxLink href={`/issues?${issues.toString()}`} className="nx-btn" data-testid="rule-issues">{t("Open its issues")}</NxLink>
        {canSuppress ? (
          <Button size={40} variant="secondary" aria-expanded={panel === "suppress"} onClick={() => setPanel(panel === "suppress" ? null : "suppress")}>{t("Suppress")}</Button>
        ) : null}
        {canEdit && own ? (
          <Button size={40} variant="secondary" disabled={flip.isPending} aria-pressed={own.enabled} onClick={() => (own.enabled ? setConfirmOff(true) : flip.mutate(true))}>
            {own.enabled ? t("Disable rule") : t("Enable rule")}
          </Button>
        ) : null}
        {canEdit ? <NxLink href={`/rules?view=drafts&module=${encodeURIComponent(mod)}`} className="nx-btn">{t("Edit in authoring")}</NxLink> : null}
        {canEdit ? <NxLink href={`/rule-dry-run?rule=${encodeURIComponent(view.id)}&module=${encodeURIComponent(mod)}`} className="nx-btn">{t("Dry run")}</NxLink> : null}
        {canHandoff ? (
          <Button size={40} variant="secondary" aria-expanded={panel === "handoff"} onClick={() => setPanel(panel === "handoff" ? null : "handoff")}>{t("Hand to a steward")}</Button>
        ) : null}
      </div>
      <Confirm
        open={confirmOff && Boolean(own)}
        title={t("Disable rule")}
        consequence={t("Disable {id}? The next run skips it, so its failures stop counting in the score. You can enable it again.", { id: view.id })}
        confirmLabel={t("Disable rule")}
        danger
        onConfirm={() => {
          setConfirmOff(false);
          flip.mutate(false);
        }}
        onCancel={() => setConfirmOff(false)}
      />
      {panel === "suppress" ? <SuppressForm view={view} onDone={() => finish(t("{id} is suppressed until the date you set.", { id: view.id }))} /> : null}
      {panel === "handoff" ? <HandoffForm view={view} onDone={() => finish(t("{id} is handed over; the steward finds it in the inbox.", { id: view.id }))} /> : null}
      {done ? <p role="status" className="nx-ib-meta">{done}</p> : null}
      {!canSuppress && !canEdit && !canHandoff ? <Note>{t("Your role can read this rule. Suppressing, editing and hand-off need a steward, owner or lead role.")}</Note> : null}
    </Sec>
  );
}

export { firstRun };
