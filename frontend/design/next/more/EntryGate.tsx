"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { getFirewallSummary, validateRecords, type FirewallFailure, type FirewallModuleRow, type FirewallSuggestion, type FirewallSummary, type GateRequest, type HoldMode, type HoldState, type RecordHold, type StewardRequest } from "@/lib/api/v2/dq-firewall";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { V2Link } from "@/design/v2/parts";
import { Button, Code, DataTable, ErrorState, Skeleton, Stepper } from "../kit";
import { AreaTrend } from "../viz";
import { About, Banner, Fold, Panel } from "./cfg-parts";
import { Dash, DdicCard, DuplicateResults, FieldCode, NeedsPermission, ageWord, objectWord, statusWord } from "./entry-parts";

/**
 * Entry gate: the data quality firewall as a page. SAP posts a candidate record before it is saved and the firewall
 * answers with the rules it fails. Every figure comes from the firewall's own audit trail; a figure the trail did not
 * record (the warned count before it was kept) is a dash, never a zero. The licensed objects only.
 */

/** The objects the licence covers: material master, customer master and SuccessFactors employee data. */
const LICENSED_MODULES = ["material_master", "sd_customer_master", "employee_central"] as const;

const SAMPLE = JSON.stringify([{ "MARA.MATNR": "ENTRY-TEST-1", "MARA.MTART": "", "MARA.MEINS": "KG" }], null, 2);

const num = (n: number | null | undefined) => (n == null ? <Dash why={t("Not recorded for these days.")} /> : int(n));

const SEV: Record<FirewallFailure["severity"], () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low") };

function DayChart({ days, title, pick, testId }: { days: FirewallSummary["days"]; title: string; pick: (d: FirewallSummary["days"][number]) => number; testId: string }) {
  return (
    <Panel title={title} meta={t("Records a day, last 7 days")} testId={testId}>
      <AreaTrend
        points={days.length < 2 ? [] : days.map((d) => ({ label: d.day.slice(5), value: pick(d) }))}
        label={title}
        height={160}
        empty={t("Two days of calls are needed to draw a trend.")}
      />
    </Panel>
  );
}

function Suggested({ s }: { s?: FirewallSuggestion | null }) {
  if (!s) return <Dash why={t("No grounded fix exists for this failure.")} />;
  return (
    <span data-testid="entry-suggestion">
      {s.kind === "value" ? <Code code={s.value ?? ""} /> : (
        <>
          {(s.allowed_values ?? []).map((v) => <Code key={v.code} code={v.code} text={v.text ?? undefined} />)}
          {s.truncated ? ` ${t("and more")}` : null}
        </>
      )}{" "}
      <span className="nx-sub">{t("Rule {rule}, {source}", { rule: s.rule_id, source: s.source })}</span>
    </span>
  );
}

/** Why the gate opened no request, in words. */
function notOpenedWord(r: StewardRequest["reason"]): string {
  switch (r) {
    case "module_has_no_change_request": return t("This object has no change request, so nothing was opened. Hand the record to a steward another way.");
    case "over_limit": return t("Too many records in one call. Only the first 25 flagged records open a request.");
    case "not_accepted": return t("The change request refused this record, so nothing was opened.");
    default: return t("The request could not be opened. The verdict above still stands.");
  }
}

function holdWord(s: HoldState): string {
  switch (s) {
    case "held": return t("Held");
    case "released": return t("Released");
    case "rejected": return t("Rejected");
    case "written": return t("Written");
    default: return t("Not held");
  }
}

function holdNote(h: RecordHold): string {
  switch (h.state) {
    case "held": return t("Waiting for the approval workflow. The SAP save stops.");
    case "released": return t("Approved and released to the SAP save. The save may go on, even for a blocked record.");
    case "rejected": return t("Rejected by an approver. The SAP save stops. Changed content opens a new request.");
    case "written": return h.reason === "exported_as_load_file"
      ? t("Already taken as a load file. The SAP save stops, so the record is not created twice.")
      : t("Meridian writes or has written this record to SAP. The SAP save stops, so the record is not created twice.");
    default: return notOpenedWord(h.reason as StewardRequest["reason"]);
  }
}

