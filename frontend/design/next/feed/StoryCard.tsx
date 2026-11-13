"use client";

import { formatInt } from "@/lib/format";
import { relTime } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { f1 } from "@/lib/v2/score";
import { V2Link } from "@/design/v2/parts";
import type { AletheiaFinding } from "@/lib/api/v2/insights";
import { actionOf, type PortfolioRow } from "@/lib/api/next/portfolio";
import { Button, Sparkline } from "../kit";
import { objectHref, type PortfolioActions } from "../portfolio/BulkBar";
import { deltaOf, deltaSentence } from "./model";

/** The one primary action of a card, by cycle step. */
function Primary({ row, act }: { row: PortfolioRow; act: PortfolioActions }) {
  const at = actionOf(row);
  const n = formatInt(row.run_number ?? 0);
  const deny = (a: string) => (act.can(a) ? undefined : t("Your role cannot do this."));
  if (at === "pull") return <Button variant="primary" size={32} icon="play" onClick={() => act.pull([row])} disabled={!!deny("trigger_sync")} reason={deny("trigger_sync")}>{t("Pull now")}</Button>;
  if (at === "clean") return <Button variant="primary" size={32} icon="download" onClick={() => act.download([row])}>{t("Download workbook")}</Button>;
  if (at === "upload") return <Button variant="primary" size={32} icon="upload" onClick={() => act.upload([row])} disabled={!!deny("upload")} reason={deny("upload")}>{t("Upload cleaned workbook")}</Button>;
  if (at === "score") {
    const running = act.scoring.has(row.version_id) || !!row.cycle?.parent_run;
    return <Button variant="primary" size={32} icon="refresh" onClick={() => act.score([row])} disabled={running || !!deny("analyse")} reason={running ? t("Scoring run {n}", { n }) : deny("analyse")}>{t("Score again")}</Button>;
  }
  if (at === "ready") return <V2Link className="nx-btn nx-btn-primary nx-btn-sm" href={`/load?object=${encodeURIComponent(row.module)}&run=${row.version_id}`}>{t("Prepare load files")}</V2Link>;
  return <V2Link className="nx-btn nx-btn-primary nx-btn-sm" href={objectHref(row, act.sysName, `/cycle?step=compare&run=${row.version_id}`)}>{t("Compare runs")}</V2Link>;
}

/** One bar to the shown score, a tick where the measured score sits before any cap. The verdict word carries the colour. */
function Ruler({ row }: { row: PortfolioRow }) {
  const shown = row.composite_score ?? 0;
  const verdict = row.readiness === "pass" ? t("Ready to load") : row.readiness === "warn" ? t("Needs a look") : row.readiness === "fail" ? t("Not ready") : null;
  return (
    <div className="nx-fd-ruler">
      <div className="nx-fd-ruler-bar" role="img" aria-label={t("DQS {v}", { v: f1(row.composite_score) })}>
        <span className="nx-fd-ruler-fill" data-readiness={row.readiness ?? "none"} style={{ width: `${Math.max(0, Math.min(100, shown))}%` }} />
        {row.capped && row.measured_score != null ? <span className="nx-fd-ruler-tick" style={{ insetInlineStart: `${Math.min(100, row.measured_score)}%` }} /> : null}
      </div>
      {verdict ? <span className="nx-fd-verdict" data-readiness={row.readiness}>{verdict}</span> : null}
    </div>
  );
}

export function aletheiaSentence(f: AletheiaFinding): string {
  const n = formatInt(f.affected);
  const top = f.why.origin.top;
  return top ? t("{name}: {n} records affected, most in {top}.", { name: f.name, n, top }) : t("{name}: {n} records affected.", { name: f.name, n });
}

/** A card of the Home feed: name, hero score, change, trend, ruler, one Aletheia sentence, one action. */
export function StoryCard({ row, act, finding, evidence = 0, onEvidence, selected, onSelect }: { row: PortfolioRow; act: PortfolioActions; finding?: AletheiaFinding; evidence?: number; onEvidence?: () => void; selected?: boolean; onSelect?: () => void }) {
  const d = deltaOf(row);
  const name = `${row.label} (${row.module})`;
  const compare = objectHref(row, act.sysName, `/cycle?step=compare&run=${row.version_id}`);
  return (
    <article className="nx-fd-card" aria-label={name} data-testid="pf-card" data-selected={selected ?? false}>
      <header className="nx-fd-card-head">
        {onSelect ? <input type="checkbox" className="nx-check" checked={!!selected} onChange={onSelect} aria-label={t("Select {name}", { name })} /> : null}
        <h2>{row.label} <span className="nx-mono nx-fd-code nx-pf-code">{row.module}</span></h2>
        <span className="nx-fd-meta">{act.sysName(row.system_id)}{row.run_at ? `, ${t("run {when}", { when: relTime(row.run_at) })}` : ""}</span>
      </header>
      <div className="nx-fd-hero">
        <p className="nx-fd-score"><span className="nx-sr">{t("DQS {v}", { v: f1(row.composite_score) })}</span><span aria-hidden="true">{f1(row.composite_score)}</span></p>
        <p className="nx-fd-delta" data-dir={d == null || Math.abs(d) < 0.05 ? "flat" : d > 0 ? "up" : "down"}>{deltaSentence(row)}</p>
        {row.trend.length > 1 ? <Sparkline points={row.trend.slice(-12)} label={t("DQS trend of {name}", { name: row.label })} /> : null}
      </div>
      <Ruler row={row} />
      {row.capped ? <p className="nx-fd-cap">{t("Capped by a critical rule")}</p> : null}
      {finding ? (
        <p className="nx-fd-aletheia">
          <span className="nx-fd-mark">{t("Aletheia")}</span> {aletheiaSentence(finding)}{" "}
          {onEvidence ? <Button variant="quiet" size={32} onClick={onEvidence}>{t("Evidence ({n})", { n: formatInt(evidence || 1) })}</Button> : null}
        </p>
      ) : null}
      <footer className="nx-fd-card-foot">
        <Primary row={row} act={act} />
        <V2Link className="nx-btn nx-btn-quiet nx-btn-sm" href={objectHref(row, act.sysName, `?run=${row.version_id}`)}>{t("Open")}</V2Link>
        <V2Link className="nx-btn nx-btn-quiet nx-btn-sm" href={compare}>{t("Runs")}</V2Link>
      </footer>
    </article>
  );
}
