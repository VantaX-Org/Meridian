"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { withFixture, useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { describeField } from "@/lib/v2/sap-fields";
import { useWorkRows } from "@/lib/v2/work-queries";
import { STATUS_LABEL, alphaOut, displayKey, keyHeaders, splitKey } from "@/lib/v2/work";
import type { WorkRow } from "@/lib/api/v2/types";
import { Button, Card, DataTable, EmptyState, ErrorState, FieldChip, Search, Select, Skeleton, StatTile, TrendArea, type Column, SeverityPill } from "@/ui/kit";
import { compactCount } from "@/ui/screens/object/format";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { useBackAfterClean } from "./hooks";
import { TabFrame, objectPath, useTabChat } from "./TabFrame";

export const sevLabel = (s: string): string => (s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : s === "low" ? t("Low") : t("Info"));
export const recordPath = (system: string, module: string, key: string) => objectPath(system, module, `records/${encodeURIComponent(key)}`);

/** The post-clean read: records that were fixed and came back (record_history.py:282). Shown on Records and on one record. */
export function PostClean({ rule }: { rule?: string }) {
  const q = useBackAfterClean();
  if (q.isLoading) return <Skeleton lines={3} label={t("Loading post-clean monitoring")} />;
  if (q.isError || !q.data) return <EmptyState heading={t("No post-clean reading yet. Once fixes are sent to SAP, records that return are counted here.")} />;
  const d = q.data;
  const rules = rule ? d.rules.filter((r) => r.check_id === rule) : d.rules;
  const back = d.weeks.reduce((n, w) => n + w.back, 0);
  const fixed = d.weeks.reduce((n, w) => n + w.fixed, 0);
  return (
    <>
      <dl className="mx-tiles">
        <StatTile label={t("Fixed in the last 12 weeks")} value={compactCount(fixed)} />
        <StatTile label={t("Came back")} value={compactCount(back)} note={fixed ? t("{n}% of those fixed", { n: Math.round((100 * back) / fixed) }) : undefined} bar={fixed ? (100 * back) / fixed : 0} barTone="data" />
      </dl>
      <TrendArea
        points={d.weeks.map((w) => ({ axis: w.week, title: t("Week of {week}: {n} came back", { week: w.week, n: w.back }), value: w.fixed ? Math.round((100 * w.back) / w.fixed) : 0 }))}
        label={t("Share of fixed records that came back, by week")}
        emptyLabel={t("Not enough weeks to draw a trend yet")}
      />
      {rules.length ? (
        <DataTable
          label={t("Rules whose fixed records came back")}
          rows={rules.slice(0, 8)}
          rowKey={(r) => r.check_id}
          height={200}
          columns={[
            { key: "rule", label: t("Rule"), render: (r) => <FieldChip code={r.check_id} description={r.message ?? undefined} /> },
            { key: "fixed", label: t("Fixed"), align: "end", render: (r) => r.fixed, sort: (r) => r.fixed },
            { key: "back", label: t("Came back"), align: "end", render: (r) => r.back, sort: (r) => r.back },
          ]}
        />
      ) : null}
    </>
  );
}

export function Records({ o, system, module }: { o: ObjectRun; system: string; module: string }) {
  const router = useRouter();
  const fx = useFixture();
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const rowsQ = useWorkRows({ module: o.module, version_id: o.runId ?? undefined, q: q || undefined, severity: severity || undefined, status: status || undefined }, "value");
  const rows = useMemo(() => rowsQ.data?.pages.flatMap((p) => p.items) ?? [], [rowsQ.data]);
  const heads = keyHeaders(rows);

  useTabChat(system, module, "records", o.label, [t("Which records carry the most risk?"), t("Which fixed records came back?")], () => {
    const top = rows[0];
    return {
      text: top
        ? t("{n} records are loaded. The one with the most at stake is {name}: {msg}.", { n: rows.length, name: top.name ?? top.record_key, msg: top.top_message ?? t("see its findings") })
        : t("No records match this filter."),
      actions: top ? [{ id: "open", label: t("Open the record"), href: withFixture(o.hrefWith(recordPath(system, module, top.record_key)), fx) }] : undefined,
    };
  });

  const columns: Column<WorkRow>[] = [
    { key: "record", label: heads.first, render: (r) => <><strong>{r.name ?? alphaOut(splitKey(r.record_key)[0]?.value ?? "")}</strong> <span className="mx-muted">{displayKey(r.record_key)}</span></>, sort: (r) => r.record_key },
    { key: "sev", label: t("Severity"), render: (r) => <SeverityPill sev={r.severity} label={sevLabel(r.severity)} />, sort: (r) => r.severity },
    { key: "issues", label: t("Issues"), align: "end", render: (r) => r.issues, sort: (r) => r.issues },
    {
      key: "finding", label: t("Top finding"),
      render: (r) => <>{r.top_field ? <FieldChip code={r.top_field} description={r.field_description ?? describeField(r.top_field) ?? undefined} /> : null} {r.top_message ?? ""}</>,
    },
    { key: "status", label: t("Status"), render: (r) => STATUS_LABEL[r.status] ?? r.status, sort: (r) => r.status },
    { key: "risk", label: t("Value at risk"), align: "end", render: (r) => (r.value_at_risk == null ? t("n/a") : compactCount(r.value_at_risk)), sort: (r) => r.value_at_risk ?? 0 },
  ];

  return (
    <TabFrame o={o} system={system} module={module} tab="records" title={t("Records")} actions={<Button variant="secondary" href={withFixture(`/work?module=${encodeURIComponent(o.module)}`, fx)}>{t("Open in the work queue")}</Button>}>
      <div className="mx-col">
        <Card title={t("Post-clean monitoring")} sub={t("Records that were fixed and failed again")}><PostClean /></Card>
        <Card title={t("Records with findings")} sub={t("{n} loaded", { n: rows.length })}>
          <div className="mx-links">
            <Search value={q} onChange={setQ} label={t("Search records")} clearLabel={t("Clear")} placeholder={t("Search by key or name")} />
            <Select aria-label={t("Severity")} value={severity} onChange={(e) => setSeverity(e.target.value)} options={[{ value: "", label: t("Any severity") }, ...["critical", "high", "medium", "low"].map((s) => ({ value: s, label: sevLabel(s) }))]} />
            <Select aria-label={t("Status")} value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: "", label: t("Any status") }, ...Object.keys(STATUS_LABEL).map((s) => ({ value: s, label: STATUS_LABEL[s] }))]} />
          </div>
          {rowsQ.isLoading ? <Skeleton lines={6} label={t("Loading records")} /> : rowsQ.isError ? <ErrorState heading={t("The records could not be loaded")} /> : rows.length === 0 ? <EmptyState heading={t("No records match this filter.")} /> : (
            <DataTable
              label={t("Records with findings")}
              rows={rows}
              rowKey={(r) => r.record_key}
              columns={columns}
              height={440}
              onSelect={(r) => router.push(withFixture(o.hrefWith(recordPath(system, module, r.record_key)), fx))}
            />
          )}
          {rowsQ.hasNextPage ? <div className="mx-links"><Button variant="secondary" onClick={() => void rowsQ.fetchNextPage()} disabled={rowsQ.isFetchingNextPage}>{t("Load more records")}</Button></div> : null}
        </Card>
      </div>
    </TabFrame>
  );
}
