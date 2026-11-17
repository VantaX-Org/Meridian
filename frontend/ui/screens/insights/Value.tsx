"use client";

import { getImpactPortfolio, getValue } from "@/lib/api/v2/analytics";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { BarList, Button, Card, PageHeader, StatTile, TrendArea, useAletheia, useAletheiaScope } from "@/ui/kit";
import { Gate, InsightsNav, Tbl, money, n0, n1, useQ } from "./shared";

export function Value() {
  useInterfaceLang();
  const chat = useAletheia();
  const val = useQ("value", getValue);
  const port = useQ("portfolio", getImpactPortfolio);
  const v = val.data;
  useAletheiaScope({
    key: "insights/value",
    label: t("Asking about the value"),
    suggestions: [t("How is the return calculated?"), t("Which finding saved the most?"), t("What is still at risk?")],
    context: v?.version_id ? { version_id: v.version_id } : undefined,
  });
  const cur = v?.roi.currency;
  const rows = port.data?.impacts ?? [];
  return (
    <div className="b8-page">
      <PageHeader title={t("Value")} context={t("What the programme returns against what it costs, and how each figure is worked out.")}
        actions={<><InsightsNav here="value" /><Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button></>} />
      <Gate q={val} empty={!v || !v.roi} emptyHeading={t("No value measured yet")} emptyBody={t("Value appears once findings are fixed and costed.")}>
        {v ? (
          <div className="b8-stack">
            <dl className="mx-tiles">
              <StatTile label={t("Risk mitigated")} value={money(v.roi.risk_mitigated, cur)} />
              <StatTile label={t("Subscription per year")} value={money(v.roi.subscription_annual, cur)} />
              <StatTile label={t("Return multiple")} value={`${n1(v.roi.roi_multiple)}x`} />
              <StatTile label={t("Payback, months")} value={n1(v.roi.payback_months)} />
            </dl>
            <Card title={t("Return over time")}>
              <TrendArea label={t("Cumulative return multiple")} emptyLabel={t("No history yet")} points={v.cost_avoidance_history.map((h) => ({ axis: h.period, title: h.period, value: h.cumulative_roi_multiple }))} />
            </Card>
            <Card title={t("Risk by category")}>
              <BarList label={t("Annual risk by category")} items={v.impacts.map((i) => ({ id: i.category, label: i.category, value: i.annual_risk, display: money(i.annual_risk, i.currency) }))} />
            </Card>
            <Card title={t("How each figure is worked out")}>
              <Tbl label={t("Value calculation")} rows={v.impacts} rowKey={(r) => r.category} cols={[
                { key: "c", label: t("Category"), render: (r) => r.category },
                { key: "r", label: t("Annual risk"), end: true, render: (r) => money(r.annual_risk, r.currency) },
                { key: "m", label: t("Mitigated"), end: true, render: (r) => money(r.mitigated, r.currency) },
                { key: "f", label: t("Findings"), end: true, render: (r) => n0(r.finding_count) },
                { key: "x", label: t("Method"), render: (r) => r.calculation_method },
              ]} />
            </Card>
          </div>
        ) : null}
      </Gate>
      <Card title={t("Impact portfolio")}>
        <Gate q={port} empty={rows.length === 0} emptyHeading={t("No impact portfolio yet")}>
          <Tbl label={t("Impact portfolio")} rows={rows} rowKey={(r) => r.category} cols={[
            { key: "c", label: t("Category"), render: (r) => r.category },
            { key: "r", label: t("Annual risk"), end: true, render: (r) => money(r.annual_risk, r.currency) },
            { key: "m", label: t("Mitigated"), end: true, render: (r) => money(r.mitigated, r.currency) },
          ]} />
        </Gate>
      </Card>
    </div>
  );
}
