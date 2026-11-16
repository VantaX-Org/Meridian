"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { getRecordSheet } from "@/lib/api/v2/object-records";
import { t } from "@/lib/v2/i18n";
import { describeField, describeTable } from "@/lib/v2/sap-fields";
import { useRecordHistory } from "@/lib/v2/step10-queries";
import { useRecordLinks, useWorkRecord } from "@/lib/v2/work-queries";
import { STATUS_LABEL, splitKey, keyLabel } from "@/lib/v2/work";
import { Button, Card, DataTable, EmptyState, FieldChip, Select, Skeleton, StatTile } from "@/ui/kit";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { useAsOf } from "./hooks";
import { PostClean, sevLabel } from "./Records";
import { TabFrame, objectPath, useTabChat } from "./TabFrame";

/** TABLE.FIELD values grouped by table, tables in first-seen order. Pure, so the grouping has a test. */
export function groupByTable(values: Record<string, string | null>): { table: string; fields: { field: string; value: string | null }[] }[] {
  const out = new Map<string, { field: string; value: string | null }[]>();
  for (const [k, v] of Object.entries(values)) {
    const at = k.indexOf(".");
    const table = at < 0 ? "" : k.slice(0, at);
    const list = out.get(table) ?? [];
    list.push({ field: at < 0 ? k : k.slice(at + 1), value: v });
    out.set(table, list);
  }
  return [...out].map(([table, fields]) => ({ table, fields }));
}

/** Runs where the record failed again after a fix was approved or sent earlier (post-clean, record_history.py:282). */
export function cameBack(runs: { run_id: string; run_at: string; failing: boolean }[], events: { at: string | null; kind: string }[]): Set<string> {
  const fixes = events.filter((e) => e.at && (e.kind === "fix_sent" || e.kind === "fix_approved")).map((e) => e.at as string).sort();
  const first = fixes[0];
  return new Set(first ? runs.filter((r) => r.failing && r.run_at > first).map((r) => r.run_id) : []);
}

