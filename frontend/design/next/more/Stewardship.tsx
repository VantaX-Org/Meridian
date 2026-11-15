"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { labelText, moduleText } from "@/lib/v2/labels";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { useAssignable } from "@/lib/v2/approvals-queries";
import { errorSentence } from "@/lib/api/v2/client";
import {
  STEWARD_STATUSES, assignStewardItem, bulkApproveSteward, escalateStewardItem, getStewardMetrics, listStewardQueue, resolveStewardItem,
  type StewardItem,
} from "@/lib/api/v2/stewardship";
import { V2Link } from "@/design/v2/parts";
import { Button, Chip, Code, DataTable, PartBar, Ring, SegmentedControl, useToast, type ChipTone, type Column } from "../kit";
import { ChartCard, cardState, compact } from "./ChartCard";
import { QueryView } from "./states";

type StatusFilter = (typeof STEWARD_STATUSES)[number];

const STATUS_LABEL: Record<string, () => string> = {
  open: () => t("Open"),
  in_progress: () => t("In progress"),
  escalated: () => t("Escalated"),
  resolved: () => t("Approved"),
  rejected: () => t("Rejected"),
};
const SLA_LABEL: Record<string, () => string> = { on_track: () => t("On track"), at_risk: () => t("At risk"), breached: () => t("Breached") };
const SLA_TONE: Record<string, ChipTone> = { on_track: "good", at_risk: "warn", breached: "bad" };
const STATUS_TONE: Record<string, ChipTone> = { open: "neutral", in_progress: "accent", escalated: "warn", resolved: "resolved", rejected: "bad" };
const TYPE_LABEL: Record<string, () => string> = {
  finding: () => t("Finding"),
  duplicate: () => t("Possible duplicate"),
  contract_breach: () => t("Contract breach"),
  golden_record: () => t("Golden record"),
};

const statusText = (s: string) => (STATUS_LABEL[s] ?? (() => labelText(s)))();
const typeText = (s: string) => (TYPE_LABEL[s] ?? (() => labelText(s)))();
const OPEN = new Set(["open", "in_progress", "escalated"]);
const pct = (n: number) => `${Math.round(n)}%`;

/** The text of a queue item: the rule code beside its description, or the item type when the source has no rule. */
function ItemCell({ i }: { i: StewardItem }) {
  return (
    <span className="nx-cell-stack">
      {i.source_check_id ? <Code code={i.source_check_id} text={i.source_title ?? typeText(i.item_type)} /> : <span>{i.source_title ?? typeText(i.item_type)}</span>}
      <span className="nx-sub">{typeText(i.item_type)}, {moduleText(i.source_module || i.domain)}</span>
    </span>
  );
}

/**
 * The stewardship workbench: the queue a steward works, with SLA compliance, the backlog by status and type, and the AI's
 * recommendation on each item. Assign needs assign; approve, reject, escalate and bulk approve need approve (the API
 * checks the same permissions). Exceptions keep their own page.
 */
