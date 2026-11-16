"use client";

import "./record.css";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WorkIssue, WorkRecordDetail } from "@/lib/api/work";
import { formatDate } from "@/lib/format";
import { errorSentence, postApproveBatch, postSendBack, type RecordLinks } from "@/lib/api/v2/work";
import { useOpenItem, useRunParam } from "@/lib/v2/hooks";
import { t, tn } from "@/lib/v2/i18n";
import { ledgerRegistry } from "@/lib/v2/keys";
import { refreshV2, useLandscape, useStatus } from "@/lib/v2/queries";
import { objectHref } from "@/lib/v2/people";
import { notFound, useRelated } from "@/lib/v2/roles-queries";
import { describeField, sapField } from "@/lib/v2/sap-fields";
import { int } from "@/lib/v2/score";
import { STATUS_LABEL, splitKey } from "@/lib/v2/work";
import { useWorkActions, useWorkCan, type RowRef } from "@/lib/v2/work-actions";
import { clearPatches, patched, usePatches } from "@/lib/v2/work-overrides";
import { useRecordLinks, useWorkRecord } from "@/lib/v2/work-queries";
import { Mono, V2Link } from "@/design/v2/parts";
import { SeverityMark } from "@/design/v2/marks";
import { Button, Confirm, EmptyState, ErrorState, Popover, Skeleton, Tabs, useToast } from "../../kit";
import { InspectorFrame, type BodyProps } from "./frame";
import { CollabSections, Dash, useDone } from "./panels-kit";
import { FixBlock, sev } from "./record-fix";
import { RecordHistoryPanel } from "./record-history";

export function parseRecordId(id: string): { module: string; key: string } {
  const at = id.indexOf(":");
  return at > 0 ? { module: id.slice(0, at), key: id.slice(at + 1) } : { module: "", key: id };
}

/** What the history rows say, in the words of the trade. */
export function historyLine(h: RecordLinks["history"][number]): string {
  if (h.action === "assign") return h.to_value ? t("Assigned to {to_value}{value}", { to_value: h.to_value, value: h.user ? t(" by {user}", { user: h.user }) : "" }) : h.user ? t("Unassigned by {user}", { user: h.user }) : t("Unassigned");
  if (h.action === "comment") return t("{user} wrote: {note}", { user: h.user ?? t("Someone"), note: h.note ?? "" });
  if (h.action === "status") return `${h.check_id ? `${h.check_id}: ` : ""}${h.to_value ?? t("Status changed")}${h.user ? `, ${h.user}` : ""}${h.note ? `. ${h.note}` : ""}`;
  return `${h.action}${h.to_value ? `: ${h.to_value}` : ""}${h.user ? `, ${h.user}` : ""}`;
}

/** An amount priced by the tenant's cost model, always marked as an estimate. */
function MoneyText({ amount, currency }: { amount: number; currency?: string | null }) {
  const s = useStatus().data;
  const isDefault = s?.cost_model_source === "default";
  const unit = currency ?? s?.cost_model ?? null;
  return (
    <span title={isDefault ? t("Estimate from default assumptions, set your cost model in Administration") : t("Estimated from your cost model")} data-testid="money">
      {`${unit ? `${unit} ` : ""}${int(amount)} `}
      <span className="nx-ib-meta">{isDefault ? t("default estimate") : t("est.")}</span>
    </span>
  );
}

/** Which object has to be fixed first, when the related graph says so. */
function FixOrderHint({ module }: { module: string | null }) {
  const q = useRelated(module);
  if (!module || !q.data?.fix_hint) return q.isError && !notFound(q.error) ? <Dash why={t("The fix order could not be read")} /> : null;
  return (
    <p className="nx-ib-meta" data-testid="fix-hint" role="note">
      {t("{sentence}. Records there fail before this object can pass.", { sentence: q.data.fix_hint.sentence })}
    </p>
  );
}

/** The Assign menu: assign the record to me, or unassign it. */
function AssignMenu({ onPick }: { onPick: (assignee: string) => void }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const pick = (a: string) => {
    setOpen(false);
    onPick(a);
  };
  return (
    <span ref={setAnchor}>
      <Button variant="secondary" aria-label={t("Assign")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t("Assign")}
      </Button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} label={t("Assign")}>
        <div role="menu" aria-label={t("Assign")} className="nx-rc-menu">
          <button type="button" role="menuitem" onClick={() => pick("me")}>
            {t("Assign to me")}
          </button>
          <button type="button" role="menuitem" onClick={() => pick("")}>
            {t("Unassign")}
          </button>
        </div>
      </Popover>
    </span>
  );
}

