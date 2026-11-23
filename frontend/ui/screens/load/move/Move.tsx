"use client";

import { useState } from "react";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { PageHeader, Stepper } from "@/ui/kit";
import { useBack } from "../common";
import { Delta } from "./Delta";
import { MoveLoad } from "./MoveLoad";
import { PlanStep } from "./PlanStep";
import { Preflight } from "./Preflight";
import { Reconcile } from "./Reconcile";
import { Scope, type Scope as ScopeState } from "./Scope";
import { Systems, type Pick } from "./Systems";

/** Move to new instance: seven steps, one primary action each. */
export function Move() {
  useInterfaceLang();
  const back = useBack();
  const [step, setStep] = useState(0);
  const [pick, setPick] = useState<Pick>({ source: "", target: "" });
  const [scope, setScope] = useState<ScopeState>({ modules: [], mode: "cleansed" });
  const [planId, setPlanId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const go = (n: number) => () => setStep(n);
  const steps = [t("Systems"), t("Scope"), t("Plan"), t("Check"), t("Load"), t("Reconcile"), t("Delta")].map((label, i) => ({ id: String(i), label }));

  return (
    <div className="mx-col">
      <PageHeader back={back} title={t("Move to new instance")} context={t("Move every object and its history from one system to a new one, then prove it arrived.")} />
      <Stepper steps={steps} current={step} label={t("Steps")} />
      <p className="mx-muted">{t("Step {n} of {total}: {name}", { n: step + 1, total: steps.length, name: steps[step].label })}</p>
      {step === 0 ? <Systems pick={pick} onPick={setPick} onNext={go(1)} /> : null}
      {step === 1 ? <Scope pick={pick} scope={scope} onScope={setScope} onBack={go(0)} onPlan={(id) => { setPlanId(id); setRunId(null); setStep(2); }} /> : null}
      {step === 2 && planId ? <PlanStep planId={planId} onBack={go(1)} onNext={go(3)} /> : null}
      {step === 3 && planId ? <Preflight planId={planId} onBack={go(2)} onNext={go(4)} /> : null}
      {step === 4 && planId ? <MoveLoad planId={planId} runId={runId} onRun={setRunId} onBack={go(3)} onNext={go(5)} /> : null}
      {step === 5 && planId ? <Reconcile planId={planId} onBack={go(4)} onNext={go(6)} /> : null}
      {step === 6 && planId ? <Delta planId={planId} onBack={go(5)} /> : null}
    </div>
  );
}
