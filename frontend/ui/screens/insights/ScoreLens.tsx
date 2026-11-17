"use client";

import { getConfigAwareScore, getHeatmap, getScoreHistory } from "@/lib/api/v2/score";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { Button, Card, FieldChip, PageHeader, StatTile, TrendArea, useAletheia, useAletheiaScope } from "@/ui/kit";
import { Gate, InsightsNav, Mod, Tbl, day, n0, n1, pc, sevLabel, sevOf, useQ } from "./shared";

export function ScoreLens() {
  useInterfaceLang();
  const chat = useAletheia();
  const hist = useQ("score-history", getScoreHistory);
  const cfg = useQ("score-config", getConfigAwareScore);
  const heat = useQ("score-heat", getHeatmap);
  useAletheiaScope({
    key: "insights/score",
    label: t("Asking about the score lens"),
    suggestions: [t("Why is the configured score different?"), t("Which rules do not apply to us?"), t("Which dimension drags the score?")],
    context: cfg.data?.version_id ? { version_id: cfg.data.version_id } : undefined,
  });
  const runs = [...(hist.data?.history ?? [])].reverse();
  const c = cfg.data;
  const h = heat.data;
  return (
    <div className="b8-page">
      <PageHeader title={t("Score lens")} context={t("The same run scored as it was then, under today's weights and from your loaded configuration.")}
        actions={<><InsightsNav here="score" /><Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button></>} />
      <Card title={t("Score by run")} sub={t("As scored at the time and under today's weights")}>
        <Gate q={hist} empty={runs.length === 0} emptyHeading={t("No scored runs yet")} emptyBody={t("The history fills after the first scored run.")}>
          <div className="b8-stack">
            <TrendArea label={t("Score by run")} emptyLabel={t("No score history")} points={runs.map((r) => ({ axis: day(r.run_at), title: r.version_id, value: r.under_current.composite }))} />
            <Tbl label={t("Score history")} rows={runs} rowKey={(r) => r.version_id} cols={[
              { key: "run", label: t("Run"), render: (r) => r.version_id },
              { key: "at", label: t("Date"), render: (r) => day(r.run_at) },
              { key: "then", label: t("At the time"), end: true, render: (r) => n1(r.at_the_time?.composite) },
              { key: "now", label: t("Under today's weights"), end: true, render: (r) => n1(r.under_current.composite) },
              { key: "tier", label: t("Tier"), render: (r) => r.under_current.tier ?? t("n/a") },
            ]} />
          </div>
        </Gate>
      </Card>
      <Card title={t("From your configuration")} sub={t("Passes over the rules that apply to your loaded configuration")}>
        <Gate q={cfg} empty={!c || !c.config_load} emptyHeading={t("No configuration loaded")} emptyBody={t("Load the system configuration to see which rules apply.")}>
          {c ? (
            <div className="b8-stack">
              <dl className="mx-tiles">
                <StatTile label={t("Configured score")} value={n1(c.config_aware.score)} bar={c.config_aware.score ?? 0} barTone="pass" note={t("{n} rules apply", { n: n0(c.config_aware.applicable) })} />
                <StatTile label={t("Existing score")} value={n1(c.existing_dqs?.composite)} />
                <StatTile label={t("Not applicable")} value={n0(c.config_aware.not_applicable)} note={t("Rules the configuration switches off")} />
                <StatTile label={t("Passing by default")} value={n0(c.config_aware.by_default)} />
              </dl>
              <div className="b8-grid">
                <Card title={t("By object")}>
                  <Tbl label={t("Configured score by object")} rows={c.modules} rowKey={(r) => r.module} cols={[
                    { key: "m", label: t("Object"), render: (r) => <Mod code={r.module} /> },
                    { key: "s", label: t("Score"), end: true, render: (r) => n1(r.score) },
                    { key: "a", label: t("Applicable"), end: true, render: (r) => n0(r.applicable) },
                    { key: "n", label: t("Not applicable"), end: true, render: (r) => n0(r.not_applicable) },
                  ]} />
                </Card>
                <Card title={t("Why rules do not apply")}>
                  <Tbl label={t("Reasons")} rows={c.config_aware.not_applicable_reasons} rowKey={(r) => r.reason ?? ""} cols={[
                    { key: "r", label: t("Reason"), render: (r) => r.reason },
                    { key: "c", label: t("Rules"), end: true, render: (r) => n0(r.count) },
                  ]} />
                </Card>
              </div>
              <Card title={t("Top failing rules")}>
                <Tbl label={t("Top failing rules")} rows={c.config_aware.top_failing} rowKey={(r) => r.check_id} cols={[
                  { key: "r", label: t("Rule"), render: (r) => <FieldChip code={r.check_id} description={r.title ?? undefined} /> },
                  { key: "m", label: t("Object"), render: (r) => <Mod code={r.module} /> },
                  { key: "sev", label: t("Severity"), render: (r) => sevLabel(sevOf(r.severity)) },
                  { key: "a", label: t("Records"), end: true, render: (r) => n0(r.affected_count) },
                ]} />
              </Card>
            </div>
          ) : null}
        </Gate>
      </Card>
      <Card title={t("Object by dimension")} sub={t("Latest run, each object scored on the six dimensions")}>
        <Gate q={heat} empty={!h || h.rows.length === 0} emptyHeading={t("No dimension scores yet")} emptyBody={t("They appear after the first scored run.")}>
          {h ? (
            <Tbl label={t("Object by dimension")} rows={h.rows} rowKey={(r) => r.module} cols={[
              { key: "m", label: t("Object"), render: (r) => <Mod code={r.module} /> },
              ...h.dimensions.map((d) => ({ key: d, label: d, end: true, render: (r: (typeof h.rows)[number]) => pc(r.scores[d]) })),
              { key: "crit", label: t("Critical"), end: true, render: (r) => n0(r.critical) },
            ]} />
          ) : null}
        </Gate>
      </Card>
    </div>
  );
}