type Reason = { kind: "not_an_issue" | "accept_risk"; issues: WorkIssue[] } | { kind: "send_back" } | null;

/**
 * `?open=record:<module>:<record_key>`: the key in mono, a status line, every field with the rules that reject it,
 * one fix block per failing rule, the links (also fails on, feature impact, provenance, history) and the actions this
 * person's role allows. `[` and `]` step through the ledger.
 */
export function RecordInspectorNative({ id, onClose }: BodyProps) {
  const { module, key } = parseRecordId(id);
  const detailQ = useWorkRecord(module, key);
  const detail = detailQ.data;
  const linksQ = useRecordLinks(module, key, detail?.version_id ?? null);
  const links = linksQ.data;
  const patches = usePatches();
  const qc = useQueryClient();
  const push = useToast();
  const done = useDone();
  const actions = useWorkActions();
  const can = useWorkCan();
  const { hrefFor } = useOpenItem();
  const landscape = useLandscape(useRunParam()).data;
  const [reason, setReason] = useState<Reason>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [pane, setPane] = useState("record");
  const firstInput = useRef<HTMLDivElement>(null);

  const parts = splitKey(key);
  const title = parts[0]?.value ?? key;
  const plant = parts.find((p) => p.field === "WERKS")?.value ?? detail?.values["MARC.WERKS"] ?? null;
  const live = detail ? patched({ module, record_key: key, status: detail.status } as { module: string; record_key: string; status: WorkRecordDetail["status"] }, patches).status : null;
  const atRisk = detail ? detail.issues.reduce((n, i) => n + (i.rule?.cost_per_record ?? 0), 0) : 0;
  const statusParts: ReactNode[] = detail ? [STATUS_LABEL[live ?? detail.status] ?? detail.status, detail.name, plant ? t("plant {plant}", { plant: String(plant) }) : null, atRisk > 0 ? <>{tn("{money} at risk", { money: <MoneyText amount={atRisk} currency={detail.currency} /> })}</> : null].filter(Boolean) : [];
  const status: ReactNode = detail ? <span className="nx-rc-status">{statusParts.map((part, n) => <span key={n}>{part}</span>)}</span> : t("Reading the record");

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
      done({ ids: res.action_id ? [res.action_id] : [], label });
      await refreshV2(qc);
      clearPatches();
    } catch (err) {
      push({ text: errorSentence(err, t("The change could not be saved.")), tone: "bad" });
    } finally {
      setBusy(false);
    }
  };
  const closeReason = () => {
    setReason(null);
    setNote("");
  };

  const body: ReactNode = detailQ.isPending ? (
    <div aria-busy="true" data-testid="record-loading">
      <Skeleton lines={9} label={t("Reading the record")} />
    </div>
  ) : detailQ.isError || !detail ? (
    detailQ.isError && notFound(detailQ.error) ? (
      <div data-testid="record-not-found">
        <EmptyState heading={t("Record not found")}>{t("No failing record with the key {key} is in the latest run. Check the key; a record fixed since the list was read also leaves it.", { key })}</EmptyState>
      </div>
    ) : (
      <ErrorState sentence={t("The record could not be read.")} onRetry={() => void detailQ.refetch()} />
    )
  ) : (
    <>
      <section className="nx-ib-sec">
        <h3>{t("Facts")}</h3>
        <dl className="nx-ib-facts" data-testid="record-facts">
          {Object.entries(detail.values).map(([field, value]) => {
            const hits = failing.get(field) ?? [];
            const desc = describeField(field, detail.field_descriptions);
            return (
              <div className="nx-ib-fact" key={field}>
                <dt>
                  {desc ? <>{desc} </> : null}
                  <Mono>{sapField(field)}</Mono>
                </dt>
                <dd className="nx-rc-line">
                  {value === null || value === "" ? <span className="nx-ib-meta">{t("blank")}</span> : /\s/.test(String(value).trim()) || String(value).length > 40 ? <span>{String(value)}</span> : <Mono>{String(value)}</Mono>}
                  {[...new Map(hits.map((h) => [h.check_id, h])).values()].map((h) => (
                    <span key={h.check_id} className="nx-rc-line">
                      <SeverityMark severity={sev(h.severity)} />
                      <V2Link href={hrefFor({ kind: "rule", id: h.check_id })}>
                        <Mono>{h.check_id}</Mono>
                      </V2Link>
                    </span>
                  ))}
                </dd>
              </div>
            );
          })}
          {links?.variants && links.variants.items.length ? (
            <div className="nx-ib-fact" data-testid="also-fails">
              <dt>{t("Also fails on…")}</dt>
              <dd>
                {links.variants.items.map((v, n) => (
                  <span key={v.record_key}>
                    {n > 0 ? ", " : ""}
                    {v.failing.map((f) => f.check_id).join(", ")} {t("on")}{" "}
                    {Object.entries(v.differs_in)
                      .map(([f, val]) => `${f === "WERKS" ? t("plant") : f.toLowerCase()} ${val ?? t("none")}`)
                      .join(", ")}
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
          {links?.features.length ? (
            <div className="nx-ib-fact" data-testid="feature-impact">
              <dt>{t("Feature impact")}</dt>
              <dd>
                <ul className="nx-ib-list">
                  {links.features.map((f) => (
                    <li key={f.feature} className="nx-rc-line">
                      <V2Link href={hrefFor({ kind: "feature", id: f.feature })}>{f.feature}</V2Link>
                      <span className="nx-ib-meta">{t("{status} by {because}", { status: f.status, because: f.because.join(", ") })}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="nx-ib-sec">
        <h3>{t("{issuesCount, plural, one {Fix} other {Fix by rule}}", { issuesCount: issues.length })}</h3>
        <div ref={firstInput} className="nx-rc-fixes">
          {issues.map((i) => (
            <FixBlock key={`${id}|${i.check_id}|${i.status}|${i.decision?.value ?? ""}`} issue={i} detail={detail} row={rowFor(i)} canFix={can.apply} canSign={can.approve} actions={actions} onReason={(kind, issue) => setReason({ kind, issues: [issue] })} />
          ))}
        </div>
      </section>

      <section className="nx-ib-sec">
        <h3>{t("Actions")}</h3>
        {can.mode === "viewer" ? (
          <p className="nx-ib-meta" data-testid="read-only">
            {t("Read-only for your role. Ask a steward or an administrator for access to fix records.")}
          </p>
        ) : can.mode === "owner" ? (
          <>
            <div className="nx-ib-acts">
              <Button variant="primary" disabled={!batch || busy} loading={busy} onClick={() => batch && void act(() => postApproveBatch(batch.batch_id), t("Approved {batch_name}", { batch_name: batch.batch_name }))}>
                {t("Approve")}
              </Button>
              <Button variant="secondary" disabled={!batch || busy} onClick={() => setReason({ kind: "send_back" })}>
                {t("Send back")}
              </Button>
            </div>
            <p className="nx-ib-meta">
              {batch ? t("Approving acts on the whole batch {batch_name}, not only this record. The person who built it cannot approve it.", { batch_name: batch.batch_name }) : t("Only a record whose value waits in a draft fix batch can be approved. This record is: {STATUS_LABEL}.", { STATUS_LABEL: (STATUS_LABEL[detail.status] ?? detail.status).toLowerCase() })}
            </p>
          </>
        ) : (
          <div className="nx-ib-acts">
            {can.apply ? (
              <Button variant="primary" disabled={suggested.length === 0 || busy} aria-describedby={suggested.length === 0 ? "accept-suggested-why" : undefined} onClick={() => void actions.decide(suggested.map(rowFor), "accept")}>
                {t("Accept suggested")} <kbd>a</kbd>
              </Button>
            ) : null}
            {can.apply && suggested.length === 0 ? (
              <span id="accept-suggested-why" className="nx-ib-meta">
                {t("No suggested value for this record")}
              </span>
            ) : null}
            {can.apply ? (
              <Button variant="secondary" disabled={fixable.length === 0} onClick={() => firstInput.current?.querySelector<HTMLInputElement>("input")?.focus()}>
                {t("Propose value")}
              </Button>
            ) : null}
            {can.approve ? (
              <>
                <Button variant="secondary" disabled={fixable.length === 0} onClick={() => setReason({ kind: "not_an_issue", issues: fixable })}>
                  {t("Not an issue")} <kbd>n</kbd>
                </Button>
                <Button variant="secondary" disabled={fixable.length === 0} onClick={() => setReason({ kind: "accept_risk", issues: fixable })}>
                  {t("Accept risk")} <kbd>r</kbd>
                </Button>
              </>
            ) : null}
            {can.assign ? <AssignMenu onPick={(assignee) => void actions.decide(issues.map(rowFor).slice(0, 1), "assign", { assignee })} /> : null}
          </div>
        )}
        <div className="nx-ib-acts">
          <Button variant="quiet" size={32} onClick={() => ledgerRegistry.get()?.step(-1)}>
            {t("Previous row")} <kbd>[</kbd>
          </Button>
          <Button variant="quiet" size={32} onClick={() => ledgerRegistry.get()?.step(1)}>
            {t("Next row")} <kbd>]</kbd>
          </Button>
        </div>
      </section>

      <section className="nx-ib-sec">
        <h3>{t("Provenance")}</h3>
        {links ? (
          <dl className="nx-ib-facts" data-testid="provenance">
            <div className="nx-ib-fact">
              <dt>{t("Tables")}</dt>
              <dd>{links.provenance.source_tables.length ? links.provenance.source_tables.map((s) => s.table).join(", ") : <span className="nx-ib-meta">—</span>}</dd>
            </div>
            <div className="nx-ib-fact">
              <dt>{t("Extraction run")}</dt>
              <dd>
                <Mono>{links.provenance.run_id.slice(0, 8)}</Mono>
                {links.provenance.run_at ? `, ${formatDate(links.provenance.run_at, "datetime")}` : ""}
              </dd>
            </div>
            <div className="nx-ib-fact">
              <dt>{t("Extracted at")}</dt>
              <dd>{links.provenance.extracted_at ? formatDate(links.provenance.extracted_at, "datetime") : <span className="nx-ib-meta">—</span>}</dd>
            </div>
            <div className="nx-ib-fact">
              <dt>{t("Record hash")}</dt>
              <dd>{links.provenance.record_hash ? <Mono>{links.provenance.record_hash}</Mono> : <Dash why={t("No hash is stored for this record")} />}</dd>
            </div>
          </dl>
        ) : linksQ.isError ? (
          <p className="nx-ib-meta">{t("The links of this record could not be read.")}</p>
        ) : (
          <Skeleton lines={2} />
        )}
      </section>

      <section className="nx-ib-sec">
        <h3>{t("History")}</h3>
        {links && links.history.length ? (
          <ul className="nx-ib-list" data-testid="record-history">
            {links.history.map((h, n) => (
              <li key={`${h.at}-${n}`} className="nx-rc-line">
                <span className="nx-ib-meta">{h.at ? formatDate(h.at, "date") : ""}</span>
                <span>{historyLine(h)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nx-ib-meta">{links ? t("No changes have been made to this record yet.") : ""}</p>
        )}
        <FixOrderHint module={module} />
      </section>
      <CollabSections kind="record" id={id} label={t("this record")} />
    </>
  );

  const signing = reason && reason.kind !== "send_back" ? reason : null;
  const signTitle = signing?.kind === "not_an_issue" ? t("Mark as not an issue") : t("Accept the risk");
  return (
    <>
      <InspectorFrame title={<Mono>{title}</Mono>} status={status} onClose={onClose}>
        <p className="nx-ib-meta">
          <V2Link href={`${objectHref(landscape, module)}/records/${encodeURIComponent(key)}`}>{t("Open full record")}</V2Link>
        </p>
        <Tabs
          items={[
            { id: "record", label: t("Record") },
            { id: "history", label: t("History") },
          ]}
          value={pane}
          onChange={setPane}
          label={t("Views of this record")}
          idBase="rec"
        />
        <div id="rec-panel" role="tabpanel" aria-labelledby={`rec-tab-${pane}`}>
          {pane === "history" ? <RecordHistoryPanel module={module} recordKey={key} /> : body}
        </div>
      </InspectorFrame>
      <Confirm
        open={signing !== null}
        title={signTitle}
        consequence={
          <div className="nx-rc-form">
            <label>
              {t("Reason")}
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
        }
        blocked={note.trim() ? undefined : t("Reason")}
        confirmLabel={signTitle}
        onCancel={closeReason}
        onConfirm={() => {
          const r = signing;
          const text = note.trim();
          closeReason();
          if (r) void actions.decide(r.issues.map(rowFor), r.kind, { note: text });
        }}
      />
      <Confirm
        open={reason?.kind === "send_back"}
        title={t("Send the batch back")}
        consequence={
          <div className="nx-rc-form">
            <label>
              {t("What the author has to change")}
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
        }
        blocked={note.trim() ? undefined : t("What the author has to change")}
        confirmLabel={t("Send back")}
        onCancel={closeReason}
        onConfirm={() => {
          const text = note.trim();
          closeReason();
          if (batch) void act(() => postSendBack(batch.batch_id, text), t("Sent back {batch_name}", { batch_name: batch.batch_name }));
        }}
      />
    </>
  );
}

export const RECORD_BODIES: Record<string, React.ComponentType<BodyProps>> = { record: RecordInspectorNative };
