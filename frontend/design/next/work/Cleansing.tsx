"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { DASH, f1, int, moduleSlug } from "@/lib/v2/score";
import { formatDate } from "@/lib/format";
import { getBackAfterClean } from "@/lib/api/remediation";
import { queryKeys } from "@/lib/query-keys";
import { downloadCleaningWorkbook } from "@/lib/api/v2/roundtrip";
import { useLandscape } from "@/lib/v2/queries";
import { getBatches, reassignBatch, type BatchRowApi } from "@/lib/api/v2/batches";
import { useAssignable } from "@/lib/v2/approvals-queries";
import type { DdicEvidence } from "@/lib/api/v2/dq-firewall";
import {
  applyProposal,
  approveGroup,
  approveProposal,
  CONFIDENT,
  EXPORT_FORMATS,
  exportCleaning,
  getAppliedCleaning,
  getCleaningAudit,
  getCleaningGroups,
  getCleaningMetrics,
  getCleaningSafety,
  getDedupCandidates,
  getDedupCandidatesFor,
  getExportOptions,
  getProposals,
  mergeDedup,
  previewDedup,
  rejectGroup,
  rejectProposal,
  rollbackCleaning,
  sendAiFeedback,
  WAITING,
  type CleaningGroup,
  type CleaningItem,
  type CleaningMetric,
  type DedupCandidate,
  type ExportFormat,
  type Proposal,
  type RecordData,
  type SafetyItem,
} from "@/lib/api/v2/cleaning";
import { Button, Chip, Code, EmptyState, ErrorState, SegmentedControl, Sheet, Skeleton, useToast } from "../kit";
import { AreaTrend, StackedBar } from "../viz";
import { FixApproveFlow } from "../flows/FixApproveFlow";
import { Approvals } from "../screens/Approvals";
import "./approvals-seg.css";

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

/** The weekly snapshots, oldest first, each summed over its objects. */
export function weekly(metrics: readonly CleaningMetric[]): { period: string; sums: Sums; objects: CleaningMetric[] }[] {
  const by = new Map<string, CleaningMetric[]>();
  for (const m of metrics) by.set(m.period, [...(by.get(m.period) ?? []), m]);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, objects]) => ({ period, sums: objects.reduce(add, ZERO), objects }));
}

/** The fields a proposal changes, with the value before and after. */
export function changed(before: RecordData, after: RecordData): { field: string; from: string; to: string }[] {
  const b = before ?? {};
  const a = after ?? {};
  const text = (v: unknown) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => text(b[k]) !== text(a[k])).map((k) => ({ field: k, from: text(b[k]), to: text(a[k]) }));
}

/** The worst SAP verdict over the checked values of one proposal; null when none was checked. */
export function worstVerdict(items: readonly SafetyItem[] | undefined, id: string): SafetyItem["verdict"] | null {
  const mine = (items ?? []).filter((x) => x.id === id);
  if (!mine.length) return null;
  return mine.some((x) => x.verdict === "reject") ? "reject" : mine.some((x) => x.verdict === "unknown") ? "unknown" : "safe";
}

function useCleaning<T>(name: string, fn: () => Promise<T>, enabled = true) {
  const fixture = useFixture();
  return useQuery({
    queryKey: ["cleaning", fixture, name],
    queryFn: fn,
    enabled,
    staleTime: 60_000,
    retry: (n, e) => {
      const s = status(e);
      return s !== 403 && s !== 404 && n < 2;
    },
  });
}

const pct = (c: number | null | undefined) => (c == null ? DASH : t("{n}%", { n: int(Math.round(c * 100)) }));

