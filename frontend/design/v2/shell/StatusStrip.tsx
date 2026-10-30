"use client";

import { Fragment } from "react";
import { formatDate } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { firstSentence, JOB_KIND_LABEL, jobObject, openFailures } from "@/lib/v2/jobs";
import { useLandscape, useStatus } from "@/lib/v2/queries";
import { useV2Jobs } from "@/lib/v2/runs-queries";
import { useCanvasRun } from "@/lib/v2/scope";
import { int } from "@/lib/v2/score";
import { useStatusPage } from "@/lib/v2/enterprise-queries";
import { overallVerdict, overallWord } from "@/lib/v2/status";
import { SeverityMark, VerdictMark } from "../marks";
import { Dot, V2Link } from "../parts";
import { t } from "@/lib/v2/i18n";

/** The platform's health in one word, a link to the status page. Nothing shows until the status page has answered. */
function HealthWord() {
  const q = useStatusPage();
  if (!q.data) return null;
  const s = q.data.status;
  return (
    <V2Link href="/status" className="m2-health" data-testid="status-health" aria-label={t("Platform {statusWord}, open the status page", { statusWord: overallWord(s) })}>
      <VerdictMark verdict={overallVerdict(s)} />
      {overallWord(s)}
    </V2Link>
  );
}

/** "11 m 42 s" from seconds; a dash is the caller's job for a missing value. */
export function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} m ${s} s` : `${s} s`;
}

/** The newest failed job that no later success replaced, as one line with a way into its inspector. */
function FailureLine() {
  const { jobs } = useV2Jobs();
  const { hrefFor } = useOpenItem();
  const failed = openFailures(jobs)[0];
  if (!failed) return null;
  const why = firstSentence(failed.error);
  return (
    <span className="m2-fail" data-testid="status-failure">
      <SeverityMark severity="critical" />
      <span>
        {t("{JOB_KIND_LABEL} of {jobObject} failed{value}", { JOB_KIND_LABEL: JOB_KIND_LABEL[failed.kind], jobObject: jobObject(failed), value: why ? `: ${why}` : "" })}{" "}
        <V2Link href={hrefFor({ kind: "job", id: failed.id })}>{t("Open")}</V2Link>
      </span>
    </span>
  );
}

/**
 * The status strip under the canvas: what the numbers on screen were made from. When the canvas is scoped to a run
 * (`?run=` or a run page) the figures are that run's. A failed job adds one line at the end.
 */
export function StatusStrip() {
  const run = useCanvasRun();
  const current = useStatus();
  const scoped = useLandscape(run);
  const q = run ? scoped : current;
  const s = run ? scoped.data?.status_strip : current.data;
  const parts: string[] = s
    ? [
        s.run_at ? t("Run {run_at}", { run_at: formatDate(s.run_at, "datetime") }) : t("No run yet"),
        t("{records_checked} records checked", { records_checked: int(s.records_checked) }),
        t("{rules_measured} rules measured", { rules_measured: int(s.rules_measured) }),
        s.scored_in_s == null ? "" : t("scored in {scored_in_s}", { scored_in_s: duration(s.scored_in_s) }),
        s.cost_model ? t("cost model {cost_model}", { cost_model: s.cost_model }) : "",
        s.licence_valid_to ? t("licence valid to {licence_valid_to}", { licence_valid_to: formatDate(s.licence_valid_to, "date") }) : "",
      ].filter(Boolean)
    : [];
  return (
    <footer className="m2-status" data-testid="status-strip" aria-label={t("Status")}>
      <span className="m2-status-l">
        <HealthWord />
        <span className="m2-status-t">
        {q.isError ? (
          t("The status line could not be read.")
        ) : s ? (
          parts.map((p, i) => (
            <Fragment key={p}>
              {i > 0 ? <Dot /> : null}
              {p}
            </Fragment>
          ))
        ) : (
          <span className="m2-skel" style={{ width: 360, height: 12 }} aria-hidden="true" />
        )}
        </span>
      </span>
      <FailureLine />
    </footer>
  );
}
