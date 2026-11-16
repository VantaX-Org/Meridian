"use client";

/**
 * One failing record, natively, for the object page's record sheet (id `${module}:${key}`): its status, every field
 * with the rules that reject it, one fix block per failing rule, the actions this person's role allows, the S/4
 * features it blocks, its provenance and its history. Reads GET /work/records/{module}/{key} and
 * /records/{module}/{key}/links; decisions go to POST /work/decide, batch sign-off to the batch endpoints.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Chip, Code, EmptyState, ErrorState, Skeleton, useToast } from "@/design/next/kit";
import { useSheets } from "@/design/next/shell/SheetHost";
import { V2Link } from "@/design/v2/parts";
import type { WorkIssue, WorkRecordDetail, WorkAction } from "@/lib/api/work";
import { errorSentence, postApproveBatch, postDecide, postSendBack, type RecordLinks } from "@/lib/api/v2/work";
import { formatDate } from "@/lib/format";
import { useOpenItem, useRunParam } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { objectHref } from "@/lib/v2/people";
import { refreshV2, useLandscape } from "@/lib/v2/queries";
import { describeField, sapField } from "@/lib/v2/sap-fields";
import { int } from "@/lib/v2/score";
import { STATUS_LABEL, splitKey } from "@/lib/v2/work";
import { useWorkCan } from "@/lib/v2/work-actions";
import { useRecordLinks, useWorkRecord } from "@/lib/v2/work-queries";
import { recordDetailId } from "./RecordSheets";
import { Dash, SevChip } from "./tabs/tabs-g-parts";
import "../runs/runs.css";

export function parseRecordId(id: string): { module: string; key: string } {
  const at = id.indexOf(":");
  return at > 0 ? { module: id.slice(0, at), key: id.slice(at + 1) } : { module: "", key: id };
}

/** What the history rows say, in the words of the trade. */
export function historyLine(h: RecordLinks["history"][number]): string {
  if (h.action === "assign") return h.to_value ? t("Assigned to {to_value}{value}", { to_value: h.to_value, value: h.user ? t(" by {user}", { user: h.user }) : "" }) : (h.user ? t("Unassigned by {user}", { user: h.user }) : t("Unassigned"));
  if (h.action === "comment") return t("{user} wrote: {note}", { user: h.user ?? t("Someone"), note: h.note ?? "" });
  if (h.action === "status") return `${h.check_id ? `${h.check_id}: ` : ""}${h.to_value ?? t("Status changed")}${h.user ? `, ${h.user}` : ""}${h.note ? `. ${h.note}` : ""}`;
  return `${h.action}${h.to_value ? `: ${h.to_value}` : ""}${h.user ? `, ${h.user}` : ""}`;
}

const SHOWN_ALLOWED = 5;
type Reason = { kind: "not_an_issue" | "accept_risk"; issues: WorkIssue[] } | { kind: "send_back" };
type Decide = (issues: WorkIssue[], action: WorkAction, extra?: { value?: string; note?: string; assignee?: string }) => Promise<boolean>;

