"use client";

import { formatInt } from "@/lib/format";
import { relTime } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { f1 } from "@/lib/v2/score";
import { V2Link } from "@/design/v2/parts";
import type { AletheiaFinding } from "@/lib/api/v2/insights";
import { actionOf, type PortfolioRow } from "@/lib/api/next/portfolio";
import { AreaSpark, Button, Ring, SegBar } from "../kit";
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

/** The visual lead of a card: score ring, DQS trend and the records that need a fix. Real data only. */
function Visual({ row, delta }: { row: PortfolioRow; delta: number | null }) {
  const v = row.composite_score;
  const verdict = row.readiness === "pass" ? t("Ready to load") : row.readiness === "warn" ? t("Needs a look") : row.readiness === "fail" ? t("Not ready") : null;
  const ringLabel = v == null ? t("Not scored yet") : row.capped && row.measured_score != null
    ? t("DQS {v}, capped from {m} by a critical rule", { v: f1(v), m: f1(row.measured_score) })
    : t("DQS {v}", { v: f1(v) });
  const trend = row.trend.slice(-12);
  const last = row.run_number ?? trend.length;
  const points = trend.map((p, i) => ({ label: t("Run {n}", { n: formatInt(last - (trend.length - 1 - i)) }), value: Number(f1(p)) }));
  const segments = [
    { label: t("New issues"), value: row.new_issues },
    { label: t("Failing again"), value: row.regressed },
    { label: t("Fixed"), value: row.resolved },
  ];
  const moved = segments.some((x) => x.value > 0);
  return (
    <div className="nx-fd-visual">
      <Ring value={v} label={ringLabel}>
        {v == null ? <span className="nx-fd-ring-empty">{t("Not scored yet")}</span> : <span className="nx-fd-ring-value">{f1(v)}</span>}
      </Ring>
      <div className="nx-fd-visual-side">
        <p className="nx-fd-delta" data-dir={delta == null || Math.abs(delta) < 0.05 ? "flat" : delta > 0 ? "up" : "down"}>
          {v == null ? t("Score this run to see its quality.") : deltaSentence(row)}
          {verdict ? <> <span className="nx-fd-verdict" data-readiness={row.readiness}>{verdict}</span></> : null}
        </p>
        <AreaSpark points={points} label={t("DQS trend of {name}", { name: row.label })} empty={t("The trend shows after the second run.")} />
        <SegBar label={t("Records that need a fix")} format={formatInt} segments={segments} />
        {moved ? null : <p className="nx-fd-capnote">{v == null ? t("Record counts show once the run is scored.") : t("No records changed since the last run.")}</p>}
      </div>
    </div>
  );
}

export function aletheiaSentence(f: AletheiaFinding): string {
  const n = formatInt(f.affected);
  const top = f.why.origin.top;
  return top ? t("{name}: {n} records affected, most in {top}.", { name: f.name, n, top }) : t("{name}: {n} records affected.", { name: f.name, n });
}

/** A card of the Home feed: name, the visual lead (ring, trend, records to fix), one Aletheia sentence, one action. */
export function StoryCard({ row, act, finding, evidence = 0, onEvidence, selected, onSelect }: { row: PortfolioRow; act: PortfolioActions; finding?: AletheiaFinding; evidence?: number; onEvidence?: () => void; selected?: boolean; onSelect?: () => void }) {
  const d = deltaOf(row);
  const name = `${row.label} (${row.module})`;
  const failed = row.freshness === "failed";
  const compare = objectHref(row, act.sysName, `/cycle?step=compare&run=${row.version_id}`);
  return (
    <article className="nx-fd-card" aria-label={name} data-testid="pf-card" data-selected={selected ?? false}>
      <header className="nx-fd-card-head">
        {onSelect ? <input type="checkbox" className="nx-check" checked={!!selected} onChange={onSelect} aria-label={t("Select {name}", { name })} /> : null}
        <h2>{row.label} <span className="nx-mono nx-fd-code nx-pf-code">{row.module}</span></h2>
        <span className="nx-fd-meta">{act.sysName(row.system_id)}{row.run_at ? `, ${t("run {when}", { when: relTime(row.run_at) })}` : ""}</span>
      </header>
      <Visual row={row} delta={d} />
      {failed ? (
        <p className="nx-fd-failed" role="status">
          {t("The last pull failed.")}{" "}
          <Button variant="secondary" size={32} icon="refresh" onClick={() => act.pull([row])} disabled={!act.can("trigger_sync")} reason={act.can("trigger_sync") ? undefined : t("Your role cannot do this.")}>{t("Retry")}</Button>
        </p>
      ) : null}
      {row.capped ? <p className="nx-fd-cap">{t("Capped by a critical rule")}</p> : null}
      {finding ? (
        <p className="nx-fd-aletheia">
          <span className="nx-fd-mark">{t("Aletheia")}</span> {aletheiaSentence(finding)}{" "}
          {onEvidence && evidence > 0 ? <Button variant="quiet" size={32} onClick={onEvidence}>{t("Evidence ({n})", { n: formatInt(evidence) })}</Button> : null}
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
