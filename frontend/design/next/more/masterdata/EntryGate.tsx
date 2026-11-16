"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { getFirewallSummary, validateRecords, type FirewallFailure, type FirewallSuggestion, type FirewallSummary, type FirewallVerdict, type HoldMode } from "@/lib/api/v2/dq-firewall";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { describeField, sapField } from "@/lib/v2/sap-fields";
import { int } from "@/lib/v2/score";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, PointSpark, Skeleton, StatCard, type Column } from "../../kit";
import { ChartCard } from "../ChartCard";
import { TableSave } from "./TableSave";
import { DdicCard, DuplicateResults } from "./EntryEvidence";
import { httpStatus, noRetry4xx, sevTone, sevWord, useGo } from "./util";
import { LICENSED_MODULES, ageWord, holdNote, holdWord, moduleRows, notOpenedWord, objectWord, statusWord } from "./words";

/**
 * Entry gate, native: the data quality firewall. SAP posts a candidate record before it is saved and the firewall
 * answers with the rules it fails. Every figure comes from the firewall's own audit trail; a figure the trail did not
 * record (the warned count before it was kept) shows a dash, never a zero. The licensed objects only.
 */

const SAMPLE = JSON.stringify([{ "MARA.MATNR": "ENTRY-TEST-1", "MARA.MTART": "", "MARA.MEINS": "KG" }], null, 2);
const dash = (n: number | null | undefined) => (n == null ? <span title={t("Not recorded for these days.")}>-</span> : int(n));
type Day = FirewallSummary["days"][number];
type Req = FirewallSummary["requests"][number];

function RequestTable({ rows, caption, testId }: { rows: readonly Req[]; caption: string; testId: string }) {
  const { openItem } = useOpenItem();
  const cols: Column<Req>[] = [
    { id: "request", label: t("Request"), cell: (r) => <Button variant="quiet" size={32} onClick={() => openItem({ kind: "request", id: r.id })}>{r.title || t("Untitled request")}</Button> },
    { id: "object", label: t("Object"), cell: (r) => objectWord(r.object) },
    { id: "status", label: t("Status"), cell: (r) => statusWord(r.status) },
    { id: "opened", label: t("Opened"), cell: (r) => formatDate(r.created_at, "date") },
  ];
  return (
    <div data-testid={testId}>
      <TableSave title={caption}><DataTable rows={[...rows]} columns={cols} rowKey={(r) => r.id} rowLabel={(r) => r.title || r.id} caption={caption} /></TableSave>
    </div>
  );
}

function Suggested({ s }: { s?: FirewallSuggestion | null }) {
  if (!s) return <span className="nx-sub">{t("No grounded fix exists for this failure.")}</span>;
  return (
    <span data-testid="entry-suggestion" className="nx-cell-stack">
      {s.kind === "value" ? <Code code={s.value ?? ""} /> : (
        <span className="nx-row nx-wrap">
          {(s.allowed_values ?? []).map((v) => <Code key={v.code} code={v.code} text={v.text ?? undefined} />)}
          {s.truncated ? t("and more") : null}
        </span>
      )}
      <span className="nx-sub">{t("Rule {rule}, {source}", { rule: s.rule_id, source: s.source })}</span>
    </span>
  );
}

