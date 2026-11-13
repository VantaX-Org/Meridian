"use client";

import { formatDate, formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1 } from "@/lib/v2/score";
import { V2Link } from "@/design/v2/parts";
import { actionOf, daysOnStep, type CycleStep, type PortfolioRow } from "@/lib/api/next/portfolio";
import { Button, Chip, Sparkline, Stepper, type StepItem } from "../kit";
import { cycleHref, objectHref, type PortfolioActions } from "./BulkBar";

const STEPS = ["pull", "clean", "upload", "score", "compare", "load"] as const;

export const stepLabel = (s: CycleStep | "load" | "ready" | null): string =>
  ({ pull: t("Pull"), clean: t("Clean"), upload: t("Upload"), score: t("Score"), compare: t("Compare"), load: t("Load"), ready: t("Load") })[s ?? "pull"];

/** The six steps of the cycle with the object's place on it: scoring shows as running. */
export function cycleSteps(row: PortfolioRow): StepItem[] {
  const at = actionOf(row);
  const here = at === "ready" ? 5 : STEPS.indexOf(at);
  return STEPS.map((id, i) => ({
    id,
    label: stepLabel(id),
    state: i < here ? "done" : i > here ? "future" : at === "score" ? "running" : "current",
  }));
}

/** The one primary action of a card, by step. */
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
  return <V2Link className="nx-btn nx-btn-primary nx-btn-sm" href={cycleHref(row, act.sysName, `?step=compare&run=${row.version_id}`)}>{t("Compare runs")}</V2Link>;
}

export function ObjectCard({ row, act, selected, onSelect }: { row: PortfolioRow; act: PortfolioActions; selected: boolean; onSelect: () => void }) {
  const delta = row.composite_score != null && row.previous_score != null ? row.composite_score - row.previous_score : null;
  const days = daysOnStep(row);
  const compare = cycleHref(row, act.sysName, `?step=compare&run=${row.version_id}`);
  const name = `${row.label} (${row.module})`;
  return (
    <article className="nx-card nx-pf-card" aria-label={name} data-testid="pf-card" data-selected={selected}>
      <header className="nx-pf-card-head">
        <input type="checkbox" className="nx-check" checked={selected} onChange={onSelect} aria-label={t("Select {name}", { name })} />
        <div className="nx-pf-card-title">
          <strong>{row.label}</strong> <span className="nx-mono nx-pf-code">{row.module}</span>
          <div className="nx-pf-meta">
            <Chip>{act.sysName(row.system_id)}</Chip>
            <span>{row.owner ?? t("No owner")}</span>
            {row.freshness === "stale" ? <Chip tone="warn">{t("Stale")}</Chip> : null}
          </div>
        </div>
      </header>
      <Stepper steps={cycleSteps(row)} label={t("Cycle of {name}", { name: row.label })} />
      <p className="nx-pf-cycle">
        {t("Cycle {n}, {step}", { n: formatInt(row.cycle?.number ?? 1), step: stepLabel(actionOf(row)) })}
        {days != null ? `, ${t("{d} days on this step", { d: formatInt(days) })}` : ""}
      </p>
      <div className="nx-pf-score">
        <span className="nx-pf-dqs"><span className="nx-sr">{t("DQS {v}", { v: f1(row.composite_score) })}</span><span aria-hidden="true">{f1(row.composite_score)}</span></span>
        {delta != null ? <Chip tone={delta > 0 ? "good" : delta < 0 ? "bad" : "neutral"}>{`${delta > 0 ? "+" : ""}${f1(delta)}`}</Chip> : null}
        {row.trend.length > 1 ? <Sparkline points={row.trend} label={t("DQS trend of {name}", { name: row.label })} /> : null}
      </div>
      <p className="nx-pf-run">{t("Run {n}, {date}", { n: formatInt(row.run_number ?? 0), date: formatDate(row.run_at) })}</p>
      <div className="nx-pf-chips">
        <V2Link href={compare}><Chip tone="new" count={row.new_issues}>{t("New")}</Chip></V2Link>
        <V2Link href={compare}><Chip tone="resolved" count={row.resolved}>{t("Resolved")}</Chip></V2Link>
        <V2Link href={compare}><Chip tone="regressed" count={row.regressed}>{t("Regressed")}</Chip></V2Link>
      </div>
      <footer className="nx-pf-card-foot">
        <Primary row={row} act={act} />
        <V2Link className="nx-btn nx-btn-quiet nx-btn-sm" href={objectHref(row, act.sysName, `?run=${row.version_id}`)}>{t("Open")}</V2Link>
      </footer>
    </article>
  );
}

export function Cards({ rows, act, selected, onToggle }: { rows: PortfolioRow[]; act: PortfolioActions; selected: Set<string>; onToggle: (row: PortfolioRow) => void }) {
  return (
    <div className="nx-pf-grid">
      {rows.map((r) => <ObjectCard key={r.version_id} row={r} act={act} selected={selected.has(r.version_id)} onSelect={() => onToggle(r)} />)}
    </div>
  );
}