export function Record({ o, system, module, recordKey }: { o: ObjectRun; system: string; module: string; recordKey: string }) {
  const fx = useFixture();
  const rec = useWorkRecord(o.module, recordKey);
  const sheet = useQuery({ queryKey: ["b13", "sheet", fx, o.module, recordKey], queryFn: () => getRecordSheet(o.module, recordKey), enabled: rec.isError, retry: false });
  const links = useRecordLinks(o.module, recordKey, o.runId);
  const hist = useRecordHistory(o.module, recordKey);
  const [asOf, setAsOf] = useState<string | null>(null);
  const asOfQ = useAsOf(o.module, asOf);

  const d = rec.data;
  const values = useMemo<Record<string, string | null>>(() => d?.values ?? Object.fromEntries(Object.entries(sheet.data?.mara ?? {}).map(([k, v]) => [`${k}`, v])), [d, sheet.data]);
  const descr = d?.field_descriptions ?? null;
  const labels = sheet.data?.labels ?? null;
  const groups = groupByTable(values);
  const runs = hist.data?.runs ?? [];
  const events = hist.data?.events ?? [];
  const back = cameBack(runs, events);
  const name = d?.name ?? hist.data?.name ?? sheet.data?.description ?? splitKey(recordKey)[0]?.value ?? recordKey;

  useTabChat(system, module, "record", o.label, [t("Why does this record fail?"), t("Did this record come back after a fix?")], () => {
    const first = d?.issues[0];
    return {
      text: first ? t("{name} fails {rule}: {msg}", { name, rule: first.check_id, msg: first.message }) : t("No open findings on {name}.", { name }),
      evidence: back.size ? [t("Failed again in {n} runs after a fix was sent", { n: back.size })] : undefined,
    };
  });

  return (
    <TabFrame o={o} system={system} module={module} tab="record" title={name}
      actions={<Button variant="secondary" href={withFixture(o.hrefWith(objectPath(system, module, "records")), fx)}>{t("Back to records")}</Button>}>
      {rec.isLoading ? <Skeleton lines={8} label={t("Loading record")} /> : (
        <div className="mx-col">
          <dl className="mx-tiles">
            {splitKey(recordKey).map((p) => <StatTile key={p.field + p.value} label={keyLabel(p.field)} value={p.value} />)}
            <StatTile label={t("Status")} value={d ? (STATUS_LABEL[d.status] ?? d.status) : t("n/a")} />
            <StatTile label={t("Open findings")} value={d ? String(d.issues.length) : t("n/a")} />
          </dl>

          <Card title={t("Findings")} sub={t("What fails on this record and why it matters")}>
            {d?.issues.length ? (
              <DataTable label={t("Findings")} rows={d.issues} rowKey={(i) => i.check_id + i.field} height={Math.min(360, 60 + 44 * d.issues.length)} columns={[
                { key: "rule", label: t("Rule"), render: (i) => <code className="mx-code">{i.check_id}</code> },
                { key: "sev", label: t("Severity"), render: (i) => <span className="mx-sev" data-sev={i.severity}><i className="mx-dot" aria-hidden="true" />{sevLabel(i.severity)}</span> },
                { key: "field", label: t("Field"), render: (i) => i.field ? <FieldChip code={i.field} description={describeField(i.field, descr) ?? undefined} /> : null },
                { key: "now", label: t("Current value"), render: (i) => i.current_value ?? t("empty") },
                { key: "fix", label: t("Suggested value"), render: (i) => i.suggestion?.value ?? t("n/a") },
                { key: "msg", label: t("Why it matters"), render: (i) => i.why_it_matters || i.message },
              ]} />
            ) : <EmptyState heading={t("No open findings on this record.")} />}
          </Card>

          <Card title={t("Field values")} sub={t("Every value as it stands in this run, with its meaning")}>
            {groups.length ? groups.map((g) => (
              <section key={g.table || "all"}>
                <h3 className="mx-card-t">{g.table ? <FieldChip code={g.table} description={describeTable(g.table) ?? undefined} /> : t("Values")}</h3>
                <DataTable label={g.table || t("Values")} rows={g.fields} rowKey={(f) => f.field} height={Math.min(320, 60 + 40 * g.fields.length)} columns={[
                  { key: "field", label: t("Field"), render: (f) => <FieldChip code={f.field} description={labels?.[f.field] ?? describeField(f.field, descr) ?? undefined} /> },
                  { key: "value", label: t("Value"), render: (f) => f.value ?? t("empty") },
                ]} />
              </section>
            )) : <EmptyState heading={t("No field values are stored for this record in this run.")} />}
          </Card>

          <Card title={t("Post-clean monitoring")} sub={t("Did this record fail again after a fix?")}>
            <dl className="mx-tiles">
              <StatTile label={t("Runs that failed")} value={String(runs.filter((r) => r.failing).length)} />
              <StatTile label={t("Failed again after a fix")} value={String(back.size)} />
            </dl>
            <PostClean />
          </Card>

          <Card title={t("History across runs")} sub={t("Oldest first")}>
            {runs.length ? (
              <DataTable label={t("History across runs")} rows={runs} rowKey={(r) => r.run_id} height={Math.min(320, 60 + 40 * runs.length)} columns={[
                { key: "run", label: t("Run"), render: (r) => r.label },
                { key: "at", label: t("Run date"), render: (r) => r.run_at.slice(0, 10), sort: (r) => r.run_at },
                { key: "fail", label: t("Result"), render: (r) => r.failing ? (back.has(r.run_id) ? t("Failed again after a fix") : t("Failed")) : t("Passed") },
                { key: "rules", label: t("Rules failed"), render: (r) => r.checks.map((c) => <code className="mx-code" key={c}>{c}</code>) },
                { key: "st", label: t("Work status"), render: (r) => r.work_status ? (STATUS_LABEL[r.work_status] ?? r.work_status) : "" },
              ]} />
            ) : <EmptyState heading={t("This record has no history yet.")} />}
            {runs.length ? (
              <div className="mx-links">
                <Select aria-label={t("Show the object as of a run")} value={asOf ?? ""} onChange={(e) => setAsOf(e.target.value || null)} options={[{ value: "", label: t("Show the object as of a run") }, ...runs.map((r) => ({ value: r.run_id, label: r.label ?? r.run_id }))]} />
                {asOfQ.data ? <span className="mx-muted">{t("As of {run}: score {score}, {n} failing records", { run: asOfQ.data.run_at.slice(0, 10), score: asOfQ.data.score ?? t("n/a"), n: asOfQ.data.failing_records })}</span> : null}
              </div>
            ) : null}
          </Card>

          <Card title={t("Change log")} sub={t("Every proposal, approval and send, with who did it")}>
            {events.length ? (
              <DataTable label={t("Change log")} rows={events} rowKey={(e) => `${e.at}${e.action}${e.check_id}${e.to_value}`} height={Math.min(320, 60 + 40 * events.length)} columns={[
                { key: "at", label: t("When"), render: (e) => (e.at ?? "").slice(0, 16).replace("T", " "), sort: (e) => e.at ?? "" },
                { key: "act", label: t("Action"), render: (e) => e.action ?? e.kind },
                { key: "rule", label: t("Rule"), render: (e) => e.check_id ? <code className="mx-code">{e.check_id}</code> : null },
                { key: "from", label: t("From"), render: (e) => e.from_value ?? "" },
                { key: "to", label: t("To"), render: (e) => e.to_value ?? "" },
                { key: "by", label: t("By"), render: (e) => e.by ?? "" },
              ]} />
            ) : <EmptyState heading={t("Nothing has been changed on this record.")} />}
          </Card>

          <Card title={t("Where it came from")} sub={t("Source tables and linked records")}>
            {links.data?.provenance ? (
              <p className="mx-muted">{t("Run {run} from {system}, extracted {at}", { run: links.data.provenance.run_id, system: links.data.provenance.system_name ?? "", at: links.data.provenance.extracted_at?.slice(0, 10) ?? "" })}</p>
            ) : null}
            {links.data?.provenance?.source_tables.map((s) => (
              <p key={s.table}><FieldChip code={s.table} description={describeTable(s.table) ?? undefined} /> {s.fields.map((f) => <FieldChip key={f} code={f} description={describeField(f, descr) ?? undefined} />)}</p>
            ))}
            <div className="mx-links">
              {d?.golden_record ? <Button variant="secondary" href={withFixture(o.hrefWith(objectPath(system, module, "golden")), fx)}>{t("Open golden record")}</Button> : null}
              {d?.duplicates?.open ? <Button variant="secondary" href={withFixture(o.hrefWith(objectPath(system, module, "golden")), fx)}>{t("{n} open duplicates", { n: d.duplicates.open })}</Button> : null}
              <Button variant="ghost" href={withFixture(`/work?module=${encodeURIComponent(o.module)}&q=${encodeURIComponent(recordKey)}`, fx)}>{t("Open in the work queue")}</Button>
            </div>
            {!links.data?.provenance && !d?.golden_record && !d?.duplicates?.open ? <EmptyState heading={t("No lineage was recorded for this record.")} /> : null}
          </Card>
        </div>
      )}
    </TabFrame>
  );
}
