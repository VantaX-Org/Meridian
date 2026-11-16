"use client";

import type { TimelineRun } from "@/lib/api/v2/runs";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { runLabel } from "@/lib/v2/run-label";
import { useRunPicker } from "@/lib/v2/scope";
import { Button } from "@/design/next/kit";
import "./tabs-f.css";

/** Says an older run is on screen, and why actions are off. The way back is one button. */
export function OldRunBand({ shown, system, latest }: { shown: Pick<TimelineRun, "run_number" | "run_at" | "status"> | null; system: string | null; latest: Pick<TimelineRun, "id" | "run_number"> | null }) {
  const pick = useRunPicker(latest?.id ?? null);
  const name = shown ? runLabel(system, shown.run_number) : t("An earlier run");
  return (
    <div className="nx-card nx-tf-band" role="status" data-testid="old-run-band">
      <p>
        <b>{name}</b>
        {shown?.run_at ? <>{" "}{t("from {date}", { date: formatDate(shown.run_at, "date") })}</> : null}
        {". "}
        {t("This is not the current run, so actions are off. Open the current run to act.")}
      </p>
      {latest ? (
        <Button variant="primary" size={32} onClick={() => pick(latest.id)}>
          {t("Open the current run ({name})", { name: runLabel(system, latest.run_number) })}
        </Button>
      ) : null}
    </div>
  );
}
