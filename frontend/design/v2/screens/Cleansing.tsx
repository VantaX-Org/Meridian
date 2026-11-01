"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import {
  applyProposal, approveGroup, EXPORT_FORMATS, exportCleaning, getExportOptions, type ExportFormat, approveProposal, CONFIDENT, getAppliedCleaning, getDedupCandidates, mergeDedup, previewDedup, getCleaningAudit, getCleaningGroups, getCleaningMetrics, getProposals, rejectProposal,
  rollbackCleaning, sendAiFeedback, WAITING, type CleaningGroup, type CleaningItem, type CleaningMetric, type DedupCandidate, type Proposal, type RecordData,
} from "@/lib/api/v2/cleaning";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { DASH, f1, int } from "@/lib/v2/score";
import { ChartFrame, ChartTable, niceTicks, StackedBar, TrendChart } from "../charts";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { useToast } from "../Toast";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { ScrollFrame } from "./object/ScrollFrame";
import { Fld } from "../admin/kit";

/**
 * Cleansing: what the cleaning engine proposed, what was applied to SAP and what was undone. The weekly task stores a
 * snapshot of the queue by status per object, so the newest snapshot is the current state and the series of
 * snapshots is the trend; the snapshots are never summed across weeks. The applied changes can be rolled back until
 * their deadline, and the audit trail lists every decision. How the cleaned records held up is on Work, Monitor.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;

const ACTION: Record<string, () => string> = {
  detected: () => t("Detected"),
  recommended: () => t("Proposed"),
  approved: () => t("Approved"),
  auto_approved: () => t("Approved automatically"),
  rejected: () => t("Rejected"),
  applied: () => t("Applied to SAP"),
  verified: () => t("Verified"),
  rolled_back: () => t("Rolled back"),
};

type Sums = Omit<CleaningMetric, "period" | "period_type" | "object_type">;
const ZERO: Sums = { detected: 0, recommended: 0, approved: 0, rejected: 0, applied: 0, verified: 0, rolled_back: 0, auto_approved: 0 };
const add = (a: Sums, m: Sums): Sums => ({
  detected: a.detected + m.detected,
  recommended: a.recommended + m.recommended,
  approved: a.approved + m.approved,
  rejected: a.rejected + m.rejected,
  applied: a.applied + m.applied,
  verified: a.verified + m.verified,
  rolled_back: a.rolled_back + m.rolled_back,
  auto_approved: a.auto_approved + m.auto_approved,
});
const cleaned = (s: Sums) => s.applied + s.verified;
const waiting = (s: Sums) => s.detected + s.recommended;

/** The snapshots per week, oldest first, each summed across the objects. */
export function weekly(metrics: readonly CleaningMetric[]): { period: string; sums: Sums; objects: CleaningMetric[] }[] {
  const by = new Map<string, CleaningMetric[]>();
  for (const m of metrics) by.set(m.period, [...(by.get(m.period) ?? []), m]);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, objects]) => ({ period, sums: objects.reduce(add, ZERO), objects }));
}

/** The fields an applied change touched, with the value before and after. */
export function changed(before: RecordData, after: RecordData): { field: string; from: string; to: string }[] {
  const b = before ?? {};
  const a = after ?? {};
  const text = (v: unknown) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => text(b[k]) !== text(a[k])).map((k) => ({ field: k, from: text(b[k]), to: text(a[k]) }));
}

function useCleaning<T>(name: string, fn: () => Promise<T>) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["cleaning", fixture, name], queryFn: fn, staleTime: 60_000, retry: (n, e) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; } });
}

