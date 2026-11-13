"use client";

/** One sticky line over the object: where it is, which run is shown, its score against the run before, the cycle. */
import { Chip } from "@/design/next/kit";
import { V2Link } from "@/design/v2/parts";
import { t } from "@/lib/v2/i18n";
import type { ObjectCycle } from "@/lib/api/next/runs";
import { dqsOf, score, signed } from "./model";
import { ObjectRunSwitcher } from "./RunSwitcher";
import type { ObjectRun } from "./useObjectRun";

const STEP: Record<ObjectCycle["step"], () => string> = {
  pull: () => t("pull"),
  clean: () => t("clean"),
  upload: () => t("upload"),
  score: () => t("score"),
  compare: () => t("compare"),
};

export function ObjectBar({ o, cycle, onCompare }: { o: ObjectRun; cycle: ObjectCycle | null; onCompare: () => void }) {
  const now = dqsOf(o.run, o.module);
  const before = dqsOf(o.previous, o.module);
  const delta = now !== null && before !== null ? now - before : null;
  return (
    <div className="nx-obar" data-testid="object-bar">
      <nav aria-label={t("Breadcrumb")} className="nx-obar-crumbs">
        <V2Link href="/objects">{t("Objects")}</V2Link>
        <span aria-hidden="true">›</span>
        <V2Link href={`/s/${encodeURIComponent(o.systemSeg)}`}>{o.systemName}</V2Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page" className="nx-obar-here">
          {o.label} <span className="nx-mono nx-obar-code">{o.module}</span>
        </span>
      </nav>
      <ObjectRunSwitcher o={o} onCompare={onCompare} />
      {now !== null ? (
        <span className="nx-obar-dqs" data-testid="object-dqs">
          <span className="nx-obar-dqs-label">{t("DQS")}</span> <strong className="nx-num">{score(now)}</strong>
          {delta !== null ? (
            <span className="nx-num nx-obar-delta" data-tone={delta > 0 ? "good" : delta < 0 ? "bad" : "neutral"}>
              {" "}{signed(delta)} <span className="nx-sr">{t("against run {n}", { n: o.previous?.run_number ?? "" })}</span>
            </span>
          ) : null}
        </span>
      ) : null}
      {cycle ? <Chip tone="accent">{t("Cycle {n}, {step}", { n: cycle.number, step: STEP[cycle.step]() })}</Chip> : null}
    </div>
  );
}
