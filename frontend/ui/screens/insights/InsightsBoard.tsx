"use client";

/**
 * The top of the Insights route: where the score is going, what moves the next score, value at risk, unusual runs
 * and the proof of value of fixes people made. Every figure is read from an existing endpoint; what none supplies is
 * left out (see the change report).
 */
import { getFindings } from "@/lib/api/v2/insights";
import { getForesight, getReason, type Anomaly, type CausalRisk } from "@/lib/api/v2/aletheia-engine";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { labelText, moduleText, moneyCompactText } from "@/lib/v2/labels";
import { AletheiaMark, BandChart, BarList, Card, EmptyState, EvidenceNote, FieldChip, ScoreRuler, Skeleton, StatTile } from "@/ui/kit";
import { compactCount, score, signed } from "../object/format";
import { day, sevLabel, sevOf, useQ } from "./shared";
import "./insightsboard.css";

const n1 = (n: number | null | undefined) => (n == null ? t("n/a") : score(n));
const byEffect = (a: CausalRisk, b: CausalRisk) => Math.abs(b.effect ?? 0) - Math.abs(a.effect ?? 0);

export function InsightsBoard() {
  useInterfaceLang();
  const fore = useQ("aletheia-foresight", getForesight);
  const reason = useQ("aletheia-reason", () => getReason());
  const found = useQ("findings", () => getFindings());
  if (fore.isLoading || reason.isLoading || found.isLoading) return <Skeleton lines={5} label={t("Loading the insights")} />;

  const f = fore.data;
  const p = f?.projection;
  const labels = reason.data?.labels ?? {};
  const metric = (m: string) => labels[m] ?? labelText(m.startsWith("dimension:") ? m.slice(10) : m);
  const det = reason.data?.deterministic;
  const risks = [...(det?.risks ?? [])].sort(byEffect).slice(0, 5);
  const anomalies: Anomaly[] = det?.anomalies ?? [];
  const cur = found.data?.currency;
  const money = (found.data?.findings ?? []).filter((x) => (x.money.cost_at_risk ?? 0) > 0)
    .sort((a, b) => (b.money.cost_at_risk ?? 0) - (a.money.cost_at_risk ?? 0)).slice(0, 8);
  const total = money.reduce((s, x) => s + (x.money.cost_at_risk ?? 0), 0);
  const acted = (found.data?.acted ?? []).filter((a) => !a.waiting && a.affected_now !== null);
  const data = f && p?.available ? [
    ...f.runs.filter((r) => r.composite != null).map((r) => ({ axis: day(r.run_at), value: r.composite })),
    ...(p.band ?? []).map((b) => ({ axis: day(b.date), point: b.point, low: b.low, high: b.high })),
  ] : [];
  const gl = p?.go_live;

  return (
    <section className="ib-board" aria-label={t("Insights at a glance")} data-testid="insights-board">
      <Card title={t("Where the score is going")} sub={t("Composite score per run, then the projection with its 95% band")} action={<AletheiaMark />}>
        {f && p?.available ? (
          <div className="ib-stack">
            <BandChart label={t("Composite score per run, then the projection with its 95% band")} data={data} target={f.target} />
            <ScoreRuler ariaLabel={t("Score now on the ruler, gates at 70 and 85")} marks={[{ id: "now", label: t("Score now"), shown: p.latest ?? 0 }]} showName={false}
              labels={{ atRisk: t("At risk"), go: t("Go"), cap70: t("Gate 70, critical cap"), cap85: t("Gate 85, go"), measured: (n) => t("Measured {n}", { n }) }} />
            <dl className="mx-tiles">
              <StatTile label={t("Score now")} value={n1(p.latest)} note={p.slope_per_30d == null ? undefined : t("{n} points per 30 days", { n: signed(p.slope_per_30d) })} />
              {p.next && <StatTile label={t("Next run")} value={n1(p.next.point)} note={t("{a} to {b}", { a: n1(p.next.low), b: n1(p.next.high) })} />}
              {gl?.projected && <StatTile label={t("Passes the target")} value={day(gl.projected)} note={t("{a} to {b}", { a: day(gl.earliest), b: day(gl.latest) })} />}
            </dl>
            <EvidenceNote ev={p.evidence} testId="insights-board-evidence" />
          </div>
        ) : <EmptyState heading={t("No projection yet")} body={t("Aletheia needs at least three scored runs.")} />}
      </Card>

      <Card title={t("What moves the next score")} sub={t("Unusual runs, and the rules and dimensions moving the score, by effect")} action={<AletheiaMark />}>
        {risks.length ? (
          <>
            <ol className="ib-list" data-testid="insights-drivers">
              {risks.map((r) => (
                <li key={`${r.kind}/${r.driver}`}>
                  {r.kind === "rule" ? <FieldChip code={r.driver} description={r.name} /> : <span>{metric(`dimension:${r.driver}`)}</span>}
                  <span className="ib-num" data-tone={(r.effect ?? 0) >= 0 ? "good" : "bad"}>{r.effect == null ? t("n/a") : signed(r.effect)}</span>
                  <span className="ib-note">{t("{n}% confidence", { n: Math.round(r.confidence) })}</span>
                </li>
              ))}
            </ol>
            {det && <EvidenceNote ev={det.risk_evidence} />}
          </>
        ) : <EmptyState heading={t("No risk or unusual run found")} body={t("Every run is in line and no rule is moving the score.")} />}
      </Card>

      <Card title={t("Value at risk")} sub={t("Top {n} rules", { n: money.length })}>
        {money.length ? (
          <>
            <p className="ib-lead">{moneyCompactText(total, cur)}</p>
            <BarList label={t("Value at risk by rule")} items={money.map((x) => ({
              id: x.id, label: `${x.check_id} ${x.name}`, value: x.money.cost_at_risk ?? 0, display: moneyCompactText(x.money.cost_at_risk, x.money.currency || cur),
            }))} />
          </>
        ) : <EmptyState heading={t("No value at risk costed yet")} body={t("Value appears once failing rules are mapped to features.")} />}
      </Card>

      <Card title={t("Anomalies")} sub={t("{count, plural, one {# unusual run} other {# unusual runs}}", { count: anomalies.length })} action={<AletheiaMark />}>
        {anomalies.length ? (
          <ul className="ib-list" data-testid="insights-anomalies">
            {anomalies.map((a) => (
              <li key={`${a.metric}/${a.version_id}`}>
                <span>{a.label ?? a.version_id ?? t("n/a")}, {a.metric.startsWith("dimension:") ? metric(a.metric) : <FieldChip code={a.metric} description={metric(a.metric)} />}</span>
                <span className="ib-note">{sevLabel(sevOf(a.severity))}</span>
                <span className="ib-note">{t("Expected {e}, observed {o}, z {z}", { e: n1(a.expected), o: n1(a.observed), z: n1(a.z) })}</span>
              </li>
            ))}
          </ul>
        ) : <EmptyState heading={t("No unusual runs")} body={t("Every run was in line with the ones before it.")} />}
        {det && <EvidenceNote ev={det.anomaly_evidence} />}
      </Card>

      <Card title={t("Proof of value")} sub={t("Fixes people made, measured after")}>
        {acted.length ? (
          <table className="ib-table" data-testid="insights-proof">
            <thead><tr><th scope="col">{t("Rule")}</th><th scope="col">{t("Object")}</th><th scope="col" className="ib-end">{t("Affected before")}</th><th scope="col" className="ib-end">{t("Affected now")}</th><th scope="col" className="ib-end">{t("Score gain")}</th></tr></thead>
            <tbody>
              {acted.map((a) => (
                <tr key={`${a.module}/${a.check_id}/${a.version_id}`}>
                  <td><FieldChip code={a.check_id} description={a.name ?? t("Rule")} /></td>
                  <td>{moduleText(a.module)}</td>
                  <td className="ib-end">{a.affected_before == null ? "" : compactCount(a.affected_before)}</td>
                  <td className="ib-end">{a.affected_now == null ? "" : compactCount(a.affected_now)}</td>
                  <td className="ib-end">{a.gain == null ? "" : signed(a.gain)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <EmptyState heading={t("No fixes measured yet")} body={t("A fix shows here once a later run has measured it.")} />}
      </Card>
    </section>
  );
}