function Panel({ title, meta, testId, children }: { title: string; meta?: ReactNode; testId: string; children: ReactNode }) {
  return (
    <section className="nx-aps-sheet" aria-label={title} data-testid={testId}>
      <header className="nx-aps-head">
        <h2>{title}</h2>
        {meta ? <span className="nx-aps-meta">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Changes({ before, after }: { before: RecordData; after: RecordData }) {
  const rows = changed(before, after);
  if (!rows.length) return <>{DASH}</>;
  return (
    <ul className="nx-aps-changes">
      {rows.map((r) => (
        <li key={r.field}>
          <Code code={r.field} text={labelText(r.field)} /> <s>{r.from || t("blank")}</s> {t("to")} <strong>{r.to || t("blank")}</strong>
        </li>
      ))}
    </ul>
  );
}

function SafetyBadge({ verdict }: { verdict: SafetyItem["verdict"] | null }) {
  const tone = verdict === "safe" ? "good" : verdict === "reject" ? "bad" : "neutral";
  const word = verdict === "safe" ? t("SAP accepts it") : verdict === "reject" ? t("SAP would reject it") : t("Not checked");
  return (
    <span data-testid="ddic-verdict">
      <Chip tone={tone}>{word}</Chip>
    </span>
  );
}

function sourceWord(e: DdicEvidence): string {
  if (!e.check_table) return t("no check table");
  if (e.source === "live") return t("check table {table}, read from the system", { table: e.check_table });
  if (e.source === "baseline") return t("check table {table}, SAP-standard values", { table: e.check_table });
  return t("check table {table}, not read", { table: e.check_table });
}

function DdicCard({ evidence }: { evidence: DdicEvidence | null | undefined }) {
  if (!evidence) return <span title={t("The SAP dictionary does not know this field.")}>{DASH}</span>;
  const e = evidence;
  const size = e.type ? `${e.type} ${e.length ?? ""}${e.decimals ? `,${e.decimals}` : ""}`.trim() : null;
  const meta = [e.data_element ? t("data element {de}", { de: e.data_element }) : null, e.domain ? t("domain {d}", { d: e.domain }) : null, size, sourceWord(e)].filter(Boolean).join(", ");
  return (
    <div data-testid="ddic-card">
      <Code code={e.field} text={e.field_text ?? undefined} /> <span className="nx-aps-meta">{meta}</span>
      {e.reasons?.length ? (
        <ul data-testid="ddic-reasons">
          {e.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {e.nearest?.length ? (
        <div data-testid="ddic-nearest">
          {t("Did you mean")}{" "}
          {e.nearest.map((n) => (
            <Code key={n.code} code={n.code} text={n.text ?? undefined} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Table({ label, head, children }: { label: string; head: ReactNode; children: ReactNode }) {
  return (
    <div className="nx-table-scroll" role="region" tabIndex={0} aria-label={label}>
      <table className="nx-table">
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const sr = (text: string) => (
  <th>
    <span className="nx-sr">{text}</span>
  </th>
);

function useDecide() {
  const qc = useQueryClient();
  const toast = useToast();
  const session = useV2Session();
  const done = () => qc.invalidateQueries({ queryKey: ["cleaning"] });
  const fail = (fallback: string) => (e: unknown) => toast({ text: errorSentence(e, fallback), tone: "bad" });
  return {
    group: useMutation({
      mutationFn: (g: CleaningGroup) => approveGroup(g, CONFIDENT),
      onSuccess: (r) => {
        toast({ text: t("{n} proposals approved. Export them as a load file and load it in SAP.", { n: int(r.approved_count) }), tone: "good" });
        void done();
      },
      onError: fail(t("The proposals could not be approved.")),
    }),
    rejectAll: useMutation({
      mutationFn: ({ g, reason }: { g: CleaningGroup; reason: string }) => rejectGroup(g, reason),
      onSuccess: (r) => {
        toast({ text: t("{n} proposals rejected. The reason is kept in the audit trail.", { n: int(r.rejected_count) }), tone: "good" });
        void done();
      },
      onError: fail(t("The proposals could not be rejected.")),
    }),
    approve: useMutation({
      mutationFn: (id: string) => approveProposal(id),
      onSuccess: () => {
        toast({ text: t("The proposal was approved."), tone: "good" });
        void done();
      },
      onError: fail(t("The proposal could not be approved.")),
    }),
    reject: useMutation({
      mutationFn: async ({ item, reason }: { item: CleaningItem; reason: string }) => {
        await rejectProposal(item.id, reason);
        if (session.can("ai_feedback")) await sendAiFeedback(item.id, item.object_type, reason).catch(() => undefined);
      },
      onSuccess: () => {
        toast({ text: t("The proposal was rejected. The reason is kept in the audit trail."), tone: "good" });
        void done();
      },
      onError: fail(t("The proposal could not be rejected.")),
    }),
    apply: useMutation({
      mutationFn: (id: string) => applyProposal(id),
      onSuccess: () => {
        toast({ text: t("Marked as loaded in SAP. The next run checks the record. The mark can be undone for 72 hours."), tone: "good" });
        void done();
      },
      onError: fail(t("The change could not be marked as loaded.")),
    }),
  };
}

function what(g: CleaningGroup): ReactNode {
  if (g.rule_name) return g.rule_name;
  if (g.kind === "duplicate") return t("Merge duplicate records");
  if (g.kind === "match") return t("Link to the golden record");
  return <Code code={g.kind} text={labelText(g.kind)} />;
}

function GroupItems({ g }: { g: CleaningGroup }) {
  const session = useV2Session();
  const decide = useDecide();
  const items = useCleaning(`items-${g.version_id}-${g.kind}`, () => getProposals({ status: WAITING, version_id: g.version_id, kind: g.kind }));
  const safety = useCleaning("safety", getCleaningSafety);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (items.isPending) return <Skeleton lines={3} label={t("Proposals to decide")} />;
  if (items.isError) return <ErrorState sentence={t("The proposals in this group could not be read.")} onRetry={() => void items.refetch()} />;
  const rows = items.data.items.filter((p) => p.object_type === g.object_type);
  if (!rows.length) return <EmptyState heading={t("Every proposal in this group has been decided.")} />;
  const pending = decide.approve.isPending || decide.reject.isPending;
  return (
    <ul className="nx-aps-items" data-testid={`cleansing-items-${g.kind}`}>
      {rows.map((p) => (
        <li key={p.id} data-testid={`cleansing-item-${p.id}`}>
          <Code code={p.record_key} /> {t("{p} confidence", { p: pct(p.confidence) })} <SafetyBadge verdict={worstVerdict(safety.data?.items, p.id)} />
          <Changes before={p.record_data_before} after={p.record_data_after} />
          {session.can("approve") ? (
            rejecting === p.id ? (
              <form
                className="nx-aps-form"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  const r = reason.trim();
                  if (r) decide.reject.mutate({ item: p, reason: r }, { onSuccess: () => { setRejecting(null); setReason(""); } });
                }}
              >
                <input className="nx-input" aria-label={t("Why is this proposal wrong?")} placeholder={t("Why is this proposal wrong?")} data-testid={`cleansing-reason-${p.id}`} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                <Button type="submit" size={32} variant="danger" data-testid={`cleansing-confirm-reject-${p.id}`} disabled={!reason.trim() || pending}>{t("Reject")}</Button>
                <Button type="button" size={32} variant="quiet" onClick={() => setRejecting(null)}>{t("Cancel")}</Button>
              </form>
            ) : (
              <span className="nx-aps-acts">
                <Button size={32} data-testid={`cleansing-approve-${p.id}`} disabled={pending} onClick={() => decide.approve.mutate(p.id)}>{t("Approve")}</Button>
                <Button size={32} variant="quiet" data-testid={`cleansing-reject-${p.id}`} onClick={() => { setRejecting(p.id); setReason(""); }}>{t("Reject")}</Button>
              </span>
            )
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Approved({ query }: { query: ReturnType<typeof useCleaning<{ items: Proposal[]; total: number }>> }) {
  const session = useV2Session();
  const decide = useDecide();
  const title = t("Approved, waiting to be loaded in SAP");
  let body: ReactNode;
  if (query.isPending) body = <Skeleton lines={3} label={title} />;
  else if (query.isError) body = <ErrorState sentence={t("The approved proposals could not be read.")} onRetry={() => void query.refetch()} />;
  else if (!query.data.items.length) body = <EmptyState heading={t("No approved proposal is waiting to be loaded.")} />;
  else
    body = (
      <Table label={t("Approved proposals table, scrollable")} head={<><th>{t("Record")}</th><th>{t("Object")}</th><th>{t("Change")}</th><th>{t("Confidence")}</th>{sr(t("Action"))}</>}>
        {query.data.items.map((p) => (
          <tr key={p.id} data-testid={`cleansing-approved-${p.id}`}>
            <td><Code code={p.record_key} /></td>
            <td>{moduleText(p.object_type)}</td>
            <td><Changes before={p.record_data_before} after={p.record_data_after} /></td>
            <td>{pct(p.confidence)}</td>
            <td>
              {!session.can("apply") ? null : p.approved_by && p.approved_by === session.id ? (
                <span data-testid={`cleansing-second-${p.id}`}>{t("Waits for a second person")}</span>
              ) : (
                <Button size={32} variant="secondary" data-testid={`cleansing-apply-${p.id}`} disabled={decide.apply.isPending} onClick={() => decide.apply.mutate(p.id)}>{t("Mark as loaded in SAP")}</Button>
              )}
            </td>
          </tr>
        ))}
      </Table>
    );
  return (
    <Panel title={title} meta={query.data ? t("{n} approved", { n: int(query.data.items.length) }) : undefined} testId="cleansing-approved">
      <p>{t("Meridian does not change SAP from here. Export the approved changes as a load file, load it in SAP, then mark each change loaded. The person who approved a change cannot mark it.")}</p>
      {body}
    </Panel>
  );
}

function Proposals() {
  const session = useV2Session();
  const decide = useDecide();
  const groups = useCleaning("groups", getCleaningGroups);
  const approved = useCleaning("approved", () => getProposals({ status: "approved" }));
  const [open, setOpen] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const keyOf = (g: CleaningGroup) => `${g.version_id ?? ""}|${g.object_type}|${g.kind}`;
  const title = t("Proposals to decide");
  let body: ReactNode;
  if (groups.isPending) body = <Skeleton lines={4} label={title} />;
  else if (groups.isError)
    body = status(groups.error) === 403 ? <EmptyState icon="info" heading={t("Your role cannot see the cleansing proposals.")} /> : <ErrorState sentence={t("The proposals could not be read.")} onRetry={() => void groups.refetch()} />;
  else if (!groups.data.groups.length) body = <EmptyState heading={t("No proposal is waiting for a decision. New proposals appear after the next cleansing task has run.")} />;
  else {
    const pending = decide.group.isPending || decide.rejectAll.isPending;
    body = (
      <Table
        label={t("Proposals table, scrollable")}
        head={<><th>{t("What it does")}</th><th>{t("Object")}</th><th>{t("Run")}</th><th>{t("Records")}</th><th>{t("Average confidence")}</th><th>{t("Confident")}</th>{sr(t("Action"))}</>}
      >
        {groups.data.groups.map((g) => {
          const k = keyOf(g);
          return [
            <tr key={k} data-testid={`cleansing-group-${g.kind}`}>
              <td>{what(g)}</td>
              <td>{moduleText(g.object_type)} <Code code={g.object_type} /></td>
              <td>{g.run_label ?? (g.run_at ? formatDate(g.run_at, "date") : DASH)}</td>
              <td>{int(g.records)}</td>
              <td>{pct(g.avg_confidence)}</td>
              <td>{int(g.confident)}</td>
              <td>
                <span className="nx-aps-acts">
                  {session.can("approve") ? (
                    <>
                      <Button size={32} data-testid={`cleansing-approve-group-${g.kind}`} disabled={!g.confident || pending} onClick={() => decide.group.mutate(g)}>
                        {t("Approve the {n} confident", { n: int(g.confident) })}
                      </Button>
                      <Button size={32} variant="quiet" data-testid={`cleansing-reject-group-${g.kind}`} onClick={() => { setRejecting(rejecting === k ? null : k); setReason(""); }}>
                        {t("Reject the group")}
                      </Button>
                    </>
                  ) : null}
                  <Button size={32} variant="secondary" data-testid={`cleansing-open-${g.kind}`} aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>
                    {open === k ? t("Close") : t("Open")}
                  </Button>
                </span>
              </td>
            </tr>,
            rejecting === k ? (
              <tr key={`${k}-reject`}>
                <td colSpan={7}>
                  <form
                    className="nx-aps-form"
                    onSubmit={(e: FormEvent) => {
                      e.preventDefault();
                      const r = reason.trim();
                      if (r) decide.rejectAll.mutate({ g, reason: r }, { onSuccess: () => { setRejecting(null); setReason(""); } });
                    }}
                  >
                    <input className="nx-input" aria-label={t("Why are these proposals wrong?")} placeholder={t("Why are these proposals wrong?")} data-testid={`cleansing-group-reason-${g.kind}`} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                    <Button type="submit" size={32} variant="danger" data-testid={`cleansing-confirm-reject-group-${g.kind}`} disabled={!reason.trim() || pending}>{t("Reject")}</Button>
                    <Button type="button" size={32} variant="quiet" onClick={() => setRejecting(null)}>{t("Cancel")}</Button>
                  </form>
                </td>
              </tr>
            ) : null,
            open === k ? (
              <tr key={`${k}-items`}>
                <td colSpan={7}>
                  <GroupItems g={g} />
                </td>
              </tr>
            ) : null,
          ];
        })}
      </Table>
    );
  }
  return (
    <>
      <span id="cleansing-proposals" />
      <Panel
        title={title}
        meta={groups.data ? t("{n} proposals in {g} groups, {c} at {p} confidence or more", { n: int(groups.data.records), g: int(groups.data.groups.length), c: int(groups.data.confident), p: pct(CONFIDENT) }) : undefined}
        testId="cleansing-proposals"
      >
        <p>{t("Approving only marks a proposal as accepted. SAP is not changed until you write it in the next step.")}</p>
        {body}
      </Panel>
      <Approved query={approved} />
    </>
  );
}

function Safety() {
  const q = useCleaning("safety", getCleaningSafety);
  const title = t("Would SAP accept the new values");
  let body: ReactNode;
  if (q.isPending) body = <Skeleton lines={3} label={title} />;
  else if (q.isError && status(q.error) === 403) body = <EmptyState icon="info" heading={t("Your role cannot see the cleansing proposals.")} />;
  else if (q.isError || !q.data?.totals) body = <ErrorState sentence={t("The safety check could not be read.")} onRetry={() => void q.refetch()} />;
  else if (q.data.totals.checked === 0) body = <EmptyState heading={t("No waiting proposal has a new value to check.")} />;
  else {
    const s = q.data.totals;
    body = (
      <>
        <p role="status" data-testid="cleansing-safety-banner">
          {t("{safe} of {checked} new values are safe to apply, {reject} would be rejected by SAP, {unknown} not checked.", { safe: int(s.safe), checked: int(s.checked), reject: int(s.reject), unknown: int(s.unknown) })}
          {q.data.truncated ? <> {t("Only the first proposals were checked.")}</> : null}
        </p>
        <Table label={t("Safety table, scrollable")} head={<><th>{t("Record")}</th><th>{t("Object")}</th><th>{t("New value")}</th><th>{t("Verdict")}</th><th>{t("SAP dictionary")}</th></>}>
          {q.data.items.map((x) => (
            <tr key={`${x.id}:${x.field ?? ""}:${x.value ?? ""}`} data-testid={`cleansing-safety-${x.id}`}>
              <td><Code code={x.record_key ?? x.id} /></td>
              <td>{x.object_type ? moduleText(x.object_type) : DASH}</td>
              <td>{x.field ? <Code code={x.field} /> : null} {x.value != null ? <Code code={x.value} /> : DASH}</td>
              <td><SafetyBadge verdict={x.verdict} /></td>
              <td>{x.evidence ? <DdicCard evidence={x.evidence} /> : x.reasons.join(" ")}</td>
            </tr>
          ))}
        </Table>
      </>
    );
  }
  return (
    <Panel title={title} meta={t("Each new value checked against the SAP dictionary of the target system: type, length, fixed values and check table.")} testId="cleansing-safety">
      {body}
    </Panel>
  );
}

type AppliedQuery = ReturnType<typeof useCleaning<{ items: CleaningItem[]; total: number; readAt: number }>>;

function Rollbacks({ query }: { query: AppliedQuery }) {
  const session = useV2Session();
  const qc = useQueryClient();
  const toast = useToast();
  const undo = useMutation({
    mutationFn: (id: string) => rollbackCleaning(id),
    onSuccess: () => {
      toast({ text: t("The change was rolled back. SAP holds the earlier value again."), tone: "good" });
      void qc.invalidateQueries({ queryKey: ["cleaning"] });
    },
    onError: (e) => toast({ text: errorSentence(e, t("The change could not be rolled back.")), tone: "bad" }),
  });
  const title = t("Applied changes you can still undo");
  let body: ReactNode;
  if (query.isPending) body = <Skeleton lines={3} label={title} />;
  else if (query.isError) body = <ErrorState sentence={t("The applied changes could not be read.")} onRetry={() => void query.refetch()} />;
  else if (!query.data.items.length) body = <EmptyState heading={t("No applied change is waiting out its rollback window.")} />;
  else {
    const now = query.data.readAt;
    body = (
      <Table label={t("Applied changes table, scrollable")} head={<><th>{t("Record")}</th><th>{t("Object")}</th><th>{t("Change")}</th><th>{t("Undo until")}</th>{sr(t("Action"))}</>}>
        {query.data.items.map((i) => {
          const deadline = i.rollback_deadline ? Date.parse(i.rollback_deadline) : NaN;
          const open = Number.isFinite(deadline) && deadline > now;
          return (
            <tr key={i.id} data-testid={`cleansing-row-${i.id}`}>
              <td><Code code={i.record_key} /></td>
              <td>{moduleText(i.object_type)}</td>
              <td><Changes before={i.record_data_before} after={i.record_data_after} /></td>
              <td>{i.rollback_deadline ? (open ? formatDate(i.rollback_deadline, "datetime") : t("Window closed")) : DASH}</td>
              <td>
                {session.can("apply") ? (
                  <Button size={32} variant="secondary" data-testid={`cleansing-undo-${i.id}`} disabled={!open || undo.isPending} onClick={() => undo.mutate(i.id)}>{t("Roll back")}</Button>
                ) : null}
              </td>
            </tr>
          );
        })}
      </Table>
    );
  }
  return (
    <Panel title={title} meta={query.data ? t("{n} applied, each can be rolled back for 72 hours", { n: int(query.data.items.length) }) : undefined} testId="cleansing-rollback">
      {body}
    </Panel>
  );
}

function Merge({ pair, onDone }: { pair: DedupCandidate; onDone: () => void }) {
  const session = useV2Session();
  const fixture = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const preview = useQuery({ queryKey: ["cleaning", fixture, "dedup-preview", pair.id], queryFn: () => previewDedup(pair), staleTime: 60_000 });
  const [survivor, setSurvivor] = useState(pair.record_key_a);
  const [reason, setReason] = useState("");
  const merge = useMutation({
    mutationFn: () => mergeDedup(pair.id, survivor, reason.trim()),
    onSuccess: () => {
      const other = survivor === pair.record_key_a ? pair.record_key_b : pair.record_key_a;
      toast({ text: t("{b} was merged into {a}.", { a: survivor, b: other }), tone: "good" });
      void qc.invalidateQueries({ queryKey: ["cleaning"] });
      onDone();
    },
    onError: (e) => toast({ text: errorSentence(e, t("The records could not be merged.")), tone: "bad" }),
  });
  if (preview.isPending) return <Skeleton lines={3} label={t("Duplicate records to merge")} />;
  if (preview.isError) return <ErrorState sentence={t("The two records could not be compared.")} onRetry={() => void preview.refetch()} />;
  const rows = Object.entries(preview.data.merge_preview ?? {});
  return (
    <div data-testid={`cleansing-dedup-merge-${pair.id}`}>
      <p>{t("Merging keeps the record you pick as the survivor and folds the other into it.")}</p>
      {rows.length ? (
        <Table label={t("Duplicate records table, scrollable")} head={<><th>{t("Field")}</th><th><Code code={pair.record_key_a} /></th><th><Code code={pair.record_key_b} /></th><th>{t("Suggested value")}</th></>}>
          {rows.map(([f, v]) => (
            <tr key={f}>
              <td><Code code={f} text={labelText(f)} /></td>
              <td>{v.a || DASH}</td>
              <td>{v.b || DASH}</td>
              <td>{v.survivor || DASH}</td>
            </tr>
          ))}
        </Table>
      ) : (
        <p>{t("The cleaning queue holds no data for these records.")}</p>
      )}
      {session.can("approve") ? (
        <form
          className="nx-aps-form"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (reason.trim()) merge.mutate();
          }}
        >
          <fieldset>
            <legend>{t("Keep")}</legend>
            {[pair.record_key_a, pair.record_key_b].map((k) => (
              <label key={k}>
                <input type="radio" name={`survivor-${pair.id}`} value={k} checked={survivor === k} onChange={() => setSurvivor(k)} data-testid={`cleansing-dedup-keep-${k}`} /> <Code code={k} />
              </label>
            ))}
          </fieldset>
          <input className="nx-input" aria-label={t("Why are these the same record?")} placeholder={t("Why are these the same record?")} data-testid={`cleansing-dedup-reason-${pair.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button type="submit" size={32} data-testid={`cleansing-dedup-merge-btn-${pair.id}`} disabled={!reason.trim() || merge.isPending}>{t("Merge")}</Button>
        </form>
      ) : null}
    </div>
  );
}

function Duplicates() {
  const session = useV2Session();
  const [objectType, setObjectType] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const all = useCleaning("dedup", getDedupCandidates);
  const one = useCleaning(`dedup-${objectType}`, () => getDedupCandidatesFor(objectType), !!objectType);
  const pairs = objectType ? one : all;
  const types = [...new Set((all.data?.items ?? []).map((p) => p.object_type))].sort();
  const title = t("Duplicate records to merge");
  let body: ReactNode;
  if (pairs.isPending) body = <Skeleton lines={3} label={title} />;
  else if (pairs.isError)
    body = status(pairs.error) === 403 ? <EmptyState icon="info" heading={t("Your role cannot see the duplicate records.")} /> : <ErrorState sentence={t("The duplicate records could not be read.")} onRetry={() => void pairs.refetch()} />;
  else if (!pairs.data.items.length) body = <EmptyState heading={t("No duplicate pair is waiting to be merged.")} />;
  else
    body = (
      <Table label={t("Duplicate records table, scrollable")} head={<><th>{t("Records")}</th><th>{t("Object")}</th><th>{t("Matched on")}</th><th>{t("Match score")}</th>{sr(t("Action"))}</>}>
        {pairs.data.items.map((p) => [
          <tr key={p.id} data-testid={`cleansing-dedup-${p.id}`}>
            <td><Code code={p.record_key_a} /> {t("and")} <Code code={p.record_key_b} /></td>
            <td>{moduleText(p.object_type)}</td>
            <td>
              {Object.keys(p.match_fields ?? {}).map((f, i) => (
                <span key={f}>{i ? ", " : null}<Code code={f} text={labelText(f)} /></span>
              ))}
            </td>
            <td>{f1(p.match_score)}</td>
            <td>
              <Button size={32} variant="secondary" data-testid={`cleansing-dedup-open-${p.id}`} aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                {open === p.id ? t("Close") : session.can("approve") ? t("Compare and merge") : t("Compare")}
              </Button>
            </td>
          </tr>,
          open === p.id ? (
            <tr key={`${p.id}-merge`}>
              <td colSpan={5}>
                <Merge pair={p} onDone={() => setOpen(null)} />
              </td>
            </tr>
          ) : null,
        ])}
      </Table>
    );
  return (
    <Panel title={title} meta={pairs.data ? t("{n} pairs the cleaning engine found to be the same record", { n: int(pairs.data.items.length) }) : undefined} testId="cleansing-dedup">
      {types.length > 1 || objectType ? (
        <label className="nx-field">
          <span>{t("Object type")}</span>
          <select className="nx-input" aria-label={t("Object type")} data-testid="cleansing-dedup-type" value={objectType} onChange={(e) => { setObjectType(e.target.value); setOpen(null); }}>
            <option value="">{t("All objects")}</option>
            {types.map((ty) => (
              <option key={ty} value={ty}>{moduleText(ty)}</option>
            ))}
          </select>
        </label>
      ) : null}
      {body}
    </Panel>
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

function Export() {
  const session = useV2Session();
  const fixture = useFixture();
  const toast = useToast();
  const allowed = session.can("export");
  const q = useQuery({ queryKey: ["cleaning", fixture, "export-options"], queryFn: getExportOptions, enabled: allowed, staleTime: 60_000 });
  const [picked, setPicked] = useState<string | null>(null);
  const [object, setObject] = useState("");
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const run = useMutation({
    mutationFn: (st: string) => exportCleaning(format, st, object || undefined),
    onSuccess: (name) => toast({ text: t("Saved {name}.", { name }), tone: "good" }),
    onError: (e) => toast({ text: errorSentence(e, t("The file could not be built.")), tone: "bad" }),
  });
  if (!allowed) return null;
  const title = t("Export the corrected records");
  let body: ReactNode;
  if (q.isPending) body = <Skeleton lines={2} label={title} />;
  else if (q.isError) body = <ErrorState sentence={t("The export options could not be read.")} onRetry={() => void q.refetch()} />;
  else if (!q.data.statuses.length) body = <EmptyState heading={t("The cleansing queue is empty, so there is nothing to export.")} />;
  else {
    const statuses = q.data.statuses;
    const st = picked ?? (statuses.some((s) => s.value === "approved") ? "approved" : statuses[0].value);
    body = (
      <form
        className="nx-aps-form"
        aria-label={title}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          run.mutate(st);
        }}
      >
        <label className="nx-field">
          <span>{t("Status")}</span>
          <select className="nx-input" value={st} onChange={(e) => setPicked(e.target.value)}>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>{t("{label} ({n})", { label: ACTION[s.value]?.() ?? labelText(s.value), n: int(s.count) })}</option>
            ))}
          </select>
        </label>
        <label className="nx-field">
          <span>{t("Object")}</span>
          <select className="nx-input" value={object} onChange={(e) => setObject(e.target.value)}>
            <option value="">{t("All objects")}</option>
            {q.data.object_types.map((o) => (
              <option key={o.value} value={o.value}>{t("{label} {code} ({n})", { label: moduleText(o.value), code: o.value, n: int(o.count) })}</option>
            ))}
          </select>
        </label>
        <label className="nx-field">
          <span>{t("Format")}</span>
          <select className="nx-input" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {EXPORT_FORMATS.map((f) => (
              <option key={f} value={f}>{FORMAT[f]()}</option>
            ))}
          </select>
        </label>
        <Button type="submit" size={32} loading={run.isPending} loadingLabel={t("Building the file…")}>{t("Download")}</Button>
      </form>
    );
  }
  return (
    <Panel title={title} meta={t("A file to review, or to load into SAP with LSMW, a BAPI or IDocs. Nothing changes in SAP until the file is loaded.")} testId="cleansing-export">
      {body}
    </Panel>
  );
}

function CleanInExcel() {
  const toast = useToast();
  const land = useLandscape(null);
  const cells = (land.data?.cells ?? []).filter((c) => c.run_id);
  const keyOf = (c: { system_id: string; module: string }) => `${c.system_id}|${c.module}`;
  const [key, setKey] = useState<string | null>(null);
  const cell = cells.find((c) => keyOf(c) === key) ?? cells[0];
  const run = useMutation({
    mutationFn: (c: { run_id: string; module: string }) => downloadCleaningWorkbook(c.run_id, c.module),
    onSuccess: (name) => toast({ text: t("Saved {name}.", { name }), tone: "good" }),
    onError: (e) => toast({ text: errorSentence(e, t("The file could not be built.")), tone: "bad" }),
  });
  const sysName = (id: string) => land.data?.systems.find((s) => s.id === id)?.name ?? id;
  const objLabel = (m: string) => land.data?.objects.find((o) => o.module === m)?.label ?? moduleText(m);
  const title = t("Clean in Excel");
  let body: ReactNode;
  if (land.isPending) body = <Skeleton lines={2} label={title} />;
  else if (land.isError) body = <ErrorState error={land.error} onRetry={() => void land.refetch()} />;
  else if (!cell) body = <EmptyState heading={t("No object has been scored yet, so there is no workbook to download.")} />;
  else
    body = (
      <form
        className="nx-aps-form"
        aria-label={t("Download the cleaning workbook")}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (cell.run_id) run.mutate({ run_id: cell.run_id, module: cell.module });
        }}
      >
        <label className="nx-field">
          <span>{t("Object")}</span>
          <select className="nx-input" data-testid="cleansing-excel-object" value={keyOf(cell)} onChange={(e) => setKey(e.target.value)}>
            {cells.map((c) => (
              <option key={keyOf(c)} value={keyOf(c)}>{t("{system}: {label} {code}", { system: sysName(c.system_id), label: objLabel(c.module), code: c.module })}</option>
            ))}
          </select>
        </label>
        <Button type="submit" size={32} loading={run.isPending} loadingLabel={t("Building the file…")}>{t("Download the cleaning workbook")}</Button>
        <a className="nx-btn nx-btn-secondary nx-btn-sm" href={`/next/o/_/${moduleSlug(cell.module)}/cycle?step=upload`}>{t("Upload the cleaned workbook")}</a>
      </form>
    );
  return (
    <Panel title={title} meta={t("Download the cleaning workbook, correct the values in Excel, and upload it back. Meridian scores it as the next run.")} testId="cleansing-excel">
      {body}
    </Panel>
  );
}

function StayClean() {
  const q = useQuery({ queryKey: queryKeys.backAfterClean(), queryFn: () => getBackAfterClean(12), staleTime: 30_000 });
  const sum = (k: "back" | "fixed") => (q.data?.weeks ?? []).reduce((a, w) => a + w[k], 0);
  const back = sum("back");
  const fixed = sum("fixed");
  const title = t("Do the cleansed records stay clean?");
  let body: ReactNode;
  if (q.isPending) body = <Skeleton lines={2} label={title} />;
  else if (q.isError) body = <ErrorState sentence={t("The monitor could not be read.")} onRetry={() => void q.refetch()} />;
  else if (!back && !fixed) body = <EmptyState heading={t("Nothing has been fixed yet, so there is nothing to monitor.")} />;
  else
    body = (
      <p data-testid="cleansing-stay-clean-figs">
        <strong>{int(fixed)}</strong> {t("Fixed and still clean")}, <strong>{int(back)}</strong> {t("Failing again")}
      </p>
    );
  return (
    <Panel title={title} meta={t("Checked after every run, for the last 12 weeks.")} testId="cleansing-stay-clean">
      {body}
      <span className="nx-aps-acts">
        <Link className="nx-btn nx-btn-secondary nx-btn-sm" href="/next/work/monitor">{t("Open the monitor")}</Link>
        <Link className="nx-btn nx-btn-secondary nx-btn-sm" href="/next/work">{t("Open the work list")}</Link>
      </span>
    </Panel>
  );
}

/** The cleansing desk: decide, write to SAP, check it stayed clean. */
export function Cleansing() {
  const metrics = useCleaning("metrics", getCleaningMetrics);
  const queue = useCleaning("applied", () => getAppliedCleaning().then((r) => ({ ...r, readAt: Date.now() })));
  const audit = useCleaning("audit", getCleaningAudit);
  if (metrics.isPending) return <Skeleton lines={6} label={t("Cleansing")} />;
  if (metrics.isError) return <ErrorState sentence={t("The cleansing figures could not be read.")} onRetry={() => void metrics.refetch()} />;
  const weeks = weekly(metrics.data.metrics);
  const now = weeks.at(-1);
  if (!now)
    return (
      <>
        <EmptyState heading={t("Nothing has been cleansed yet. The figures appear after the weekly cleansing task has run once.")} />
        <CleanInExcel />
      </>
    );
  const prev = weeks.at(-2);
  const s = now.sums;
  const gain = prev ? cleaned(s) - cleaned(prev.sums) : null;
  const current = waiting(s) > 0 ? 0 : s.approved > 0 ? 1 : 2;
  const steps = [
    { label: t("Decide on the proposals"), n: waiting(s), hint: t("Approve the ones you trust, reject the rest. Nothing changes in SAP yet.") },
    { label: t("Write the approved changes to SAP"), n: s.approved, hint: t("This changes the records in SAP. You can undo it for 72 hours.") },
    { label: t("Check the records stayed clean"), n: s.verified, hint: t("Each change is read back from SAP. Undo any that look wrong.") },
  ];
  const figures = [
    { label: t("Waiting for a decision"), n: waiting(s), note: t("proposed changes nobody has approved or rejected") },
    { label: t("Approved, not yet in SAP"), n: s.approved, note: t("written at the next apply") },
    { label: t("Verified"), n: s.verified, note: t("applied and read back from SAP") },
  ];
  return (
    <div className="nx-aps-root">
      <section className="nx-aps-sheet" data-testid="cleansing" aria-label={t("Cleansing")}>
        <span className="nx-aps-meta">{t("Cleansing, week of {date}", { date: formatDate(now.period, "date") })}</span>
        <h2>{t("{n} records cleansed in SAP, {r} rolled back", { n: int(cleaned(s)), r: int(s.rolled_back) })}</h2>
        <p>{gain == null ? t("The first weekly snapshot. The trend starts next week.") : t("{n} more than the week before; {a} of the approvals were made automatically.", { n: int(gain), a: int(s.auto_approved) })}</p>
        <dl className="nx-aps-stats">
          {figures.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>
                <strong>{int(f.n)}</strong> <span className="nx-aps-meta">{f.note}</span>
              </dd>
            </div>
          ))}
        </dl>
        <a className="nx-btn nx-btn-primary nx-btn-sm" href="#cleansing-proposals" data-testid="cleansing-review">{t("Review the proposals")}</a>
      </section>
      <p>{t("Cleansing proposes changes to records, a steward approves them, and the engine writes them to SAP and reads them back. Review the proposals first, then apply the approved ones. Each object shows the run it was last scored in.")}</p>
      <dl className="nx-aps-stats">
        <div><dt>{t("Waiting for a decision")}</dt><dd>{t("Proposed changes that nobody has approved or rejected.")}</dd></div>
        <div><dt>{t("Approved, not yet in SAP")}</dt><dd>{t("Approved changes that the next apply will write.")}</dd></div>
        <div><dt>{t("Verified")}</dt><dd>{t("Applied changes that were read back from SAP and match.")}</dd></div>
        <div><dt>{t("Rolled back")}</dt><dd>{t("Applied changes that were reversed inside the rollback window.")}</dd></div>
      </dl>
      <ol className="nx-aps-items" aria-label={t("Cleansing steps")}>
        {steps.map((st, i) => (
          <li key={st.label} aria-current={i === current ? "step" : undefined}>
            <strong>{st.label}</strong> {int(st.n)} <span className="nx-aps-meta">{st.hint}</span>
          </li>
        ))}
      </ol>
      <Proposals />
      <Safety />
      <Rollbacks query={queue} />
      <Duplicates />
      <CleanInExcel />
      <details>
        <summary>{t("Trends, breakdown by object, export and audit trail")}</summary>
        <Panel title={t("Where every proposal stands")} meta={t("The latest snapshot of the queue, all objects.")} testId="cleansing-status">
          <StackedBar
            label={t("Proposals by status")}
            segs={[
              { id: "waiting", label: t("Waiting for a decision"), value: waiting(s), tone: "warn" },
              { id: "approved", label: t("Approved"), value: s.approved, tone: "chart1" },
              { id: "cleaned", label: t("Cleansed in SAP"), value: cleaned(s), tone: "good" },
              { id: "rolled", label: t("Rolled back"), value: s.rolled_back, tone: "chart3" },
              { id: "rejected", label: t("Rejected"), value: s.rejected, tone: "bad" },
            ]}
          />
        </Panel>
        <Panel title={t("Records cleansed, week by week")} meta={t("Applied and verified at each weekly snapshot")} testId="cleansing-trend">
          <AreaTrend label={t("Records cleansed by week")} points={weeks.length > 1 ? weeks.map((w) => ({ label: formatDate(w.period, "date"), value: cleaned(w.sums) })) : []} empty={t("Two weekly snapshots are needed to draw a trend.")} />
        </Panel>
        <Panel title={t("Cleansed by object")} meta={t("Records in SAP per object, with the share of its proposals.")} testId="cleansing-objects">
          <ul className="nx-aps-items">
            {now.objects.map((o) => {
              const total = waiting(o) + o.approved + cleaned(o) + o.rolled_back + o.rejected;
              return (
                <li key={o.object_type}>
                  {moduleText(o.object_type)} <Code code={o.object_type} /> {t("{n} of {total}, {pct}%", { pct: f1(total ? (cleaned(o) / total) * 100 : 0), n: int(cleaned(o)), total: int(total) })}
                </li>
              );
            })}
          </ul>
        </Panel>
        <Export />
        <Panel title={t("Audit trail")} meta={audit.data ? t("The last {n} decisions", { n: int(audit.data.items.length) }) : undefined} testId="cleansing-audit">
          {audit.isPending ? (
            <Skeleton lines={3} label={t("Audit trail")} />
          ) : audit.isError ? (
            status(audit.error) === 403 ? <EmptyState icon="info" heading={t("Your role cannot export, so the audit trail is hidden.")} /> : <ErrorState sentence={t("The audit trail could not be read.")} onRetry={() => void audit.refetch()} />
          ) : !audit.data.items.length ? (
            <EmptyState heading={t("No decision has been recorded yet.")} />
          ) : (
            <Table label={t("Audit trail table, scrollable")} head={<><th>{t("When")}</th><th>{t("Decision")}</th><th>{t("Record")}</th><th>{t("Object")}</th><th>{t("By")}</th></>}>
              {audit.data.items.map((a) => (
                <tr key={a.id}>
                  <td>{formatDate(a.created_at, "datetime")}</td>
                  <td>{ACTION[a.action]?.() ?? labelText(a.action)}</td>
                  <td>{a.record_key ? <Code code={a.record_key} /> : DASH}</td>
                  <td>{a.object_type ? moduleText(a.object_type) : DASH}</td>
                  <td>{a.actor_name === "scheduler" ? t("Weekly task") : a.actor_name ?? DASH}</td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </details>
      <StayClean />
    </div>
  );
}

function ReassignBatch({ b }: { b: BatchRowApi }) {
  const session = useV2Session();
  const fixture = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const allowed = session.can("assign");
  const users = useAssignable(open && allowed);
  const run = useMutation({
    mutationFn: (u: { id: string; name: string }) => reassignBatch(b.id, u.id).then((r) => ({ r, u })),
    onSuccess: ({ r, u }) => {
      toast({ text: t("Batch {label}: {count} {count2, plural, one {record} other {records}} reassigned to {name}", { label: b.name, count: int(r.reassigned), count2: r.reassigned, name: u.name }), tone: "good" });
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["cleaning-batches", fixture] });
    },
    onError: (e) => toast({ text: errorSentence(e, t("The batch could not be reassigned.")), tone: "bad" }),
  });
  if (!allowed) return null;
  const list = users.data ?? [];
  const pick = to || list[0]?.id || "";
  return (
    <>
      <Button size={32} variant="quiet" data-testid={`approvals-batch-reassign-${b.id}`} aria-label={t("Reassign batch {label}", { label: b.name })} aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("Reassign whole batch")}
      </Button>
      {open ? (
        users.isPending ? (
          <span className="nx-aps-meta">{t("Reading the people…")}</span>
        ) : users.isError ? (
          <span className="nx-aps-meta">{t("The people could not be read")}</span>
        ) : (
          <form
            className="nx-aps-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              const u = list.find((x) => x.id === pick);
              if (u) run.mutate(u);
            }}
          >
            <select className="nx-input" aria-label={t("Reassign to")} data-testid={`approvals-batch-reassign-to-${b.id}`} value={pick} onChange={(e) => setTo(e.target.value)}>
              {list.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <Button type="submit" size={32} data-testid={`approvals-batch-reassign-go-${b.id}`} disabled={!pick} loading={run.isPending}>{t("Reassign to")}</Button>
          </form>
        )
      ) : null}
    </>
  );
}

function Batches() {
  const session = useV2Session();
  const fixture = useFixture();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cleaning-batches", fixture], queryFn: getBatches, staleTime: 30_000 });
  const [openId, setOpenId] = useState<string | null>(null);
  const title = t("Batches waiting");
  const rows = (q.data?.items ?? []).filter((b) => b.status === "draft" && b.items > 0);
  const opened = rows.find((b) => b.id === openId) ?? null;
  let body: ReactNode;
  if (q.isPending) body = <Skeleton lines={3} label={title} />;
  else if (q.isError) body = <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  else if (!rows.length) body = <EmptyState heading={t("Nothing is waiting for approval{where}.", { where: "" })} />;
  else
    body = (
      <Table label={title} head={<><th>{t("Batch")}</th><th>{t("Records")}</th><th>{t("Raised by")}</th><th>{t("Created")}</th>{sr(t("Action"))}</>}>
        {rows.map((b) => (
          <tr key={b.id}>
            <td>{b.name} <Code code={b.id} /></td>
            <td>{int(b.items)}</td>
            <td>{b.created_by_label ?? b.created_by ?? DASH}</td>
            <td>{b.created_at ? formatDate(b.created_at, "date") : DASH}</td>
            <td>
              <span className="nx-aps-acts">
                <Button size={32} variant="secondary" data-testid={`approvals-batch-open-${b.id}`} onClick={() => setOpenId(b.id)}>{t("Open")}</Button>
                <ReassignBatch b={b} />
              </span>
            </td>
          </tr>
        ))}
      </Table>
    );
  return (
    <Panel title={title} testId="approvals-batches">
      {body}
      <Sheet open={!!opened} onClose={() => setOpenId(null)} title={opened?.name ?? title}>
        {opened ? (
          <FixApproveFlow
            id={opened.id}
            summary={opened.name}
            ownBatch={!!session.id && opened.created_by === session.id}
            onDone={() => {
              setOpenId(null);
              void qc.invalidateQueries({ queryKey: ["cleaning-batches", fixture] });
            }}
          />
        ) : null}
      </Sheet>
    </Panel>
  );
}

type Seg = "cleaning" | "writeback";

/** Approvals, inside Work: cleaning proposals and write-back requests. */
export function WorkApprovals() {
  const [seg, setSeg] = useState<Seg>("cleaning");
  return (
    <div className="nx-aps-root">
      <SegmentedControl<Seg>
        label={t("Approvals")}
        value={seg}
        onChange={setSeg}
        items={[
          { value: "cleaning", label: t("Cleaning") },
          { value: "writeback", label: t("Write-back requests") },
        ]}
      />
      {seg === "cleaning" ? (
        <>
          <Batches />
          <Cleansing />
        </>
      ) : (
        <Approvals base="/next/work/approvals" back="/next/work/approvals" />
      )}
    </div>
  );
}