function Results({ res }: { res: FirewallVerdict }) {
  const { openItem } = useOpenItem();
  type Fail = FirewallFailure & { record: number };
  const rows: Fail[] = res.records.flatMap((r) => r.failures.map((f) => ({ ...f, record: r.index })));
  const failCols: Column<Fail>[] = [
    { id: "record", label: t("Record"), align: "end", cell: (f) => int(f.record + 1) },
    { id: "rule", label: t("Rule"), cell: (f) => <Code code={f.rule_id} /> },
    { id: "requires", label: t("What the rule requires"), cell: (f) => f.description },
    { id: "field", label: t("Field"), cell: (f) => <Code code={sapField(f.field)} text={f.field_description ?? describeField(f.field) ?? undefined} /> },
    { id: "severity", label: t("Severity"), cell: (f) => <Chip tone={sevTone(f.severity)}>{sevWord(f.severity)}</Chip> },
    { id: "fix", label: t("Suggested fix"), cell: (f) => <Suggested s={f.suggestion} /> },
    { id: "ddic", label: t("SAP dictionary"), cell: (f) => <DdicCard e={f.ddic} /> },
  ];
  const steward = res.records.filter((r) => r.steward_request);
  type St = (typeof steward)[number];
  const stewardCols: Column<St>[] = [
    { id: "record", label: t("Record"), align: "end", cell: (r) => int(r.index + 1) },
    { id: "request", label: t("Request"), cell: ({ steward_request: sr }) => (sr?.request_id ? <Button variant="quiet" size={32} onClick={() => openItem({ kind: "request", id: sr.request_id! })}>{t("Open the request")}</Button> : "-") },
    { id: "status", label: t("Status"), cell: ({ steward_request: sr }) => (sr?.status ? statusWord(sr.status) : "-") },
    { id: "note", label: t("Note"), cell: ({ steward_request: sr }) => (sr?.request_id ? (sr.existing ? t("Already open for this record. No second request was added.") : t("Opened and sent to the approval workflow.")) : notOpenedWord(sr?.reason)) },
  ];
  const held = res.records.filter((r) => r.hold);
  type Hd = (typeof held)[number];
  const holdCols: Column<Hd>[] = [
    { id: "record", label: t("Record"), align: "end", cell: (r) => int(r.index + 1) },
    { id: "hold", label: t("Hold"), cell: (r) => (r.hold ? holdWord(r.hold.state) : "-") },
    { id: "request", label: t("Request"), cell: (r) => (r.hold?.request_id ? <Button variant="quiet" size={32} onClick={() => openItem({ kind: "request", id: r.hold!.request_id! })}>{t("Open the request")}</Button> : "-") },
    { id: "key", label: t("SAP key"), cell: (r) => (r.hold?.sap_key ? <Code code={r.hold.sap_key} /> : <span className="nx-sub">{t("SAP has not given a key.")}</span>) },
    { id: "means", label: t("What it means"), cell: (r) => (r.hold ? holdNote(r.hold) : null) },
  ];
  return (
    <>
      <p role="status" data-testid="entry-gate-result">
        <Chip tone={res.verdict === "block" ? "bad" : "good"}>{res.verdict === "block" ? t("Blocked") : t("Passed")}</Chip>{" "}
        {t("{blocked} of {total} records blocked, {rules} rules run.", { blocked: res.records.filter((r) => r.verdict === "block").length, total: res.records.length, rules: res.rules_run })}
      </p>
      {res.save ? <p role="status" data-testid="entry-gate-save">{res.save === "stop" ? t("The SAP save stops.") : t("The SAP save may go on.")}</p> : null}
      {rows.length === 0 ? <EmptyState heading={t("Every record passed every enabled rule.")} /> : (
        <TableSave title={t("Failing rules")}>
          <DataTable rows={rows} columns={failCols} rowKey={(f) => `${f.record}:${f.rule_id}`} rowLabel={(f) => f.rule_id} caption={t("Failing rules")} />
        </TableSave>
      )}
      <DuplicateResults res={res} />
      {steward.length ? (
        <div data-testid="entry-gate-steward">
          <DataTable rows={steward} columns={stewardCols} rowKey={(r) => String(r.index)} rowLabel={(r) => String(r.index + 1)} caption={t("Requests opened for flagged records")} />
        </div>
      ) : null}
      {held.length ? (
        <div data-testid="entry-gate-hold-results">
          <DataTable rows={held} columns={holdCols} rowKey={(r) => String(r.index)} rowLabel={(r) => String(r.index + 1)} caption={t("Hold state of each record")} />
        </div>
      ) : null}
    </>
  );
}

