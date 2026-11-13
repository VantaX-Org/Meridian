"use client";

import { useState, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Button } from "./Button";
import { CheckList, type CheckResult } from "./CheckList";
import { Confirm } from "./Confirm";
import { Stepper, type StepItem } from "./Stepper";

export interface FlowStep {
  id: string;
  label: string;
  /** One task: the body of this step. */
  body: ReactNode;
  /** Why Next is off; the step cannot be left while this is set. Shown beside the button and under the step in the rail. */
  blocked?: string;
  /** The primary action of the step ("Test connection"); default "Next", "Finish" on the last. Throw to stay on the step. */
  next?: { label: string; run?: () => Promise<unknown> | unknown };
  failed?: boolean;
  detail?: ReactNode;
  /** Check results for this step. A block holds the primary (its sentence is the reason); a warn asks Confirm first. */
  gate?: CheckResult[];
  /** One sentence under the primary about what happens next ("Scoring takes about two minutes"). */
  hint?: string;
}

/**
 * A multi-step job as one task per screen: a progress rail, the step body, and a sticky bottom bar with Back and one
 * primary action. `initial` is the step the server says the job is on, so a reload resumes there. Steps after the
 * current one are not reachable; the rail says why the next one is still closed.
 */
export function StepFlow({ steps, label, initial = 0, onFinish }: { steps: FlowStep[]; label: string; initial?: number; onFinish?: () => void }) {
  const [at, setAt] = useState(Math.min(Math.max(initial, 0), steps.length - 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = steps[at]!;
  const last = at === steps.length - 1;
  const [ask, setAsk] = useState(false);
  const block = s.gate?.find((c) => c.level === "block");
  const warns = s.gate?.filter((c) => c.level === "warn") ?? [];
  const blocked = s.blocked ?? block?.text;
  const items: StepItem[] = steps.map((x, i) => ({
    id: x.id,
    label: x.label,
    state: x.failed ? "failed" : i < at ? "done" : i === at ? (busy ? "running" : "current") : "future",
    detail: i === at + 1 && blocked ? blocked : x.detail,
  }));

  const go = async () => {
    setError(null);
    setBusy(true);
    try {
      await s.next?.run?.();
      if (last) onFinish?.();
      else setAt(at + 1);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("This step did not finish. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="nx-flow" aria-label={label} data-testid="step-flow">
      <p className="nx-flow-count nx-num" data-testid="flow-count">{t("Step {n} of {total}", { n: at + 1, total: steps.length })}</p>
      <Stepper steps={items} label={label} onSelect={(id) => { const i = steps.findIndex((x) => x.id === id); if (i <= at && !busy) setAt(i); }} selectedId={s.id} />
      <div key={s.id} className="nx-flow-body nx-enter" data-testid={`flow-step-${s.id}`}>
        <h2 className="nx-flow-h">{s.label}</h2>
        {s.body}
        {s.gate?.length ? <CheckList checks={s.gate} /> : null}
        {error ? <p role="alert" className="nx-error-line">{error}</p> : null}
      </div>
      <div className="nx-flow-bar" data-testid="flow-bar">
        <Button variant="quiet" disabled={at === 0 || busy} onClick={() => { setError(null); setAt(at - 1); }}>{t("Back")}</Button>
        <Button variant="primary" loading={busy} loadingLabel={t("Working")} disabled={!!blocked} reason={blocked} onClick={() => (warns.length ? setAsk(true) : void go())}>
          {s.next?.label ?? (last ? t("Finish") : t("Next"))}
        </Button>
      </div>
      {s.hint ? <p className="nx-flow-hint">{s.hint}</p> : null}
      <Confirm open={ask} title={t("Continue with warnings?")} consequence={<CheckList checks={warns} />} confirmLabel={t("Continue anyway")}
        onCancel={() => setAsk(false)} onConfirm={() => { setAsk(false); void go(); }} />
    </section>
  );
}
