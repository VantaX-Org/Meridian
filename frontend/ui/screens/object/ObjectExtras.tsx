"use client";

/** The object overview's supporting parts: the score receipt, the old-run action gate, the monitor strip,
 *  Aletheia's findings for this object with their actions, and the related objects. */
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { createRuleBatch, getFindings, markActed, type AletheiaFinding } from "@/lib/api/v2/insights";
import { putOwner } from "@/lib/api/v2/mdm";
import { draftTunedVersion } from "@/lib/api/v2/pilot";
import { getObjectMonitor, type Freshness } from "@/lib/api/v2/run-ops";
import type { Receipt } from "@/lib/api/v2/types";
import { formatDate } from "@/lib/format";
import { useAssignable } from "@/lib/v2/approvals-queries";
import { describeCron } from "@/lib/v2/cron";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moneyCompactText } from "@/lib/v2/labels";
import { notFound, useRelated } from "@/lib/v2/roles-queries";
import { describeField } from "@/lib/v2/sap-fields";
import { DASH, f1, int, pct1 } from "@/lib/v2/score";
import { Badge, Button, Card, DataTable, FieldChip, Select, StatTile, useToast } from "@/ui/kit";
import { objectPath } from "../object-tabs/TabFrame";

/** "How {score} is made": the receipt behind the score, folded under the ring. */
export function ScoreReceipt({ receipt }: { receipt: Receipt | undefined }) {
  if (!receipt) return null;
  const sw = receipt.severity_weights;
  return (
    <details className="mx-receipt" data-testid="score-receipt">
      <summary>{t("How {score} is made", { score: f1(receipt.score) })}</summary>
      <p className="mx-muted">{receipt.formula}</p>
      <dl className="mx-tiles">
        <StatTile label={t("Records checked")} value={int(receipt.records_checked)} />
        <StatTile label={t("Rules measured")} value={int(receipt.rules_measured)} />
        <StatTile label={t("Coverage")} value={pct1(receipt.coverage)} note={receipt.low_confidence ? t("Low confidence") : undefined} />
        <StatTile label={t("Weighted score")} value={f1(receipt.weighted)} note={receipt.capped ? t("Held at {cap}", { cap: receipt.cap_level ?? DASH }) : undefined} />
      </dl>
      <DataTable
        label={t("Score by dimension")}
        rowKey={(d) => d.key}
        rows={receipt.dimensions}
        columns={[
          { key: "label", label: t("Dimension") },
          { key: "weight", label: t("Weight"), align: "end", render: (d) => pct1(d.weight) },
          { key: "score", label: t("Score"), align: "end", render: (d) => f1(d.score) },
          { key: "points", label: t("Points"), align: "end", render: (d) => f1(d.points) },
          { key: "rules_measured", label: t("Rules measured"), align: "end", render: (d) => int(d.rules_measured) },
        ]}
      />
      <p className="mx-muted">
        {t("Severity weights: critical {c}, high {h}, medium {m}, low {l}.", { c: sw.critical, h: sw.high, m: sw.medium, l: sw.low })} {receipt.cap_rule}
      </p>
      {receipt.breaches.length ? (
        <DataTable
          label={t("Critical rules over tolerance")}
          rowKey={(b) => b.check_id}
          rows={receipt.breaches}
          columns={[
            { key: "check_id", label: t("Rule"), render: (b) => <FieldChip code={b.check_id} description={b.name} /> },
            { key: "failing", label: t("Failing records"), align: "end", render: (b) => int(b.failing) },
            { key: "pct", label: t("Failing share"), align: "end", render: (b) => pct1(b.pct) },
          ]}
        />
      ) : null}
    </details>
  );
}

/** Actions act on the current run only: on an older run they show disabled with the reason (links too, through inert). */
export function OldRunGate({ runId, latest, children }: { runId: string | null; latest: string | null; children: ReactNode }) {
  if (!latest || !runId || runId === latest) return <>{children}</>;
  const reason = t("Open the current run to act");
  return (
    <fieldset className="mx-gate" disabled title={reason} data-testid="action-gate">
      <p className="mx-muted" data-testid="action-gate-reason">{reason}</p>
      <div inert>{children}</div>
    </fieldset>
  );
}

