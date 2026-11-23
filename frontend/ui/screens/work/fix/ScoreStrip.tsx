"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { simulateFix, type SimulateBody } from "@/lib/api/v2/step9";
import type { WorkRow } from "@/lib/api/v2/types";
import { t } from "@/lib/v2/i18n";
import { Button, ScoreRuler } from "@/ui/kit";
import { score as fmt } from "@/ui/screens/object/format";
import { capSentence, decisionSentence, decidedByRule, projectionBody } from "./fixlib";

/** The projection waits this long after the last decision, so a run of keypresses is one call. */
export const PROJECTION_DEBOUNCE_MS = 300;

/** The projection of the drafted fixes: debounced, and the last answer stays while the next is in flight. Never a client guess. */
export function useProjection(module: string | null, drafts: WorkRow[], fullRules: string[]) {
  const fx = useFixture();
  const { body, capped } = useMemo(() => (module ? projectionBody(module, drafts, fullRules) : { body: null as SimulateBody | null, capped: false }), [module, drafts, fullRules]);
  const wanted = body ? JSON.stringify(body) : null;
  const [sent, setSent] = useState<string | null>(wanted);
  useEffect(() => {
    if (wanted === sent) return;
    const id = setTimeout(() => setSent(wanted), PROJECTION_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [wanted, sent]);
  const q = useQuery({
    queryKey: ["v2", "fix", "simulate", fx, sent],
    queryFn: () => simulateFix(JSON.parse(sent as string) as SimulateBody),
    enabled: sent !== null,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  });
  return { res: q.data ?? null, capped };
}

/** The pinned strip: the ruler with shown, measured and projected, what is drafted, the cap and the load-file action. */
export function ScoreStrip({ module, drafts, fullRules, onCreate }: { module: string | null; drafts: WorkRow[]; fullRules: string[]; onCreate: () => void }) {
  const { res, capped } = useProjection(module, drafts, fullRules);
  const n = drafts.length;
  const rules = useMemo(() => decidedByRule(drafts).size, [drafts]);
  const before = res?.before ?? null;
  const after = n > 0 ? res?.after ?? null : null;
  const shown = before?.score ?? null;
  const measured = before && before.raw_score !== null && shown !== null && before.raw_score !== shown ? before.raw_score : null;
  const marks = shown === null ? [] : [{ id: "object", label: module ?? "", shown, measured, projected: after?.score ?? null }];

  return (
    <section className="mx-fixstrip" aria-label={t("Score and load file")} data-testid="fix-strip">
      <div className="mx-fixstrip-nums">
        <div><span className="mx-fixstrip-k">{t("Shown now")}</span><b className="mx-num">{shown === null ? "-" : fmt(shown)}</b></div>
        <div><span className="mx-fixstrip-k">{t("Projected after load")}</span><b className="mx-num mx-fixstrip-proj" data-testid="projected">{after?.score == null ? "-" : fmt(after.score)}</b></div>
      </div>
      <div className="mx-fixstrip-ruler">
        {marks.length ? (
          <ScoreRuler
            marks={marks}
            ariaLabel={t("Score of this object against the gates")}
            showName={false}
            zones={{ noGo: t("No-go"), atRisk: t("At risk"), go: t("Go") }}
            labels={{ atRisk: t("At risk"), go: t("Go"), cap70: t("Cap at 70"), cap85: t("Cap at 85"), measured: (v) => t("Measured {n}", { n: v }), projected: (v) => t("Projected {n}", { n: v }) }}
          />
        ) : <p className="mx-muted">{module ? t("The projected score appears once a run is scored.") : t("Pick one object to see the projected score")}</p>}
        <p className="mx-fixstrip-sentence" data-testid="decision-sentence" aria-live="polite">
          {decisionSentence(n, rules)}
          {before ? <span className="mx-muted">{" "}{capSentence({ cap_level: before.cap_level, breaches: before.breaches }, after)}</span> : null}
          {capped ? <span className="mx-muted">{" "}{t("The projection covers the first 5,000.")}</span> : null}
        </p>
      </div>
      <div className="mx-fixstrip-act">
        <Button variant="primary" disabled={n === 0} onClick={onCreate} data-testid="create-load-file">{t("Create load file, {n, plural, one {# record} other {# records}}", { n })}</Button>
      </div>
    </section>
  );
}