function Fact({ label, children, testId }: { label: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return <div data-testid={testId}><dt>{label}</dt><dd>{children}</dd></div>;
}

/** A reason is required for a sign-off and for sending a batch back; the API refuses one without it. */
function ReasonForm({ title, label, confirm, onConfirm, onCancel }: { title: string; label: string; confirm: string; onConfirm: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState("");
  return (
    <section className="nx-rn-sub" aria-label={title} data-testid="reason-form">
      <h3 className="nx-rn-h3">{title}</h3>
      <label className="nx-field">
        <span className="nx-field-label">{label}</span>
        <textarea className="nx-input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="nx-rn-sub">
        <Button variant="primary" size={32} disabled={!note.trim()} onClick={() => onConfirm(note.trim())}>{confirm}</Button>
        <Button variant="quiet" size={32} onClick={onCancel}>{t("Cancel")}</Button>
      </div>
    </section>
  );
}

function FixBlock({ issue, detail, canFix, canSign, decide, onReason }: { issue: WorkIssue; detail: WorkRecordDetail; canFix: boolean; canSign: boolean; decide: Decide; onReason: (r: Reason) => void }) {
  const { hrefFor } = useOpenItem();
  const serverValue = issue.decision?.value ?? "";
  const [value, setValue] = useState(serverValue);
  const [showAll, setShowAll] = useState(false);
  const allowed = issue.allowed_values ?? [];
  const list = showAll ? allowed : allowed.slice(0, SHOWN_ALLOWED);
  const labelOf = (v: string | null | undefined) => (v ? allowed.find((a) => a.value === v)?.label ?? undefined : undefined);
  const typed = value.trim();
  // A rule with a value list accepts only those values; free text is for rules without one.
  const outside = typed !== "" && allowed.length > 0 && !allowed.some((a) => a.value === typed);
  const canSave = typed !== "" && typed !== serverValue && !outside;
  const open = issue.status === "to_fix";
  return (
    <section className="nx-rn-sub" aria-label={t("Fix for {check_id}", { check_id: issue.check_id })} data-testid="fix-block">
      <dl className="nx-paired-row">
        <Fact label={t("Rule")}>
          <V2Link className="nx-link" href={hrefFor({ kind: "rule", id: issue.check_id })}><Code code={issue.check_id} text={issue.message} /></V2Link>{" "}
          <SevChip severity={issue.severity} />
        </Fact>
        <Fact label={t("Field")}>{issue.field ? <Code code={sapField(issue.field)} text={describeField(issue.field, detail.field_descriptions) ?? undefined} /> : <Dash />}</Fact>
        {issue.failing != null ? (
          <Fact label={t("In this run")}>
            {t("{failing} {failing2, plural, one {record fails} other {records fail}}{value}", { failing: int(issue.failing), failing2: issue.failing, value: issue.population ? t(" of {population} checked", { population: int(issue.population) }) : "" })}
          </Fact>
        ) : null}
        <Fact label={t("Current value")}>{issue.current_value ? <Code code={issue.current_value} text={labelOf(issue.current_value)} /> : <span className="nx-muted">{t("blank")}</span>}</Fact>
        <Fact label={t("Possible values")}>
          {allowed.length === 0 ? <span className="nx-muted">{t("The rule does not list values")}</span> : (
            <>
              <ul>{list.map((a) => <li key={a.value}><Code code={a.value} text={a.label ?? undefined} /></li>)}</ul>
              {allowed.length > SHOWN_ALLOWED ? (
                <Button variant="quiet" size={32} onClick={() => setShowAll((v) => !v)}>{showAll ? t("Show fewer") : t("Show all {allowedCount}", { allowedCount: allowed.length })}</Button>
              ) : null}
            </>
          )}
        </Fact>
        <Fact label={t("Suggested value")}>
          {issue.suggestion?.value ? (
            <><Code code={issue.suggestion.value} text={labelOf(issue.suggestion.value)} />{issue.suggestion.why ? <span className="nx-muted">{` ${issue.suggestion.why}`}</span> : null}</>
          ) : <span className="nx-muted">{t("none for this row")}</span>}
        </Fact>
        <Fact label={t("New value")}>
          {canFix && open ? (
            <>
              <input
                type="text"
                className="nx-input nx-mono"
                aria-label={t("New value for {check_id}", { check_id: issue.check_id })}
                aria-invalid={outside || undefined}
                placeholder={allowed.length ? t("Pick or type an allowed value") : t("Type a value")}
                list={allowed.length ? `allowed-${issue.check_id}` : undefined}
                value={value}
                spellCheck={false}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && canSave) { e.preventDefault(); void decide([issue], "edit", { value: typed }); } }}
              />
              {allowed.length ? <datalist id={`allowed-${issue.check_id}`}>{allowed.map((a) => <option key={a.value} value={a.value}>{a.label ?? a.value}</option>)}</datalist> : null}{" "}
              <Button variant="secondary" size={32} disabled={!canSave} onClick={() => void decide([issue], "edit", { value: typed })}>{t("Save")}</Button>
              {issue.suggestion?.value ? <Button variant="quiet" size={32} onClick={() => void decide([issue], "accept")}>{t("Accept suggested")}</Button> : null}
              {outside ? <span role="alert" className="nx-muted" data-testid="new-value-outside">{" "}{t("{value} is not one of the values this rule accepts.", { value: typed })}</span> : null}
            </>
          ) : serverValue ? <Code code={serverValue} text={labelOf(serverValue)} /> : <Dash why={canFix ? undefined : t("Read-only for your role")} />}
        </Fact>
        <Fact label={t("Status")}>{STATUS_LABEL[issue.status] ?? issue.status}</Fact>
        {detail.assignee_email ? <Fact label={t("Assigned to")}>{detail.assignee_email}</Fact> : null}
      </dl>
      {canSign && open ? (
        <div className="nx-rn-sub">
          <Button variant="quiet" size={32} onClick={() => onReason({ kind: "not_an_issue", issues: [issue] })}>{t("Not an issue")}</Button>
          <Button variant="quiet" size={32} onClick={() => onReason({ kind: "accept_risk", issues: [issue] })}>{t("Accept risk")}</Button>
        </div>
      ) : null}
    </section>
  );
}

