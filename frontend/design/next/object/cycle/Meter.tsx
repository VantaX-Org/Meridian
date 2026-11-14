"use client";

/** The score as a hero number with its change, a ruler from 0 to 100, and a bar for the change between two scores. */
import { t } from "@/lib/v2/i18n";
import { AreaSpark, ScoreRing } from "../../kit/viz";
import { score, signed } from "../model";

export function Ruler({ value, label }: { value: number | null; label: string }) {
  const at = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="nx-ruler" role="img" aria-label={value === null ? t("{label}: no score", { label }) : t("{label}: {value} of 100", { label, value: score(value) })}>
      <span className="nx-ruler-fill" style={{ inlineSize: `${at}%` }} />
    </div>
  );
}

/** The score as a ring beside the big number, with the trend of earlier runs under it when there are any. */
export function Hero({ label, value, delta, trend, testid }: { label: string; value: number | null; delta?: number | null; trend?: readonly (number | null)[]; testid?: string }) {
  return (
    <div className="nx-hero nx-hero-visual" data-testid={testid}>
      <ScoreRing compact size={96} value={value} label={label} testid={testid ? `${testid}-ring` : undefined} />
      <div className="nx-hero-body">
        <span className="nx-hero-label">{label}</span>
        <span className="nx-hero-num nx-num">{value === null ? "—" : score(value)}</span>
        {delta !== undefined && delta !== null ? <span className="nx-hero-delta nx-num" data-sign={delta > 0 ? "up" : delta < 0 ? "down" : "same"}>{signed(delta)}</span> : null}
        <Ruler value={value} label={label} />
      </div>
      {trend ? <AreaSpark values={trend} label={t("Score trend")} testid={testid ? `${testid}-trend` : undefined} /> : null}
    </div>
  );
}

/** Two scores on one 0 to 100 line: the gap between them is filled, and said in words. */
export function DeltaBar({ before, after }: { before: number | null; after: number | null }) {
  if (before === null || after === null) return <p className="nx-muted">{t("One of the runs has no score for this object.")}</p>;
  const lo = Math.max(0, Math.min(100, Math.min(before, after)));
  const hi = Math.max(0, Math.min(100, Math.max(before, after)));
  const d = after - before;
  return (
    <div className="nx-delta" data-testid="delta-bar" data-sign={d > 0 ? "up" : d < 0 ? "down" : "same"}>
      <div className="nx-delta-track" role="img" aria-label={t("From {a} to {b}", { a: score(before), b: score(after) })}>
        <span className="nx-delta-span" style={{ insetInlineStart: `${lo}%`, inlineSize: `${hi - lo}%` }} />
      </div>
      <p className="nx-num">{d === 0 ? t("No change") : d > 0 ? t("Up {n} points", { n: score(d) }) : t("Down {n} points", { n: score(-d) })}</p>
    </div>
  );
}
