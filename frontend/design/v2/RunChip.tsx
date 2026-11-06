import { formatDate } from "@/lib/format";
import type { TimelineRun } from "@/lib/api/v2/runs";
import { runLabel, runStatusWord } from "@/lib/v2/run-label";
import { t } from "@/lib/v2/i18n";

/** One run in words: "{System} run {n}", its date, its status, and a Baseline tag. Never an id or a bare timestamp. */
export function RunChip({ run, system }: { run: Pick<TimelineRun, "run_number" | "run_at" | "status" | "baseline">; system?: string | null }) {
  return (
    <span className="m2-runchip" data-testid="run-chip">
      <b>{runLabel(system, run.run_number)}</b>
      <span className="m2-runchip-d">{formatDate(run.run_at, "date")}</span>
      <span className="m2-runchip-s">{runStatusWord(run.status)}</span>
      {run.baseline ? <span className="m2-runchip-tag">{t("Baseline")}</span> : null}
    </span>
  );
}
