"use client";

import { Money } from "../Money";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WorkIssue, WorkRecordDetail } from "@/lib/api/work";
import { formatDate } from "@/lib/format";
import { errorSentence, postApproveBatch, postSendBack, type RecordLinks } from "@/lib/api/v2/work";
import { useOpenItem } from "@/lib/v2/hooks";
import { ledgerRegistry } from "@/lib/v2/keys";
import { refreshV2 } from "@/lib/v2/queries";
import { describeField, sapField } from "@/lib/v2/sap-fields";
import { int } from "@/lib/v2/score";
import { STATUS_LABEL, splitKey } from "@/lib/v2/work";
import { useWorkActions, useWorkCan, type RowRef } from "@/lib/v2/work-actions";
import { clearPatches, patched, usePatches } from "@/lib/v2/work-overrides";
import { useRecordLinks, useWorkRecord } from "@/lib/v2/work-queries";
import { InspectorFrame } from "../Inspector";
import { MenuButton } from "../Menu";
import { SeverityMark, type SeverityKey } from "../marks";
import { Value, Dash, Dot, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { useToast } from "../Toast";
import { PromptDialog } from "./work-parts";
import { CollabSections } from "../inspector/collab";
import { FixOrderHint } from "./object/Related";
import { t as tr, tn } from "@/lib/v2/i18n";
import { RecordHistoryPanel } from "./step10/RecordHistory";

export function parseRecordId(id: string): { module: string; key: string } {
  const at = id.indexOf(":");
  return at > 0 ? { module: id.slice(0, at), key: id.slice(at + 1) } : { module: "", key: id };
}

const sev = (s: string | null | undefined): SeverityKey => (s === "critical" || s === "high" || s === "medium" || s === "low" ? s : "low");
const SHOWN_ALLOWED = 5;

/** What the history rows say, in the words of the trade. */
function historyLine(h: RecordLinks["history"][number]): string {
  if (h.action === "assign") return h.to_value ? tr("Assigned to {to_value}{value}", { to_value: h.to_value, value: h.user ? tr(" by {user}", { user: h.user }) : "" }) : (h.user ? tr("Unassigned by {user}", { user: h.user }) : tr("Unassigned"));
  if (h.action === "comment") return tr("{user} wrote: {note}", { user: h.user ?? tr("Someone"), note: h.note ?? "" });
  if (h.action === "status") return `${h.check_id ? `${h.check_id}: ` : ""}${h.to_value ?? tr("Status changed")}${h.user ? `, ${h.user}` : ""}${h.note ? `. ${h.note}` : ""}`;
  return `${h.action}${h.to_value ? `: ${h.to_value}` : ""}${h.user ? `, ${h.user}` : ""}`;
}

/** One failing rule and its fix: what the rule found, the values it accepts, what is suggested, and where to type. */
function FixBlock({ issue, detail, row, canFix, canSign, onReason, actions }: { issue: WorkIssue; detail: WorkRecordDetail; row: RowRef; canFix: boolean; canSign: boolean; onReason: (kind: "not_an_issue" | "accept_risk", issue: WorkIssue) => void; actions: ReturnType<typeof useWorkActions> }) {
  const { hrefFor } = useOpenItem();
  const serverValue = issue.decision?.value ?? "";
  const [value, setValue] = useState(serverValue);
  const [showAll, setShowAll] = useState(false);
  const [local, setLocal] = useState<{ status?: string; value?: string } | null>(null);
  const status = local?.status ?? issue.status;
  const allowed = issue.allowed_values ?? [];
  const list = showAll ? allowed : allowed.slice(0, SHOWN_ALLOWED);
  const decision = status === "not_an_issue" ? (issue.resolution === "accepted_risk" ? tr("accept risk") : tr("not an issue")) : status === "to_fix" ? "" : "fix";
  const hasSuggestion = Boolean(issue.suggestion?.value);
  const run = async (kind: "accept" | "edit", v?: string) => {
    setLocal({ status: "proposed", value: v ?? issue.suggestion?.value });
    const ok = await actions.decide([row], kind, { value: v });
    if (!ok) setLocal(null);
  };
  const fieldName = issue.field ? sapField(issue.field) : null;
  return (
    <section className="m2-fixbox" aria-label={tr("Fix for {check_id}", { check_id: issue.check_id })} data-testid="fix-block">
      <div className="m2-fixrow">
        <span>{tr("Rule")}</span>
        <span>
          <V2Link href={hrefFor({ kind: "rule", id: issue.check_id })} className="m2-mono">
            {issue.check_id}
          </V2Link>{" "}
          <span className="m2-v">
            <SeverityMark severity={sev(issue.severity)} />
            {issue.message}
          </span>
        </span>
      </div>
      <div className="m2-fixrow">
        <span>{tr("Field")}</span>
        <span>{fieldName ? <>{describeField(issue.field ?? "") ?? ""} <Mono>{fieldName}</Mono></> : <Dash />}</span>
      </div>
      {issue.failing != null ? (
        <div className="m2-fixrow">
          <span>{tr("In this run")}</span>
          <span>{tr("{failing} {failing2, plural, one {record fails} other {records fail}}{value}", { failing: int(issue.failing), failing2: issue.failing, value: issue.population ? tr(" of {population} checked", { population: int(issue.population) }) : "" })}</span>
        </div>
      ) : null}
      <div className="m2-fixrow">
        <span>{tr("Current value")}</span>
        <span>{issue.current_value ? <Mono>{issue.current_value}</Mono> : <span className="m2-meta">{tr("blank")}</span>}</span>
      </div>
      <div className="m2-fixrow">
        <span>{tr("Possible values")}</span>
        <span>
          {allowed.length === 0 ? (
            <span className="m2-meta">{tr("The rule does not list values")}</span>
          ) : (
            <>
              <ul className="m2-pvlist">
                {list.map((a) => (
                  <li key={a.value}>
                    <Mono>{a.value}</Mono>
                    {a.label ? <span className="m2-meta">{` ${a.label}`}</span> : null}
                  </li>
                ))}
              </ul>
              {allowed.length > SHOWN_ALLOWED ? (
                <button type="button" className="m2-linkbtn" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? tr("Show fewer") : tr("Show all {allowedCount}", { allowedCount: allowed.length })}
                </button>
              ) : null}
            </>
          )}
        </span>
      </div>
      <div className="m2-fixrow">
        <span>{tr("Suggested value")}</span>
        <span>
          {issue.suggestion?.value ? (
            <>
              <Mono>{issue.suggestion.value}</Mono>
              {issue.suggestion.why ? <span className="m2-meta">{` ${issue.suggestion.why}`}</span> : null}
            </>
          ) : (
            <span className="m2-meta">{tr("none for this row")}</span>
          )}
        </span>
      </div>
      <div className="m2-fixrow">
        <span>{tr("New value")}</span>
        {canFix ? (
          <input
            type="text"
            className="m2-inp m2-mono"
            aria-label={tr("New value for {check_id}", { check_id: issue.check_id })}
            placeholder={tr("Type a value")}
            value={local?.value ?? value}
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) {
                e.preventDefault();
                void run("edit", value.trim());
              }
            }}
          />
        ) : (
          <span>{serverValue ? <Mono>{serverValue}</Mono> : <Dash why={tr("Read-only for your role")} />}</span>
        )}
      </div>
      <div className="m2-fixrow">
        <span>{tr("Decision")}</span>
        {canFix || canSign ? (
          <select
            className="m2-sel"
            aria-label={tr("Decision for {check_id}", { check_id: issue.check_id })}
            value={decision}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "fix") {
                if (value.trim() && value.trim() !== serverValue) void run("edit", value.trim());
                else if (hasSuggestion) void run("accept");
                else void actions.decide([{ ...row, suggested_value: null }], "accept");
              } else if (v === "not an issue") onReason("not_an_issue", issue);
              else if (v === "accept risk") onReason("accept_risk", issue);
            }}
          >
            {decision === "" ? <option value="">{tr("Decide")}</option> : null}
            <option value="fix" disabled={!canFix}>{tr("fix")}</option>
            <option value="not an issue" disabled={!canSign}>{tr("not an issue")}</option>
            <option value="accept risk" disabled={!canSign}>{tr("accept risk")}</option>
          </select>
        ) : (
          <span>{decision || "—"}</span>
        )}
      </div>
      <div className="m2-fixrow">
        <span>{tr("Status")}</span>
        <span>{STATUS_LABEL[status] ?? status}</span>
      </div>
      {detail.assignee_email ? (
        <div className="m2-fixrow">
          <span>{tr("Assigned to")}</span>
          <span>{detail.assignee_email}</span>
        </div>
      ) : null}
    </section>
  );
}

