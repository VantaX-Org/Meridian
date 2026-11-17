"use client";

import { getForecast, getPredictive } from "@/lib/api/v2/analytics";
import { getHeatmap } from "@/lib/api/v2/score";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { Button, Card, EmptyState, PageHeader, Select, StatTile, TrendArea, useAletheia, useAletheiaScope } from "@/ui/kit";
import { useState } from "react";
import { Gate, InsightsNav, Mod, Tbl, n0, n1, useQ } from "./shared";

const trendText = (s: string) => (s === "improving" ? t("Improving") : s === "declining" ? t("Declining") : s === "critical" ? t("Critical") : t("Stable"));

function ModuleForecast({ module }: { module: string }) {
  const q = useQ("forecast", () => getForecast(module), [module]);
  const f = q.data?.forecast ?? null;
  return (
    <Gate q={q} empty={!f} emptyHeading={t("Not enough runs to forecast")} emptyBody={q.data?.message ?? t("A forecast needs several scored runs.")}>
      {f ? (
        <div className="b8-stack">
          <dl className="mx-tiles">
            <StatTile label={t("Score now")} value={n1(f.current_score)} note={trendText(f.trend)} />
            <StatTile label={t("In 7 days")} value={n1(f.forecast_7d)} note={t("{a} to {b}", { a: n1(f.forecast_7d_low), b: n1(f.forecast_7d_high) })} />
            <StatTile label={t("In 30 days")} value={n1(f.forecast_30d)} note={t("{a} to {b}", { a: n1(f.forecast_30d_low), b: n1(f.forecast_30d_high) })} />
            <StatTile label={t("In 90 days")} value={n1(f.forecast_90d)} note={t("{a} to {b}", { a: n1(f.forecast_90d_low), b: n1(f.forecast_90d_high) })} />
          </dl>
          <TrendArea label={t("Fitted score history")} emptyLabel={t("No history")} points={f.history.map((p) => ({ axis: t("Day {d}", { d: String(p.day) }), title: t("Day {d}", { d: String(p.day) }), value: p.score }))} />
          <p className="mx-muted">{t("Based on {n} runs over {d} days. Confidence {c}, which is the width of the 7 day band, not a probability.", { n: n0(f.points), d: n0(f.span_days), c: n0(f.confidence) })}</p>
          {f.contributing_factors.length ? <ul className="b8-list">{f.contributing_factors.map((c) => <li key={c}>{c}</li>)}</ul> : null}
        </div>
      ) : null}
    </Gate>
  );
}

export function Forecast() {
  useInterfaceLang();
  const chat = useAletheia();
  const heat = useQ("score-heat", getHeatmap);
  const pred = useQ("predictive", getPredictive);
  const mods = (heat.data?.rows ?? []).map((r) => r.module);
  const [picked, setPicked] = useState<string | null>(null);
  const mod = picked ?? mods[0] ?? null;
  useAletheiaScope({
    key: "insights/forecast",
    label: t("Asking about the forecast"),
    suggestions: [t("Which object will fall below target?"), t("What happens if we do nothing?"), t("How reliable is this forecast?")],
    context: mod ? { module: mod } : undefined,
  });
  const warnings = pred.data?.early_warnings ?? [];
  return (
    <div className="b8-page">
      <PageHeader title={t("Forecast")} context={t("Where each object's score is heading, with the band it should stay in.")}
        actions={<><InsightsNav here="forecast" /><Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button></>} />
      <Card title={t("Object forecast")} action={mods.length ? <Select aria-label={t("Object")} value={mod ?? ""} onChange={(e) => setPicked(e.target.value)} options={mods.map((m) => ({ value: m, label: m }))} /> : undefined}>
        {mod ? <ModuleForecast module={mod} /> : <EmptyState heading={t("No object to forecast")} body={t("Objects appear after the first scored run.")} />}
      </Card>
      <Card title={t("Early warnings")} sub={t("Signals that an object may soon cross its threshold")}>
        <Gate q={pred} empty={warnings.length === 0} emptyHeading={t("No early warnings")} emptyBody={pred.data?.reason ?? t("No object is heading toward its threshold.")}>
          <Tbl label={t("Early warnings")} rows={warnings} rowKey={(r) => `${r.module_id}/${r.signal}`} cols={[
            { key: "m", label: t("Object"), render: (r) => <Mod code={r.module_id} /> },
            { key: "s", label: t("Signal"), render: (r) => r.signal },
            { key: "r", label: t("Reason"), render: (r) => r.reason },
            { key: "t", label: t("Threshold"), end: true, render: (r) => n1(r.threshold) },
          ]} />
        </Gate>
      </Card>
    </div>
  );
}
