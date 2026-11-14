"use client";

/** Score: run the rules on the open run again (after a rule change, or when the first scoring failed). */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, useToast } from "@/design/next/kit";
import { RunForecast } from "@/design/v2/screens/step10/Prediction";
import { analyseRun } from "@/lib/api/v2/runs";
import { uploadSentence } from "@/lib/api/v2/roundtrip";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { statusOf } from "../model";
import type { ObjectRun } from "../useObjectRun";

export function ScoreStep({ o }: { o: ObjectRun }) {
  const can = useV2Session().can("analyse");
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const running = o.run ? statusOf(o.run) === "running" : false;
  const n = o.run?.run_number ?? "";
  const reason = !o.runId ? t("Pull a run first.") : running ? t("Run {n} is being scored.", { n }) : !can ? t("Only users with the analyse right can score a run.") : undefined;

  return (
    <div className="nx-stack" data-testid="score-step">
      <p>{t("Scoring runs every rule of {object} on run {n}. A pull and an upload score on their own; score again after the rules change.", { object: o.label, n })}</p>
      {running ? <p role="status">{t("Run {n} is being scored.", { n })}</p> : null}
      <RunForecast systemId={o.systemId} modules={[o.module]} what="analysis" />
      <Button
        variant="secondary"
        icon="refresh"
        loading={busy}
        loadingLabel={t("Starting")}
        disabled={Boolean(reason)}
        reason={reason}
        onClick={async () => {
          if (!o.runId) return;
          setBusy(true);
          try {
            await analyseRun(o.runId);
            void qc.invalidateQueries({ queryKey: ["next"] });
            toast({ text: t("Run {n} is being scored again.", { n }), tone: "good" });
          } catch (e) {
            toast({ text: uploadSentence(e, t("Scoring could not start.")), tone: "bad" });
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Score again")}
      </Button>
    </div>
  );
}