const FRESH: Record<Freshness, { label: () => string; tone?: "good" | "bad" }> = {
  fresh: { label: () => t("Fresh"), tone: "good" },
  due: { label: () => t("Due") },
  stale: { label: () => t("Stale"), tone: "bad" },
  failed: { label: () => t("Failed"), tone: "bad" },
  paused: { label: () => t("Paused") },
  manual: { label: () => t("Manual") },
};

/** Cadence, freshness and drift since the baseline run (GET /objects/{module}/monitor). Nothing before a first run. */
export function MonitorStrip({ module }: { module: string }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["object-monitor", fx, module], queryFn: () => getObjectMonitor(module), retry: (n, e) => !notFound(e) && n < 1, staleTime: 60_000 });
  const m = q.data;
  if (!m) return null;
  const f = FRESH[m.freshness];
  return (
    <Card title={t("Monitor")} action={<Badge tone={f.tone}>{f.label()}</Badge>}>
      <dl className="mx-kv" data-testid="monitor-strip">
        <div><dt>{t("Last run")}</dt><dd>{m.last_run_at ? formatDate(m.last_run_at, "datetime") : DASH}<small>{m.requested_by_label ?? m.trigger ?? ""}</small></dd></div>
        <div><dt>{t("Next run")}</dt><dd>{m.next_run_at ? formatDate(m.next_run_at, "datetime") : DASH}<small>{m.cadence.cron ? describeCron(m.cadence.cron) : t("No schedule")}</small></dd></div>
        <div><dt>{t("Newly failing")}</dt><dd>{int(m.drift.new_failing)}<small>{t("{n} rules", { n: m.drift.newly_failing_rule_count })}</small></dd></div>
        <div><dt>{t("Recovered")}</dt><dd>{int(m.drift.recovered)}<small>{t("{n} rules", { n: m.drift.recovered_rule_count })}</small></dd></div>
      </dl>
    </Card>
  );
}

const RELATION: Record<"upstream" | "downstream" | "shared-reference", () => string> = {
  upstream: () => t("Upstream"),
  downstream: () => t("Downstream"),
  "shared-reference": () => t("Shares reference data"),
};

/** Objects that feed this one or depend on it, with their open critical rules. */
export function RelatedObjects({ system, module }: { system: string; module: string }) {
  const fx = useFixture();
  const q = useRelated(module);
  const rel = q.data;
  if (!rel || !rel.related.length) return null;
  return (
    <Card title={t("Related objects")} sub={rel.fix_hint?.sentence}>
      <DataTable
        label={t("Related objects")}
        rowKey={(r) => r.module}
        rows={rel.related}
        columns={[
          { key: "label", label: t("Object"), render: (r) => <a href={withFixture(objectPath(system, r.module), fx)}>{r.label}</a> },
          { key: "relation", label: t("Relation"), render: (r) => RELATION[r.relation]() },
          { key: "open_criticals", label: t("Open critical rules"), align: "end", render: (r) => int(r.open_criticals) },
        ]}
      />
    </Card>
  );
}

const ACTION_LABEL = { across: () => t("Review across systems"), tune: () => t("Draft tuned version"), cleanse: () => t("Draft cleansing batch"), open: () => t("Open rule"), merge: () => t("Review duplicates"), assign: () => t("Assign owner") };
const ACTION_DONE = { tune: () => t("Tuned rule version drafted"), cleanse: () => t("Cleansing batch drafted"), assign: () => t("Owner assigned") };
const ACTION_NEEDS = { tune: "manage_rules", cleanse: "apply" } as const;

/** Aletheia's findings for this object, ranked by score impact, each with the one action that moves it. */
export function FindingsCard({ system, module, latest }: { system: string; module: string; latest: boolean }) {
  const fx = useFixture();
  const queryKey = ["object-findings", fx, module];
  const q = useQuery({ queryKey, queryFn: () => getFindings(module), staleTime: 60_000, retry: false });
  const rows = q.data?.findings ?? [];
  if (!rows.length) return null;
  return (
    <Card title={t("Aletheia found")} sub={t("Ranked by score impact, from the latest run of each object")}>
      <DataTable
        label={t("Aletheia found")}
        rowKey={(f) => f.id}
        rows={rows}
        columns={[
          { key: "name", label: t("Finding"), render: (f) => f.action.kind === "across"
            ? t("{n} pairs exist in more than one connected system", { n: int(f.action.pairs ?? f.affected) })
            : <><FieldChip code={f.check_id} description={f.name} />{f.field ? <> <FieldChip code={f.field} description={describeField(f.field) ?? undefined} /></> : null}</> },
          { key: "affected", label: t("Failing records"), align: "end", render: (f) => int(f.affected) },
          { key: "money", label: t("Money at risk"), align: "end", render: (f) => f.money.cost_at_risk != null ? moneyCompactText(f.money.cost_at_risk, f.money.currency) : <span className="mx-muted" title={t("No cost model covers this rule")}>{DASH}</span> },
          { key: "confidence", label: t("Confidence"), align: "end", render: (f) => f.confidence ? pct1(f.confidence.value) : <span className="mx-muted" title={t("Not measured yet")}>{DASH}</span> },
          { key: "action", label: t("Action"), render: (f) => latest ? <FindingAction f={f} system={system} queryKey={queryKey} /> : <span className="mx-muted">{t("Open the current run to act")}</span> },
        ]}
      />
    </Card>
  );
}

