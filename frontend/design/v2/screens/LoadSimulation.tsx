"use client";
/**
 * Load simulation for one migration run (api/routes/migration.py /runs/{id}/load-simulation): which records would
 * fail a load into the target, grouped per load object and error message the way the Migration Cockpit reports a
 * simulated load, and the configuration that has to be transported first.
 */
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getLoadSimulation, type SimValue } from "@/lib/api/v2/load-simulation";
import { formatModuleName } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { Sev } from "../inspector/rule";
import { Coded, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../parts";
import { CcHBars } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

const valueList = (vs: SimValue[]) =>
  vs.map((v) => t("{value} ({n} records)", { value: v.value || t("(initial)"), n: int(v.records) })).join(", ");

export function LoadSimulationPanel({ runId }: { runId: string }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["migration", "load-simulation", runId, fixture], queryFn: () => getLoadSimulation(runId), staleTime: 60_000 });
  const title = t("Load simulation");
  if (q.isPending) return <Panel title={title} testId="load-sim"><Skeleton width="100%" height={160} /></Panel>;
  if (q.isError) return <Panel title={title} testId="load-sim"><ErrorFrame onRetry={() => void q.refetch()}>{t("The load simulation could not be read.")}</ErrorFrame></Panel>;
  const s = q.data;
  const meta = t("{ok} of {n} records would load", { ok: int(s.totals.would_load), n: int(s.totals.records) });
  return (
    <Panel title={title} meta={meta} testId="load-sim">
      {s.groups.length === 0 ? <EmptyFrame>{t("No record would fail the load.")}</EmptyFrame> : (
        <>
          <CcHBars
            label={t("Would load and would fail per load object")}
            testId="load-sim-bars"
            rows={s.objects.flatMap((o) => [
              { key: `${o.module}-ok`, label: t("{object}, would load", { object: o.label || formatModuleName(o.module) }), value: o.would_load, text: int(o.would_load), tone: "pass" as const },
              { key: `${o.module}-fail`, label: t("{object}, would fail", { object: o.label || formatModuleName(o.module) }), value: o.would_fail, text: o.provisional ? t("{n} ({p} provisional)", { n: int(o.would_fail), p: int(o.provisional) }) : int(o.would_fail), tone: "crit" as const },
            ])}
          />
          {s.totals.provisional > 0 ? (
            <p className="m2-meta" data-testid="load-sim-provisional">
              {t("{n, plural, one {# record fails} other {# records fail}} only on values missing from the SAP standard baseline. The target may already hold them; connect the target to confirm.", { n: s.totals.provisional })}
            </p>
          ) : null}
          <ScrollFrame label={t("Messages")}>
            <table className="m2-tbl m2-cards" data-testid="load-sim-groups">
              <caption className="m2-sr">{t("Messages")}</caption>
              <thead><tr>{[t("Message"), t("Field"), t("Severity"), t("Records"), t("Sample records")].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {s.groups.map((g) => (
                  <tr key={`${g.module}-${g.dest_table}-${g.field}-${g.gap_type}-${g.rule ?? ""}`} data-testid={`load-sim-group-${g.dest_table}-${g.field}-${g.gap_type}`}>
                    <td>{g.message}{g.provisional ? <> <span className="m2-meta">{t("Provisional")}</span></> : null}</td>
                    <td><Coded code={g.dest_table ? `${g.dest_table}-${g.field}` : g.field} text={g.field_text} first /></td>
                    <td><Sev severity={g.severity} /></td>
                    <td>{g.structural ? t("Structure") : int(g.records)}</td>
                    <td>{g.samples.length ? g.samples.join(", ") : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        </>
      )}
      {s.transports.length > 0 ? (
        <ScrollFrame label={t("Configuration to transport")}>
          <table className="m2-tbl m2-cards" data-testid="load-sim-transports">
            <caption className="m2-sr">{t("Configuration to transport")}</caption>
            <thead><tr>{[t("Check table"), t("Field"), t("Missing values"), t("Records")].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
            <tbody>
              {s.transports.map((x) => (
                <tr key={`${x.module}-${x.check_table}-${x.field}`} data-testid={`load-sim-transport-${x.check_table}`}>
                  <td><Coded code={x.check_table} text={x.check_table_text} first />{x.provisional ? <> <span className="m2-meta">{t("Provisional")}</span></> : null}</td>
                  <td><Coded code={x.field} text={x.field_text} first /></td>
                  <td>{valueList(x.values)}</td>
                  <td>{int(x.records)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      ) : null}
      <p className="m2-meta">
        {s.target_connected ? t("Checked against the target's own configuration and the {release} dictionary.", { release: s.release }) : t("No target is connected: checked against the SAP standard baseline and the {release} dictionary.", { release: s.release })}{" "}
        <V2Link href="/migration/load-plan">{t("See the load order")}</V2Link>
      </p>
    </Panel>
  );
}
