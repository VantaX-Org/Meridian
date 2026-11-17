"use client";

import { getStewardMetrics } from "@/lib/api/v2/stewardship";
import { t } from "@/lib/v2/i18n";
import { BarList, Button, Card, DataTable, EmptyState, PageHeader, StatTile, useAletheia, useAletheiaScope } from "@/ui/kit";
import { Gate, useQ } from "./common";

const pct = (v: number | null | undefined) => (v === null || v === undefined ? t("n/a") : `${Math.round(v * (v <= 1 ? 100 : 1))}%`);
const word = (s: string) => s.replace(/_/g, " ");

export function Stewardship() {
  const q = useQ(["stewardship-metrics"], () => getStewardMetrics());
  const chat = useAletheia();
  const d = q.data;
  useAletheiaScope({
    key: "stewardship",
    label: t("Stewardship"),
    suggestions: [t("What is the backlog?"), t("Who has overdue items?")],
    answer: () => ({
      text: d
        ? t("{backlog} items are waiting and {overdue} are overdue. SLA compliance is {sla}.", { backlog: d.backlog_total, overdue: d.overdue_count, sla: pct(d.sla_compliance_rate) })
        : t("The stewardship numbers are still loading."),
    }),
  });
  return (
    <>
      <PageHeader title={t("Stewardship")} context={t("Backlog, SLA and who is carrying it")} actions={<Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>} />
      <Gate q={q} label={t("Loading stewardship")}>
        {(m) => (
          <div className="mx-col">
            <dl className="mx-tiles">
              <StatTile label={t("Backlog")} value={m.backlog_total} />
              <StatTile label={t("Overdue")} value={m.overdue_count} />
              <StatTile label={t("SLA compliance")} value={pct(m.sla_compliance_rate)} />
              <StatTile label={t("AI acceptance")} value={pct(m.ai_acceptance_rate)} />
            </dl>
            <Card title={t("By status")}>
              {Object.keys(m.items_by_status).length === 0 ? <EmptyState heading={t("No items")} /> : (
                <BarList label={t("Items by status")} items={Object.entries(m.items_by_status).map(([k, v]) => ({ id: k, label: word(k), value: v }))} />
              )}
            </Card>
            <Card title={t("By type")} sub={t("Average hours to resolve")}>
              {Object.keys(m.items_by_type).length === 0 ? <EmptyState heading={t("No items")} /> : (
                <BarList label={t("Items by type")} items={Object.entries(m.items_by_type).map(([k, v]) => {
                  const h = m.avg_resolution_hours_by_type?.[k];
                  return { id: k, label: word(k), value: v, display: h === undefined ? String(v) : `${v}, ${Math.round(h)} h` };
                })} />
              )}
            </Card>
            <Card title={t("By steward")}>
              {!m.steward_breakdown || m.steward_breakdown.length === 0 ? (
                <EmptyState heading={t("No steward breakdown")} body={t("The breakdown appears once items are assigned to people.")} />
              ) : (
                <DataTable
                  label={t("Stewards")}
                  rows={m.steward_breakdown}
                  rowKey={(s) => s.user_id}
                  columns={[
                    { key: "name", label: t("Steward"), render: (s) => s.name ?? s.user_id },
                    { key: "open", label: t("Open"), align: "end", sort: (s) => s.open, render: (s) => s.open },
                    { key: "resolved", label: t("Resolved"), align: "end", sort: (s) => s.resolved, render: (s) => s.resolved },
                    { key: "overdue", label: t("Overdue"), align: "end", sort: (s) => s.overdue, render: (s) => s.overdue },
                  ]}
                />
              )}
            </Card>
          </div>
        )}
      </Gate>
    </>
  );
}