export function Stewardship() {
  const fx = useFixture();
  const qc = useQueryClient();
  const session = useV2Session();
  const toast = useToast();
  const [status, setStatus] = useState<StatusFilter>("open");
  const canAssign = session.can("assign");
  const canApprove = session.can("approve");
  const metrics = useQuery({ queryKey: ["steward", "metrics", fx], queryFn: getStewardMetrics, staleTime: 30_000, retry: false });
  const list = useQuery({ queryKey: ["steward", "list", fx, status], queryFn: () => listStewardQueue({ status }), staleTime: 30_000, retry: false });
  const people = useAssignable(canAssign);
  const nameOf = (id: string | null) => (id ? people.data?.find((p) => p.id === id)?.name ?? id : null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["steward"] });
  const done = (text: string) => { toast({ text, tone: "good" }); void refresh(); };
  const fail = (fallback: string) => (e: unknown) => toast({ text: errorSentence(e, fallback), tone: "bad" });

  const assign = useMutation({
    mutationFn: (v: { id: string; user: string | null }) => assignStewardItem(v.id, v.user),
    onSuccess: () => done(t("The item was assigned.")),
    onError: fail(t("The item could not be assigned.")),
  });
  const resolve = useMutation({
    mutationFn: (v: { id: string; action: "approve" | "reject" }) => resolveStewardItem(v.id, v.action),
    onSuccess: (r) => done(r.action === "reject" ? t("The item was rejected.") : t("The item was approved.")),
    onError: fail(t("The item could not be resolved.")),
  });
  const escalate = useMutation({
    mutationFn: (id: string) => escalateStewardItem(id),
    onSuccess: () => done(t("The item was escalated.")),
    onError: fail(t("The item could not be escalated.")),
  });
  const bulk = useMutation({
    mutationFn: (ids: string[]) => bulkApproveSteward(ids),
    onSuccess: (r) => done(t("{n} {count, plural, one {item was} other {items were}} approved. Items under 85% AI confidence stay open.", { n: int(r.approved), count: r.approved })),
    onError: fail(t("The items could not be approved.")),
  });

  const m = metrics.data;
  const items = list.data?.items ?? [];
  const busy = assign.isPending || resolve.isPending || escalate.isPending || bulk.isPending;

  const columns: Column<StewardItem>[] = [
    { id: "item", label: t("Item"), cell: (i) => <ItemCell i={i} /> },
    { id: "status", label: t("Status"), cell: (i) => <Chip tone={STATUS_TONE[i.status] ?? "neutral"}>{statusText(i.status)}</Chip> },
    {
      id: "sla", label: t("SLA"),
      cell: (i) => (
        <span className="nx-cell-stack">
          {i.sla_state ? <Chip tone={SLA_TONE[i.sla_state] ?? "neutral"}>{(SLA_LABEL[i.sla_state] ?? (() => labelText(i.sla_state)))()}</Chip> : null}
          <span className="nx-sub">{i.due_at ? t("Due {date}", { date: formatDate(i.due_at, "date") }) : t("No due date")}</span>
        </span>
      ),
      compare: (a, b) => (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity),
    },
    { id: "priority", label: t("Priority"), align: "end", compare: (a, b) => a.priority - b.priority, cell: (i) => int(i.priority) },
    {
      id: "ai", label: t("AI recommendation"),
      compare: (a, b) => (a.ai_confidence ?? -1) - (b.ai_confidence ?? -1),
      cell: (i) => i.ai_recommendation ? (
        <span className="nx-cell-stack">
          <Chip tone="aletheia">{labelText(i.ai_recommendation)}</Chip>
          {i.ai_confidence != null ? <span className="nx-sub">{t("{pct} confident", { pct: pct(i.ai_confidence * 100) })}</span> : null}
        </span>
      ) : t("None yet"),
    },
    {
      id: "owner", label: t("Assigned to"),
      cell: (i) => canAssign && OPEN.has(i.status) ? (
        <select
          className="nx-input"
          aria-label={t("Assign {item}", { item: i.source_title ?? i.id })}
          value={i.assigned_to ?? ""}
          disabled={busy}
          onFocus={() => void people.refetch()}
          onChange={(e) => assign.mutate({ id: i.id, user: e.target.value || null })}
        >
          <option value="">{t("Nobody")}</option>
          {i.assigned_to && !people.data?.some((p) => p.id === i.assigned_to) ? <option value={i.assigned_to}>{i.assigned_to}</option> : null}
          {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      ) : (nameOf(i.assigned_to) ?? t("Nobody")),
    },
    {
      id: "act", label: t("Actions"),
      cell: (i) => canApprove && OPEN.has(i.status) ? (
        <span className="nx-row nx-wrap">
          <Button size={32} variant="secondary" disabled={busy} onClick={() => resolve.mutate({ id: i.id, action: "approve" })} aria-label={t("Approve {item}", { item: i.source_title ?? i.id })}>{t("Approve")}</Button>
          <Button size={32} variant="quiet" disabled={busy} onClick={() => resolve.mutate({ id: i.id, action: "reject" })} aria-label={t("Reject {item}", { item: i.source_title ?? i.id })}>{t("Reject")}</Button>
          {i.status !== "escalated" ? <Button size={32} variant="quiet" disabled={busy} onClick={() => escalate.mutate(i.id)} aria-label={t("Escalate {item}", { item: i.source_title ?? i.id })}>{t("Escalate")}</Button> : null}
        </span>
      ) : null,
    },
  ];

  const byStatus = STEWARD_STATUSES.map((s) => ({ label: statusText(s), value: m?.items_by_status[s] ?? 0 }));
  const byType = Object.entries(m?.items_by_type ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: typeText(k), value: v }));
  const mState = cardState(metrics, !m || (m.backlog_total === 0 && Object.keys(m.items_by_status).length === 0));
  const compliance = m ? m.sla_compliance_rate * (m.sla_compliance_rate <= 1 ? 100 : 1) : null;

  return (
    <div className="nx-body" data-testid="stewardship-page">
      <div className="nx-chartcards">
        <ChartCard
          title={t("SLA compliance")} state={mState} testId="steward-sla"
          chart={<Ring value={compliance} label={t("SLA compliance")}>{compliance == null ? null : pct(compliance)}</Ring>}
          figure={compliance == null ? undefined : pct(compliance)}
          line={m ? t("{n} overdue of {total} open", { n: int(m.overdue_count), total: int(m.backlog_total) }) : undefined}
          emptyLine={t("No item has been queued yet.")} onRetry={() => void metrics.refetch()}
        />
        <ChartCard
          title={t("Backlog by status")} state={mState} testId="steward-status"
          chart={<PartBar segments={byStatus} label={t("Backlog by status")} format={compact} />}
          figure={m ? compact(m.backlog_total) : undefined}
          line={byStatus.filter((s) => s.value > 0).map((s) => `${s.label} ${compact(s.value)}`).join(", ")}
          emptyLine={t("No item has been queued yet.")} onRetry={() => void metrics.refetch()}
        />
        <ChartCard
          title={t("Backlog by type")} state={mState} testId="steward-type"
          chart={<PartBar segments={byType} label={t("Backlog by type")} format={compact} />}
          figure={m?.ai_acceptance_rate != null ? pct(m.ai_acceptance_rate * (m.ai_acceptance_rate <= 1 ? 100 : 1)) : undefined}
          figureTitle={t("Share of AI recommendations the stewards accepted")}
          line={m?.ai_acceptance_rate != null ? t("AI recommendations accepted") : byType.map((s) => `${s.label} ${compact(s.value)}`).join(", ")}
          emptyLine={t("No item has been queued yet.")} onRetry={() => void metrics.refetch()}
        />
      </div>
      <div className="nx-row nx-wrap" data-testid="steward-actions">
        <SegmentedControl<StatusFilter> label={t("Show items")} value={status} onChange={setStatus} items={STEWARD_STATUSES.map((s) => ({ value: s, label: statusText(s) }))} />
        <V2Link href="/work/exceptions" className="nx-btn nx-btn-quiet nx-btn-sm">{t("Exceptions")}</V2Link>
      </div>
      <QueryView
        loading={list.isLoading} error={list.error} onRetry={() => void list.refetch()} empty={items.length === 0}
        emptyHeading={t("Nothing in this list")} emptyText={t("No queue item has this status. The queue fills after each run from findings, duplicates and contract breaches.")}
        label={t("Loading the stewardship queue")}
      >
        <DataTable
          rows={items}
          columns={columns}
          rowKey={(i) => i.id}
          rowLabel={(i) => i.source_title ?? i.id}
          caption={t("Stewardship queue")}
          total={list.data?.total}
          selectable={canApprove && OPEN.has(status)}
          bulkActions={(keys) => (
            <Button size={32} variant="primary" loading={bulk.isPending} onClick={() => bulk.mutate([...keys])}>
              {t("Approve {n} selected", { n: int(keys.length) })}
            </Button>
          )}
        />
        {canApprove ? <p className="nx-sub">{t("Bulk approve applies the AI recommendation only where its confidence is 85% or more. The rest stay open for a steward.")}</p> : null}
      </QueryView>
    </div>
  );
}