function TryPanel({ modules }: { modules: readonly string[] }) {
  const qc = useQueryClient();
  const [obj, setObj] = useState<string>(modules[0] ?? "material_master");
  const [text, setText] = useState(SAMPLE);
  const [suggest, setSuggest] = useState(true);
  const [duplicates, setDuplicates] = useState(false);
  const [route, setRoute] = useState(false);
  const [hold, setHold] = useState<HoldMode>("off");
  const [bad, setBad] = useState<string | null>(null);
  // POST /dq-firewall/validate needs mdm.write; a shared or view-as session is read-only.
  const session = useV2Session();
  const allowed = session.can("mdm.write") && !session.shared && !session.viewAs;
  const run = useMutation({
    mutationFn: async () => {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new SyntaxError("array");
      return validateRecords(obj, parsed as Record<string, string>[], { suggest, duplicates, route_to_steward: route, hold });
    },
    onMutate: () => setBad(null),
    onError: (e) => { if (e instanceof SyntaxError) setBad(t("The records must be a JSON list of objects, each with TABLE.FIELD values.")); },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["entry-gate"] }),
  });
  const apiErr = run.isError && !(run.error instanceof SyntaxError) ? errorSentence(run.error, t("The records could not be checked.")) : null;
  return (
    <section aria-label={t("Try a record")} data-testid="entry-gate-try">
      <h3>{t("Try a record")}</h3>
      <p className="nx-sub">{t("Runs the same check SAP calls at save. A suggestion is shown only when the rule itself gives one.")}</p>
      <div className="nx-row nx-wrap">
        <label className="nx-field">
          <span>{t("Object")}</span>
          <select className="nx-input" value={obj} onChange={(e) => setObj(e.target.value)} data-testid="entry-gate-object">
            {modules.map((m) => <option key={m} value={m}>{moduleText(m)} ({m})</option>)}
          </select>
        </label>
        <label className="nx-field">
          <span>{t("Hold")}</span>
          <select className="nx-input" value={hold} onChange={(e) => setHold(e.target.value as HoldMode)} data-testid="entry-gate-hold">
            <option value="off">{t("Off: the verdict alone decides the save")}</option>
            <option value="blocked">{t("Blocked: hold blocked records for approval")}</option>
            <option value="flagged">{t("Flagged: hold blocked and warned records for approval")}</option>
          </select>
        </label>
      </div>
      <label className="nx-field">
        <span>{t("Records, as JSON")}</span>
        <textarea className="nx-input nx-mono" rows={7} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-testid="entry-gate-json" />
      </label>
      <label><input type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} /> {t("Show a fix where the rule gives one")}</label>
      <label><input type="checkbox" checked={duplicates} onChange={(e) => setDuplicates(e.target.checked)} data-testid="entry-gate-duplicates" /> {t("Look for duplicates among existing records")}</label>
      <label><input type="checkbox" checked={route} onChange={(e) => setRoute(e.target.checked)} data-testid="entry-gate-route" /> {t("Send blocked or warned records to a steward as a change request")}</label>
      <p className="nx-row nx-wrap">
        {allowed ? (
          <Button variant="primary" disabled={run.isPending} onClick={() => run.mutate()} data-testid="entry-gate-run">{t("Check records")}</Button>
        ) : <span className="nx-sub" data-testid="entry-gate-needs">{t("Checking records at the gate needs the {permission} permission.", { permission: "mdm.write" })}</span>}
      </p>
      {bad || apiErr ? <p role="alert">{bad ?? apiErr}</p> : null}
      {run.data ? <Results res={run.data} /> : null}
    </section>
  );
}

