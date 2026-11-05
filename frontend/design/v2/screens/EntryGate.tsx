"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { getFirewallSummary, validateRecords, type FirewallFailure, type FirewallModuleRow, type FirewallSuggestion, type FirewallSummary, type StewardRequest } from "@/lib/api/v2/dq-firewall";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { ChartFrame, ChartTable, TrendChart, niceTicks, type TrendPoint } from "../charts";
import { objectWord, statusWord } from "../inspector/request";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { CcBanner, CcPage } from "./cc-parts";
import { DuplicateResults } from "./EntryDuplicates";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Entry gate: the data quality firewall as a page. SAP posts a candidate record before it is saved and the firewall
 * answers with the rules it fails. Every figure here comes from the firewall's own audit trail; a figure the trail did
 * not record (the warned count before it was kept) is a dash, never a zero. The licensed objects only.
 */

/** The objects the licence covers: material master, customer master and SuccessFactors employee data. */
export const LICENSED_MODULES = ["material_master", "sd_customer_master", "employee_central"] as const;

const SAMPLE = JSON.stringify([{ "MARA.MATNR": "ENTRY-TEST-1", "MARA.MTART": "", "MARA.MEINS": "KG" }], null, 2);

const num = (n: number | null | undefined) => (n == null ? <Dash why={t("Not recorded for these days.")} /> : int(n));

function trend(days: FirewallSummary["days"], pick: (d: FirewallSummary["days"][number]) => number | null): { points: TrendPoint[]; max: number } {
  const points = days.map((d) => {
    const v = pick(d);
    return { id: d.day, label: d.day.slice(5), title: v == null ? t("{day}: not recorded", { day: d.day }) : t("{day}: {n}", { day: d.day, n: int(v) }), value: v };
  });
  return { points, max: Math.max(4, ...points.map((p) => p.value ?? 0)) };
}

function DayChart({ days, title, pick, testId }: { days: FirewallSummary["days"]; title: string; pick: (d: FirewallSummary["days"][number]) => number | null; testId: string }) {
  const { points, max } = trend(days, pick);
  const ticks = niceTicks(0, max, 4);
  const top = ticks[ticks.length - 1] ?? max;
  return (
    <ChartFrame
      title={title}
      sub={t("Records a day, last 7 days")}
      height={160}
      level={2}
      state={points.length < 2 ? "empty" : "ready"}
      empty={t("Two days of calls are needed to draw a trend.")}
      testId={testId}
      table={<ChartTable caption={title} head={[t("Day"), t("Records")]} rows={points.map((p) => [p.label, p.value == null ? <Dash key={p.id} /> : int(p.value)])} />}
    >
      <TrendChart points={points} domain={[0, top] as const} ticks={ticks} height={160} label={title} yLabel={t("records")} format={int} />
    </ChartFrame>
  );
}

export function moduleRows(rows: readonly FirewallModuleRow[]): { module: string; row: FirewallModuleRow | null }[] {
  return LICENSED_MODULES.map((m) => ({ module: m, row: rows.find((r) => r.module === m) ?? null }));
}

const SEV: Record<FirewallFailure["severity"], () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low") };

function Suggested({ s }: { s?: FirewallSuggestion | null }) {
  if (!s) return <Dash why={t("No grounded fix exists for this failure.")} />;
  return (
    <span data-testid="entry-suggestion">
      {s.kind === "value" ? <Mono>{s.value ?? ""}</Mono> : (
        <>
          {(s.allowed_values ?? []).map((v) => (
            <span key={v.code}><Mono>{v.code}</Mono> {v.text ?? ""}{" "}</span>
          ))}
          {s.truncated ? t("and more") : null}
        </>
      )}{" "}
      <span className="m2-meta">{t("Rule {rule}, {source}", { rule: s.rule_id, source: s.source })}</span>
    </span>
  );
}

