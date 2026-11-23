"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { bulkIssues, commentIssue, exportIssues, getIssue, getIssues, ISSUE_STATUSES, RESOLUTIONS, type Issue, type IssueStatus } from "@/lib/api/v2/issues";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Chip, Code, DataTable, DetailPanel, Input, Search, Split, useToast, ExportMenu } from "@/ui/kit";
import { Async, Empty, Head, num, Sev, useRead, useScreenScope, when } from "./shared";
import { displayKey } from "@/lib/v2/work";

const statusText = (s: string) => ({
  open: t("Open"), in_progress: t("In progress"), waiting_sap: t("Waiting for SAP"), waiting_requester: t("Waiting for requester"), accepted: t("Accepted"), resolved: t("Resolved"),
} as Record<string, string>)[s] ?? s;

function IssueDetail({ id }: { id: string }) {
  const [tab, setTab] = useState("history");
  const [note, setNote] = useState("");
  const toast = useToast();
  const qc = useQueryClient();
  const q = useRead(["issue", id], () => getIssue(id));
  const send = async () => {
    if (!note.trim()) return;
    try { await commentIssue(id, note.trim()); setNote(""); toast(t("Comment added"), "good"); void qc.invalidateQueries({ queryKey: ["b7b"] }); }
    catch { toast(t("The comment could not be saved"), "bad"); }
  };
  return (
    <Async q={q}>
      {(d) => (
        <DetailPanel idBase="iss" label={t("Issue detail")} tabsLabel={t("Issue sections")} value={tab} onChange={setTab}
          tabs={[{ id: "history", label: t("History") }, { id: "runs", label: t("Runs") }]}
          header={<><Sev s={d.issue.severity} /><Code code={d.issue.check_id} description={d.issue.message ?? undefined} /><span className="mx-muted">{d.issue.record_key ? displayKey(d.issue.record_key) : null}</span></>}>
          {tab === "history" && (
            <>
              {d.events.length ? (
                <ul className="mx-links">{d.events.map((e, i) => (
                  <li key={i}>{when(e.created_at)} {e.user_label ?? ""} {e.action === "comment" ? e.note : `${statusText(e.from_value ?? "")} ${t("to")} ${statusText(e.to_value ?? "")}`}</li>
                ))}</ul>
              ) : <Empty heading={t("No history yet")} />}
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Add a comment")} aria-label={t("Add a comment")} />
              <Button variant="secondary" onClick={() => void send()}>{t("Comment")}</Button>
            </>
          )}
          {tab === "runs" && (d.runs.length ? (
            <DataTable label={t("Runs that saw this issue")} rows={d.runs} rowKey={(r) => r.version_id} height={260}
              columns={[
                { key: "run", label: t("Run"), render: (r) => <Code code={r.version_id.slice(0, 8)} /> },
                { key: "at", label: t("Date"), render: (r) => when(r.run_at) },
                { key: "f", label: t("State"), render: (r) => (r.failing ? t("Failing") : t("Passing")) },
              ]} />
          ) : <Empty heading={t("No runs")} />)}
        </DetailPanel>
      )}
    </Async>
  );
}

export function IssuesScreen() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const toast = useToast();
  const qc = useQueryClient();
  const q = useRead(["issues", status, search], () => getIssues({ status: status || undefined, search: search || undefined, limit: 100 }));
  useScreenScope("issues", t("Record issues"), [
    { prompt: t("How many issues are open?"), answer: () => ({ text: `${q.data?.counts.open ?? 0} ${t("open")}` }) },
  ]);
  const act = async (next: IssueStatus) => {
    if (!picked.length) return;
    try { await bulkIssues({ ids: picked, status: next, resolution: RESOLUTIONS[next]?.[0] }); toast(t("Issues updated"), "good"); setPicked([]); void qc.invalidateQueries({ queryKey: ["b7b"] }); }
    catch { toast(t("The issues could not be updated"), "bad"); }
  };
  const first = q.data?.items[0]?.id;
  const cur = sel ?? first ?? null;
  return (
    <>
      <Head title={t("Record issues")} context={q.data ? `${num(q.data.total)} ${t("issues")}` : undefined}
        actions={<ExportMenu formats={[{ id: "csv", label: t("CSV"), hint: t("The issues that match the filters") }, { id: "xlsx", label: t("Excel"), hint: t("The issues that match the filters") }]} onExport={(f) => exportIssues({ status: status || undefined, search: search || undefined }, f === "csv" ? "csv" : "xlsx")} />} />
      <Split leftLabel={t("Issues")} rightLabel={t("Issue detail")}
        left={
          <>
            <div className="mx-links">
              <Chip selected={status === ""} onClick={() => setStatus("")}>{t("All")}</Chip>
              {ISSUE_STATUSES.map((s) => <Chip key={s} selected={status === s} onClick={() => setStatus(s)} count={q.data?.counts[s]}>{statusText(s)}</Chip>)}
            </div>
            <Search value={search} onChange={setSearch} label={t("Search issues")} clearLabel={t("Clear search")} placeholder={t("Rule or record")} />
            <Card title={t("Bulk change")} sub={`${picked.length} ${t("selected")}`}>
              <Button variant="secondary" onClick={() => void act("in_progress")}>{t("Start work")}</Button>
              <Button variant="secondary" onClick={() => void act("resolved")}>{t("Resolve")}</Button>
            </Card>
            <Async q={q}>
              {(d) => (d.items.length ? (
                <DataTable<Issue> label={t("Issues")} rows={d.items} rowKey={(i) => i.id} selected={cur}
                  onSelect={(i) => { setSel(i.id); setPicked((p) => (p.includes(i.id) ? p.filter((x) => x !== i.id) : [...p, i.id])); }} height={420}
                  columns={[
                    { key: "sev", label: t("Severity"), sort: (i) => i.severity, render: (i) => <Sev s={i.severity} /> },
                    { key: "rule", label: t("Rule"), sort: (i) => i.check_id, render: (i) => <Code code={i.check_id} description={i.message ?? undefined} /> },
                    { key: "rec", label: t("Record"), render: (i) => (i.record_key ? displayKey(i.record_key) : "") },
                    { key: "st", label: t("Status"), render: (i) => `${picked.includes(i.id) ? "+ " : ""}${statusText(i.status)}` },
                  ]} />
              ) : <Empty heading={t("No issues match")} />)}
            </Async>
          </>
        }
        right={cur ? <IssueDetail id={cur} /> : <Empty heading={t("Pick an issue")} />} />
    </>
  );
}
