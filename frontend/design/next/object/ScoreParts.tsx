"use client";

/** Two small parts of the object's score: the sentence that names the rules capping it, and the six dimensions as bars. */
import { Chip, Code, EmptyState, ErrorState, NxLink, Skeleton, type ChipTone } from "@/design/next/kit";
import type { LandscapeCell } from "@/lib/api/v2/types";
import { DIMENSIONS } from "@/lib/api/v2/types";
import { useQualityThresholds } from "@/lib/v2/admin-queries";
import { useOpenItem } from "@/lib/v2/hooks";
import { t, tn } from "@/lib/v2/i18n";
import { bandOf, bandsFor, bandWord, type Band } from "@/lib/v2/thresholds";
import { ScoreBar } from "./tabs/tabs-g-parts";
import "./tabs/tabs-g.css";

/** Names the capping rules as links that open them. Reads the ids it is given, so it never waits for anything. */
export function CapSentence({ capped, cap, ids, names }: { capped: boolean; cap: number | null; ids: readonly string[]; names?: Readonly<Record<string, string>> }) {
  const { hrefFor } = useOpenItem();
  const link = (id: string) => (
    <NxLink key={id} href={hrefFor({ kind: "rule", id })} className="nx-link"><Code code={id} text={names?.[id]} /></NxLink>
  );
  if (!capped) {
    return <>{ids.length === 0 ? t("No critical rule is failing, so nothing holds this score down.") : t("A critical rule is failing, but the score is already below the level it would be held at.")}</>;
  }
  const n = ids.length;
  const at = cap ?? 70;
  if (n === 1) return <>{tn("Held at {cap} because one critical rule fails: {rule}.", { cap: at, rule: link(ids[0]) })}</>;
  if (n === 2) return <>{tn("Held at {cap} because two critical rules fail: {rule} and {rule2}.", { cap: at, rule: link(ids[0]), rule2: link(ids[1]) })}</>;
  return <>{tn("Held at {cap} because {n} critical rules fail, including {rule} and {rule2}.", { cap: at, n, rule: link(ids[0]), rule2: link(ids[1]) })}</>;
}

const BAND_TONE: Record<Band, ChipTone> = { pass: "good", warn: "warn", fail: "bad", critical: "bad" };

/** The six dimensions with their full names, the share of the total each carries, the score, and the tenant's band. */
export function DimensionBars({ cell }: { cell: LandscapeCell }) {
  const tq = useQualityThresholds();
  const thresholds = tq.data;
  if (DIMENSIONS.every((d) => cell.dimensions[d.key] == null)) {
    return <EmptyState heading={t("No dimension is measured yet")}>{t("Run analysis on this object and its six dimensions show here.")}</EmptyState>;
  }
  return (
    <section aria-label={t("Score by dimension")} data-testid="dimension-bars">
      <h3 className="nx-rn-h3">{t("Score by dimension")}</h3>
      <table className="nx-table">
        <caption className="nx-sr">{t("Score by dimension")}</caption>
        <thead>
          <tr><th scope="col">{t("Dimension")}</th><th scope="col" className="nx-r">{t("Weight")}</th><th scope="col">{t("Score")}</th><th scope="col">{t("Target")}</th></tr>
        </thead>
        <tbody>
          {DIMENSIONS.map((d) => {
            const v = cell.dimensions[d.key] ?? null;
            const b = bandsFor(thresholds, cell.module, d.key);
            const band = bandOf(v, b);
            return (
              <tr key={d.key} data-testid={`dimension-${d.key}`}>
                <td>{d.label}</td>
                <td className="nx-r nx-num">{t("{n}% of the score", { n: Math.round(d.weight * 100) })}</td>
                <td>{v == null ? <span className="nx-muted">{t("not measured")}</span> : <ScoreBar value={v} label={d.label} />}</td>
                <td>
                  {band && b ? (
                    <span title={t("Target {target}, warning {warning}, critical {critical}", { target: b.target, warning: b.warning, critical: b.critical })}>
                      <Chip tone={BAND_TONE[band]}>{bandWord(band)}</Chip> <span className="nx-muted nx-num">{b.target}</span>
                    </span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* The scores come with the cell; only the target column waits on the tenant's thresholds. */}
      {tq.isPending ? <Skeleton lines={1} label={t("Reading the score by dimension")} /> : null}
      {tq.isError ? <ErrorState sentence={t("The quality targets could not be read.")} error={tq.error} onRetry={() => void tq.refetch()} /> : null}
    </section>
  );
}
