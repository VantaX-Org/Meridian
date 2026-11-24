"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { simulateFix, type SimulateBody } from "@/lib/api/v2/step9";
import type { WorkRow } from "@/lib/api/v2/types";
import { t } from "@/lib/v2/i18n";
import { Button, ScoreRuler } from "@/ui/kit";
import { score as fmt } from "@/ui/screens/object/format";
import { decisionSentence, decidedByRule, projectionBody } from "./fixlib";

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

/** The held-at-the-gate text, built only from the capping rules the score answer carries. Null when no cap holds the score. */
export function heldText(before: { cap_level: number | null; breaches: string[] }, after: { cap_level: number | null } | null): { head: string; body: string } | null {
  if (before.cap_level === null) return null;
  const n = before.breaches.length;
  const body = n ? t("{n, plural, one {# critical rule is over tolerance} other {# critical rules are over tolerance}}", { n }) : "";
  const lifts = after && (after.cap_level === null || after.cap_level > before.cap_level);
  return { head: t("Held at the {cap} gate", { cap: before.cap_level }), body: lifts ? `${body}. ${t("The drafted fixes lift the cap")}` : body };
}

const Legend = () => (
  <ul className="mx-fixstrip-legend">
    <li><svg viewBox="-8 -8 16 16" aria-hidden="true"><circle className="mx-ruler-dot" data-tone="watch" r="6" /></svg>{t("Shown")}</li>
    <li><svg viewBox="-8 -8 16 16" aria-hidden="true"><circle className="mx-ruler-hollow" r="5" /></svg>{t("Measured")}</li>
    <li><svg viewBox="-8 -8 16 16" aria-hidden="true"><polygon className="mx-ruler-proj" points="0,-7 7,0 0,7 -7,0" /></svg>{t("Projected")}</li>
  </ul>
);

/** The thin strip: the numbers, a slim ruler with its legend, why the score is held, and the load-file action with what is drafted. */
export function ScoreStrip({ module, drafts, fullRules, onCreate }: { module: string | null; drafts: WorkRow[]; fullRules: string[]; onCreate: () => void }) {
  const { res, capped } = useProjection(module, drafts, fullRules);
  const n = drafts.length;
  const rules = useMemo(() => decidedByRule(drafts).size, [drafts]);
  const before = res?.before ?? null;
  const after = n > 0 ? res?.after ?? null : null;
  const shown = before?.score ?? null;
  const measured = before && before.raw_score !== null && shown !== null && before.raw_score !== shown ? before.raw_score : null;
  const marks = shown === null ? [] : [{ id: "object", label: module ?? "", shown, measured, projected: after?.score ?? null }];
  const held = before ? heldText(before, after) : null;

  return (
    <section className="mx-fixstrip" aria-label={t("Score and load file")} data-testid="fix-strip">
      <div className="mx-fixstrip-nums">
        <div><span className="mx-fixstrip-k">{t("Shown now")}</span><b className="mx-num">{shown === null ? "-" : fmt(shown)}</b></div>
        <div><span className="mx-fixstrip-k">{t("Projected after load")}</span><b className="mx-num mx-fixstrip-proj" data-testid="projected">{after?.score == null ? "-" : fmt(after.score)}</b></div>
      </div>
      <div className="mx-fixstrip-ruler">
        {marks.length ? (
          <>
            <ScoreRuler
              marks={marks} slim
              ariaLabel={t("Score of this object against the gates")}
              labels={{ atRisk: t("At risk"), go: t("Go"), cap70: t("70 gate"), cap85: t("85 gate"), measured: (v) => t("Measured {n}", { n: v }), projected: (v) => t("Projected {n}", { n: v }) }}
            />
            <Legend />
          </>
        ) : <p className="mx-muted">{module ? t("The projected score appears once a run is scored.") : t("Pick one object to see the projected score")}</p>}
      </div>
      <p className="mx-fixstrip-held" data-testid="held-note">
        {held ? <><b>{held.head}</b>{held.body ? <span className="mx-muted">{" "}{held.body}</span> : null}</> : null}
        {capped ? <span className="mx-muted">{" "}{t("The projection covers the first 5,000.")}</span> : null}
      </p>
      <div className="mx-fixstrip-act">
        <Button variant="primary" disabled={n === 0} onClick={onCreate} data-testid="create-load-file">{t("Create load file, {n, plural, one {# record} other {# records}}", { n })}</Button>
        <span className="mx-fixstrip-hint mx-muted" data-testid="decision-sentence" aria-live="polite">{decisionSentence(n, rules)}</span>
      </div>
    </section>
  );
}