function FindingAction({ f, system, queryKey }: { f: AletheiaFinding; system: string; queryKey: unknown[] }) {
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const session = useV2Session();
  const [done, setDone] = useState(false);
  const kind = f.action.kind;
  const act = useMutation({
    mutationFn: async () => {
      if (kind === "tune") await draftTunedVersion(f.check_id);
      else if (kind === "cleanse") await createRuleBatch(`${f.check_id} ${f.name}`.slice(0, 200), { module: f.module, check_id: f.check_id });
      return markActed({ module: f.module, check_id: f.check_id, action: kind });
    },
    onSuccess: () => { setDone(true); void qc.invalidateQueries({ queryKey }); },
    onError: () => toast(t("The change did not go through"), "bad"),
  });
  const mark = () => void markActed({ module: f.module, check_id: f.check_id, action: kind }).catch(() => undefined);
  if (kind === "assign") return <AssignAction f={f} queryKey={queryKey} />;
  if (kind === "open") return <Button variant="secondary" href={withFixture(`/r/${encodeURIComponent(f.check_id)}`, fx)}>{ACTION_LABEL.open()}</Button>;
  if (kind === "merge" || kind === "across") {
    const path = `${objectPath(system, f.module, "golden")}${kind === "across" ? "#across-systems" : ""}`;
    return <span onClick={mark}><Button variant="secondary" href={withFixture(path, fx)}>{ACTION_LABEL[kind]()}</Button></span>;
  }
  if (done) return <span className="mx-muted" role="status">{ACTION_DONE[kind]()}</span>;
  if (!session.can(ACTION_NEEDS[kind]) || session.shared || session.viewAs) return <span className="mx-muted">{t("Your role cannot do this")}</span>;
  return (
    <>
      <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate()}>{ACTION_LABEL[kind]()}</Button>
      {act.isError ? <span role="alert" className="mx-muted"> {failureText(act.error)}</span> : null}
    </>
  );
}

/** Neither the rule nor its object has an owner: pick a person as the rule's owner (PUT /owners). Needs the assign permission. */
function AssignAction({ f, queryKey }: { f: AletheiaFinding; queryKey: unknown[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const session = useV2Session();
  const allowed = session.can("assign") && !session.shared && !session.viewAs;
  const people = useAssignable(allowed);
  const [who, setWho] = useState("");
  const [done, setDone] = useState(false);
  const act = useMutation({
    mutationFn: async () => {
      await putOwner("rule", f.check_id, who);
      return markActed({ module: f.module, check_id: f.check_id, action: "assign" });
    },
    onSuccess: () => { setDone(true); void qc.invalidateQueries({ queryKey }); },
    onError: () => toast(t("The change did not go through"), "bad"),
  });
  if (done) return <span className="mx-muted" role="status">{ACTION_DONE.assign()}</span>;
  if (!allowed) return <span className="mx-muted">{t("No owner. Someone with the assign permission can set one.")}</span>;
  return (
    <span className="mx-links">
      <Select
        value={who}
        onChange={(e) => setWho(e.target.value)}
        aria-label={t("Owner of {id}", { id: f.check_id })}
        options={[{ value: "", label: t("Choose") }, ...(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))]}
      />
      <Button variant="secondary" disabled={!who || act.isPending} onClick={() => act.mutate()}>{t("Assign")}</Button>
      {act.isError ? <span role="alert" className="mx-muted">{failureText(act.error)}</span> : null}
    </span>
  );
}