function RequestTable({ rows, caption, empty, prefix }: { rows: GateRequest[]; caption: string; empty: string; prefix: string }) {
  const { hrefFor } = useOpenItem();
  return (
    <DataTable
      caption={caption}
      rows={rows}
      rowKey={(r) => r.id}
      rowLabel={(r) => r.title || t("Untitled request")}
      empty={{ heading: empty }}
      columns={[
        { id: "req", label: t("Request"), cell: (r) => <span data-testid={`${prefix}-${r.id}`}><V2Link href={hrefFor({ kind: "request", id: r.id })}>{r.title || t("Untitled request")}</V2Link></span> },
        { id: "obj", label: t("Object"), cell: (r) => objectWord(r.object) },
        { id: "status", label: t("Status"), cell: (r) => statusWord(r.status) },
        { id: "opened", label: t("Opened"), cell: (r) => formatDate(r.created_at, "date") },
      ]}
    />
  );
}

/** Held, released, rejected and written requests, how long the oldest has waited, and the latest held ones. */
function HoldsPanel({ holds: h }: { holds: FirewallSummary["holds"] }) {
  const figs: { id: string; label: string; value: ReactNode }[] = [
    { id: "held", label: t("Held"), value: int(h.held) },
    { id: "released", label: t("Released"), value: int(h.released) },
    { id: "rejected", label: t("Rejected"), value: int(h.rejected) },
    { id: "written", label: t("Written"), value: int(h.written) },
    { id: "oldest", label: t("Oldest held"), value: h.oldest_held_hours == null ? <Dash why={t("Nothing is held.")} /> : ageWord(h.oldest_held_hours) },
    { id: "median", label: t("Median time to a decision"), value: h.median_decision_hours == null ? <Dash why={t("Nothing was decided in the last 7 days.")} /> : ageWord(h.median_decision_hours) },
  ];
  return (
    <Panel title={t("Holds")} meta={t("A held record waits for the approval workflow before SAP may save it. Released, rejected and written count the last 7 days; held counts what waits now.")} testId="entry-gate-holds">
      <dl className="nx-cfg-figs">
        {figs.map((f) => (
          <div key={f.id} data-testid={`entry-gate-hold-${f.id}`}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      <div data-testid="entry-gate-held-list">
        <RequestTable rows={h.latest} caption={t("Held requests table, scrollable")} empty={t("No record is held.")} prefix="entry-gate-held" />
      </div>
    </Panel>
  );
}

function StewardResults({ records }: { records: { index: number; steward_request?: StewardRequest | null }[] }) {
  const { hrefFor } = useOpenItem();
  const rows = records.filter((r) => r.steward_request);
  if (rows.length === 0) return null;
  return (
    <div data-testid="entry-gate-steward">
      <DataTable
        caption={t("Requests opened for flagged records table, scrollable")}
        rows={rows}
        rowKey={(r) => String(r.index)}
        rowLabel={(r) => t("Record {n}", { n: r.index + 1 })}
        columns={[
          { id: "rec", label: t("Record"), align: "end", cell: (r) => int(r.index + 1) },
          { id: "req", label: t("Request"), cell: ({ steward_request: sr }) => (sr?.request_id ? <V2Link href={hrefFor({ kind: "request", id: sr.request_id })}>{t("Open the request")}</V2Link> : <Dash />) },
          { id: "status", label: t("Status"), cell: ({ steward_request: sr }) => (sr?.status ? statusWord(sr.status) : <Dash />) },
          { id: "note", label: t("Note"), cell: ({ steward_request: sr }) => (sr?.request_id ? (sr.existing ? t("Already open for this record. No second request was added.") : t("Opened and sent to the approval workflow.")) : notOpenedWord(sr?.reason)) },
        ]}
      />
    </div>
  );
}

function HoldResults({ records }: { records: { index: number; hold?: RecordHold | null }[] }) {
  const { hrefFor } = useOpenItem();
  const rows = records.filter((r): r is { index: number; hold: RecordHold } => !!r.hold);
  if (rows.length === 0) return null;
  return (
    <div data-testid="entry-gate-hold-results">
      <DataTable
        caption={t("Hold state of each record table, scrollable")}
        rows={rows}
        rowKey={(r) => String(r.index)}
        rowLabel={(r) => t("Record {n}", { n: r.index + 1 })}
        columns={[
          { id: "rec", label: t("Record"), align: "end", cell: (r) => int(r.index + 1) },
          { id: "hold", label: t("Hold"), cell: (r) => holdWord(r.hold.state) },
          { id: "req", label: t("Request"), cell: (r) => (r.hold.request_id ? <V2Link href={hrefFor({ kind: "request", id: r.hold.request_id })}>{t("Open the request")}</V2Link> : <Dash />) },
          { id: "key", label: t("SAP key"), cell: (r) => (r.hold.sap_key ? <Code code={r.hold.sap_key} /> : <Dash why={t("SAP has not given a key.")} />) },
          { id: "means", label: t("What it means"), cell: (r) => holdNote(r.hold) },
        ]}
      />
    </div>
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
  const res = run.data;
  const rows = res ? res.records.flatMap((r) => r.failures.map((f) => ({ ...f, record: r.index }))) : [];
  const apiErr = run.isError && !(run.error instanceof SyntaxError) ? errorSentence(run.error, t("The records could not be checked.")) : null;
  return (
    <Panel title={t("Try a record")} meta={t("Runs the same check SAP calls at save. A suggestion is shown only when the rule itself gives one.")} testId="entry-gate-try">
      <div className="nx-form">
        <label className="nx-field">
          <span>{t("Object")}</span>
          <select className="nx-input" value={obj} onChange={(e) => setObj(e.target.value)} data-testid="entry-gate-object">
            {modules.map((m) => <option key={m} value={m}>{moduleText(m)}</option>)}
          </select>
        </label>
        <label className="nx-field">
          <span>{t("Records, as JSON")}</span>
          <textarea className="nx-input" rows={7} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-testid="entry-gate-json" />
        </label>
        <label className="nx-check">
          <input type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} /> {t("Show a fix where the rule gives one")}
        </label>
        <label className="nx-check">
          <input type="checkbox" checked={duplicates} onChange={(e) => setDuplicates(e.target.checked)} data-testid="entry-gate-duplicates" /> {t("Look for duplicates among existing records")}
        </label>
        <label className="nx-check">
          <input type="checkbox" checked={route} onChange={(e) => setRoute(e.target.checked)} data-testid="entry-gate-route" /> {t("Send blocked or warned records to a steward as a change request")}
        </label>
        <label className="nx-field">
          <span>{t("Hold")}</span>
          <select className="nx-input" value={hold} onChange={(e) => setHold(e.target.value as HoldMode)} data-testid="entry-gate-hold">
            <option value="off">{t("Off: the verdict alone decides the save")}</option>
            <option value="blocked">{t("Blocked: hold blocked records for approval")}</option>
            <option value="flagged">{t("Flagged: hold blocked and warned records for approval")}</option>
          </select>
        </label>
        {allowed ? (
          <Button variant="primary" loading={run.isPending} disabled={run.isPending} onClick={() => run.mutate()} data-testid="entry-gate-run">{t("Check records")}</Button>
        ) : (
          <NeedsPermission what={t("Checking records at the gate")} permission="mdm.write" />
        )}
      </div>
      {bad || apiErr ? <p role="alert" className="nx-note">{bad ?? apiErr}</p> : null}
      {res ? (
        <div className="nx-form">
          <p role="status" data-testid="entry-gate-result">
            {res.verdict === "block" ? t("Blocked") : t("Passed")}{" "}
            {t("{blocked} of {total} records blocked, {rules} rules run.", { blocked: res.records.filter((r) => r.verdict === "block").length, total: res.records.length, rules: res.rules_run })}
          </p>
          {res.save ? (
            <p role="status" data-testid="entry-gate-save">
              {res.save === "stop" ? t("The SAP save stops.") : t("The SAP save may go on.")}
            </p>
          ) : null}
          <DataTable
            caption={t("Failing rules table, scrollable")}
            rows={rows}
            rowKey={(f) => `${f.record}:${f.rule_id}`}
            rowLabel={(f) => f.rule_id}
            empty={{ heading: t("Every record passed every enabled rule.") }}
            columns={[
              { id: "rec", label: t("Record"), align: "end", cell: (f) => int(f.record + 1) },
              { id: "rule", label: t("Rule"), cell: (f) => <Code code={f.rule_id} text={f.description} /> },
              { id: "what", label: t("What the rule requires"), cell: (f) => f.description },
              { id: "field", label: t("Field"), cell: (f) => <FieldCode field={f.field} /> },
              { id: "sev", label: t("Severity"), cell: (f) => SEV[f.severity]() },
              { id: "fix", label: t("Suggested fix"), cell: (f) => <Suggested s={f.suggestion} /> },
              { id: "ddic", label: t("SAP dictionary"), cell: (f) => <DdicCard evidence={f.ddic} /> },
            ]}
          />
          <DuplicateResults res={res} />
          <StewardResults records={res.records} />
          <HoldResults records={res.records} />
        </div>
      ) : null}
    </Panel>
  );
}

function moduleRows(rows: readonly FirewallModuleRow[]): { module: string; row: FirewallModuleRow | null }[] {
  return LICENSED_MODULES.map((m) => ({ module: m, row: rows.find((r) => r.module === m) ?? null }));
}

export function EntryGate() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["entry-gate", fixture], queryFn: getFirewallSummary, staleTime: 15_000 });
  if (q.isPending) return <div className="nx-body"><Skeleton lines={8} label={t("Entry gate")} /></div>;
  if (q.isError) return <div className="nx-body"><ErrorState sentence={t("The firewall traffic could not be read.")} onRetry={() => void q.refetch()} /></div>;
  const s = q.data;
  const days = s.days ?? [];
  const checked = days.reduce((n, d) => n + d.checked, 0);
  const blocked = days.reduce((n, d) => n + d.blocked, 0);
  const rules = s.top_rules ?? [];
  const mods = moduleRows(s.by_module ?? []);
  const tryModules = LICENSED_MODULES.filter((m) => s.modules.includes(m));
  const steps = [t("Try a record"), t("Review what is held"), t("Approve or reject"), t("SAP saves what passes")];

  return (
    <div className="nx-body" data-testid="entry-gate-page">
      <Stepper label={t("Entry gate")} steps={steps.map((label, i) => ({ id: String(i), label, state: i < 1 ? "done" : i === 1 ? "current" : "future" }))} />
      <About
        shows={t("Shows the records the entry gate checked before SAP saved them: how many passed, were held for approval, rejected or written.")}
        why={t("SAP asks the firewall before it saves a record. A record that fails a critical rule is blocked; one that passes but fails a lesser rule is warned.")}
        next={{ href: "/requests", label: t("Open the requests") }}
        means={[
          [t("Held"), t("Records waiting for the approval workflow before SAP may save them.")],
          [t("Rejected"), t("Records the gate stopped because they failed a rule.")],
          [t("Written"), t("Records that passed and SAP saved.")],
        ]}
      />
      <Banner
        testId="entry-gate"
        label={t("Entry gate")}
        title={t("{blocked} of {checked} records were stopped at entry in the last 7 days", { blocked: int(blocked), checked: int(checked) })}
        why={t("SAP asks the firewall before it saves a record. A record that fails a critical rule is blocked; one that passes but fails a lesser rule is warned.")}
        meta={t("Entry gate")}
        figs={[
          { label: t("Calls in 24 hours"), value: int(s.calls_24h) },
          { label: t("Calls in 7 days"), value: int(s.calls_7d) },
        ]}
      />

      <DayChart days={days} title={t("Records checked")} pick={(d) => d.checked} testId="entry-gate-checked" />
      <DayChart days={days} title={t("Records blocked")} pick={(d) => d.blocked} testId="entry-gate-blocked" />

      <Fold title={t("Each day")} hint={t("Warned and passed were not kept before this release, so earlier days show a dash.")}>
        <div data-testid="entry-gate-days">
          <DataTable
            caption={t("Firewall traffic by day table, scrollable")}
            rows={days}
            rowKey={(d) => d.day}
            rowLabel={(d) => d.day}
            empty={{ heading: t("The firewall has not been called in the last 7 days.") }}
            columns={[
              { id: "day", label: t("Day"), cell: (d) => d.day },
              { id: "checked", label: t("Checked"), align: "end", cell: (d) => int(d.checked) },
              { id: "blocked", label: t("Blocked"), align: "end", cell: (d) => int(d.blocked) },
              { id: "warned", label: t("Warned"), align: "end", cell: (d) => num(d.warned) },
              { id: "passed", label: t("Passed"), align: "end", cell: (d) => num(d.passed) },
            ]}
          />
        </div>
      </Fold>

      <Panel title={t("Rules that block most")} meta={t("Critical rules, most blocked records first.")} testId="entry-gate-rules">
        <DataTable
          caption={t("Top blocking rules table, scrollable")}
          rows={rules}
          rowKey={(r) => r.rule_id}
          rowLabel={(r) => r.rule_id}
          empty={{ heading: t("No rule has blocked a record yet.") }}
          columns={[
            { id: "rule", label: t("Rule"), cell: (r) => <Code code={r.rule_id} text={r.description || undefined} /> },
            { id: "what", label: t("What the rule requires"), cell: (r) => r.description || <Dash /> },
            { id: "blocked", label: t("Blocked"), align: "end", cell: (r) => int(r.blocked) },
          ]}
        />
      </Panel>

      <Panel title={t("By object")} meta={t("The objects the licence covers.")} testId="entry-gate-modules">
        <DataTable
          caption={t("Firewall traffic by object table, scrollable")}
          rows={mods}
          rowKey={(m) => m.module}
          rowLabel={(m) => moduleText(m.module)}
          columns={[
            { id: "obj", label: t("Object"), cell: ({ module }) => <span data-testid={`entry-gate-module-${module}`}><Code code={module} text={moduleText(module)} /></span> },
            { id: "checked", label: t("Checked"), align: "end", cell: ({ row }) => (row ? int(row.checked) : <Dash />) },
            { id: "blocked", label: t("Blocked"), align: "end", cell: ({ row }) => (row ? int(row.blocked) : <Dash />) },
            { id: "warned", label: t("Warned"), align: "end", cell: ({ row }) => (row ? num(row.warned) : <Dash />) },
            { id: "passed", label: t("Passed"), align: "end", cell: ({ row }) => (row ? num(row.passed) : <Dash />) },
          ]}
        />
      </Panel>

      <HoldsPanel holds={s.holds} />

      <Panel title={t("Requests opened from the gate")} meta={t("A flagged record can be sent to a steward as a create request. The latest ten are listed.")} testId="entry-gate-requests">
        <RequestTable rows={s.requests ?? []} caption={t("Requests opened from the gate table, scrollable")} empty={t("The gate has not opened a request yet.")} prefix="entry-gate-request" />
      </Panel>

      <TryPanel modules={tryModules.length ? tryModules : LICENSED_MODULES} />
    </div>
  );
}