export function RecordEvidence({ id }: { id: string }) {
  const { module, key } = parseRecordId(id);
  const detailQ = useWorkRecord(module, key);
  const detail = detailQ.data;
  const linksQ = useRecordLinks(module, key, detail?.version_id ?? null);
  const links = linksQ.data;
  const qc = useQueryClient();
  const toast = useToast();
  const can = useWorkCan();
  const { hrefFor } = useOpenItem();
  const { open } = useSheets();
  const landscape = useLandscape(useRunParam()).data;
  const [reason, setReason] = useState<Reason | null>(null);
  const [busy, setBusy] = useState(false);
  const issues = useMemo(() => detail?.issues ?? [], [detail]);

  // Facts: every field the record has; a failing field carries the rules that reject it.
  const failing = useMemo(() => {
    const map = new Map<string, WorkIssue[]>();
    for (const i of issues) {
      if (!i.field) continue;
      for (const k of new Set([i.field, sapField(i.field), i.field.split(".").pop() ?? i.field])) map.set(k, [...(map.get(k) ?? []), i]);
    }
    return map;
  }, [issues]);

  const run = async (fn: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      toast({ text: done, tone: "good" });
      await refreshV2(qc);
      return true;
    } catch (err) {
      toast({ text: errorSentence(err, t("The change could not be saved.")), tone: "bad" });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const decide: Decide = (list, action, extra = {}) =>
    run(() => postDecide(list.map((i) => ({ module, record_key: key, check_id: i.check_id, action, ...extra })), detail?.version_id), t("Saved"));

  if (detailQ.isPending) return <Skeleton lines={9} label={t("Reading the record")} />;
  if (detailQ.isError || !detail) {
    const e = detailQ.error as { status?: number; response?: { status?: number } } | null;
    if (e?.response?.status === 404 || e?.status === 404) {
      return (
        <div data-testid="record-not-found">
          <EmptyState heading={t("Record not found")}>{t("No failing record with the key {key} is in the latest run. Check the key; a record fixed since the list was read also leaves it.", { key })}</EmptyState>
        </div>
      );
    }
    return <ErrorState fallback={t("The record could not be read.")} error={detailQ.error} onRetry={() => void detailQ.refetch()} />;
  }

  const parts = splitKey(key);
  const plant = parts.find((p) => p.field === "WERKS")?.value ?? detail.values["MARC.WERKS"] ?? null;
  const fixable = issues.filter((i) => i.status === "to_fix");
  const suggested = fixable.filter((i) => i.suggestion?.value);
  const batch = issues.map((i) => i.decision).find((d) => d && d.batch_status === "draft");

  return (
    <div data-testid="record-evidence">
      <p data-testid="record-status">
        <Chip>{STATUS_LABEL[detail.status] ?? detail.status}</Chip>{" "}
        {detail.name ? <span>{detail.name}</span> : null}
        {plant ? <span className="nx-muted">{" "}{t("plant {plant}", { plant })}</span> : null}
      </p>
      <div className="nx-rn-sub">
        <Button variant="secondary" size={32} onClick={() => open({ kind: "record-detail", id: recordDetailId(detail.version_id, module, key) })}>{t("Every field of this record")}</Button>
        <V2Link className="nx-btn nx-btn-secondary" href={`${objectHref(landscape, module)}/records/${encodeURIComponent(key)}`}>{t("Open full record")}</V2Link>
      </div>

      <h3 className="nx-rn-h3">{t("Facts")}</h3>
      <dl className="nx-paired-row" data-testid="record-facts">
        {Object.entries(detail.values).map(([field, value]) => {
          const hits = [...new Map((failing.get(field) ?? []).map((h) => [h.check_id, h])).values()];
          return (
            <Fact key={field} label={<Code code={sapField(field)} text={describeField(field, detail.field_descriptions) ?? undefined} />}>
              {value === null || value === "" ? <span className="nx-muted">{t("blank")}</span> : <span className="nx-mono">{String(value)}</span>}
              {hits.map((h) => (
                <span key={h.check_id}>{" "}<SevChip severity={h.severity} /> <V2Link className="nx-link" href={hrefFor({ kind: "rule", id: h.check_id })}><Code code={h.check_id} text={h.message} /></V2Link></span>
              ))}
            </Fact>
          );
        })}
        {links?.variants && links.variants.items.length ? (
          <Fact label={t("Also fails on…")} testId="also-fails">
            {links.variants.items.map((v, n) => (
              <span key={v.record_key}>
                {n > 0 ? ", " : ""}
                {v.failing.map((f) => f.check_id).join(", ")}{" "}{t("on")}{" "}
                {Object.entries(v.differs_in).map(([f, val]) => `${f === "WERKS" ? t("plant") : f.toLowerCase()} ${val ?? t("none")}`).join(", ")}
              </span>
            ))}
          </Fact>
        ) : null}
      </dl>

      <h3 className="nx-rn-h3">{t("{issuesCount, plural, one {Fix} other {Fix by rule}}", { issuesCount: issues.length })}</h3>
      {issues.length === 0 ? <p className="nx-muted">{t("No rule fails on this record in this run.")}</p> : issues.map((i) => (
        <FixBlock key={`${i.check_id}|${i.status}|${i.decision?.value ?? ""}`} issue={i} detail={detail} canFix={can.apply} canSign={can.approve} decide={decide} onReason={setReason} />
      ))}

      <h3 className="nx-rn-h3">{t("Actions")}</h3>
      {can.mode === "viewer" ? (
        <p className="nx-muted" data-testid="read-only">{t("Read-only for your role. Ask a steward or an administrator for access to fix records.")}</p>
      ) : can.mode === "owner" ? (
        <>
          <div className="nx-rn-sub">
            <Button variant="primary" size={32} disabled={!batch} loading={busy} onClick={() => batch && void run(() => postApproveBatch(batch.batch_id), t("Approved {batch_name}", { batch_name: batch.batch_name }))}>{t("Approve")}</Button>
            <Button variant="secondary" size={32} disabled={!batch || busy} onClick={() => setReason({ kind: "send_back" })}>{t("Send back")}</Button>
          </div>
          <p className="nx-rn-note">
            {batch ? t("Approving acts on the whole batch {batch_name}, not only this record. The person who built it cannot approve it.", { batch_name: batch.batch_name }) : t("Only a record whose value waits in a draft fix batch can be approved. This record is: {STATUS_LABEL}.", { STATUS_LABEL: (STATUS_LABEL[detail.status] ?? detail.status).toLowerCase() })}
          </p>
        </>
      ) : (
        <div className="nx-rn-sub">
          {can.apply ? <Button variant="primary" size={32} loading={busy} disabled={suggested.length === 0} reason={suggested.length === 0 ? t("No suggested value for this record") : undefined} onClick={() => void decide(suggested, "accept")}>{t("Accept suggested")}</Button> : null}
          {can.approve ? (
            <>
              <Button variant="secondary" size={32} disabled={fixable.length === 0} onClick={() => setReason({ kind: "not_an_issue", issues: fixable })}>{t("Not an issue")}</Button>
              <Button variant="secondary" size={32} disabled={fixable.length === 0} onClick={() => setReason({ kind: "accept_risk", issues: fixable })}>{t("Accept risk")}</Button>
            </>
          ) : null}
          {can.assign && issues.length ? (
            <>
              <Button variant="quiet" size={32} disabled={busy} onClick={() => void decide(issues.slice(0, 1), "assign", { assignee: "me" })}>{t("Assign to me")}</Button>
              <Button variant="quiet" size={32} disabled={busy} onClick={() => void decide(issues.slice(0, 1), "assign", { assignee: "" })}>{t("Unassign")}</Button>
            </>
          ) : null}
        </div>
      )}

      {reason && reason.kind !== "send_back" ? (
        <ReasonForm
          title={reason.kind === "not_an_issue" ? t("Mark as not an issue") : t("Accept the risk")}
          label={t("Reason")}
          confirm={reason.kind === "not_an_issue" ? t("Mark as not an issue") : t("Accept the risk")}
          onCancel={() => setReason(null)}
          onConfirm={(note) => { const r = reason; setReason(null); void decide(r.issues, r.kind, { note }); }}
        />
      ) : null}
      {reason && reason.kind === "send_back" && batch ? (
        <ReasonForm
          title={t("Send the batch back")}
          label={t("What the author has to change")}
          confirm={t("Send back")}
          onCancel={() => setReason(null)}
          onConfirm={(note) => { setReason(null); void run(() => postSendBack(batch.batch_id, note), t("Sent back {batch_name}", { batch_name: batch.batch_name })); }}
        />
      ) : null}

      {links?.features.length ? (
        <>
          <h3 className="nx-rn-h3">{t("Feature impact")}</h3>
          <ul className="nx-rn-sub" data-testid="feature-impact">
            {links.features.map((f) => (
              <li key={f.feature}>
                <V2Link className="nx-link" href={hrefFor({ kind: "feature", id: f.feature })}>{f.feature}</V2Link>{" "}
                <Chip tone={f.status === "blocked" ? "bad" : "warn"}>{f.status === "blocked" ? t("Blocked") : t("Degraded")}</Chip>{" "}
                <span className="nx-muted">{f.because.join(", ")}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="nx-rn-h3">{t("Provenance")}</h3>
      {links ? (
        <dl className="nx-paired-row" data-testid="provenance">
          <Fact label={t("Tables")}>{links.provenance.source_tables.length ? links.provenance.source_tables.map((s) => <Code key={s.table} code={s.table} text={describeField(s.table) ?? undefined} />) : <Dash />}</Fact>
          <Fact label={t("Extraction run")}><span className="nx-mono">{links.provenance.run_id.slice(0, 8)}</span>{links.provenance.run_at ? `, ${formatDate(links.provenance.run_at, "datetime")}` : ""}</Fact>
          <Fact label={t("Extracted at")}>{links.provenance.extracted_at ? formatDate(links.provenance.extracted_at, "datetime") : <Dash />}</Fact>
          <Fact label={t("Record hash")}>{links.provenance.record_hash ? <span className="nx-mono">{links.provenance.record_hash}</span> : <Dash why={t("No hash is stored for this record")} />}</Fact>
        </dl>
      ) : linksQ.isError ? (
        <ErrorState fallback={t("The links of this record could not be read.")} error={linksQ.error} onRetry={() => void linksQ.refetch()} />
      ) : <Skeleton lines={3} label={t("Reading the record")} />}

      <h3 className="nx-rn-h3">{t("History")}</h3>
      {links && links.history.length ? (
        <ul className="nx-rn-sub" data-testid="record-history">
          {links.history.map((h, n) => (
            <li key={`${h.at}-${n}`}><span className="nx-muted">{h.at ? formatDate(h.at, "date") : ""}</span> <span>{historyLine(h)}</span></li>
          ))}
        </ul>
      ) : <p className="nx-muted">{links ? t("No changes have been made to this record yet.") : ""}</p>}
    </div>
  );
}
