"use client";

import { useState } from "react";
import type { DestScoreContributor, MigrationWave, WaveBlocker, WaveVerdict } from "@/types/api";
import * as rep from "@/lib/api/v2/reports";
import { useWaveCockpit } from "@/lib/v2/admin-queries";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
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

const MOVE_WORD: Record<DestScoreContributor["kind"], () => string> = {
  dropped: () => t("Field not migrated"),
  target: () => t("Target rule"),
  gap: () => t("Migration gap"),
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
      setBatch(null);
      return {
        tone: "ok",
        title: t("Analysis of {name} queued", { name: wave.name }),
        detail: t("{n, plural, one {# object is} other {# objects are}} being analysed. The verdicts update when it finishes.", { n: r.modules.length }),
      };
    });
  const c = cockpit.data;
  const moves = (c?.objects ?? []).flatMap((o) => (o.dest_contributors ?? []).map((x) => ({ module: o.module, x })));
  const canExport = session.can("export");
  const canFix = session.can("apply") && !session.shared && !session.viewAs;
  const { hrefFor } = useOpenItem();
  const [batch, setBatch] = useState<string | null>(null);
  const draft = (b: WaveBlocker) =>
    void run(`fix:${b.module}:${b.gap_type}:${b.field ?? ""}`, async () => {
      const r = await rep.draftBlockerFixBatch(wave.id, { module: b.module, gap_type: b.gap_type, field: b.field });
      setBatch(r.id);
      return {
        tone: "ok",
        title: t("Fix batch drafted for {gap}", { gap: gapText(b.gap_type) }),
        detail: t("{n, plural, one {# record is} other {# records are}} in the batch, {p} with a proposed fix. Review it before anything is changed.", { n: r.items, p: r.with_proposal }),
      };
    });
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
            {batch ? <V2Link href={hrefFor({ kind: "batch", id: batch })}>{t("Open the fix batch")}</V2Link> : <V2Link href="/migration">{t("Open the migration analyses")}</V2Link>}
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
                  <th scope="col">{t("Quality score at source")}</th>
                  <th scope="col">{t("Projected in target")}</th>
                  <th scope="col">{t("Measured in target")}</th>
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
                      <td>{o.dest_dqs_projected == null ? <Dash /> : f1(o.dest_dqs_projected)}</td>
                      <td>{o.dest_dqs_actual == null ? <Dash /> : f1(o.dest_dqs_actual)}</td>
                      <td>{int(o.records)}</td>
                      <td>{int(o.records_blocked)}</td>
                      <td>{int(o.blocker_count)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <h4>{t("What moves the quality score in the target")}</h4>
          {moves.length === 0 ? (
            <EmptyFrame>
              {c.objects.some((o) => o.dest_dqs_projected != null)
                ? t("No rule or gap moves the quality score between source and target.")
                : t("The quality score in the target shape is projected on the next analysis of the wave.")}
            </EmptyFrame>
          ) : (
            <div className="m2-frame" tabIndex={0} style={{ maxHeight: 240 }}>
              <table className="m2-tbl" aria-label={t("Rules and gaps that move the quality score in the target")}>
                <thead>
                  <tr>
                    <th scope="col">{t("Object")}</th>
                    <th scope="col">{t("Rule")}</th>
                    <th scope="col">{t("Field")}</th>
                    <th scope="col">{t("Severity")}</th>
                    <th scope="col">{t("Change")}</th>
                    <th scope="col">{t("Records")}</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map(({ module, x }) => (
                    <tr key={`${module}:${x.check_id}`}>
                      <th scope="row">{moduleText(module)}</th>
                      <td>
                        <Coded code={x.check_id.split(":")[0]} text={x.description} first />
                      </td>
                      <td>{x.field ? <Coded code={x.field} text={x.field_description} first /> : <Dash />}</td>
                      <td>
                        <Sev severity={x.severity} />
                      </td>
                      <td>{MOVE_WORD[x.kind]()}</td>
                      <td>{int(x.dest_affected ?? x.source_affected ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
                    {canFix ? <th scope="col">{t("Fix")}</th> : null}
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
                      {canFix ? (
                        <td>
                          <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => draft(b)}>
                            {pending === `fix:${b.module}:${b.gap_type}:${b.field ?? ""}` ? t("Drafting…") : t("Draft a fix batch")}
                          </button>
                        </td>
                      ) : null}
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