function Loading() {
  return (
    <div aria-busy="true" data-testid="record-loading">
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} style={{ height: 28, display: "flex", alignItems: "center" }}>
          <Skeleton width={`${40 + ((i * 17) % 40)}%`} height={12} />
        </div>
      ))}
    </div>
  );
}

/**
 * A record in the inspector: its title (the key, in mono), a status line, every field the record has with the
 * rules that reject it, one fix block per failing rule, the links (also fails on, feature impact, provenance,
 * history) and the actions this person's role allows. `[` and `]` step through the ledger.
 */
export function RecordInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const { module, key } = parseRecordId(id);
  const detailQ = useWorkRecord(module, key);
  const detail = detailQ.data;
  const linksQ = useRecordLinks(module, key, detail?.version_id ?? null);
  const links = linksQ.data;
  const patches = usePatches();
  const qc = useQueryClient();
  const toast = useToast();
  const actions = useWorkActions();
  const can = useWorkCan();
  const { hrefFor } = useOpenItem();
  const [reason, setReason] = useState<{ kind: "not_an_issue" | "accept_risk"; issues: WorkIssue[] } | { kind: "send_back" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pane, setPane] = useState<"record" | "history">("record");
  const firstInput = useRef<HTMLDivElement>(null);

  const parts = splitKey(key);
  const title = parts[0]?.value ?? key;
  const plant = parts.find((p) => p.field === "WERKS")?.value ?? detail?.values["MARC.WERKS"] ?? null;
  const live = detail ? patched({ module, record_key: key, status: detail.status } as { module: string; record_key: string; status: WorkRecordDetail["status"] }, patches).status : null;
  const atRisk = detail ? detail.issues.reduce((n, i) => n + (i.rule?.cost_per_record ?? 0), 0) : 0;
  const statusParts = detail ? [STATUS_LABEL[live ?? detail.status] ?? detail.status, detail.name, plant ? tr("plant {plant}", { plant }) : null, atRisk > 0 ? <>{tn("{money} at risk", { money: <Money amount={atRisk} currency={detail.currency} compact={false} /> })}</> : null].filter(Boolean) : [];
  const status: ReactNode = detail ? statusParts.map((part, n) => (n === 0 ? <span key={n}>{part}</span> : <span key={n}><Dot />{part}</span>)) : tr("Reading the record");

  const rowFor = (i: WorkIssue): RowRef => ({ module, record_key: key, version_id: detail?.version_id, checks: [i.check_id], suggested_value: i.suggestion?.value ?? null, status: i.status });
  const issues = useMemo(() => detail?.issues ?? [], [detail]);
  const fixable = issues.filter((i) => i.status === "to_fix");
  const suggested = fixable.filter((i) => i.suggestion?.value);

  // Facts: every field the record has; a failing field carries the id of the rule that rejects it.
  const failing = useMemo(() => {
    const map = new Map<string, WorkIssue[]>();
    for (const i of issues) {
      if (!i.field) continue;
      for (const k of [i.field, sapField(i.field), i.field.split(".").pop() ?? i.field]) map.set(k, [...(map.get(k) ?? []), i]);
    }
    return map;
  }, [issues]);

  const batch = issues.map((i) => i.decision).find((d) => d && d.batch_status === "draft");
  const act = async (fn: () => Promise<{ action_id?: string | null }>, label: string) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.done({ ids: res.action_id ? [res.action_id] : [], label });
      await refreshV2(qc);
      clearPatches();
    } catch (err) {
      toast.show(errorSentence(err, tr("The change could not be saved.")), "error");
    } finally {
      setBusy(false);
    }
  };

  const body: ReactNode = detailQ.isPending ? (
    <Loading />
  ) : detailQ.isError || !detail ? (
    (detailQ.error as { status?: number; response?: { status?: number } } | null)?.response?.status === 404 || (detailQ.error as { status?: number } | null)?.status === 404 ? (
      <div data-testid="record-not-found">
        <h3>{tr("Record not found")}</h3>
        <EmptyFrame>{tr("No failing record with the key {key} is in the latest run. Check the key; a record fixed since the list was read also leaves it.", { key })}</EmptyFrame>
      </div>
    ) : (
      <ErrorFrame onRetry={() => void detailQ.refetch()}>{tr("The record could not be read.")}</ErrorFrame>
    )
  ) : (
    <>
      <h3>{tr("Facts")}</h3>
      <dl className="m2-facts" data-testid="record-facts">
        {Object.entries(detail.values).map(([field, value]) => {
          const hits = failing.get(field) ?? [];
          const desc = describeField(field);
          return (
            <div className="m2-fact" key={field}>
              <dt>
                {desc ? <>{desc} </> : null}
                <Mono className="m2-fid">{sapField(field)}</Mono>
              </dt>
              <dd>
                {value === null || value === "" ? <span className="m2-meta">{tr("blank")}</span> : <Value value={String(value)} />}
                {hits.length ? (
                  <span className="m2-fail">
                    {[...new Map(hits.map((h) => [h.check_id, h])).values()].map((h) => (
                      <span key={h.check_id} className="m2-v">
                        <SeverityMark severity={sev(h.severity)} />
                        <V2Link href={hrefFor({ kind: "rule", id: h.check_id })} className="m2-mono">
                          {h.check_id}
                        </V2Link>
                      </span>
                    ))}
                  </span>
                ) : null}
              </dd>
            </div>
          );
        })}
        {links?.variants && links.variants.items.length ? (
          <div className="m2-fact" data-testid="also-fails">
            <dt>{tr("Also fails on…")}</dt>
            <dd>
              {links.variants.items.map((v, n) => (
                <span key={v.record_key}>
                  {n > 0 ? ", " : ""}
                  {v.failing.map((f) => f.check_id).join(", ")}{" "}{tr("on")}{" "}
                  {Object.entries(v.differs_in)
                    .map(([f, val]) => `${f === "WERKS" ? tr("plant") : f.toLowerCase()} ${val ?? tr("none")}`)
                    .join(", ")}
                </span>
              ))}
            </dd>
          </div>
        ) : null}
        {links?.features.length ? (
          <div className="m2-fact m2-stack" data-testid="feature-impact">
            <dt>{tr("Feature impact")}</dt>
            <dd>
              {links.features.map((f) => (
                <span key={f.feature} className="m2-feat">
                  <V2Link href={hrefFor({ kind: "feature", id: f.feature })}>{f.feature}</V2Link>
                  <span className="m2-meta">{tr("{status} by {because}", { status: f.status, because: f.because.join(", ") })}</span>
                </span>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>

      <h3>{tr("{issuesCount, plural, one {Fix} other {Fix by rule}}", { issuesCount: issues.length })}</h3>
      <div ref={firstInput} className="m2-fixes">
        {issues.map((i) => (
          <FixBlock key={`${i.check_id}|${i.status}|${i.decision?.value ?? ""}`} issue={i} detail={detail} row={rowFor(i)} canFix={can.apply} canSign={can.approve} actions={actions} onReason={(kind, issue) => setReason({ kind, issues: [issue] })} />
        ))}
      </div>

      <h3>{tr("Actions")}</h3>
      {can.mode === "viewer" ? (
        <p className="m2-meta" data-testid="read-only">
          {tr("Read-only for your role. Ask a steward or an administrator for access to fix records.")}
        </p>
      ) : can.mode === "owner" ? (
        <>
          <div className="m2-acts">
            <button type="button" className="m2-btn m2-strong" disabled={!batch || busy} onClick={() => batch && void act(() => postApproveBatch(batch.batch_id), tr("Approved {batch_name}", { batch_name: batch.batch_name }))}>
              {tr("Approve")}
            </button>
            <button type="button" className="m2-btn" disabled={!batch || busy} onClick={() => setReason({ kind: "send_back" })}>
              {tr("Send back")}
            </button>
          </div>
          <p className="m2-meta m2-note">
            {batch ? tr("Approving acts on the whole batch {batch_name}, not only this record. The person who built it cannot approve it.", { batch_name: batch.batch_name }) : tr("Only a record whose value waits in a draft fix batch can be approved. This record is: {STATUS_LABEL}.", { STATUS_LABEL: (STATUS_LABEL[detail.status] ?? detail.status).toLowerCase() })}
          </p>
        </>
      ) : (
        <div className="m2-acts">
          {can.apply ? (
            <button type="button" className="m2-btn m2-strong" disabled={suggested.length === 0 || busy} title={suggested.length === 0 ? tr("No suggested value for this record") : undefined} onClick={() => void actions.decide(suggested.map(rowFor), "accept")}>
              {tr("Accept suggested")}{" "}<kbd className="m2-kb">a</kbd>
            </button>
          ) : null}
          {can.apply ? (
            <button type="button" className="m2-btn" disabled={fixable.length === 0} onClick={() => firstInput.current?.querySelector<HTMLInputElement>("input")?.focus()}>
              {tr("Propose value")}
            </button>
          ) : null}
          {can.approve ? (
            <>
              <button type="button" className="m2-btn" disabled={fixable.length === 0} onClick={() => setReason({ kind: "not_an_issue", issues: fixable })}>
                {tr("Not an issue")}{" "}<kbd className="m2-kb">n</kbd>
              </button>
              <button type="button" className="m2-btn" disabled={fixable.length === 0} onClick={() => setReason({ kind: "accept_risk", issues: fixable })}>
                {tr("Accept risk")}{" "}<kbd className="m2-kb">r</kbd>
              </button>
            </>
          ) : null}
          {can.assign ? (
            <MenuButton
              label={tr("Assign")}
              buttonLabel={tr("Assign")}
              className="m2-btn"
              entries={[
                { kind: "item", id: "me", label: tr("Assign to me"), onSelect: () => void actions.decide(issues.map(rowFor).slice(0, 1), "assign", { assignee: "me" }) },
                { kind: "item", id: "none", label: tr("Unassign"), onSelect: () => void actions.decide(issues.map(rowFor).slice(0, 1), "assign", { assignee: "" }) },
              ]}
            >
              {tr("Assign")}
            </MenuButton>
          ) : null}
        </div>
      )}
      <div className="m2-acts m2-step">
        <button type="button" className="m2-btn m2-sm m2-ghost" onClick={() => ledgerRegistry.get()?.step(-1)}>
          {tr("Previous row")}{" "}<kbd className="m2-kb">[</kbd>
        </button>
        <button type="button" className="m2-btn m2-sm m2-ghost" onClick={() => ledgerRegistry.get()?.step(1)}>
          {tr("Next row")}{" "}<kbd className="m2-kb">]</kbd>
        </button>
      </div>

      <h3>{tr("Provenance")}</h3>
      {links ? (
        <dl className="m2-facts" data-testid="provenance">
          <div className="m2-fact">
            <dt>{tr("Tables")}</dt>
            <dd>{links.provenance.source_tables.length ? links.provenance.source_tables.map((t) => t.table).join(", ") : <Dash />}</dd>
          </div>
          <div className="m2-fact">
            <dt>{tr("Extraction run")}</dt>
            <dd>
              <Mono>{links.provenance.run_id.slice(0, 8)}</Mono>
              {links.provenance.run_at ? `, ${formatDate(links.provenance.run_at, "datetime")}` : ""}
            </dd>
          </div>
          <div className="m2-fact">
            <dt>{tr("Extracted at")}</dt>
            <dd>{links.provenance.extracted_at ? formatDate(links.provenance.extracted_at, "datetime") : <Dash />}</dd>
          </div>
          <div className="m2-fact">
            <dt>{tr("Record hash")}</dt>
            <dd>{links.provenance.record_hash ? <Mono>{links.provenance.record_hash}</Mono> : <Dash why={tr("No hash is stored for this record")} />}</dd>
          </div>
        </dl>
      ) : linksQ.isError ? (
        <p className="m2-meta">{tr("The links of this record could not be read.")}</p>
      ) : (
        <Skeleton width="60%" height={12} />
      )}

      <h3>{tr("History")}</h3>
      {links && links.history.length ? (
        <ul className="m2-hist" data-testid="record-history">
          {links.history.map((h, n) => (
            <li key={`${h.at}-${n}`}>
              <span className="m2-meta">{h.at ? formatDate(h.at, "date") : ""}</span>
              <span>{historyLine(h)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m2-meta">{links ? tr("No changes have been made to this record yet.") : ""}</p>
      )}
      <FixOrderHint module={module} />
      <CollabSections kind="record" id={id} label={tr("this record")} />
    </>
  );

  return (
    <>
      <InspectorFrame title={<Mono>{title}</Mono>} status={status} onClose={onClose}>
        <div className="m2-hist-tabs" role="tablist" aria-label={tr("Views of this record")}>
          <button type="button" role="tab" id="rec-tab-record" aria-controls="rec-panel" aria-selected={pane === "record"} tabIndex={pane === "record" ? 0 : -1} onClick={() => setPane("record")} onKeyDown={(e) => e.key === "ArrowRight" && (setPane("history"), document.getElementById("rec-tab-history")?.focus())}>
            {tr("Record")}
          </button>
          <button type="button" role="tab" id="rec-tab-history" aria-controls="rec-panel" aria-selected={pane === "history"} tabIndex={pane === "history" ? 0 : -1} onClick={() => setPane("history")} onKeyDown={(e) => e.key === "ArrowLeft" && (setPane("record"), document.getElementById("rec-tab-record")?.focus())}>
            {tr("History")}
          </button>
        </div>
        <div id="rec-panel" role="tabpanel" aria-labelledby={pane === "record" ? "rec-tab-record" : "rec-tab-history"}>
          {pane === "history" ? <RecordHistoryPanel module={module} recordKey={key} /> : body}
        </div>
      </InspectorFrame>
      {reason && reason.kind !== "send_back" ? (
        <PromptDialog
          title={reason.kind === "not_an_issue" ? tr("Mark as not an issue") : tr("Accept the risk")}
          label={tr("Reason")}
          confirm={reason.kind === "not_an_issue" ? tr("Mark as not an issue") : tr("Accept the risk")}
          multiline
          onCancel={() => setReason(null)}
          onConfirm={(note) => {
            const r = reason;
            setReason(null);
            void actions.decide(r.issues.map(rowFor), r.kind, { note });
          }}
        />
      ) : null}
      {reason && reason.kind === "send_back" ? (
        <PromptDialog
          title={tr("Send the batch back")}
          label={tr("What the author has to change")}
          confirm={tr("Send back")}
          multiline
          onCancel={() => setReason(null)}
          onConfirm={(note) => {
            setReason(null);
            if (batch) void act(() => postSendBack(batch.batch_id, note), tr("Sent back {batch_name}", { batch_name: batch.batch_name }));
          }}
        />
      ) : null}
    </>
  );
}

