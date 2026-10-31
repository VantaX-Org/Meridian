"use client";

import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { getAppliedCleaning, getCleaningAudit, getCleaningMetrics, rollbackCleaning, type CleaningItem, type CleaningMetric, type RecordData } from "@/lib/api/v2/cleaning";
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
        action={<V2Link href="/work" className="m2-btn m2-next" data-testid="cleansing-review">{t("Review the proposals")}</V2Link>}
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