export function Cleansing() {
  const metrics = useCleaning("metrics", getCleaningMetrics);
  const queue = useCleaning("applied", () => getAppliedCleaning().then((r) => ({ ...r, readAt: Date.now() })));
  const audit = useCleaning("audit", getCleaningAudit);

  if (metrics.isPending) return <CcPage><Skeleton width="100%" height={320} /></CcPage>;
  if (metrics.isError) return <CcPage><ErrorFrame onRetry={() => void metrics.refetch()}>{t("The cleansing figures could not be read.")}</ErrorFrame></CcPage>;

  const weeks = weekly(metrics.data.metrics);
  const now = weeks.at(-1);
  if (!now) return <CcPage><EmptyFrame>{t("Nothing has been cleansed yet. The figures appear after the weekly cleansing task has run once.")}</EmptyFrame></CcPage>;
  const prev = weeks.at(-2);
  const s = now.sums;
  const gain = prev ? cleaned(s) - cleaned(prev.sums) : null;

  return (
    <CcPage>
      <CcBanner
        testId="cleansing"
        label={t("Cleansing")}
        eyebrow={t("Cleansing, week of {date}", { date: formatDate(now.period, "date") })}
        headline={t("{n} records cleansed in SAP, {r} rolled back", { n: int(cleaned(s)), r: int(s.rolled_back) })}
        why={gain == null ? t("The first weekly snapshot. The trend starts next week.") : t("{n} more than the week before; {a} of the approvals were made automatically.", { n: int(gain), a: int(s.auto_approved) })}
        figs={[
          { label: t("Waiting for a decision"), value: int(waiting(s)), note: t("proposed changes nobody has approved or rejected") },
          { label: t("Approved, not yet in SAP"), value: int(s.approved), note: t("written at the next apply") },
          { label: t("Verified"), value: int(s.verified), note: t("applied and read back from SAP") },
        ]}
        action={<a href="#cleansing-proposals" className="m2-btn m2-next" data-testid="cleansing-review">{t("Review the proposals")}</a>}
      />

      <Panel title={t("Where every proposal stands")} meta={t("The latest snapshot of the queue, all objects.")} testId="cleansing-status">
        <StackedBar
          label={t("Proposals by status")}
          format={int}
          testId="cleansing-stack"
          parts={[
            { key: "waiting", label: t("Waiting for a decision"), value: waiting(s), colour: "--m2-sev-low", title: t("Waiting for a decision: {n}", { n: int(waiting(s)) }) },
            { key: "approved", label: t("Approved"), value: s.approved, colour: "--m2-data", title: t("Approved: {n}", { n: int(s.approved) }) },
            { key: "cleaned", label: t("Cleansed in SAP"), value: cleaned(s), colour: "--m2-pass", title: t("Cleansed in SAP: {n}", { n: int(cleaned(s)) }) },
            { key: "rolled", label: t("Rolled back"), value: s.rolled_back, colour: "--m2-warn", title: t("Rolled back: {n}", { n: int(s.rolled_back) }) },
            { key: "rejected", label: t("Rejected"), value: s.rejected, colour: "--m2-sev-med", title: t("Rejected: {n}", { n: int(s.rejected) }) },
          ]}
        />
      </Panel>

      <Proposals />
      <Duplicates />

      <div className="m2-cc-split">
        <Trend weeks={weeks} />
        <Panel title={t("Cleansed by object")} meta={t("Records in SAP per object, with the share of its proposals.")} testId="cleansing-objects">
          <CcHBars
            label={t("Cleansed by object")}
            rows={[...now.objects]
              .map((o) => ({ o, total: waiting(o) + o.approved + cleaned(o) + o.rolled_back + o.rejected }))
              .sort((a, b) => cleaned(b.o) - cleaned(a.o))
              .map(({ o, total }) => {
                const pct = total ? (cleaned(o) / total) * 100 : 0;
                return {
                  key: o.object_type,
                  label: <span>{moduleText(o.object_type)} <Mono>{o.object_type}</Mono></span>,
                  value: cleaned(o),
                  text: t("{n} of {total}, {pct}%", { pct: f1(pct), n: int(cleaned(o)), total: int(total) }),
                  tone: "pass",
                };
              })}
          />
        </Panel>
      </div>

      <Rollbacks query={queue} />
      <Export />

      <Panel title={t("Audit trail")} meta={audit.data ? t("The last {n} decisions", { n: int(audit.data.items.length) }) : undefined} testId="cleansing-audit">
        {audit.isPending ? <Skeleton width="100%" height={120} /> : status(audit.error) === 403 ? (
          <Dash why={t("Your role cannot export, so the audit trail is hidden.")} />
        ) : audit.isError ? <Dash why={t("The audit trail could not be read.")} /> : audit.data.items.length === 0 ? (
          <EmptyFrame>{t("No decision has been recorded yet.")}</EmptyFrame>
        ) : (
          <ScrollFrame label={t("Audit trail table, scrollable")}>
            <table className="m2-tbl m2-cards">
              <thead>
                <tr>
                  <th scope="col">{t("When")}</th>
                  <th scope="col">{t("Decision")}</th>
                  <th scope="col">{t("Record")}</th>
                  <th scope="col">{t("Object")}</th>
                  <th scope="col">{t("By")}</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.items.map((a) => (
                  <tr key={a.id}>
                    <td data-label={t("When")}>{formatDate(a.created_at, "datetime")}</td>
                    <th scope="row" className="m2-card-lead">{ACTION[a.action]?.() ?? labelText(a.action)}</th>
                    <td data-label={t("Record")}>{a.record_key ? <Mono>{a.record_key}</Mono> : <Dash />}</td>
                    <td data-label={t("Object")}>{a.object_type ? moduleText(a.object_type) : <Dash />}</td>
                    <td data-label={t("By")}>{a.actor_name === "scheduler" ? t("Weekly task") : a.actor_name ?? <Dash />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Panel>

      <p className="m2-meta">
        {t("Whether the cleansed records stayed clean is tracked week by week on")} <V2Link href="/work/monitor">{t("Work, Monitor")}</V2Link>.
      </p>
    </CcPage>
  );
}

function Trend({ weeks }: { weeks: ReturnType<typeof weekly> }) {
  const points = weeks.map((w) => {
    const label = formatDate(w.period, "date");
    return { id: w.period, label, title: t("{label}: {n} cleansed", { label, n: int(cleaned(w.sums)) }), value: cleaned(w.sums) };
  });
  const top = Math.max(1, ...points.map((p) => p.value));
  const ticks = niceTicks(0, top, 4);
  return (
    <ChartFrame
      title={t("Records cleansed, week by week")}
      sub={t("Applied and verified at each weekly snapshot")}
      height={160}
      level={2}
      state={points.length < 2 ? "empty" : "ready"}
      empty={t("Two weekly snapshots are needed to draw a trend.")}
      testId="cleansing-trend"
      table={<ChartTable caption={t("Records cleansed by week")} head={[t("Week"), t("Cleansed")]} rows={points.map((p) => [p.label, int(p.value)])} />}
    >
      <TrendChart points={points} domain={[ticks[0], ticks[ticks.length - 1]] as const} ticks={ticks} height={160} label={t("Records cleansed by week")} yLabel={t("records")} format={int} />
    </ChartFrame>
  );
}

function Rollbacks({ query }: { query: ReturnType<typeof useCleaning<{ items: CleaningItem[]; total: number; readAt: number }>> }) {
  const { can } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const undo = useMutation({
    mutationFn: rollbackCleaning,
    onSuccess: () => {
      toast.show(t("The change was rolled back. SAP holds the earlier value again."));
      void qc.invalidateQueries({ queryKey: ["cleaning"] });
    },
    onError: (e) => toast.show(errorSentence(e, t("The change could not be rolled back.")), "error"),
  });
  const now = query.data?.readAt ?? 0;
  const items = query.data?.items ?? [];
  return (
    <Panel title={t("Applied changes you can still undo")} meta={query.data ? t("{n} applied, each can be rolled back for 72 hours", { n: int(query.data.total) }) : undefined} testId="cleansing-rollback">
      {query.isPending ? <Skeleton width="100%" height={120} /> : query.isError ? <Dash why={t("The applied changes could not be read.")} /> : items.length === 0 ? (
        <EmptyFrame>{t("No applied change is waiting out its rollback window.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={t("Applied changes table, scrollable")}>
          <table className="m2-tbl m2-cards">
            <thead>
              <tr>
                <th scope="col">{t("Record")}</th>
                <th scope="col">{t("Object")}</th>
                <th scope="col">{t("Change")}</th>
                <th scope="col">{t("Undo until")}</th>
                <th scope="col"><span className="m2-sr">{t("Action")}</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const deadline = i.rollback_deadline ? Date.parse(i.rollback_deadline) : NaN;
                const open = Number.isFinite(deadline) && deadline > now;
                return (
                  <tr key={i.id} data-testid={`cleansing-row-${i.id}`}>
                    <th scope="row" className="m2-card-lead"><Mono>{i.record_key}</Mono></th>
                    <td data-label={t("Object")}>{moduleText(i.object_type)}</td>
                    <td data-label={t("Change")}><Changes item={i} /></td>
                    <td data-label={t("Undo until")}>{i.rollback_deadline ? (open ? formatDate(i.rollback_deadline, "datetime") : t("Window closed")) : DASH}</td>
                    <td data-label={t("Action")}>
                      {can("apply") ? (
                        <button
                          type="button"
                          className="m2-btn"
                          disabled={!open || undo.isPending}
                          onClick={() => undo.mutate(i.id)}
                          data-testid={`cleansing-undo-${i.id}`}
                        >
                          {t("Roll back")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </Panel>
  );
}

const pct = (c: number | null | undefined) => (c == null ? DASH : t("{n}%", { n: int(Math.round(c * 100)) }));

/** What a group of proposals does: the rule's name, or the field it sets, or a merge or a link to the golden record. */
function what(g: CleaningGroup): ReactNode {
  if (g.rule_name) return g.rule_name;
  if (g.kind === "duplicate") return t("Merge duplicate records");
  if (g.kind === "match") return t("Link to the golden record");
  return <span><Mono>{g.kind}</Mono> {labelText(g.kind)}</span>;
}

function useDecide() {
  const toast = useToast();
  const qc = useQueryClient();
  const done = (msg: string) => () => {
    toast.show(msg);
    void qc.invalidateQueries({ queryKey: ["cleaning"] });
  };
  const fail = (msg: string) => (e: unknown) => toast.show(errorSentence(e, msg), "error");
  return {
    group: useMutation({
      mutationFn: (g: CleaningGroup) => approveGroup(g, CONFIDENT),
      onSuccess: (r) => done(t("{n} proposals approved. They are written to SAP when applied.", { n: int(r.approved_count) }))(),
      onError: fail(t("The proposals could not be approved.")),
    }),
    approve: useMutation({ mutationFn: approveProposal, onSuccess: done(t("The proposal was approved.")), onError: fail(t("The proposal could not be approved.")) }),
    reject: useMutation({
      mutationFn: async ({ item, reason }: { item: Proposal; reason: string }) => {
        const r = await rejectProposal(item.id, reason);
        // Teaches Aletheia which proposals stewards turn down; a failure here must not undo the rejection.
        await sendAiFeedback(item.id, item.object_type, reason).catch(() => undefined);
        return r;
      },
      onSuccess: done(t("The proposal was rejected. The reason is kept in the audit trail.")),
      onError: fail(t("The proposal could not be rejected.")),
    }),
    apply: useMutation({ mutationFn: applyProposal, onSuccess: done(t("The change was written to SAP. It can be rolled back for 72 hours.")), onError: fail(t("The change could not be applied.")) }),
  };
}

function Proposals() {
  const { can } = useV2Session();
  const groups = useCleaning("groups", getCleaningGroups);
  const approved = useCleaning("approved", () => getProposals({ status: "approved" }));
  const decide = useDecide();
  const [open, setOpen] = useState<string | null>(null);
  const key = (g: CleaningGroup) => `${g.version_id ?? ""}|${g.object_type}|${g.kind}`;
  const list = groups.data?.groups ?? [];
  return (
    <>
      <span id="cleansing-proposals" />
      <Panel
        title={t("Proposals to decide")}
        meta={groups.data ? t("{n} proposals in {g} groups, {c} at {p} confidence or more", { n: int(groups.data.records), g: int(list.length), c: int(groups.data.confident), p: pct(CONFIDENT) }) : undefined}
        testId="cleansing-proposals"
      >
        {groups.isPending ? <Skeleton width="100%" height={120} /> : status(groups.error) === 403 ? (
          <Dash why={t("Your role cannot see the cleansing proposals.")} />
        ) : groups.isError ? <Dash why={t("The proposals could not be read.")} /> : list.length === 0 ? (
          <EmptyFrame>{t("No proposal is waiting for a decision.")}</EmptyFrame>
        ) : (
          <ScrollFrame label={t("Proposals table, scrollable")}>
            <table className="m2-tbl m2-cards">
              <thead>
                <tr>
                  <th scope="col">{t("What it does")}</th>
                  <th scope="col">{t("Object")}</th>
                  <th scope="col">{t("Run")}</th>
                  <th scope="col" className="m2-num">{t("Records")}</th>
                  <th scope="col" className="m2-num">{t("Average confidence")}</th>
                  <th scope="col" className="m2-num">{t("Confident")}</th>
                  <th scope="col"><span className="m2-sr">{t("Action")}</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((g) => {
                  const k = key(g);
                  return [
                    <tr key={k} data-testid={`cleansing-group-${g.kind}`}>
                      <th scope="row" className="m2-card-lead">{what(g)}</th>
                      <td data-label={t("Object")}>{moduleText(g.object_type)} <Mono>{g.object_type}</Mono></td>
                      <td data-label={t("Run")}>{g.run_label ?? (g.run_at ? formatDate(g.run_at, "date") : DASH)}</td>
                      <td data-label={t("Records")} className="m2-num">{int(g.records)}</td>
                      <td data-label={t("Average confidence")} className="m2-num">{pct(g.avg_confidence)}</td>
                      <td data-label={t("Confident")} className="m2-num">{int(g.confident)}</td>
                      <td data-label={t("Action")} className="m2-row-actions">
                        {can("approve") ? (
                          <button type="button" className="m2-btn m2-next" disabled={!g.confident || decide.group.isPending} onClick={() => decide.group.mutate(g)} data-testid={`cleansing-approve-group-${g.kind}`}>
                            {t("Approve the {n} confident", { n: int(g.confident) })}
                          </button>
                        ) : null}
                        <button type="button" className="m2-btn" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)} data-testid={`cleansing-open-${g.kind}`}>
                          {open === k ? t("Close") : t("Open")}
                        </button>
                      </td>
                    </tr>,
                    open === k ? (
                      <tr key={`${k}-items`}>
                        <td colSpan={7}><GroupItems group={g} decide={decide} /></td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Panel>

      <Panel
        title={t("Approved, waiting to be written to SAP")}
        meta={approved.data ? t("{n} approved", { n: int(approved.data.total) }) : undefined}
        testId="cleansing-approved"
      >
        {approved.isPending ? <Skeleton width="100%" height={80} /> : approved.isError ? <Dash why={t("The approved proposals could not be read.")} /> : approved.data.items.length === 0 ? (
          <EmptyFrame>{t("No approved proposal is waiting to be applied.")}</EmptyFrame>
        ) : (
          <ScrollFrame label={t("Approved proposals table, scrollable")}>
            <table className="m2-tbl m2-cards">
              <thead>
                <tr>
                  <th scope="col">{t("Record")}</th>
                  <th scope="col">{t("Object")}</th>
                  <th scope="col">{t("Change")}</th>
                  <th scope="col" className="m2-num">{t("Confidence")}</th>
                  <th scope="col"><span className="m2-sr">{t("Action")}</span></th>
                </tr>
              </thead>
              <tbody>
                {approved.data.items.map((i) => (
                  <tr key={i.id} data-testid={`cleansing-approved-${i.id}`}>
                    <th scope="row" className="m2-card-lead"><Mono>{i.record_key}</Mono></th>
                    <td data-label={t("Object")}>{moduleText(i.object_type)}</td>
                    <td data-label={t("Change")}><Changes item={i} /></td>
                    <td data-label={t("Confidence")} className="m2-num">{pct(i.confidence)}</td>
                    <td data-label={t("Action")}>
                      {can("apply") ? (
                        <button type="button" className="m2-btn m2-next" disabled={decide.apply.isPending} onClick={() => decide.apply.mutate(i.id)} data-testid={`cleansing-apply-${i.id}`}>
                          {t("Write to SAP")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Panel>
    </>
  );
}

function GroupItems({ group, decide }: { group: CleaningGroup; decide: ReturnType<typeof useDecide> }) {
  const { can } = useV2Session();
  const items = useCleaning(`items-${group.version_id}-${group.kind}`, () => getProposals({ status: WAITING, version_id: group.version_id, kind: group.kind }));
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (items.isPending) return <Skeleton width="100%" height={80} />;
  if (items.isError) return <Dash why={t("The proposals in this group could not be read.")} />;
  const rows = items.data.items.filter((i) => i.object_type === group.object_type);
  if (!rows.length) return <EmptyFrame>{t("Every proposal in this group has been decided.")}</EmptyFrame>;
  return (
    <ul className="m2-cl-items" data-testid={`cleansing-items-${group.kind}`}>
      {rows.map((i) => (
        <li key={i.id} data-testid={`cleansing-item-${i.id}`}>
          <div><Mono>{i.record_key}</Mono> <span className="m2-meta">{t("{p} confidence", { p: pct(i.confidence) })}</span></div>
          <Changes item={i} />
          {can("approve") ? (
            rejecting === i.id ? (
              <form
                className="m2-row-actions"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!reason.trim()) return;
                  decide.reject.mutate({ item: i, reason: reason.trim() }, { onSuccess: () => { setRejecting(null); setReason(""); } });
                }}
              >
                <input className="m2-inp" aria-label={t("Why is this proposal wrong?")} placeholder={t("Why is this proposal wrong?")} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`cleansing-reason-${i.id}`} autoFocus />
                <button type="submit" className="m2-btn m2-next" disabled={!reason.trim() || decide.reject.isPending} data-testid={`cleansing-confirm-reject-${i.id}`}>{t("Reject")}</button>
                <button type="button" className="m2-btn" onClick={() => { setRejecting(null); setReason(""); }}>{t("Cancel")}</button>
              </form>
            ) : (
              <div className="m2-row-actions">
                <button type="button" className="m2-btn m2-next" disabled={decide.approve.isPending} onClick={() => decide.approve.mutate(i.id)} data-testid={`cleansing-approve-${i.id}`}>{t("Approve")}</button>
                <button type="button" className="m2-btn" onClick={() => { setRejecting(i.id); setReason(""); }} data-testid={`cleansing-reject-${i.id}`}>{t("Reject")}</button>
              </div>
            )
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Duplicates() {
  const { can } = useV2Session();
  const pairs = useCleaning("dedup", getDedupCandidates);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel title={t("Duplicate records to merge")} meta={pairs.data ? t("{n} pairs the cleaning engine found to be the same record", { n: int(pairs.data.total) }) : undefined} testId="cleansing-dedup">
      {pairs.isPending ? <Skeleton width="100%" height={80} /> : status(pairs.error) === 403 ? (
        <Dash why={t("Your role cannot see the duplicate records.")} />
      ) : pairs.isError ? <Dash why={t("The duplicate records could not be read.")} /> : pairs.data.items.length === 0 ? (
        <EmptyFrame>{t("No duplicate pair is waiting to be merged.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={t("Duplicate records table, scrollable")}>
          <table className="m2-tbl m2-cards">
            <thead>
              <tr>
                <th scope="col">{t("Records")}</th>
                <th scope="col">{t("Object")}</th>
                <th scope="col">{t("Matched on")}</th>
                <th scope="col" className="m2-num">{t("Match score")}</th>
                <th scope="col"><span className="m2-sr">{t("Action")}</span></th>
              </tr>
            </thead>
            <tbody>
              {pairs.data.items.map((c) => [
                <tr key={c.id} data-testid={`cleansing-dedup-${c.id}`}>
                  <th scope="row" className="m2-card-lead"><Mono>{c.record_key_a}</Mono> {t("and")} <Mono>{c.record_key_b}</Mono></th>
                  <td data-label={t("Object")}>{moduleText(c.object_type)}</td>
                  <td data-label={t("Matched on")}>
                    {Object.keys(c.match_fields ?? {}).length ? Object.keys(c.match_fields ?? {}).map((f, i) => <span key={f}>{i ? ", " : ""}<Mono>{f}</Mono> {labelText(f)}</span>) : <Dash />}
                  </td>
                  <td data-label={t("Match score")} className="m2-num">{f1(c.match_score)}</td>
                  <td data-label={t("Action")}>
                    <button type="button" className="m2-btn" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)} data-testid={`cleansing-dedup-open-${c.id}`}>
                      {open === c.id ? t("Close") : can("approve") ? t("Compare and merge") : t("Compare")}
                    </button>
                  </td>
                </tr>,
                open === c.id ? (
                  <tr key={`${c.id}-merge`}>
                    <td colSpan={5}><Merge pair={c} onDone={() => setOpen(null)} /></td>
                  </tr>
                ) : null,
              ])}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </Panel>
  );
}

function Merge({ pair, onDone }: { pair: DedupCandidate; onDone: () => void }) {
  const { can } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const fixture = useFixture();
  const fields = useQuery({ queryKey: ["cleaning", fixture, "dedup-preview", pair.id], queryFn: () => previewDedup(pair), staleTime: 60_000 });
  const [survivor, setSurvivor] = useState(pair.record_key_a);
  const [reason, setReason] = useState("");
  const merge = useMutation({
    mutationFn: () => mergeDedup(pair.id, survivor, reason.trim()),
    onSuccess: () => {
      toast.show(t("{b} was merged into {a}.", { a: survivor, b: survivor === pair.record_key_a ? pair.record_key_b : pair.record_key_a }));
      void qc.invalidateQueries({ queryKey: ["cleaning"] });
      onDone();
    },
    onError: (e) => toast.show(errorSentence(e, t("The records could not be merged.")), "error"),
  });
  if (fields.isPending) return <Skeleton width="100%" height={80} />;
  if (fields.isError) return <Dash why={t("The two records could not be compared.")} />;
  const rows = Object.entries(fields.data.merge_preview);
  return (
    <div data-testid={`cleansing-dedup-merge-${pair.id}`}>
      {rows.length ? (
        <table className="m2-tbl">
          <thead>
            <tr>
              <th scope="col">{t("Field")}</th>
              <th scope="col"><Mono>{pair.record_key_a}</Mono></th>
              <th scope="col"><Mono>{pair.record_key_b}</Mono></th>
              <th scope="col">{t("Suggested value")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([f, v]) => (
              <tr key={f}>
                <th scope="row"><Mono>{f}</Mono> {labelText(f)}</th>
                <td>{v.a || <Dash />}</td>
                <td>{v.b || <Dash />}</td>
                <td>{v.survivor || <Dash />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Dash why={t("The cleaning queue holds no data for these records.")} />}
      {can("approve") ? (
        <form
          className="m2-row-actions"
          onSubmit={(e) => { e.preventDefault(); if (reason.trim()) merge.mutate(); }}
        >
          <fieldset className="m2-row-actions">
            <legend className="m2-meta">{t("Keep")}</legend>
            {[pair.record_key_a, pair.record_key_b].map((k) => (
              <label key={k}>
                <input type="radio" name={`survivor-${pair.id}`} checked={survivor === k} onChange={() => setSurvivor(k)} data-testid={`cleansing-dedup-keep-${k}`} /> <Mono>{k}</Mono>
              </label>
            ))}
          </fieldset>
          <input className="m2-inp" aria-label={t("Why are these the same record?")} placeholder={t("Why are these the same record?")} value={reason} onChange={(e) => setReason(e.target.value)} data-testid={`cleansing-dedup-reason-${pair.id}`} />
          <button type="submit" className="m2-btn m2-next" disabled={!reason.trim() || merge.isPending} data-testid={`cleansing-dedup-merge-btn-${pair.id}`}>{t("Merge")}</button>
        </form>
      ) : null}
    </div>
  );
}

function Changes({ item }: { item: CleaningItem }) {
  const rows = changed(item.record_data_before, item.record_data_after);
  if (!rows.length) return <Dash />;
  return (
    <ul className="m2-cl-changes">
      {rows.map((r) => (
        <li key={r.field}>
          <Mono>{r.field}</Mono> {labelText(r.field)}: <s>{r.from || t("blank")}</s> {t("to")} <strong>{r.to || t("blank")}</strong>
        </li>
      ))}
    </ul>
  );
}

const FORMAT: Record<ExportFormat, () => string> = {
  csv: () => t("CSV for review, with the record key"),
  xlsx: () => t("Excel for review, one sheet per object"),
  lsmw: () => t("LSMW load file"),
  bapi: () => t("BAPI calls (JSON)"),
  idoc: () => t("IDoc segments (JSON)"),
  sf_csv: () => t("SuccessFactors import CSV"),
};

/** The corrected records as a file to review or to load into SAP, for one status and one object or all of them. */
function Export() {
  const { can } = useV2Session();
  const allowed = can("export");
  const fixture = useFixture();
  const toast = useToast();
  const opts = useQuery({ queryKey: ["cleaning", fixture, "export-options"], queryFn: getExportOptions, enabled: allowed, staleTime: 60_000 });
  const [picked, setPicked] = useState<string | null>(null);
  const [object, setObject] = useState("");
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const save = useMutation({
    mutationFn: (st: string) => exportCleaning(format, st, object || undefined),
    onSuccess: (name) => toast.show(t("Saved {name}.", { name })),
    onError: (e) => toast.show(errorSentence(e, t("The file could not be built.")), "error"),
  });
  if (!allowed) return null;
  const statuses = opts.data?.statuses ?? [];
  const st = picked ?? (statuses.find((x) => x.value === "approved") ?? statuses[0])?.value ?? "";
  const label = (v: string) => ACTION[v]?.() ?? labelText(v);
  return (
    <Panel title={t("Export the corrected records")} meta={t("A file to review, or to load into SAP with LSMW, a BAPI or IDocs. Nothing changes in SAP until the file is loaded.")} testId="cleansing-export">
      {opts.isPending ? <Skeleton width="100%" height={60} /> : opts.isError ? <Dash why={t("The export options could not be read.")} /> : statuses.length === 0 ? (
        <EmptyFrame>{t("The cleansing queue is empty, so there is nothing to export.")}</EmptyFrame>
      ) : (
        <form className="m2-fbar" aria-label={t("Export the corrected records")} onSubmit={(e) => { e.preventDefault(); save.mutate(st); }}>
          <Fld label={t("Status")}>
            <select value={st} onChange={(e) => setPicked(e.target.value)}>
              {statuses.map((x) => <option key={x.value} value={x.value}>{t("{label} ({n})", { label: label(x.value), n: int(x.count) })}</option>)}
            </select>
          </Fld>
          <Fld label={t("Object")}>
            <select value={object} onChange={(e) => setObject(e.target.value)}>
              <option value="">{t("All objects")}</option>
              {(opts.data?.object_types ?? []).map((x) => <option key={x.value} value={x.value}>{t("{label} {code} ({n})", { label: moduleText(x.value), code: x.value, n: int(x.count) })}</option>)}
            </select>
          </Fld>
          <Fld label={t("Format")}>
            <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
              {EXPORT_FORMATS.map((f) => <option key={f} value={f}>{FORMAT[f]()}</option>)}
            </select>
          </Fld>
          <button type="submit" className="m2-btn" disabled={!st || save.isPending}>{save.isPending ? t("Building the file…") : t("Download")}</button>
        </form>
      )}
    </Panel>
  );
}

function Panel({ title, meta, testId, children }: { title: string; meta?: string; testId: string; children: ReactNode }) {
  return (
    <section className="m2-ck-panel" aria-label={title} data-testid={testId}>
      <header className="m2-ck-head">
        <h2 className="m2-h2">{title}</h2>
        {meta ? <span className="m2-meta">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}