/** Why the gate opened no request, in words. */
export function notOpenedWord(r: StewardRequest["reason"]): string {
  switch (r) {
    case "module_has_no_change_request": return t("This object has no change request, so nothing was opened. Hand the record to a steward another way.");
    case "over_limit": return t("Too many records in one call. Only the first 25 flagged records open a request.");
    case "not_accepted": return t("The change request refused this record, so nothing was opened.");
    default: return t("The request could not be opened. The verdict above still stands.");
  }
}

/** The request each flagged record opened, or why none was. */
function StewardResults({ records }: { records: { index: number; steward_request?: StewardRequest | null }[] }) {
  const { hrefFor } = useOpenItem();
  const rows = records.filter((r) => r.steward_request);
  if (rows.length === 0) return null;
  return (
    <ScrollFrame label={t("Requests opened for flagged records table, scrollable")}>
      <table className="m2-tbl m2-cards" data-testid="entry-gate-steward">
        <thead>
          <tr>
            <th scope="col">{t("Record")}</th>
            <th scope="col">{t("Request")}</th>
            <th scope="col">{t("Status")}</th>
            <th scope="col">{t("Note")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ index, steward_request: sr }) => (
            <tr key={index}>
              <td data-label={t("Record")} className="m2-num">{index + 1}</td>
              <td data-label={t("Request")}>
                {sr?.request_id ? <V2Link href={hrefFor({ kind: "request", id: sr.request_id })} className="m2-rowlink">{t("Open the request")}</V2Link> : <Dash />}
              </td>
              <td data-label={t("Status")}>{sr?.status ? statusWord(sr.status) : <Dash />}</td>
              <td data-label={t("Note")}>{sr?.request_id ? (sr.existing ? t("Already open for this record. No second request was added.") : t("Opened and sent to the approval workflow.")) : notOpenedWord(sr?.reason)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollFrame>
  );
}

/** The latest requests the gate opened, each linking into the change request view. */
function GateRequests({ rows }: { rows: FirewallSummary["requests"] }) {
  const { hrefFor } = useOpenItem();
  return (
    <Panel title={t("Requests opened from the gate")} meta={t("A flagged record can be sent to a steward as a create request. The latest ten are listed.")} testId="entry-gate-requests">
      {rows.length === 0 ? <EmptyFrame>{t("The gate has not opened a request yet.")}</EmptyFrame> : (
        <ScrollFrame label={t("Requests opened from the gate table, scrollable")}>
          <table className="m2-tbl m2-cards">
            <thead>
              <tr>
                <th scope="col">{t("Request")}</th>
                <th scope="col">{t("Object")}</th>
                <th scope="col">{t("Status")}</th>
                <th scope="col">{t("Opened")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`entry-gate-request-${r.id}`}>
                  <th scope="row" className="m2-card-lead">
                    <V2Link href={hrefFor({ kind: "request", id: r.id })} className="m2-rowlink">{r.title || t("Untitled request")}</V2Link>
                  </th>
                  <td data-label={t("Object")}>{objectWord(r.object)}</td>
                  <td data-label={t("Status")}>{statusWord(r.status)}</td>
                  <td data-label={t("Opened")}>{formatDate(r.created_at, "date")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </Panel>
  );
}

function TryPanel({ modules }: { modules: readonly string[] }) {
  const qc = useQueryClient();
  const [obj, setObj] = useState<string>(modules[0] ?? "material_master");
  const [text, setText] = useState(SAMPLE);
  const [suggest, setSuggest] = useState(true);
  const [duplicates, setDuplicates] = useState(false);
  const [route, setRoute] = useState(false);
  const [bad, setBad] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new SyntaxError("array");
      return validateRecords(obj, parsed as Record<string, string>[], { suggest, duplicates, route_to_steward: route });
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
      <div className="m2-fgrid">
        <label>
          <span>{t("Object")}</span>
          <select value={obj} onChange={(e) => setObj(e.target.value)} data-testid="entry-gate-object">
            {modules.map((m) => <option key={m} value={m}>{moduleText(m)}</option>)}
          </select>
        </label>
        <label>
          <span>{t("Records, as JSON")}</span>
          <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-testid="entry-gate-json" />
        </label>
        <label>
          <input type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} /> {t("Show a fix where the rule gives one")}
        </label>
        <label>
          <input type="checkbox" checked={duplicates} onChange={(e) => setDuplicates(e.target.checked)} data-testid="entry-gate-duplicates" /> {t("Look for duplicates among existing records")}
        </label>
        <label>
          <input type="checkbox" checked={route} onChange={(e) => setRoute(e.target.checked)} data-testid="entry-gate-route" /> {t("Send blocked or warned records to a steward as a change request")}
        </label>
      </div>
      <button type="button" className="m2-btn m2-strong" disabled={run.isPending} onClick={() => run.mutate()} data-testid="entry-gate-run">{t("Check records")}</button>
      {bad || apiErr ? <p role="alert">{bad ?? apiErr}</p> : null}
      {res ? (
        <>
          <p role="status" data-testid="entry-gate-result">
            {res.verdict === "block" ? t("Blocked") : t("Passed")}{" "}
            {t("{blocked} of {total} records blocked, {rules} rules run.", { blocked: res.records.filter((r) => r.verdict === "block").length, total: res.records.length, rules: res.rules_run })}
          </p>
          {rows.length === 0 ? <EmptyFrame>{t("Every record passed every enabled rule.")}</EmptyFrame> : (
            <ScrollFrame label={t("Failing rules table, scrollable")}>
              <table className="m2-tbl m2-cards">
                <thead>
                  <tr>
                    <th scope="col">{t("Record")}</th>
                    <th scope="col">{t("Rule")}</th>
                    <th scope="col">{t("What the rule requires")}</th>
                    <th scope="col">{t("Field")}</th>
                    <th scope="col">{t("Severity")}</th>
                    <th scope="col">{t("Suggested fix")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={`${f.record}:${f.rule_id}`}>
                      <td data-label={t("Record")} className="m2-num">{f.record + 1}</td>
                      <th scope="row" className="m2-card-lead"><Mono>{f.rule_id}</Mono></th>
                      <td data-label={t("What the rule requires")}>{f.description}</td>
                      <td data-label={t("Field")}><Mono>{f.field}</Mono></td>
                      <td data-label={t("Severity")}>{SEV[f.severity]()}</td>
                      <td data-label={t("Suggested fix")}><Suggested s={f.suggestion} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollFrame>
          )}
          <DuplicateResults res={res} />
          <StewardResults records={res.records} />
        </>
      ) : null}
    </Panel>
  );
}

export function EntryGate() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["entry-gate", fixture], queryFn: getFirewallSummary, staleTime: 15_000 });
  if (q.isPending) return <CcPage title={t("Entry gate")}><Skeleton width="100%" height={320} /></CcPage>;
  if (q.isError) return <CcPage title={t("Entry gate")}><ErrorFrame onRetry={() => void q.refetch()}>{t("The firewall traffic could not be read.")}</ErrorFrame></CcPage>;
  const s = q.data;
  const days = s.days ?? [];
  const checked = days.reduce((n, d) => n + d.checked, 0);
  const blocked = days.reduce((n, d) => n + d.blocked, 0);
  const rules = s.top_rules ?? [];
  const mods = moduleRows(s.by_module ?? []);
  const tryModules = LICENSED_MODULES.filter((m) => s.modules.includes(m));

  return (
    <CcPage title={t("Entry gate")}>
      <CcBanner
        testId="entry-gate"
        label={t("Entry gate")}
        eyebrow={t("Entry gate")}
        headline={t("{blocked} of {checked} records were stopped at entry in the last 7 days", { blocked: int(blocked), checked: int(checked) })}
        why={t("SAP asks the firewall before it saves a record. A record that fails a critical rule is blocked; one that passes but fails a lesser rule is warned.")}
        figs={[
          { label: t("Calls in 24 hours"), value: int(s.calls_24h) },
          { label: t("Calls in 7 days"), value: int(s.calls_7d) },
        ]}
      />

      <div className="m2-ck-row">
        <DayChart days={days} title={t("Records checked")} pick={(d) => d.checked} testId="entry-gate-checked" />
        <DayChart days={days} title={t("Records blocked")} pick={(d) => d.blocked} testId="entry-gate-blocked" />
      </div>

      <Panel title={t("Each day")} meta={t("Warned and passed were not kept before this release, so earlier days show a dash.")} testId="entry-gate-days">
        {days.length === 0 ? <EmptyFrame>{t("The firewall has not been called in the last 7 days.")}</EmptyFrame> : (
          <ScrollFrame label={t("Firewall traffic by day table, scrollable")}>
            <table className="m2-tbl m2-cards">
              <thead>
                <tr>
                  <th scope="col">{t("Day")}</th>
                  <th scope="col">{t("Checked")}</th>
                  <th scope="col">{t("Blocked")}</th>
                  <th scope="col">{t("Warned")}</th>
                  <th scope="col">{t("Passed")}</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day}>
                    <th scope="row" className="m2-card-lead">{d.day}</th>
                    <td data-label={t("Checked")} className="m2-num">{int(d.checked)}</td>
                    <td data-label={t("Blocked")} className="m2-num">{int(d.blocked)}</td>
                    <td data-label={t("Warned")} className="m2-num">{num(d.warned)}</td>
                    <td data-label={t("Passed")} className="m2-num">{num(d.passed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Panel>

      <div className="m2-ck-row">
        <Panel title={t("Rules that block most")} meta={t("Critical rules, most blocked records first.")} testId="entry-gate-rules">
          {rules.length === 0 ? <EmptyFrame>{t("No rule has blocked a record yet.")}</EmptyFrame> : (
            <ScrollFrame label={t("Top blocking rules table, scrollable")}>
              <table className="m2-tbl m2-cards">
                <thead>
                  <tr>
                    <th scope="col">{t("Rule")}</th>
                    <th scope="col">{t("What the rule requires")}</th>
                    <th scope="col">{t("Blocked")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.rule_id}>
                      <th scope="row" className="m2-card-lead"><Mono>{r.rule_id}</Mono></th>
                      <td data-label={t("What the rule requires")}>{r.description || <Dash />}</td>
                      <td data-label={t("Blocked")} className="m2-num">{int(r.blocked)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollFrame>
          )}
        </Panel>

        <Panel title={t("By object")} meta={t("The objects the licence covers.")} testId="entry-gate-modules">
          <ScrollFrame label={t("Firewall traffic by object table, scrollable")}>
            <table className="m2-tbl m2-cards">
              <thead>
                <tr>
                  <th scope="col">{t("Object")}</th>
                  <th scope="col">{t("Checked")}</th>
                  <th scope="col">{t("Blocked")}</th>
                  <th scope="col">{t("Warned")}</th>
                  <th scope="col">{t("Passed")}</th>
                </tr>
              </thead>
              <tbody>
                {mods.map(({ module, row }) => (
                  <tr key={module} data-testid={`entry-gate-module-${module}`}>
                    <th scope="row" className="m2-card-lead">{moduleText(module)} <span className="m2-meta"><Mono>{module}</Mono></span></th>
                    <td data-label={t("Checked")} className="m2-num">{row ? int(row.checked) : <Dash />}</td>
                    <td data-label={t("Blocked")} className="m2-num">{row ? int(row.blocked) : <Dash />}</td>
                    <td data-label={t("Warned")} className="m2-num">{row ? num(row.warned) : <Dash />}</td>
                    <td data-label={t("Passed")} className="m2-num">{row ? num(row.passed) : <Dash />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        </Panel>
      </div>

      <GateRequests rows={s.requests ?? []} />

      <TryPanel modules={tryModules.length ? tryModules : LICENSED_MODULES} />
    </CcPage>
  );
}
