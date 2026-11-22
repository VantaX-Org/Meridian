"use client";

import { useState } from "react";
import { displayKey } from "@/lib/v2/work";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  applyProposal, approveGroup, approveProposal, CONFIDENT, EXPORT_FORMATS, exportCleaning, getAppliedCleaning, getCleaningAudit, getCleaningGroups,
  getCleaningMetrics, getCleaningSafety, getExportOptions, getProposals, rejectGroup, rejectProposal, rollbackCleaning, WAITING,
  type CleaningGroup, type ExportFormat,
} from "@/lib/api/v2/cleaning";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Confirm, DataTable, EmptyState, Field, Input, Select, Skeleton, StatTile, Tabs } from "@/ui/kit";
import { ObjChip } from "./ObjChip";
import { day, useDo } from "./shared";

const pct = (n: number | null | undefined) => (n === null || n === undefined ? t("n/a") : `${Math.round(n * 100)}%`);
const q = (fx: boolean, k: string, ...rest: unknown[]) => ["v2", "cleaning", fx, k, ...rest];

/** The cleaning queue: proposed fixes to approve, reject, apply and roll back, with safety, export, metrics and audit. */
export function CleaningQueue() {
  const fx = useFixture();
  const run = useDo();
  const [tab, setTab] = useState("waiting");
  const [g, setG] = useState<CleaningGroup | null>(null);
  const [reject, setReject] = useState<{ id?: string; group?: CleaningGroup } | null>(null);
  const [reason, setReason] = useState("");
  const [fmt, setFmt] = useState<ExportFormat>("csv");
  const groups = useQuery({ queryKey: q(fx, "groups"), queryFn: getCleaningGroups, retry: false });
  const props = useQuery({ queryKey: q(fx, "props", tab, g?.version_id, g?.kind), queryFn: () => getProposals(tab === "approved" ? { status: "approved" } : { status: WAITING, version_id: g?.version_id, kind: g?.kind }), enabled: tab === "waiting" || tab === "approved", retry: false });
  const applied = useQuery({ queryKey: q(fx, "applied"), queryFn: getAppliedCleaning, enabled: tab === "applied", retry: false });
  const safety = useQuery({ queryKey: q(fx, "safety"), queryFn: getCleaningSafety, enabled: tab === "safety", retry: false });
  const metrics = useQuery({ queryKey: q(fx, "metrics"), queryFn: getCleaningMetrics, enabled: tab === "metrics", retry: false });
  const audit = useQuery({ queryKey: q(fx, "audit"), queryFn: getCleaningAudit, enabled: tab === "audit", retry: false });
  const opts = useQuery({ queryKey: q(fx, "opts"), queryFn: getExportOptions, enabled: tab === "export", retry: false });
  const done = () => { void groups.refetch(); void props.refetch(); void applied.refetch(); };
  const gl = groups.data?.groups ?? [];

  const body = () => {
    if (tab === "waiting" && !g) {
      if (groups.isLoading) return <Skeleton lines={3} label={t("Loading the queue")} />;
      if (!gl.length) return <EmptyState heading={t("No proposed fixes are waiting")} />;
      return (
        <DataTable label={t("Proposed fixes by rule")} rows={gl} rowKey={(x) => `${x.version_id}|${x.object_type}|${x.kind}`} onSelect={setG}
          columns={[
            { key: "o", label: t("Object"), render: (x) => <ObjChip code={x.object_type} /> },
            { key: "k", label: t("What it does"), render: (x) => x.rule_name ?? x.kind, sort: (x) => x.kind },
            { key: "n", label: t("Records"), render: (x) => x.records, sort: (x) => x.records, align: "end" },
            { key: "c", label: t("Confident"), render: (x) => `${x.confident}`, sort: (x) => x.confident, align: "end" },
            { key: "a", label: t("Confidence"), render: (x) => pct(x.avg_confidence), sort: (x) => x.avg_confidence, align: "end" },
          ]} />
      );
    }
    if (tab === "waiting" || tab === "approved") {
      const rows = props.data?.items ?? [];
      return (
        <>
          {g ? (
            <div className="mx-links">
              <Button variant="ghost" onClick={() => setG(null)}>{t("All groups")}</Button>
              <Button variant="primary" onClick={() => void run(() => approveGroup(g, CONFIDENT), (r) => t("{n} fixes approved.", { n: r.approved_count })).then(done)}>{t("Approve the confident ones")}</Button>
              <Button onClick={() => setReject({ group: g })}>{t("Reject the group")}</Button>
            </div>
          ) : null}
          {props.isLoading ? <Skeleton lines={3} label={t("Loading the queue")} /> : !rows.length ? <EmptyState heading={t("Nothing here")} /> : (
            <DataTable label={t("Proposed fixes")} rows={rows} rowKey={(x) => x.id}
              columns={[
                { key: "o", label: t("Object"), render: (x) => <ObjChip code={x.object_type} /> },
                { key: "r", label: t("Record"), render: (x) => displayKey(x.record_key), sort: (x) => x.record_key },
                { key: "c", label: t("Confidence"), render: (x) => pct(x.confidence), sort: (x) => x.confidence ?? 0, align: "end" },
                { key: "a", label: t("Action"), render: (x) => (
                  <span className="mx-links">
                    {tab === "waiting" ? <>
                      <Button variant="ghost" onClick={() => void run(() => approveProposal(x.id), () => t("Fix approved.")).then(done)}>{t("Approve")}</Button>
                      <Button variant="ghost" onClick={() => setReject({ id: x.id })}>{t("Reject")}</Button>
                    </> : <Button variant="ghost" onClick={() => void run(() => applyProposal(x.id), () => t("Fix applied.")).then(done)}>{t("Apply")}</Button>}
                  </span>
                ) },
              ]} />
          )}
        </>
      );
    }
    if (tab === "applied") {
      const rows = applied.data?.items ?? [];
      return !rows.length ? <EmptyState heading={t("No fix is applied yet")} /> : (
        <DataTable label={t("Applied fixes")} rows={rows} rowKey={(x) => x.id}
          columns={[
            { key: "o", label: t("Object"), render: (x) => <ObjChip code={x.object_type} /> },
            { key: "r", label: t("Record"), render: (x) => x.record_key },
            { key: "d", label: t("Applied"), render: (x) => day(x.applied_at), sort: (x) => x.applied_at ?? "" },
            { key: "b", label: t("Roll back until"), render: (x) => day(x.rollback_deadline) },
            { key: "a", label: t("Action"), render: (x) => <Button variant="ghost" onClick={() => void run(() => rollbackCleaning(x.id), () => t("Fix rolled back.")).then(done)}>{t("Roll back")}</Button> },
          ]} />
      );
    }
    if (tab === "safety") {
      const s = safety.data;
      if (!s) return <Skeleton lines={3} label={t("Checking the values")} />;
      return (
        <>
          <dl className="mx-tiles">
            <StatTile label={t("Checked")} value={s.totals.checked} />
            <StatTile label={t("Safe")} value={s.totals.safe} />
            <StatTile label={t("SAP would refuse")} value={s.totals.reject} />
            <StatTile label={t("Not checked")} value={s.totals.unknown} />
          </dl>
          {s.truncated ? <p className="mx-muted">{t("More fixes wait than were checked. Only the first are shown.")}</p> : null}
          {s.items.length ? (
            <DataTable label={t("Value checks")} rows={s.items} rowKey={(x) => x.id}
              columns={[
                { key: "f", label: t("Field"), render: (x) => x.field ?? t("n/a") },
                { key: "v", label: t("Value"), render: (x) => x.value ?? "" },
                { key: "s", label: t("Verdict"), render: (x) => (x.verdict === "safe" ? t("Safe") : x.verdict === "reject" ? t("SAP would refuse") : t("Not checked")), sort: (x) => x.verdict },
                { key: "w", label: t("Why"), render: (x) => x.reasons.join(" ") },
              ]} />
          ) : null}
        </>
      );
    }
    if (tab === "metrics") {
      const m = metrics.data?.metrics ?? [];
      return !m.length ? <EmptyState heading={t("No weekly numbers yet")} /> : (
        <DataTable label={t("Weekly numbers")} rows={m} rowKey={(x) => `${x.period}|${x.object_type}`}
          columns={[
            { key: "p", label: t("Week"), render: (x) => day(x.period), sort: (x) => x.period },
            { key: "o", label: t("Object"), render: (x) => <ObjChip code={x.object_type} /> },
            { key: "d", label: t("Detected"), render: (x) => x.detected, align: "end" },
            { key: "a", label: t("Approved"), render: (x) => x.approved, align: "end" },
            { key: "j", label: t("Rejected"), render: (x) => x.rejected, align: "end" },
            { key: "p2", label: t("Applied"), render: (x) => x.applied, align: "end" },
            { key: "r", label: t("Rolled back"), render: (x) => x.rolled_back, align: "end" },
          ]} />
      );
    }
    if (tab === "audit") {
      const a = audit.data?.items ?? [];
      return !a.length ? <EmptyState heading={t("No decision is logged yet")} /> : (
        <DataTable label={t("Decision log")} rows={a} rowKey={(x) => x.id}
          columns={[
            { key: "d", label: t("When"), render: (x) => day(x.created_at), sort: (x) => x.created_at },
            { key: "a", label: t("Action"), render: (x) => x.action },
            { key: "u", label: t("By"), render: (x) => x.actor_name ?? t("The scheduler") },
            { key: "r", label: t("Record"), render: (x) => x.record_key ?? "" },
          ]} />
      );
    }
    return (
      <div className="mx-links">
        <Field label={t("File format")}><Select value={fmt} onChange={(e) => setFmt(e.target.value as ExportFormat)} options={EXPORT_FORMATS.map((f) => ({ value: f, label: f.toUpperCase() }))} /></Field>
        {(opts.data?.statuses ?? [{ value: "approved", count: 0 }]).map((s) => (
          <Button key={s.value} onClick={() => void run(() => exportCleaning(fmt, s.value), () => t("The file is ready."))}>{t("Export {status} ({n})", { status: s.value, n: s.count })}</Button>
        ))}
      </div>
    );
  };

  const items = [
    { id: "waiting", label: t("Waiting"), badge: groups.data ? String(groups.data.records) : undefined }, { id: "approved", label: t("Approved") }, { id: "applied", label: t("Applied") },
    { id: "safety", label: t("Safety") }, { id: "metrics", label: t("Numbers") }, { id: "audit", label: t("Audit") }, { id: "export", label: t("Export") },
  ];
  return (
    <Card title={t("Cleaning queue")} sub={t("Proposed fixes wait for a second person to approve them.")}>
      <Tabs idBase="mx-cq" label={t("Cleaning queue views")} items={items} value={tab} onChange={(v) => { setTab(v); setG(null); }} />
      <div id={`mx-cq-panel-${tab}`} role="tabpanel" aria-labelledby={`mx-cq-tab-${tab}`}>{body()}</div>
      <Confirm open={!!reject} title={t("Reject the fix")} confirmLabel={t("Reject")} cancelLabel={t("Cancel")} danger
        onCancel={() => setReject(null)}
        onConfirm={() => { const r = reject; setReject(null); if (r && reason.trim()) void run(async () => { if (r.group) await rejectGroup(r.group, reason); else await rejectProposal(r.id as string, reason); }, () => t("Rejected.")).then(done); setReason(""); }}>
        <Field label={t("Why is it rejected?")}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>
    </Card>
  );
}
