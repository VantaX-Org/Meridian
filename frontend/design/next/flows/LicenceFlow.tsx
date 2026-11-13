"use client";

/** Admin: check the licence and the modules it activates. Validate asks the licence service again. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StepFlow, type FlowStep } from "@/design/next/kit";
import { getLicenceManifest, validateLicence, type LicenceManifest } from "@/lib/api/licence";
import { t } from "@/lib/v2/i18n";

export function LicenceFlow({ validate = validateLicence, onDone }: { validate?: () => Promise<LicenceManifest>; onDone?: () => void }) {
  const q = useQuery({ queryKey: ["licence-flow"], queryFn: getLicenceManifest });
  const [fresh, setFresh] = useState<LicenceManifest | null>(null);
  const m = fresh ?? q.data;
  const steps: FlowStep[] = [
    { id: "status", label: t("Licence"), blocked: m ? undefined : t("Reading the licence."),
      body: <p>{m ? t("Status {status}, {n} days left.", { status: m.status, n: m.days_remaining ?? 0 }) : null}</p> },
    { id: "check", label: t("Check with the licence service"), next: { label: t("Check now"), run: async () => setFresh(await validate()) },
      body: <p>{t("Meridian asks the licence service for the current licence.")}</p> },
    { id: "modules", label: t("Active modules"), blocked: m?.valid === false ? t("The licence is not valid.") : undefined,
      body: <ul className="nx-checks" data-testid="licence-modules">{(m?.enabled_modules ?? []).map((x) => <li key={x}>{x}</li>)}</ul> },
  ];
  return <StepFlow steps={steps} label={t("Activate modules")} onFinish={onDone} />;
}
