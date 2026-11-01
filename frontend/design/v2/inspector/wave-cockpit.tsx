"use client";

import type { MigrationWave, WaveVerdict } from "@/types/api";
import * as rep from "@/lib/api/v2/reports";
import { useWaveCockpit } from "@/lib/v2/admin-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { f1, int } from "@/lib/v2/score";
import { cockpitVerdict } from "@/lib/v2/waves";
import { VerdictMark } from "../marks";
import { Coded, Dash, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../parts";
import { gapText } from "../screens/Migration";
import { Sev } from "./rule";
import { ResultFrame, useOutcome } from "./shared";

const VERDICT_WORD: Record<WaveVerdict, () => string> = {
  go: () => t("Ready"),
  at_risk: () => t("At risk"),
  no_go: () => t("Blocked"),
};

/**
 * A wave's readiness cockpit, inside the wave inspector: analyse the whole wave, read each object's verdict and the
 * blockers holding it, download the report, draft a fix batch for a blocker (migration.py /waves/{id}/...).
 */
export function WaveCockpitBlock({ wave }: { wave: MigrationWave }) {
  const session = useV2Session();
  const { outcome, pending, run } = useOutcome();
  const cockpit = useWaveCockpit(wave.id);
  const canAnalyse = session.can("analyse") && !session.shared && !session.viewAs;
  const analyse = () =>
    void run("analyse", async () => {
      const r = await rep.runWave(wave.id);
      return {
        tone: "ok",
        title: t("Analysis of {name} queued", { name: wave.name }),
        detail: t("{n, plural, one {# object is} other {# objects are}} being analysed. The verdicts update when it finishes.", { n: r.modules.length }),
      };
    });
  const c = cockpit.data;
  const canExport = session.can("export");
  const download = (fmt: rep.WaveReportFormat) =>
    void run(`report:${fmt}`, async () => {
      const name = await rep.downloadWaveReport(wave.id, fmt);
      return { tone: "ok", title: t("Readiness report saved"), detail: name };
    });
  return (
    <div data-testid="wave-cockpit">
      {canAnalyse ? (
        <button type="button" className="m2-btn m2-sm" disabled={pending !== null || wave.modules.length === 0 || !wave.source_system_id} onClick={analyse}>
          {pending === "analyse" ? t("Queuing…") : t("Analyse the whole wave")}
        </button>
      ) : null}
      {canExport && c?.run_id
        ? (["xlsx", "pdf"] as const).map((fmt) => (
            <button key={fmt} type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => download(fmt)}>
              {pending === `report:${fmt}` ? t("Preparing…") : fmt === "xlsx" ? t("Download the report as Excel") : t("Download the report as PDF")}
            </button>
          ))
        : null}
      {outcome ? (
        <ResultFrame outcome={outcome}>
          <span>
            <V2Link href="/migration">{t("Open the migration analyses")}</V2Link>
          </span>
        </ResultFrame>
      ) : null}
      {cockpit.isLoading ? <Skeleton width="100%" height={60} /> : null}
      {cockpit.isError ? <ErrorFrame onRetry={() => void cockpit.refetch()}>{t("The wave cockpit could not be read.")}</ErrorFrame> : null}
      {c && !c.run_id ? <EmptyFrame>{t("This wave has not been analysed yet. Analyse the whole wave to see each object's verdict.")}</EmptyFrame> : null}
      {c && c.run_id ? (
        <>
          <p className="m2-prov">
            {t("Readiness {score} against a threshold of {threshold}. {blocked} of {total} records are blocked.", {
              score: c.score == null ? "—" : f1(c.score),
              threshold: c.threshold == null ? "—" : f1(c.threshold),
              blocked: int(c.records_blocked),
              total: int(c.records_total),
            })}
          </p>
          <div className="m2-frame" tabIndex={0} style={{ maxHeight: 240 }}>
            <table className="m2-tbl" aria-label={t("Readiness by object")}>
              <thead>
                <tr>
                  <th scope="col">{t("Object")}</th>
                  <th scope="col">{t("Verdict")}</th>
                  <th scope="col">{t("Readiness")}</th>
                  <th scope="col">{t("Quality score")}</th>
                  <th scope="col">{t("Records")}</th>
                  <th scope="col">{t("Blocked")}</th>
                  <th scope="col">{t("Blockers")}</th>
                </tr>
              </thead>
              <tbody>
                {c.objects.map((o) => {
                  const v = cockpitVerdict(o.verdict);
                  return (
                    <tr key={o.module}>
                      <th scope="row">{moduleText(o.module)}</th>
                      <td className="m2-ck-heat" data-band={v.band}>
                        <VerdictMark verdict={v.verdict} /> {VERDICT_WORD[o.verdict]()}
                      </td>
                      <td>{o.score == null ? <Dash /> : f1(o.score)}</td>
                      <td>{o.dqs == null ? <Dash /> : f1(o.dqs)}</td>
                      <td>{int(o.records)}</td>
                      <td>{int(o.records_blocked)}</td>
                      <td>{int(o.blocker_count)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <h4>{t("Blockers")}</h4>
          {c.blockers.length === 0 ? (
            <EmptyFrame>{t("Nothing blocks this wave.")}</EmptyFrame>
          ) : (
            <div className="m2-frame" tabIndex={0} style={{ maxHeight: 240 }}>
              <table className="m2-tbl" aria-label={t("Blockers of the wave")}>
                <thead>
                  <tr>
                    <th scope="col">{t("Object")}</th>
                    <th scope="col">{t("Gap")}</th>
                    <th scope="col">{t("Field")}</th>
                    <th scope="col">{t("Severity")}</th>
                    <th scope="col">{t("Records")}</th>
                    <th scope="col">{t("Gaps")}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.blockers.map((b) => (
                    <tr key={`${b.module}:${b.gap_type}:${b.field ?? ""}`}>
                      <th scope="row">{moduleText(b.module)}</th>
                      <td>{gapText(b.gap_type)}</td>
                      <td>{b.field ? <Coded code={b.field} /> : <Dash />}</td>
                      <td>
                        <Sev severity={b.severity} />
                      </td>
                      <td>{int(b.records)}</td>
                      <td>{int(b.gaps)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
