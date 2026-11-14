"use client";

/** Run analysis: choose the system, choose objects, start. Reads from the system, then scores. */
import { useState } from "react";
import { StepFlow, type FlowStep } from "@/design/next/kit";
import { extractObjects } from "@/lib/api/v2/runs";
import { t } from "@/lib/v2/i18n";

export function AnalysisFlow({ systems, objects, start = (s, o) => extractObjects(s, o, true), onDone }: {
  systems: { id: string; name: string }[]; objects: string[]; start?: (system: string, objects: string[]) => Promise<unknown>; onDone?: () => void;
}) {
  const [sys, setSys] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const steps: FlowStep[] = [
    { id: "system", label: t("System"), blocked: sys ? undefined : t("Choose a system."),
      body: <div role="radiogroup" aria-label={t("System")}>{systems.map((s) => <label key={s.id} className="nx-field"><span><input type="radio" name="sys" checked={sys === s.id} onChange={() => setSys(s.id)} /> {s.name}</span></label>)}</div> },
    { id: "objects", label: t("Objects"), blocked: picked.length ? undefined : t("Choose at least one object."),
      body: <ul className="nx-checks">{objects.map((o) => <li key={o}><label><input type="checkbox" checked={picked.includes(o)} onChange={(e) => setPicked(e.target.checked ? [...picked, o] : picked.filter((x) => x !== o))} /> {o}</label></li>)}</ul> },
    { id: "start", label: t("Start"), next: { label: t("Start analysis"), run: () => start(sys, picked) }, body: <p>{t("Meridian reads {n} objects from the system and scores them.", { n: picked.length })}</p> },
  ];
  return <StepFlow steps={steps} label={t("Run analysis")} onFinish={onDone} />;
}
