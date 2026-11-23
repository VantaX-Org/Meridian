"use client";

import { useCrumbs } from "@/ui/screens/flow";
import { useStatusPage } from "@/lib/v2/enterprise-queries";
import { formatDate } from "@/lib/format";
import { currentMaintenance, dayCells, overallVerdict, overallWord, statusWord } from "@/lib/v2/status";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { Card, DataTable, EmptyState, ErrorState, FieldChip, PageHeader, Skeleton, StatTile, TrendArea, type Severity, SeverityPill } from "@/ui/kit";

const pct = (n: number | null | undefined) => (n == null ? t("n/a") : `${n.toFixed(2)}%`);
const SEV: Record<string, Severity> = { go: "low", "at-risk": "medium", "no-go": "critical" };

/** Whether Meridian is running: overall state, the last 30 days, each component, server errors and planned maintenance. Reads only. */
export function Status() {
  const crumbs = useCrumbs();
  useInterfaceLang();
  const q = useStatusPage();
  const page = q.data;
  if (q.isError) return <ErrorState heading={t("The status could not be read")} body={t("The server may be restarting.")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  if (!page) return <Skeleton lines={6} label={t("Loading the status")} />;
  const maint = currentMaintenance(page.maintenance);
  const verdict = overallVerdict(page.status);
  const cells = dayCells(page.uptime, page.generated_at);
  const upBy = new Map(page.uptime.components.map((c) => [c.id, c.uptime_pct]));
  return (
    <>
      <PageHeader crumbs={crumbs("status")} title={t("Status")} context={t("Checked {updated}. This page reads again every minute.", { updated: formatDate(page.generated_at, "datetime") })} />
      <dl className="mx-tiles">
        <StatTile label={t("Overall")} value={<SeverityPill sev={SEV[verdict]} label={overallWord(page.status)} />} note={page.status === "operational" ? t("Every part of the platform is working.") : page.status === "degraded" ? t("Part of the platform is slower or less available than usual.") : t("A core part of the platform is down.")} />
        <StatTile label={t("Uptime, last 30 days")} value={pct(page.uptime.overall_pct)} bar={page.uptime.overall_pct ?? 0} barTone="pass" />
        <StatTile label={t("Server errors, last 24 hours")} value={page.incidents.reduce((n, i) => n + i.count, 0)} />
      </dl>
      {maint ? (
        <Card title={maint.in_progress ? t("Maintenance in progress") : t("Planned maintenance")} sub={`${formatDate(maint.starts_at, "datetime")} - ${formatDate(maint.ends_at, "datetime")}`}>
          <p><strong>{maint.title}</strong> {maint.detail ?? ""}</p>
        </Card>
      ) : null}
      <Card title={t("Last 30 days")} sub={t("Uptime day by day.")}>
        <TrendArea label={t("Uptime day by day")} emptyLabel={t("No checks recorded yet.")} points={cells.map((c) => ({ axis: c.day.slice(5), title: `${c.day}: ${c.uptimePct == null ? t("No checks recorded") : pct(c.uptimePct)}`, value: c.uptimePct }))} />
      </Card>
      <Card title={t("Components")}>
        <DataTable
          label={t("Components")}
          rows={page.components}
          rowKey={(c) => c.id}
          height={280}
          columns={[
            { key: "label", label: t("Component"), sort: (c) => c.label, render: (c) => <>{c.label} <FieldChip code={c.id} description={c.label} /></> },
            { key: "status", label: t("State"), sort: (c) => c.status, render: (c) => <SeverityPill sev={c.status === "up" ? "low" : c.status === "degraded" ? "medium" : c.status === "down" ? "critical" : "info"} label={statusWord(c.status)} /> },
            { key: "lat", label: t("Latency"), align: "end", sort: (c) => c.latency_ms ?? -1, render: (c) => <span className="mx-num">{c.latency_ms == null ? t("n/a") : t("{n} ms", { n: Math.round(c.latency_ms) })}</span> },
            { key: "up", label: t("Uptime, 30 days"), align: "end", sort: (c) => upBy.get(c.id) ?? -1, render: (c) => <span className="mx-num">{pct(upBy.get(c.id))}</span> },
            { key: "detail", label: t("Detail"), render: (c) => c.detail ?? "" },
          ]}
        />
      </Card>
      <Card title={t("Server errors, last 24 hours")}>
        {page.incidents.length ? (
          <DataTable
            label={t("Server errors")}
            rows={page.incidents}
            rowKey={(i) => i.reference}
            height={240}
            columns={[
              { key: "ref", label: t("Reference"), sort: (i) => i.reference, render: (i) => <FieldChip code={i.reference} description={i.areas[0] ?? t("n/a")} /> },
              { key: "n", label: t("Errors"), align: "end", sort: (i) => i.count, render: (i) => <span className="mx-num">{i.count}</span> },
              { key: "last", label: t("Last seen"), sort: (i) => i.last_seen, render: (i) => formatDate(i.last_seen, "datetime") },
              { key: "areas", label: t("Areas"), render: (i) => i.areas.join(", ") },
            ]}
          />
        ) : <EmptyState heading={t("No server errors")} body={t("Nothing failed in the last 24 hours.")} />}
      </Card>
    </>
  );
}
