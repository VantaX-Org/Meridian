"use client";

import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate, labelOf } from "@/lib/format";
import { markNotDuplicate, mergePair, splitGolden, type ReviewPairDetail } from "@/lib/api/v2/mdm";
import { createWritebackRequest, decideWriteback, promoteGolden, submitWritebackRequest, type WritebackRequest } from "@/lib/api/v2/golden-writeback";
import { previewSurvivorship, putSurvivorship, type SurvivorshipPreview } from "@/lib/api/v2/designer";
import type { SurvivorshipRule, SurvivorshipRuleType } from "@/lib/api/survivorship";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { mdmKeys, useGoldenEvents, useGoldenExplain, useGoldenHistory, useGoldenRecord, useMatchPair, useWritebackPreview, useWritebackRequests } from "@/lib/v2/mdm-queries";
import { refreshV2 } from "@/lib/v2/queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { describeField } from "@/lib/v2/sap-fields";
import { int, moduleFromSlug } from "@/lib/v2/score";
import { useRefreshV2, useSurvivorshipRules } from "@/lib/v2/sys-queries";
import { moveBy, needsSources, RULE_TYPES, toInput, typeLabel, validateRules, type DraftRule } from "@/lib/v2/survivorship";
import { COMPARATOR_LABEL, RULE_LABEL, confidencePct, shortKey } from "@/design/next/object/tabs/GoldenTab";
import { Button, Chip, Code, Confirm, EmptyState, ErrorState, Skeleton, type ChipTone } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Dash, Field, Gate, Note, OutcomeLine, Sec, useOutcome } from "./objects-shared";

const fieldCode = (f: string) => <Code code={f} text={describeField(f) ?? undefined} />;

const show = (v: unknown): string => (v == null || v === "" ? "-" : typeof v === "object" ? JSON.stringify(v) : String(v));

const EVENT_WORD: Record<string, () => string> = {
  merge: () => t("Merged"),
  unmerge: () => t("Split"),
  undo: () => t("Undone"),
  remerge: () => t("Merged again"),
  override: () => t("Value chosen"),
  pair_accept: () => t("Pair accepted"),
  pair_reject: () => t("Marked not a duplicate"),
  pair_clear: () => t("Decision cleared"),
};

const SKIP_REASON: Record<string, () => string> = {
  missing_value: () => t("Empty on one side, not counted"),
  semantic_scoring_failed: () => t("Could not be compared, not counted"),
  unknown_comparator: () => t("No comparison for this field, not counted"),
};

const CHANGE_WORD: Record<string, () => string> = {
  promoted: () => t("Promoted to golden"),
  created: () => t("Created"),
  updated: () => t("Updated"),
  merged: () => t("Merged"),
  split: () => t("Split"),
  writeback: () => t("Sent to SAP"),
};

/** The fields whose value differs between two snapshots of the record. */
export function changedFields(prev: Record<string, unknown> | null, next: Record<string, unknown> | null): { field: string; from: unknown; to: unknown }[] {
  const a = prev ?? {};
  const b = next ?? {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => show(a[f]) !== show(b[f])).map((f) => ({ field: f, from: a[f], to: b[f] }));
}

