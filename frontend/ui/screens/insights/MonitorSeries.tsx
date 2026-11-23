"use client";

/**
 * Monitor: where the cleaning queue is stuck (GET /analytics/bottlenecks), whether the stewards can keep up
 * (GET /analytics/capacity), and the master data health score over time (GET /analytics/mdm-health and
 * GET /mdm-metrics/history).
 */
import { useState } from "react";
import { getBottlenecks, getCapacity, getMdmHealthSeries } from "@/lib/api/v2/analytics";
import { getMdmHistory } from "@/lib/api/v2/mdm-health";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { BarList, Card, FieldChip, Select, StatTile, TrendArea } from "@/ui/kit";
import { Gate, Tbl, day, n0, n1, useQ } from "./shared";

const DAYS = [28, 56, 112];

export function QueueCards() {
  useInterfaceLang();
  const b = useQ("bottlenecks", getBottlenecks);
  const c = useQ("capacity", getCapacity);
  const stages = b.data?.bottlenecks ?? [];
  const cap = c.data;
  return (
    <div className="mb-grid">
      <Card title={t("Queue bottlenecks")} sub={t("Stages holding more than 50 items or averaging over 72 hours")}>
        <Gate q={b} empty={stages.length === 0} emptyHeading={t("No stage is stuck")} emptyBody={t("Every queue stage is small and young.")}>
          <div className="b8-stack">
            <BarList label={t("Items per stage")} items={stages.map((s) => ({ id: s.stage, label: labelText(s.stage), value: s.count, display: n0(s.count) }))} />
            <Tbl label={t("Queue bottlenecks")} rows={stages} rowKey={(r) => r.stage} cols={[
              { key: "s", label: t("Stage"), render: (r) => <FieldChip code={r.stage} description={labelText(r.stage)} /> },
              { key: "n", label: t("Items"), end: true, render: (r) => n0(r.count) },
              { key: "a", label: t("Average age in hours"), end: true, render: (r) => n1(r.avg_age_hours) },
            ]} />
            <p className="mx-muted">{t("{n} items in the whole queue.", { n: n0(b.data?.total_queue_size) })}</p>
          </div>
        </Gate>
      </Card>
      <Card title={t("Steward capacity")} sub={t("Stewards needed for the recorded inflow")}>
        <Gate q={c} empty={!cap} emptyHeading={t("No capacity read")} emptyBody={t("Capacity appears once the queue records inflow.")}>
          {cap ? (
            <div className="b8-stack">
              <dl className="mx-tiles">
                <StatTile label={t("Stewards now")} value={n0(cap.current)} />
                <StatTile label={t("Stewards needed")} value={n0(cap.needed)} />
                <StatTile label={t("Surplus or deficit")} value={cap.surplus_deficit === null ? t("n/a") : (cap.surplus_deficit > 0 ? "+" : "") + n0(cap.surplus_deficit)} />
                <StatTile label={t("Inflow a day")} value={n0(cap.daily_inflow)} />
                <StatTile label={t("Items per steward a day")} value={n0(cap.per_steward)} />
              </dl>
              {cap.reason ? <p className="mx-muted">{cap.reason === "no_inflow" ? t("No inflow is recorded, so the need cannot be worked out.") : t("No steward is recorded, so the pace per steward cannot be worked out.")}</p> : null}
            </div>
          ) : null}
        </Gate>
      </Card>
    </div>
  );
}

export function MdmSeriesCard() {
  useInterfaceLang();
  const [days, setDays] = useState(56);
  const s = useQ("mdm-series", () => getMdmHealthSeries(days), [days]);
  const h = useQ("mdm-history", () => getMdmHistory(days), [days]);
  const rows = s.data?.data ?? [];
  const hist = h.data?.history ?? [];
  const last = rows[rows.length - 1];
  return (
    <Card title={t("Master data health over time")} sub={t("One snapshot a day")}
      action={<Select aria-label={t("Days shown")} value={String(days)} onChange={(e) => setDays(Number(e.target.value))} options={DAYS.map((d) => ({ value: String(d), label: t("{n} days", { n: String(d) }) }))} />}>
      <Gate q={s} empty={rows.length === 0} emptyHeading={t("No health snapshots yet")} emptyBody={t("A snapshot is taken each day master data is scored.")}>
        <div className="b8-stack">
          <dl className="mx-tiles">
            <StatTile label={t("Health score")} value={n1(last?.mdm_health_score)} note={day(last?.snapshot_date)} />
            <StatTile label={t("Backlog")} value={n0(last?.backlog_count)} />
            {last?.ai_projected_score != null ? <StatTile label={t("Projected score")} value={n1(last.ai_projected_score)} /> : null}
          </dl>
          <TrendArea label={t("Master data health score")} emptyLabel={t("No history")}
            points={rows.filter((r) => r.mdm_health_score !== null).map((r) => ({ axis: day(r.snapshot_date), title: day(r.snapshot_date), value: r.mdm_health_score ?? 0 }))} />
          {last?.ai_narrative ? <p className="mx-muted">{last.ai_narrative}</p> : null}
          {hist.length ? (
            <TrendArea label={t("Steward backlog")} emptyLabel={t("No history")}
              points={hist.map((r) => ({ axis: day(r.snapshot_date), title: day(r.snapshot_date), value: r.backlog_count }))} />
          ) : null}
        </div>
      </Gate>
    </Card>
  );
}
