"use client";

/** Load prepare: read the plan, choose an object that is go, confirm. The load screens stay as they are. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StepFlow, Chip, type FlowStep } from "@/design/next/kit";
import { getLoadPlan, type LoadObject } from "@/lib/api/v2/load-plan";
import { t } from "@/lib/v2/i18n";

export function LoadPrepareFlow({ systemId, onPrepare, onDone }: { systemId?: string; onPrepare?: (o: LoadObject) => Promise<unknown> | unknown; onDone?: () => void }) {
  const plan = useQuery({ queryKey: ["load-prepare-plan", systemId ?? ""], queryFn: () => getLoadPlan(undefined, systemId) });
  const [mod, setMod] = useState("");
  const objs = plan.data?.objects ?? [];
  const cur = objs.find((o) => o.module === mod);
  const steps: FlowStep[] = [
    { id: "plan", label: t("Load plan"), blocked: plan.isPending ? t("Reading the plan.") : plan.isError ? t("The plan did not load.") : undefined,
      body: <p>{t("{n} objects in {steps} load steps.", { n: objs.length, steps: plan.data?.steps ?? 0 })}</p> },
    { id: "object", label: t("Object"), blocked: !cur ? t("Choose an object.") : cur.status === "go" ? undefined : t("This object is not ready: {n} blocking findings.", { n: cur.blocking }),
      body: <ul className="nx-checks">{objs.map((o) => <li key={o.module}><label><input type="radio" name="obj" checked={mod === o.module} onChange={() => setMod(o.module)} /> {o.label} <Chip tone={o.status === "go" ? "good" : o.status === "no_go" ? "bad" : "neutral"}>{o.status === "go" ? t("Go") : o.status === "no_go" ? t("No go") : t("Not run")}</Chip></label></li>)}</ul> },
    { id: "confirm", label: t("Prepare"), next: { label: t("Prepare load"), run: () => cur && onPrepare?.(cur) }, body: <p>{cur ? t("Prepare {name} for load.", { name: cur.label }) : null}</p> },
  ];
  return <StepFlow steps={steps} label={t("Prepare a load")} onFinish={onDone} />;
}