/** Field-level audit trail (GET /master-records/{id}/history). */
function FieldHistory({ id }: { id: string }) {
  const q = useGoldenHistory(id);
  const list = q.data ?? [];
  return (
    <Sec title={t("Change history")}>
      {q.isPending ? (
        <Skeleton lines={2} />
      ) : q.isError ? (
        <ErrorState sentence={t("The change history could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState heading={t("No change has been recorded for this record yet.")} />
      ) : (
        <ul className="nx-ob-hist" aria-label={t("Field-level change history")}>
          {list.map((h) => {
            const diff = h.change_type === "promoted" ? [] : changedFields(h.previous_fields, h.new_fields);
            return (
              <li key={h.id}>
                <span className="nx-ib-meta">{formatDate(h.changed_at, "date")}</span>
                <span>
                  {CHANGE_WORD[h.change_type]?.() ?? h.change_type}
                  {h.changed_by ? `, ${h.changed_by}` : ""}
                  {h.ai_was_involved ? `, ${t("AI recommendation {value}", { value: h.ai_recommendation_accepted ? t("accepted") : t("not accepted") })}` : ""}
                  {diff.map((d) => (
                    <span key={d.field} className="nx-ob-fdiff nx-ib-meta">
                      {fieldCode(d.field)}
                      {`: ${show(d.from)} ${t("to")} ${show(d.to)}`}
                    </span>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Sec>
  );
}

/** Promote a record waiting for review to golden (POST /master-records/{id}/promote). Needs approve. */
function PromoteAction({ id }: { id: string }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const { outcome, pending, run } = useOutcome();
  if (!session.can("approve")) return <Gate>{t("Promoting a record to golden needs the approve permission. A data owner can do it.")}</Gate>;
  const go = () =>
    void run("promote", async () => {
      const res = await promoteGolden(id);
      void refreshV2(qc);
      return {
        tone: "ok",
        title: t("Promoted to golden"),
        detail: res.related_reviews_queued ? t("{n} related {n, plural, one {record was} other {records were}} queued for review.", { n: res.related_reviews_queued }) : t("No related record needed a review."),
      };
    });
  return (
    <div className="nx-ob-form">
      <div className="nx-ib-acts">
        <Button variant="primary" loading={pending === "promote"} loadingLabel={t("Promoting…")} disabled={pending !== null} onClick={go}>
          {t("Promote to golden")}
        </Button>
      </div>
      {outcome ? <OutcomeLine outcome={outcome} /> : null}
    </div>
  );
}

const WORKING = new Set(["simulating", "pending_approval", "approved", "applying"]);

const STATUS: Record<string, [ChipTone, () => string]> = {
  simulating: ["neutral", () => t("Checking with SAP")],
  simulated: ["warn", () => t("Checked, not yet sent for approval")],
  simulation_failed: ["bad", () => t("The check failed")],
  pending_approval: ["warn", () => t("Waiting for a second person")],
  approved: ["good", () => t("Approved, waiting to be written")],
  applying: ["neutral", () => t("Writing to SAP")],
  applied: ["good", () => t("Written to SAP")],
  failed: ["bad", () => t("Write to SAP failed")],
  rejected: ["bad", () => t("Rejected")],
  cancelled: ["neutral", () => t("Cancelled")],
};
const statusChip = (s: string) => {
  const hit = STATUS[s];
  return <Chip tone={hit?.[0] ?? "neutral"}>{hit ? hit[1]() : s}</Chip>;
};

const RESULT_WORD: Record<string, () => string> = {
  unsupported: () => t("Not carried"),
  unchanged: () => t("Already the same"),
  would_change: () => t("Would change"),
  written: () => t("Written"),
  error: () => t("Error"),
};

/** Send a golden record's values back to SAP: preview, check with SAP (writes nothing), send for approval, approve or reject. */
function SendToSap({ id, status }: { id: string; status: string }) {
  const qc = useQueryClient();
  const fixture = useFixture();
  const session = useV2Session();
  const golden = status === "golden";
  const preview = useWritebackPreview(id, golden);
  const reqs = useWritebackRequests(id);
  const { outcome, pending, run } = useOutcome();
  const [asking, setAsking] = useState(false);
  const canApply = session.can("apply");
  const canApprove = session.can("approve");
  const list = reqs.data ?? [];
  const latest: WritebackRequest | undefined = list[0];
  const busy = list.some((r) => WORKING.has(r.status));
  const mine = latest != null && latest.requested_by != null && latest.requested_by === session.id;
  const changes = latest ? (latest.counts.would_change ?? 0) : 0;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: mdmKeys.wbRequests(fixture, id) });
    void refreshV2(qc);
  };
  const check = () =>
    void run("check", async () => {
      await createWritebackRequest(id);
      refresh();
      return { tone: "ok", title: t("Checking with SAP"), detail: t("SAP is read and nothing is written. The result appears below.") };
    });
  const submit = (r: WritebackRequest) =>
    void run("submit", async () => {
      await submitWritebackRequest(id, r.id);
      refresh();
      return { tone: "ok", title: t("Sent for approval"), detail: t("A second person sees it in their inbox.") };
    });
  const decide = (action: "approve" | "reject") => {
    setAsking(false);
    void run(action, async () => {
      await decideWriteback(id, action);
      refresh();
      return action === "approve" ? { tone: "ok", title: t("Approved"), detail: t("The values are written to SAP next.") } : { tone: "ok", title: t("Rejected"), detail: t("Nothing is written to SAP.") };
    });
  };

  return (
    <Sec title={t("Send to SAP")} testId="send-to-sap">
      {!golden ? (
        <Note>{t("Promote this record to golden first. Only an approved golden record is sent to SAP.")}</Note>
      ) : preview.isPending ? (
        <Skeleton lines={3} />
      ) : preview.isError ? (
        <ErrorState sentence={t("What would be sent to SAP could not be read.")} error={preview.error} onRetry={() => void preview.refetch()} />
      ) : (
        <>
          <Facts>
            <Fact label={t("Golden fields")}>{int(Object.keys(preview.data.golden_fields).length)}</Fact>
            <Fact label={t("Systems")}>{int(preview.data.targets.length)}</Fact>
            <Fact label={t("Writes to SAP")}>{preview.data.live_enabled ? t("Switched on") : t("Switched off in this deployment")}</Fact>
          </Facts>
          {preview.data.message ? <Note>{preview.data.message}</Note> : null}
          {preview.data.unresolved_sources.length ? <Note>{t("No target is known for the source records {keys}.", { keys: preview.data.unresolved_sources.join(", ") })}</Note> : null}
          {preview.data.targets.map((tg) => {
            const planned = latest?.targets.find((x) => x.system_id === tg.system_id);
            const fields = planned?.fields ?? tg.fields;
            return (
              <div key={tg.system_id} className="nx-ob-card">
                <p className="nx-ob-sub">{tg.system_name ?? tg.system_id}</p>
                <Note>{tg.supported ? (tg.method === "rfc_bapi" ? t("Goes by BAPI {bapi}", { bapi: tg.bapi ?? "" }) : t("Goes by OData update")) : (tg.reason ?? t("This system takes no write-back."))}</Note>
                <div className="nx-ob-scroll">
                  <table className="nx-ob-table" tabIndex={0} aria-label={t("Fields sent to {system}", { system: tg.system_name ?? tg.system_id })}>
                    <thead>
                      <tr>
                        <th scope="col">{t("Field")}</th>
                        <th scope="col">{t("Golden value")}</th>
                        <th scope="col">{t("In SAP now")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((f) => (
                        <tr key={f.field}>
                          <th scope="row">
                            {fieldCode(f.field)}
                            <span className="nx-ob-hint">{f.result ? (RESULT_WORD[f.result]?.() ?? f.result) : f.supported ? t("Can be written") : (f.reason ?? t("Not carried"))}</span>
                          </th>
                          <td>{show(f.golden_value)}</td>
                          <td>{f.result && f.result !== "unsupported" ? show(f.current_value) : <Dash why={t("Not read from SAP yet")} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </>
      )}

      {golden ? (
        <>
          <h4 className="nx-ob-sub">{t("Requests")}</h4>
          {reqs.isPending ? (
            <Skeleton lines={2} />
          ) : reqs.isError ? (
            <ErrorState sentence={t("The requests could not be read.")} error={reqs.error} onRetry={() => void reqs.refetch()} />
          ) : list.length === 0 ? (
            <EmptyState heading={t("Nothing has been sent to SAP for this record.")} />
          ) : (
            <ul className="nx-ob-hist" aria-label={t("Write-back requests")}>
              {list.map((r) => (
                <li key={r.id}>
                  <span className="nx-ib-meta">{formatDate(r.created_at, "date")}</span>
                  <span>
                    {statusChip(r.status)}
                    {r.requested_by ? `, ${t("asked by {who}", { who: r.requested_by })}` : ""}
                    {r.approved_by ? `, ${t("approved by {who}", { who: r.approved_by })}` : ""}
                    {r.rejected_by ? `, ${t("rejected by {who}", { who: r.rejected_by })}` : ""}
                    {Object.keys(r.counts).length ? <span className="nx-ob-fdiff nx-ib-meta">{t("{n} would change, {m} already the same", { n: r.counts.would_change ?? 0, m: r.counts.unchanged ?? 0 })}</span> : null}
                    {r.error ? <span className="nx-ob-fdiff nx-ob-err">{r.error}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="nx-ib-acts">
            {canApply && !busy ? (
              <Button loading={pending === "check"} loadingLabel={t("Checking…")} disabled={pending !== null} onClick={check}>
                {latest ? t("Check with SAP again") : t("Check with SAP")}
              </Button>
            ) : null}
            {canApply && latest?.status === "simulated" && mine && changes > 0 ? (
              <Button variant="primary" loading={pending === "submit"} loadingLabel={t("Sending…")} disabled={pending !== null} onClick={() => submit(latest)}>
                {t("Send for approval")}
              </Button>
            ) : null}
            {canApprove && latest?.status === "pending_approval" && !mine ? (
              <>
                <Button variant="primary" loading={pending === "approve"} loadingLabel={t("Approving…")} disabled={pending !== null} onClick={() => setAsking(true)}>
                  {t("Approve")}
                </Button>
                <Button loading={pending === "reject"} loadingLabel={t("Rejecting…")} disabled={pending !== null} onClick={() => decide("reject")}>
                  {t("Reject")}
                </Button>
              </>
            ) : null}
          </div>
          {!canApply && !canApprove ? <Gate>{t("Checking or sending to SAP needs the apply permission, which your role does not hold.")}</Gate> : null}
          {latest?.status === "simulated" && changes === 0 ? <Note>{t("SAP already holds these values. There is nothing to send.")}</Note> : null}
          {latest?.status === "pending_approval" && mine ? <Note>{t("You asked for this; a second person approves it.")}</Note> : null}
          {outcome ? <OutcomeLine outcome={outcome} /> : null}
          <Confirm
            open={asking}
            title={t("Approve the write to SAP")}
            consequence={t("{n} {n, plural, one {field is} other {fields are}} written to SAP once you approve. A committed change cannot be taken back from here.", { n: changes })}
            confirmLabel={t("Approve")}
            danger
            onConfirm={() => decide("approve")}
            onCancel={() => setAsking(false)}
          />
        </>
      ) : null}
    </Sec>
  );
}

/** Per field: how the two values compared, the rule's weight and what it added to the score. */
function WhyTheyMatch({ e }: { e: NonNullable<ReviewPairDetail["explanation"]> }) {
  return (
    <>
      <div className="nx-ob-scroll">
        <table className="nx-ob-table" aria-label={t("Why the two records match, field by field")}>
          <thead>
            <tr>
              <th scope="col">{t("Field")}</th>
              <th scope="col">{t("Record A")}</th>
              <th scope="col">{t("Record B")}</th>
              <th scope="col" className="nx-ob-num">{t("Similarity")}</th>
              <th scope="col" className="nx-ob-num">{t("Adds")}</th>
            </tr>
          </thead>
          <tbody>
            {e.attributes.map((a) => (
              <tr key={a.field} data-skipped={a.skipped ? "true" : undefined}>
                <th scope="row">
                  {fieldCode(a.field.replace(".", "-"))}
                  <span className="nx-ob-hint">{COMPARATOR_LABEL[a.comparator] ?? a.comparator}</span>
                </th>
                <td>{a.value_a}</td>
                <td>{a.value_b}</td>
                <td className="nx-ob-num">
                  {a.skipped ? (
                    <span className="nx-ob-hint">{SKIP_REASON[a.reason ?? ""]?.() ?? a.reason}</span>
                  ) : (
                    <>
                      {(a.similarity ?? 0).toFixed(2)}
                      {a.threshold != null ? (
                        <span className="nx-ob-hint">{a.threshold_met ? t("meets {value}", { value: a.threshold.toFixed(2) }) : t("below {value}", { value: a.threshold.toFixed(2) })}</span>
                      ) : null}
                    </>
                  )}
                </td>
                <td className="nx-ob-num">{t("{contribution} of {weight}", { contribution: a.contribution.toFixed(1), weight: int(a.weight) })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Note>{t("Score {total} from {weight} points of weight. Personal values are masked. Every comparison is a fixed rule; no model sees the values.", { total: e.total.toFixed(2), weight: int(e.weight_total) })}</Note>
    </>
  );
}

function GoldenBody({ id, onClose }: BodyProps) {
  const qc = useQueryClient();
  const session = useV2Session();
  const rec = useGoldenRecord(id);
  const explain = useGoldenExplain(id);
  const events = useGoldenEvents(id);
  const { outcome, pending, run } = useOutcome();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [reason, setReason] = useState("");
  const canSplit = session.can("approve");
  const r = rec.data;
  const ex = explain.data;
  const members = ex?.members ?? [];
  const survivor = r?.sap_object_key;
  const fields = useMemo(() => Object.entries(r?.golden_fields ?? {}), [r]);
  const conflicts = useMemo(() => (ex ? Object.entries(ex.survivorship).filter(([, a]) => a.losers.some((l) => l.value !== a.value)).length : 0), [ex]);

  const toggle = (k: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const split = () =>
    void run("split", async () => {
      const res = await splitGolden(id, [...picked], reason.trim());
      void refreshV2(qc);
      setPicked(new Set());
      setReason("");
      return {
        tone: "ok",
        title: t("{value} split out", { value: res.split_keys.length === 1 ? t("1 record") : t("{split_keysCount} records", { split_keysCount: res.split_keys.length }) }),
        detail: t("{remaining_keysCount} stay in this golden record. The split records are marked as not duplicates of it.", { remaining_keysCount: res.remaining_keys.length }),
      };
    });
  const blocked = picked.size === 0 ? t("Choose records to split out") : reason.trim() === "" ? t("Reason for the split") : undefined;

  return (
    <InspectorFrame
      title={r ? <Code code={r.sap_object_key} /> : t("Golden record")}
      status={r ? t("Golden record, {value}", { value: r.status === "golden" ? t("approved") : t("waiting for review") }) : t("Golden record")}
      onClose={onClose}
    >
      {rec.isError && !r ? (
        <ErrorState sentence={t("This golden record could not be read.")} error={rec.error} onRetry={() => void rec.refetch()} />
      ) : !r ? (
        <Skeleton lines={5} />
      ) : (
        <>
          <Facts>
            <Fact label={t("Golden key")}>
              <Code code={r.sap_object_key} />
            </Fact>
            <Fact label={t("Status")}>{r.status === "golden" ? t("Approved") : r.status === "pending_review" ? t("Waiting for review") : r.status}</Fact>
            <Fact label={t("Confidence")}>{confidencePct(r.overall_confidence)}</Fact>
            <Fact label={t("Sources")}>{ex ? int(members.length) : <Dash />}</Fact>
            <Fact label={t("Open conflicts")}>{ex ? int(conflicts) : <Dash />}</Fact>
            <Fact label={t("Last merged")}>{formatDate(r.updated_at, "date")}</Fact>
          </Facts>
          <Sec title={t("Fields")}>
            {explain.isError ? (
              <ErrorState sentence={t("How each value was chosen could not be read.")} error={explain.error} onRetry={() => void explain.refetch()} />
            ) : (
              <div className="nx-ob-scroll">
                <table className="nx-ob-table" tabIndex={0} aria-label={t("Golden fields and how each value was chosen")}>
                  <thead>
                    <tr>
                      <th scope="col">{t("Field")}</th>
                      <th scope="col">{t("Value")}</th>
                      <th scope="col">{t("Chosen by")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map(([f, v]) => {
                      const s = ex?.survivorship[f];
                      const differs = s?.losers.filter((l) => l.value !== s.value) ?? [];
                      return (
                        <tr key={f}>
                          <th scope="row">{fieldCode(f)}</th>
                          <td>
                            {String(v)}
                            {differs.length > 0 ? <span className="nx-ob-fdiff nx-ib-meta">{`Differs: ${differs.map((l) => `${l.value}${l.system ? ` (${l.system})` : ""}`).join(", ")}`}</span> : null}
                          </td>
                          <td>{s ? (RULE_LABEL[s.rule] ?? s.rule) : explain.isPending ? <Skeleton lines={1} /> : <Dash why={t("No rule decided this field")} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Sec>
          <Sec title={t("Source records")}>
            {explain.isPending ? (
              <Skeleton lines={2} />
            ) : members.length === 0 ? (
              <EmptyState heading={t("No source record is listed for this golden record.")} />
            ) : (
              <ul className="nx-ob-pick" aria-label={t("Source records")}>
                {members.map((k) => (
                  <li key={k}>
                    <label>
                      {canSplit && members.length > 1 && k !== survivor ? <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} aria-label={t("Split out {k}", { k })} /> : null}
                      <Code code={shortKey(k)} />
                      <span className="nx-ob-hint">{k === survivor ? t("Survivor") : t("Merged in")}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Sec>
          <Actions>
            {r.status === "pending_review" ? <PromoteAction id={id} /> : null}
            {canSplit ? (
              <div className="nx-ob-form">
                <Field label={t("Reason for the split")}>
                  {(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Why these are different materials")} />}
                </Field>
                <div className="nx-ib-acts">
                  <Button variant="primary" loading={pending === "split"} loadingLabel={t("Splitting…")} disabled={!!blocked || pending !== null} reason={blocked} onClick={split}>
                    {picked.size ? t("Split out {size} {size, plural, one {record} other {records}}", { size: picked.size }) : t("Choose records to split out")}
                  </Button>
                </div>
                {outcome ? <OutcomeLine outcome={outcome} /> : null}
              </div>
            ) : (
              <Gate>{t("Splitting a golden record needs the approve permission. A data owner can do it.")}</Gate>
            )}
          </Actions>
          <SendToSap id={id} status={r.status} />
          <Sec title={t("History")}>
            {events.isPending ? (
              <Skeleton lines={2} />
            ) : events.isError ? (
              <ErrorState sentence={t("The merge history could not be read.")} error={events.error} onRetry={() => void events.refetch()} />
            ) : (events.data ?? []).length === 0 ? (
              <EmptyState heading={t("No merge has changed this record yet.")} />
            ) : (
              <ul className="nx-ob-hist">
                {(events.data ?? []).map((e) => (
                  <li key={e.id}>
                    <span className="nx-ib-meta">{formatDate(e.created_at, "date")}</span>
                    <span>
                      {EVENT_WORD[e.event_type]?.() ?? e.event_type}
                      {e.actor ? `, ${e.actor}` : ""}
                      {e.reason ? `: ${e.reason}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Sec>
          <FieldHistory id={id} />
        </>
      )}
    </InspectorFrame>
  );
}

type Side = "a" | "b";

/** The fields where the picked side differs from the survivor's side, with the picked value: the merge's overrides. */
export function overridesOf(detail: ReviewPairDetail, survivor: Side, picks: Record<string, Side>): Record<string, string> {
  const out: Record<string, string> = {};
  const names = new Set([...Object.keys(detail.record_a.fields), ...Object.keys(detail.record_b.fields)]);
  for (const f of names) {
    const a = detail.record_a.fields[f];
    const b = detail.record_b.fields[f];
    if (String(a ?? "") === String(b ?? "")) continue;
    const pick = picks[f] ?? survivor;
    if (pick !== survivor) {
      const v = pick === "a" ? a : b;
      if (v != null) out[f] = String(v);
    }
  }
  return out;
}

function PairBody({ pairId, onClose }: { pairId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const q = useMatchPair(pairId);
  const { outcome, pending, run } = useOutcome();
  const [survivorPick, setSurvivorPick] = useState<Side | null>(null);
  const [picks, setPicks] = useState<Record<string, Side>>({});
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  const can = session.can("approve");
  const d = q.data;
  const survivor: Side = survivorPick ?? (d && d.default_survivor === d.b ? "b" : "a");
  const names = useMemo(() => (d ? [...new Set([...Object.keys(d.record_a.fields), ...Object.keys(d.record_b.fields)])] : []), [d]);
  const same = (f: string): boolean => d != null && String(d.record_a.fields[f] ?? "") === String(d.record_b.fields[f] ?? "");
  const differing = names.filter((f) => !same(f));

  const finish = () => {
    void refreshV2(qc);
    setDone(true);
  };
  const merge = () =>
    void run("merge", async () => {
      if (!d) throw new Error(t("The pair is not loaded."));
      const key = survivor === "a" ? d.record_a.key : d.record_b.key;
      const res = await mergePair(pairId, { survivor: key, overrides: overridesOf(d, survivor, picks), reason: reason.trim() });
      finish();
      return {
        tone: "ok",
        title: t("Merged"),
        detail: t("{shortKey} survives{value}. Undo it from the golden record.", {
          shortKey: shortKey(res.survivor_key),
          value: res.filled_fields.length ? t("; {filled_fieldsCount} empty {filled_fieldsCount, plural, one {field was} other {fields were}} filled from the other record", { filled_fieldsCount: res.filled_fields.length }) : "",
        }),
      };
    });
  const reject = () =>
    void run("reject", async () => {
      await markNotDuplicate(pairId, reason.trim());
      finish();
      return { tone: "ok", title: t("Marked as not a duplicate"), detail: t("This pair will not be offered again.") };
    });
  const noReason = reason.trim() === "" ? t("Reason") : undefined;

  return (
    <InspectorFrame title={t("Possible duplicate")} status={d ? t("Match score {value}, waiting for a steward", { value: d.total.toFixed(2) }) : t("Possible duplicate")} onClose={onClose}>
      {q.isError && !d ? (
        <ErrorState sentence={t("This pair could not be read. It may already be decided.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : !d ? (
        <Skeleton lines={5} />
      ) : (
        <>
          <Facts>
            <Fact label={t("Match score")}>{d.total.toFixed(2)}</Fact>
            <Fact label={t("Record A")}>
              <Code code={shortKey(d.record_a.key)} />
            </Fact>
            <Fact label={t("Record B")}>
              <Code code={shortKey(d.record_b.key)} />
            </Fact>
            <Fact label={t("Fields that differ")}>{t("{differingCount} of {namesCount}", { differingCount: differing.length, namesCount: names.length })}</Fact>
          </Facts>
          {d.explanation ? (
            <Sec title={t("Why they match")}>
              <WhyTheyMatch e={d.explanation} />
            </Sec>
          ) : null}
          <Sec title={t("Side by side")}>
            <div className="nx-ob-scroll">
              <table className="nx-ob-table" aria-label={t("The two records side by side, pick a value per field")}>
                <thead>
                  <tr>
                    <th scope="col">{t("Field")}</th>
                    <th scope="col">{t("Record A")}</th>
                    <th scope="col">{t("Record B")}</th>
                  </tr>
                </thead>
                <tbody>
                  {names.map((f) => {
                    const eq = same(f);
                    const pick = picks[f] ?? survivor;
                    const cell = (side: Side, v: unknown) => (
                      <td>
                        {eq || done || !can ? (
                          String(v ?? "")
                        ) : (
                          <label className="nx-ob-check">
                            <input type="radio" name={`pick-${f}`} checked={pick === side} onChange={() => setPicks((p) => ({ ...p, [f]: side }))} aria-label={t("{f}: keep the value of record {value}", { f, value: side === "a" ? "A" : "B" })} />
                            {String(v ?? "")}
                          </label>
                        )}
                      </td>
                    );
                    return (
                      <tr key={f} data-same={eq ? "true" : undefined}>
                        <th scope="row">{fieldCode(f)}</th>
                        {eq ? (
                          <td colSpan={2}>{t("{fields} (same)", { fields: String(d.record_a.fields[f] ?? "") })}</td>
                        ) : (
                          <>
                            {cell("a", d.record_a.fields[f])}
                            {cell("b", d.record_b.fields[f])}
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Note>{t("Each value you pick on a field that differs is kept in the merged record; the others follow the survivor.")}</Note>
          </Sec>
          <Actions>
            {!can ? (
              <Gate>{t("Merging, or marking a pair as not a duplicate, needs the approve permission. A data owner can decide this pair.")}</Gate>
            ) : done ? null : (
              <div className="nx-ob-form">
                <fieldset className="nx-ob-fset">
                  <legend>{t("Keep the key of")}</legend>
                  <label className="nx-ob-check">
                    <input type="radio" name="survivor" checked={survivor === "a"} onChange={() => setSurvivorPick("a")} />
                    <Code code={shortKey(d.record_a.key)} />
                  </label>
                  <label className="nx-ob-check">
                    <input type="radio" name="survivor" checked={survivor === "b"} onChange={() => setSurvivorPick("b")} />
                    <Code code={shortKey(d.record_b.key)} />
                  </label>
                </fieldset>
                <Field label={t("Reason")}>{(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Why these are one thing, or two")} />}</Field>
                <div className="nx-ib-acts">
                  <Button variant="primary" loading={pending === "merge"} loadingLabel={t("Merging…")} disabled={!!noReason || pending !== null} reason={noReason} onClick={merge}>
                    {t("Merge")}
                  </Button>
                  <Button loading={pending === "reject"} loadingLabel={t("Saving…")} disabled={!!noReason || pending !== null} reason={noReason} onClick={reject}>
                    {t("Not a duplicate")}
                  </Button>
                </div>
              </div>
            )}
            {outcome ? <OutcomeLine outcome={outcome} /> : null}
          </Actions>
        </>
      )}
    </InspectorFrame>
  );
}

/** `?open=golden:<id>` for one golden record, `?open=golden:pair:<id>` for a pair waiting for a steward. */
export function GoldenInspector({ id, onClose }: BodyProps) {
  if (id.startsWith("pair:")) return <PairBody pairId={id.slice(5)} onClose={onClose} />;
  if (id) return <GoldenBody id={id} onClose={onClose} />;
  return (
    <InspectorFrame title={t("Golden record")} onClose={onClose}>
      <EmptyState heading={t("No golden record is named.")} />
    </InspectorFrame>
  );
}

/* ---- survivorship rules of one object ---- */

const fromRule = (r: SurvivorshipRule, i: number): DraftRule => ({ key: `r${i}`, field: r.field, rule_type: r.rule_type, trusted_sources: r.trusted_sources ?? [], weight: String(r.weight), active: r.active, ai_inferred: r.ai_inferred });

const REASONS: Record<string, () => string> = {
  length: () => t("Length"),
  fixed_values: () => t("Fixed values"),
  check_table: () => t("Check table"),
};

/** The diff the candidate rules would make to the stored golden records, with the DDIC check of each new value. */
function PreviewResult({ p }: { p: SurvivorshipPreview }) {
  const reasons = (r: Record<string, number>) => Object.entries(r).map(([k, n]) => `${REASONS[k]?.() ?? k} ${int(n)}`).join(", ");
  const status = (a: SurvivorshipPreview["attributes"][number]) =>
    !a.in_dictionary ? t("not in the dictionary") : a.check_status === "unknown" ? t("Value set not known, not checked") : a.invalid ? reasons(a.invalid_reasons) : t("Passes");
  return (
    <Sec title={t("Preview")} label={t("Survivorship preview")} testId="sv-preview">
      <p className="nx-ob-note">
        {t("{records} {records, plural, one {golden record} other {golden records}} would change, {values} {values, plural, one {value} other {values}} in all; {invalid} {invalid, plural, one {new value fails} other {new values fail}} a dictionary check.", { records: p.records_changed, values: p.values_changed, invalid: p.invalid_values })}
      </p>
      <Note>
        {p.capped
          ? t("Scanned the first {scanned} of {total} clusters; the preview is capped at {cap}.", { scanned: p.clusters_scanned, total: p.clusters_total, cap: p.cap })
          : t("Scanned all {total} {total, plural, one {cluster} other {clusters}}.", { total: p.clusters_total })}
      </Note>
      {p.attributes.length === 0 ? (
        <EmptyState heading={t("These rules change no golden value.")} />
      ) : (
        <>
          <div className="nx-ob-scroll">
            <table className="nx-ob-table" data-testid="sv-preview-attrs">
              <caption>{t("Attributes that change, with their dictionary check")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("Attribute")}</th>
                  <th scope="col">{t("Check table")}</th>
                  <th scope="col" className="nx-ob-num">{t("Changed")}</th>
                  <th scope="col">{t("Invalid")}</th>
                </tr>
              </thead>
              <tbody>
                {p.attributes.map((a) => (
                  <tr key={a.field}>
                    <td><Code code={a.field} text={a.text ?? describeField(a.field) ?? undefined} /></td>
                    <td>{a.check_table ? <Code code={a.check_table} /> : <Dash />}</td>
                    <td className="nx-ob-num">{int(a.changed)}</td>
                    <td>
                      {a.invalid ? `${int(a.invalid)}: ` : null}
                      <span className="nx-ob-hint">{status(a)}</span>
                      {a.invalid_samples.length ? <span className="nx-ob-hint"> ({a.invalid_samples.join(", ")})</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="nx-ob-scroll">
            <table className="nx-ob-table" data-testid="sv-preview-samples">
              <caption>{t("Sample changes: record, attribute, value before and after, and the winning record")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("Record")}</th>
                  <th scope="col">{t("Attribute")}</th>
                  <th scope="col">{t("Before")}</th>
                  <th scope="col">{t("After")}</th>
                  <th scope="col">{t("Winner")}</th>
                </tr>
              </thead>
              <tbody>
                {p.samples.map((x, i) => (
                  <tr key={`${x.golden_id ?? x.key ?? i}-${x.field}`}>
                    <td>{x.key ? <Code code={x.key} /> : <Dash />}</td>
                    <td>{fieldCode(x.field)}</td>
                    <td className="nx-ob-mono">{x.before || "-"}</td>
                    <td className="nx-ob-mono">{x.after || "-"}</td>
                    <td>
                      {x.winner_key ? <Code code={x.winner_key} /> : <Dash />}
                      {x.winner_system ? <span className="nx-ob-hint"> {x.winner_system}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Sec>
  );
}

function SurvivorshipEditor({ domain, initial }: { domain: string; initial: SurvivorshipRule[] }) {
  const { can } = useV2Session();
  const allowed = can("mdm.write");
  const canPreview = can("mdm.read");
  const [preview, setPreview] = useState<SurvivorshipPreview | null>(null);
  const [previewFailed, setPreviewFailed] = useState<unknown>(null);
  const [previewing, setPreviewing] = useState(false);
  const systems = useSystemsExtended().data ?? [];
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const seq = useRef(initial.length);
  const [rules, setRules] = useState<DraftRule[]>(() => initial.map(fromRule));
  const [dirty, setDirty] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const errors = validateRules(rules);
  const valid = Object.keys(errors).length === 0;

  const change = (next: DraftRule[]) => {
    setRules(next);
    setDirty(true);
    setPreview(null);
  };
  const runPreview = () => {
    setShown(true);
    if (!valid) return;
    setPreviewing(true);
    setPreviewFailed(null);
    previewSurvivorship(domain, toInput(rules))
      .then(setPreview, (e: unknown) => setPreviewFailed(e ?? true))
      .finally(() => setPreviewing(false));
  };
  const patch = (key: string, p: Partial<DraftRule>) => change(rules.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const add = () => change([...rules, { key: `n${++seq.current}`, field: "", rule_type: "most_recent", trusted_sources: [], weight: "50", active: true }]);
  const save = () => {
    setShown(true);
    if (!valid || !allowed) return;
    void run("save", async () => {
      const saved = await putSurvivorship(domain, toInput(rules));
      setRules(saved.rules.map(fromRule));
      setDirty(false);
      setShown(false);
      refresh();
      return { tone: "ok", title: t("Survivorship rules saved"), detail: t("{total} {total, plural, one {rule} other {rules}} for {domain}. They apply from the next merge.", { total: saved.total, domain: labelOf(domain) }) };
    });
  };
  const gone = rules.find((r) => r.key === removing);

  return (
    <>
      {!allowed ? <Gate>{t("Changing survivorship rules needs the MDM write permission. You can read them.")}</Gate> : null}
      <Note>{t("A rule decides which record's value survives in the golden record, field by field. A field with no rule keeps the survivor's value. Rules are listed by field.")}</Note>
      {rules.length === 0 ? (
        <EmptyState heading={t("No survivorship rule is set for this object. Add one for a field.")} />
      ) : (
        <ul className="nx-ob-pick" aria-label={t("Survivorship rules")} data-testid="sv-list">
          {rules.map((r) => {
            const e = shown ? (errors[r.key] ?? {}) : {};
            const what = r.field || t("the new rule");
            return (
              <li key={r.key} aria-label={r.field || t("New rule")} className="nx-ob-card">
                <div className="nx-ob-word">
                  {r.field ? fieldCode(r.field) : <span>{t("New rule")}</span>}
                  <span className="nx-ob-hint">{`${typeLabel(r.rule_type)}${r.ai_inferred ? t(", suggested by the miner") : ""}`}</span>
                </div>
                <div className="nx-ob-grid">
                  <Field label={t("Field")} error={e.field}>
                    {(p) => <input {...p} className="nx-ob-mono" disabled={!allowed} value={r.field} onChange={(ev) => patch(r.key, { field: ev.target.value })} />}
                  </Field>
                  <Field label={t("Rule type")} hint={RULE_TYPES.find((x) => x.value === r.rule_type)?.help}>
                    {(p) => (
                      <select {...p} disabled={!allowed} value={r.rule_type} onChange={(ev) => patch(r.key, { rule_type: ev.target.value as SurvivorshipRuleType })}>
                        {RULE_TYPES.map((x) => (
                          <option key={x.value} value={x.value}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <Field label={t("Weight")} hint={t("0 to 100")} error={e.weight}>
                    {(p) => <input {...p} disabled={!allowed} inputMode="numeric" value={r.weight} onChange={(ev) => patch(r.key, { weight: ev.target.value })} />}
                  </Field>
                  <label className="nx-ob-check">
                    <input type="checkbox" disabled={!allowed} checked={r.active} onChange={(ev) => patch(r.key, { active: ev.target.checked })} />
                    {t("Active")}
                  </label>
                </div>
                {needsSources(r.rule_type) ? (
                  <div className="nx-ob-form">
                    <p className="nx-ob-sub">{r.rule_type === "chain" ? t("Systems, in the order they are tried") : t("Trusted systems, in priority order")}</p>
                    <ol className="nx-ob-pick" aria-label={t("Systems for {field}", { field: what })}>
                      {r.trusted_sources.map((s, k) => (
                        <li key={s} className="nx-ob-word">
                          <span>{k + 1}</span>
                          <span className="nx-ob-grow">{s}</span>
                          {allowed ? (
                            <>
                              <Button size={32} variant="quiet" aria-label={t("Move {s} up", { s })} disabled={k === 0} onClick={() => patch(r.key, { trusted_sources: moveBy(r.trusted_sources, k, -1) })}>
                                {t("Up")}
                              </Button>
                              <Button size={32} variant="quiet" aria-label={t("Move {s} down", { s })} disabled={k === r.trusted_sources.length - 1} onClick={() => patch(r.key, { trusted_sources: moveBy(r.trusted_sources, k, 1) })}>
                                {t("Down")}
                              </Button>
                              <Button size={32} variant="quiet" aria-label={t("Remove {s}", { s })} onClick={() => patch(r.key, { trusted_sources: r.trusted_sources.filter((x) => x !== s) })}>
                                {t("Remove")}
                              </Button>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                    {allowed ? (
                      <Field label={t("Add a system")} error={e.sources}>
                        {(p) => (
                          <select {...p} value="" onChange={(ev) => ev.target.value && patch(r.key, { trusted_sources: [...r.trusted_sources, ev.target.value] })}>
                            <option value="">{t("Choose a system")}</option>
                            {systems
                              .filter((s) => !r.trusted_sources.includes(s.name))
                              .map((s) => (
                                <option key={s.id} value={s.name}>
                                  {s.name}
                                </option>
                              ))}
                          </select>
                        )}
                      </Field>
                    ) : null}
                  </div>
                ) : null}
                {allowed ? (
                  <div className="nx-ib-acts">
                    <Button size={32} variant="quiet" aria-label={t("Delete the rule for {field}", { field: what })} onClick={() => setRemoving(r.key)}>
                      {t("Delete rule")}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <Confirm
        open={gone != null}
        title={t("Delete rule")}
        consequence={t("The rule for {field} is removed when you save. A merge then keeps the survivor's value for that field.", { field: gone?.field || t("this field") })}
        confirmLabel={t("Delete rule")}
        danger
        onConfirm={() => {
          if (gone) change(rules.filter((r) => r.key !== gone.key));
          setRemoving(null);
        }}
        onCancel={() => setRemoving(null)}
      />
      {allowed || canPreview ? (
        <Actions>
          {canPreview ? (
            <Button loading={previewing} loadingLabel={t("Previewing…")} disabled={rules.length === 0} onClick={runPreview} data-testid="sv-preview-btn">
              {t("Preview")}
            </Button>
          ) : null}
          {allowed ? <Button onClick={add}>{t("Add a rule")}</Button> : null}
          {allowed ? (
            <Button variant="primary" loading={pending === "save"} loadingLabel={t("Saving…")} disabled={!dirty || pending !== null} onClick={save}>
              {t("Save rules")}
            </Button>
          ) : null}
        </Actions>
      ) : null}
      {previewFailed ? <ErrorState sentence={t("The preview could not be run.")} error={previewFailed} onRetry={runPreview} /> : null}
      {preview ? <PreviewResult p={preview} /> : null}
      {shown && !valid ? (
        <p className="nx-ob-ferr" role="alert">
          {t("Fix the marked fields before saving.")}
        </p>
      ) : null}
      {outcome ? <OutcomeLine outcome={outcome} /> : null}
    </>
  );
}

/** `?open=survivorship:<module>`: add, change, reorder the systems of, and delete the survivorship rules of one object. */
export function SurvivorshipInspector({ id, onClose }: BodyProps) {
  const domain = moduleFromSlug(id);
  const q = useSurvivorshipRules(domain);
  return (
    <InspectorFrame title={t("Survivorship rules")} status={labelOf(domain)} onClose={onClose}>
      {q.isLoading ? (
        <Skeleton lines={5} />
      ) : q.isError ? (
        <ErrorState sentence={t("The survivorship rules could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <SurvivorshipEditor key={domain} domain={domain} initial={q.data ?? []} />
      )}
    </InspectorFrame>
  );
}