export function EntryGateNative() {
  const fixture = useFixture();
  const go = useGo();
  const q = useQuery({ queryKey: ["entry-gate", fixture], queryFn: getFirewallSummary, staleTime: 15_000, retry: noRetry4xx });
  if (q.isPending) return <div className="nx-body"><Skeleton lines={6} label={t("Entry gate")} /></div>;
  if (q.isError) {
    return (
      <div className="nx-body">
        {httpStatus(q.error) === 403 ? <EmptyState heading={t("Your role cannot read the firewall traffic.")} /> : (
          <ErrorState sentence={t("The firewall traffic could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
        )}
      </div>
    );
  }
  const s = q.data;
  const days = s.days ?? [];
  const checked = days.reduce((n, d) => n + d.checked, 0);
  const blocked = days.reduce((n, d) => n + d.blocked, 0);
  const rules = s.top_rules ?? [];
  const mods = moduleRows(s.by_module ?? []);
  const tryModules = LICENSED_MODULES.filter((m) => s.modules.includes(m));
  const h = s.holds;
  const spark = (pick: (d: Day) => number) => days.map((d) => ({ label: d.day, value: pick(d) }));

  const dayCols: Column<Day>[] = [
    { id: "day", label: t("Day"), cell: (d) => d.day },
    { id: "checked", label: t("Checked"), align: "end", cell: (d) => int(d.checked) },
    { id: "blocked", label: t("Blocked"), align: "end", cell: (d) => int(d.blocked) },
    { id: "warned", label: t("Warned"), align: "end", cell: (d) => dash(d.warned) },
    { id: "passed", label: t("Passed"), align: "end", cell: (d) => dash(d.passed) },
  ];
  type Rule = (typeof rules)[number];
  const ruleCols: Column<Rule>[] = [
    { id: "rule", label: t("Rule"), cell: (r) => <Code code={r.rule_id} text={r.description || undefined} /> },
    { id: "blocked", label: t("Blocked"), align: "end", compare: (a, b) => a.blocked - b.blocked, cell: (r) => int(r.blocked) },
  ];
  type Mod = (typeof mods)[number];
  const modCols: Column<Mod>[] = [
    { id: "object", label: t("Object"), cell: (m) => <span data-testid={`entry-gate-module-${m.module}`}><Code code={m.module} text={moduleText(m.module)} /></span> },
    { id: "checked", label: t("Checked"), align: "end", cell: (m) => (m.row ? int(m.row.checked) : "-") },
    { id: "blocked", label: t("Blocked"), align: "end", cell: (m) => (m.row ? int(m.row.blocked) : "-") },
    { id: "warned", label: t("Warned"), align: "end", cell: (m) => (m.row ? dash(m.row.warned) : "-") },
    { id: "passed", label: t("Passed"), align: "end", cell: (m) => (m.row ? dash(m.row.passed) : "-") },
  ];

  return (
    <div className="nx-body" data-testid="entry-gate-page">
      <section aria-label={t("Entry gate")} data-testid="entry-gate">
        <p className="nx-sub">{t("Try a record")}, {t("Review what is held")}, {t("Approve or reject")}, {t("SAP saves what passes")}</p>
        <h2>{t("{blocked} of {checked} records were stopped at entry in the last 7 days", { blocked: int(blocked), checked: int(checked) })}</h2>
        <p className="nx-sub">{t("SAP asks the firewall before it saves a record. A record that fails a critical rule is blocked; one that passes but fails a lesser rule is warned.")}</p>
        <div className="nx-statgrid">
          <StatCard label={t("Calls in 24 hours")} value={s.calls_24h} />
          <StatCard label={t("Calls in 7 days")} value={s.calls_7d} />
          <StatCard label={t("Held")} value={h.held} />
          <StatCard label={t("Released")} value={h.released} />
        </div>
        <p className="nx-row nx-wrap"><Button size={32} onClick={go("/requests")}>{t("Open the requests")}</Button></p>
      </section>
      <div className="nx-chartcards">
        <ChartCard
          title={t("Records checked")} state={days.length < 2 ? "empty" : "ready"} testId="entry-gate-checked"
          chart={<PointSpark points={spark((d) => d.checked)} label={t("Records checked")} />}
          figure={int(checked)} line={t("Records a day, last 7 days")} emptyLine={t("Two days of calls are needed to draw a trend.")}
        />
        <ChartCard
          title={t("Records blocked")} state={days.length < 2 ? "empty" : "ready"} testId="entry-gate-blocked"
          chart={<PointSpark points={spark((d) => d.blocked)} label={t("Records blocked")} />}
          figure={int(blocked)} line={t("Records a day, last 7 days")} emptyLine={t("Two days of calls are needed to draw a trend.")}
        />
      </div>
      <section aria-label={t("Each day")} data-testid="entry-gate-days">
        <h3>{t("Each day")}</h3>
        <p className="nx-sub">{t("Warned and passed were not kept before this release, so earlier days show a dash.")}</p>
        {days.length === 0 ? <EmptyState heading={t("The firewall has not been called in the last 7 days.")} /> : (
          <TableSave title={t("Each day")}><DataTable rows={days} columns={dayCols} rowKey={(d) => d.day} rowLabel={(d) => d.day} caption={t("Each day")} /></TableSave>
        )}
      </section>
      <section aria-label={t("Rules that block most")} data-testid="entry-gate-rules">
        <h3>{t("Rules that block most")}</h3>
        <p className="nx-sub">{t("Critical rules, most blocked records first.")}</p>
        {rules.length === 0 ? <EmptyState heading={t("No rule has blocked a record yet.")} /> : (
          <TableSave title={t("Rules that block most")}><DataTable rows={rules} columns={ruleCols} rowKey={(r) => r.rule_id} rowLabel={(r) => r.rule_id} caption={t("Rules that block most")} /></TableSave>
        )}
      </section>
      <section aria-label={t("By object")} data-testid="entry-gate-modules">
        <h3>{t("By object")}</h3>
        <p className="nx-sub">{t("The objects the licence covers.")}</p>
        <TableSave title={t("By object")}><DataTable rows={mods} columns={modCols} rowKey={(m) => m.module} rowLabel={(m) => moduleText(m.module)} caption={t("By object")} /></TableSave>
      </section>
      <section aria-label={t("Holds")} data-testid="entry-gate-holds">
        <h3>{t("Holds")}</h3>
        <p className="nx-sub">{t("A held record waits for the approval workflow before SAP may save it. Released, rejected and written count the last 7 days; held counts what waits now.")}</p>
        <dl className="nx-statgrid">
          {([["held", t("Held"), h.held], ["released", t("Released"), h.released], ["rejected", t("Rejected"), h.rejected], ["written", t("Written"), h.written]] as const).map(([id, label, v]) => (
            <div key={id} data-testid={`entry-gate-hold-${id}`}><dt className="nx-sub">{label}</dt><dd className="nx-mono">{int(v)}</dd></div>
          ))}
          <div data-testid="entry-gate-hold-oldest"><dt className="nx-sub">{t("Oldest held")}</dt><dd className="nx-mono">{h.oldest_held_hours == null ? t("Nothing is held.") : ageWord(h.oldest_held_hours)}</dd></div>
          <div data-testid="entry-gate-hold-median"><dt className="nx-sub">{t("Median time to a decision")}</dt><dd className="nx-mono">{h.median_decision_hours == null ? t("Nothing was decided in the last 7 days.") : ageWord(h.median_decision_hours)}</dd></div>
        </dl>
        {h.latest.length === 0 ? <EmptyState heading={t("No record is held.")} /> : <RequestTable rows={h.latest} caption={t("Held requests")} testId="entry-gate-held-list" />}
      </section>
      <section aria-label={t("Requests opened from the gate")} data-testid="entry-gate-requests">
        <h3>{t("Requests opened from the gate")}</h3>
        <p className="nx-sub">{t("A flagged record can be sent to a steward as a create request. The latest ten are listed.")}</p>
        {(s.requests ?? []).length === 0 ? <EmptyState heading={t("The gate has not opened a request yet.")} /> : <RequestTable rows={s.requests} caption={t("Requests opened from the gate")} testId="entry-gate-request-list" />}
      </section>
      <TryPanel modules={tryModules.length ? tryModules : LICENSED_MODULES} />
    </div>
  );
}
