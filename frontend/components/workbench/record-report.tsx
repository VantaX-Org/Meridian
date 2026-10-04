"use client";

/**
 * Record report: one SAP record, everything Meridian knows about it — every
 * check it fails, the evidence, what to do, which SAP features that blocks,
 * how it has behaved version by version, and the steward trail. Built on the
 * Aurora RecordReport surface; reached from the triage drawer (?issue=<id>).
 */

import Link from "next/link";
import { useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Chip, EmptyState, RecordReport, type FixStep, type RecordReportStatus } from "@/components/aurora";
import { useRole } from "@/hooks/use-role";
import { findingToRecordReport } from "@/lib/aurora";
import { getConfigImpact } from "@/lib/api/connectivity";
import { getFindings } from "@/lib/api/findings";
import { getIssue, getIssues, updateIssues, type IssueStatus, type RecordIssue } from "@/lib/api/issues";
import { getVersions } from "@/lib/api/versions";
import { formatModuleName, relativeTime } from "@/lib/format";

const STATUS: Record<IssueStatus, RecordReportStatus> = { open: "open", in_progress: "in_progress", waiting_sap: "in_progress", waiting_requester: "in_progress", accepted: "resolved", resolved: "resolved" };
const SEV = (s: string): "critical" | "high" | "medium" | "low" =>
  s === "critical" || s === "high" || s === "medium" ? s : "low";

