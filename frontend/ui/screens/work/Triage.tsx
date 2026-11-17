"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { bulkTriage, getAssignable, getTriageMetrics, getTriageQueue, type BulkAction, type QueueItem } from "@/lib/api/v2/triage";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { Button, Card, Chip, Confirm, DataTable, EmptyState, ErrorState, Field, FieldChip, Input, PageHeader, Select, Skeleton, StatTile, useAletheia, useAletheiaScope } from "@/ui/kit";
import { ObjChip } from "./ObjChip";
import { day, sevLabel, useDo } from "./shared";

const ACTIONS: { value: BulkAction; label: () => string }[] = [
  { value: "acknowledge", label: () => t("Acknowledge") },
  { value: "assign", label: () => t("Assign") },
  { value: "release", label: () => t("Release to the pool") },
  { value: "snooze", label: () => t("Snooze") },
  { value: "unsnooze", label: () => t("Wake up") },
  { value: "priority", label: () => t("Set priority") },
];

/** Everything waiting for a person, by how late it is, with bulk actions. */
export function Triage() {
  useInterfaceLang();
  const fx = useFixture();
  const chat = useAletheia();
  const run = useDo();
  const [who, setWho] = useState("me");
  const [snoozed, setSnoozed] = useState(false);
  const [bucket, setBucket] = useState<"overdue" | "due_today" | "later">("overdue");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<BulkAction>("acknowledge");
  const [user, setUser] = useState("");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [prio, setPrio] = useState("1");
  const [ask, setAsk] = useState(false);
  const q = useQuery({ queryKey: ["v2", "triage", fx, who, snoozed], queryFn: () => getTriageQueue(who, snoozed), retry: false });
  const people = useQuery({ queryKey: ["v2", "triage-people", fx], queryFn: getAssignable, retry: false });
  const met = useQuery({ queryKey: ["v2", "triage-metrics", fx], queryFn: () => getTriageMetrics(8), retry: false });
  const items = q.data?.[bucket].items ?? [];
  const m = met.data;

  useAletheiaScope({
    key: "triage", label: t("Asking about the triage queue"), suggestions: [t("What is late?")],
    answer: () => ({
      text: t("{n} items are overdue.", { n: q.data?.overdue.count ?? 0 }),
      evidence: (q.data?.overdue.items ?? []).slice(0, 3).map((i) => `${i.check_id ?? i.id}`), actions: [],
    }),
  });

  const flip = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chosen = items.filter((i) => picked.has(i.id));
  const need = (action === "assign" && !user) || (action === "snooze" && (!reason.trim() || !until));
  const apply = async () => {
    setAsk(false);
    for (const kind of ["issue", "queue"] as const) {
      const ids = chosen.filter((i) => i.kind === kind).map((i) => i.id);
      if (!ids.length) continue;
      await run(() => bulkTriage({ kind, ids, action, user_id: action === "assign" ? user : undefined, reason: action === "snooze" ? reason : undefined, until: action === "snooze" ? new Date(until).toISOString() : undefined, priority: action === "priority" ? Number(prio) : undefined }), (r) => t("{n} items updated.", { n: r.updated }));
    }
    setPicked(new Set());
  };

  return (
    <>
      <PageHeader title={t("Triage")} context={t("Who must act next, latest first")}
        actions={<Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>} />
      {m ? (
        <dl className="mx-tiles">
          <StatTile label={t("Unassigned")} value={m.unassigned} />
          <StatTile label={t("Breached")} value={m.breach_count} />
          <StatTile label={t("Within SLA")} value={m.sla_attainment_pct == null ? "-" : `${Math.round(m.sla_attainment_pct)}%`} />
          <StatTile label={t("Hours to resolve")} value={m.mttr_hours == null ? "-" : Math.round(m.mttr_hours)} />
        </dl>
      ) : null}
      <div className="mx-links">
        <Select aria-label={t("Whose queue")} value={who} onChange={(e) => { setWho(e.target.value); setPicked(new Set()); }}
          options={[{ value: "me", label: t("Mine") }, { value: "unassigned", label: t("Unassigned") }, { value: "all", label: t("Everyone") }, ...(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        <Chip selected={snoozed} onClick={() => setSnoozed(!snoozed)}>{t("Show snoozed")}</Chip>
      </div>
      <div className="mx-chips" role="group" aria-label={t("Buckets")}>
        {(["overdue", "due_today", "later"] as const).map((b) => (
          <Chip key={b} selected={bucket === b} count={q.data?.[b].count} onClick={() => { setBucket(b); setPicked(new Set()); }}>
            {b === "overdue" ? t("Overdue") : b === "due_today" ? t("Due today") : t("Later")}
          </Chip>
        ))}
      </div>
      <Card title={t("Queue")} sub={t("{n} selected", { n: chosen.length })}>
        {q.isLoading ? <Skeleton lines={5} label={t("Loading the queue")} /> : q.isError ? <ErrorState heading={t("The queue could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} /> : !items.length ? <EmptyState heading={t("Nothing is waiting here")} /> : (
          <DataTable label={t("Queue")} rows={items} rowKey={(i: QueueItem) => i.id}
            columns={[
              { key: "p", label: t("Pick"), render: (i) => <input type="checkbox" aria-label={t("Pick {id}", { id: i.id })} checked={picked.has(i.id)} onChange={() => flip(i.id)} /> },
              { key: "o", label: t("Object"), render: (i) => (i.module ? <ObjChip code={i.module} /> : "") },
              { key: "r", label: t("Rule"), render: (i) => (i.check_id ? <FieldChip code={i.check_id} description={i.ref ?? undefined} /> : "") },
              { key: "s", label: t("Severity"), render: (i) => (i.severity ? sevLabel(i.severity) : ""), sort: (i) => i.severity ?? "" },
              { key: "d", label: t("Due"), render: (i) => day(i.due_at ?? ""), sort: (i) => i.due_at ?? "" },
              { key: "k", label: t("Rank"), render: (i) => Math.round(i.rank_score), sort: (i) => i.rank_score, align: "end" },
            ]} />
        )}
      </Card>
      <Card title={t("Bulk action")} sub={t("Applies to the picked items.")}>
        <Field label={t("Action")}><Select value={action} onChange={(e) => setAction(e.target.value as BulkAction)} options={ACTIONS.map((a) => ({ value: a.value, label: a.label() }))} /></Field>
        {action === "assign" ? <Field label={t("Assign to")}><Select value={user} onChange={(e) => setUser(e.target.value)} options={[{ value: "", label: t("Pick a person") }, ...(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))]} /></Field> : null}
        {action === "snooze" ? (
          <>
            <Field label={t("Why snooze")}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Field label={t("Until")}><Input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
          </>
        ) : null}
        {action === "priority" ? <Field label={t("Priority (1 is highest)")}><Input type="number" min={1} value={prio} onChange={(e) => setPrio(e.target.value)} /></Field> : null}
        <Button variant="primary" disabled={!chosen.length || need} onClick={() => setAsk(true)}>{t("Apply to {n} items", { n: chosen.length })}</Button>
      </Card>
      <Confirm open={ask} title={t("Apply this action?")} confirmLabel={t("Apply")} cancelLabel={t("Cancel")} onConfirm={() => void apply()} onCancel={() => setAsk(false)}>
        {t("{n} items change.", { n: chosen.length })}
      </Confirm>
    </>
  );
}