export function RecordReportView({ issueId }: { issueId: string }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const detail = useQuery({ queryKey: ["issue", issueId], queryFn: () => getIssue(issueId) });
  const issue = detail.data?.issue;

  // every issue on this record, in any state
  const siblings = useQuery({
    queryKey: ["issues", "record", issue?.record_key, issue?.module], enabled: !!issue,
    queryFn: () => getIssues({ search: issue!.record_key, module: issue!.module, limit: 100 }),
  });
  const onRecord = useMemo(
    () => (siblings.data?.items ?? []).filter((i) => i.record_key === issue?.record_key),
    [siblings.data, issue?.record_key],
  );
  const open = onRecord.filter((i) => i.status === "open" || i.status === "in_progress");
  const checks = Array.from(new Set((onRecord.length ? onRecord : issue ? [issue] : []).map((i) => i.check_id)));
  const findingQs = useQueries({
    queries: checks.map((c) => ({
      queryKey: ["findings.list", { check_id: c, module: issue?.module, version_id: issue?.last_seen_version, limit: 1 }],
      enabled: !!issue,
      queryFn: () => getFindings({ check_id: c, module: issue!.module, version_id: issue!.last_seen_version, limit: 1 }),
    })),
  });
  const findings = findingQs.map((q) => q.data?.findings[0]).filter((f): f is NonNullable<typeof f> => !!f);

  const versions = useQuery({ queryKey: ["versions.list", { limit: 40 }], queryFn: () => getVersions({ limit: 40 }) });
  const latest = versions.data?.versions.find((v) => v.dqs_summary && Object.keys(v.dqs_summary).length);
  const impact = useQuery({ queryKey: ["config-impact", latest?.id], enabled: !!latest, retry: false,
    queryFn: () => getConfigImpact(latest!.id), meta: { ignoreError: true } });

  const transition = useMutation({
    mutationFn: (body: { status: IssueStatus; resolution?: string }) => updateIssues({ ids: [issueId], ...body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["issue", issueId] }); qc.invalidateQueries({ queryKey: ["issues"] }); },
    onError: (e) => toast.error((e as Error).message || "Not saved"),
  });

  if (detail.isLoading) return <EmptyState title="Loading record…" />;
  if (!issue) return <EmptyState title="This record issue no longer exists." actions={<Link className="aurora-link" href="/workbench">Back to the workbench</Link>} />;

  const worst = (open.length ? open : [issue]).map((i) => i.severity).sort((a, b) => ["critical", "high", "medium", "low"].indexOf(a) - ["critical", "high", "medium", "low"].indexOf(b))[0];
  const verdict = open.length === 0
    ? `${issue.record_key} passes every check it once failed.`
    : `${issue.record_key} fails ${open.length} check${open.length === 1 ? "" : "s"}${open.some((i) => i.severity === "critical") ? ", one of them critical" : ""}.`;

  const remediation = findings.filter((f) => f.remediation_text);
  const steps: FixStep[] = [
    ...remediation.map((f) => ({ id: f.check_id, label: f.check_id, detail: f.remediation_text, status: "pending" as const })),
    { id: "verify", label: "Download the object again — a version that evaluates this record and finds it passing resolves it",
      status: issue.status === "resolved" ? ("done" as const) : ("pending" as const) },
  ];
  const checkIds = new Set(checks);
  const configImpact = (impact.data?.results ?? [])
    .filter((r) => r.blocking_findings.some((b) => checkIds.has(b.check_id)))
    .map((r) => ({ id: `${r.system}-${r.feature}`, feature: `${r.feature} · ${r.system}`,
      status: (r.status === "ok" ? "aligned" : r.status) as "blocked" | "degraded" | "aligned", rationale: r.opportunity_cost_summary }));

  const act = (status: IssueStatus, resolution?: string) => transition.mutate({ status, resolution });
  const canAct = can("approve") || can("apply") || can("assign");

  return (
    <div className="aurora-page">
      <RecordReport
        recordId={issue.record_key}
        module={formatModuleName(issue.module)}
        verdict={verdict}
        support={`${formatModuleName(issue.module)}${issue.grain ? ` · evaluated on ${issue.grain}` : ""} · first seen ${relativeTime(issue.first_seen_at)} · last failing ${relativeTime(issue.last_seen_at)}${issue.reopened_count ? ` · re-opened ${issue.reopened_count}×` : ""}`}
        severity={SEV(worst)}
        status={STATUS[issue.status]}
        lastUpdated={relativeTime(issue.last_seen_at)}
        actions={<Button variant="secondary" onClick={() => window.print()}>Print / PDF</Button>}
        context={[
          { id: "object", label: "Object", value: formatModuleName(issue.module) },
          { id: "key", label: "Record key", value: <span className="aurora-number">{issue.record_key}</span> },
          { id: "assignee", label: "Assigned to", value: issue.assignee_email ?? "Unassigned" },
          { id: "version", label: "Last seen in version", value: issue.last_seen_version.slice(0, 8), href: "/versions" },
          ...(issue.resolution ? [{ id: "resolution", label: "Resolution", value: issue.resolution.replace(/_/g, " ") }] : []),
        ]}
        findings={findings.map((f) => findingToRecordReport(f))}
        fixPlaybook={steps.length ? { title: "What to do", steps } : undefined}
        configImpact={configImpact}
        activity={[
          ...detail.data!.runs.map((r) => ({ id: r.version_id, timestamp: r.run_at, displayTime: new Date(r.run_at).toLocaleString(),
            actor: "Analysis", action: r.failing ? "found the record failing" : "found the record passing" })),
          ...detail.data!.events.map((e, n) => ({ id: `e${n}`, timestamp: e.created_at, displayTime: relativeTime(e.created_at),
            actor: e.user_label ?? "system", action: `${e.action.replace(/_/g, " ")}${e.from_value || e.to_value ? ` ${e.from_value ?? ""} → ${e.to_value ?? ""}` : ""}`,
            body: e.note ?? undefined })),
        ].sort((a, b) => b.timestamp.localeCompare(a.timestamp))}
        actionBar={canAct ? (
          <>
            {issue.status !== "in_progress" && issue.status !== "resolved" ? <Button variant="secondary" onClick={() => act("in_progress")} disabled={transition.isPending}>Start</Button> : null}
            {issue.status !== "resolved" ? <Button onClick={() => act("resolved", "fixed_in_source")} disabled={transition.isPending}>Fixed in SAP</Button> : null}
            {issue.status !== "accepted" ? <Button variant="ghost" onClick={() => act("accepted", "accepted_risk")} disabled={transition.isPending}>Accept risk</Button> : null}
            {issue.status !== "accepted" ? <Button variant="ghost" onClick={() => act("accepted", "false_positive")} disabled={transition.isPending}>False positive</Button> : null}
            {issue.status === "resolved" || issue.status === "accepted" ? <Button variant="ghost" onClick={() => act("open")} disabled={transition.isPending}>Re-open</Button> : null}
            <Chip tone={issue.status === "resolved" ? "success" : issue.status === "accepted" ? "info" : "warning"}>{issue.status.replace("_", " ")}</Chip>
          </>
        ) : undefined}
      />
    </div>
  );
}

export type { RecordIssue };
