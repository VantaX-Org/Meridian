"use client";

/** Connect a system and extract: details, test, objects, extract. The details step is the native OAuth form; no password is ever sent. */
import { useState } from "react";
import { StepFlow, type FlowStep } from "@/design/next/kit";
import { extractObjects, testSystemConnection } from "@/lib/api/v2/runs";
import { t } from "@/lib/v2/i18n";
import { ConnectDetails } from "./ConnectDetails";

export interface ConnectApi {
  test: (id: string) => Promise<{ connected?: boolean; message?: string }>;
  extract: (id: string, objects: string[]) => Promise<unknown>;
}
const LIVE: ConnectApi = {
  test: (id) => testSystemConnection(id),
  extract: (id, objects) => extractObjects(id, objects, true),
};

export function ConnectSteps({ api = LIVE, objects: choices, onDone }: { api?: ConnectApi; objects: string[]; onDone?: () => void }) {
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const steps: FlowStep[] = [
    { id: "details", label: t("System details"), blocked: saved ? undefined : t("Save the connection first."),
      body: saved ? <p role="status">{saved.name}</p> : <ConnectDetails saveLabel={t("Save and continue")} onSaved={setSaved} /> },
    { id: "test", label: t("Test the connection"), body: <p>{t("Meridian logs on with these details. The next step opens only if the logon works.")}</p>,
      next: { label: t("Test connection"), run: async () => { if (!saved) return; const r = await api.test(saved.id); if (r.connected === false) throw new Error(r.message || t("The system did not accept the logon.")); } } },
    { id: "objects", label: t("Choose objects"), blocked: picked.length ? undefined : t("Choose at least one object."),
      body: <ul className="nx-checks">{choices.map((o) => <li key={o}><label><input type="checkbox" checked={picked.includes(o)} onChange={(e) => setPicked(e.target.checked ? [...picked, o] : picked.filter((x) => x !== o))} /> {o}</label></li>)}</ul> },
    { id: "extract", label: t("Extract"), next: { label: t("Start extraction"), run: async () => { if (saved) await api.extract(saved.id, picked); } },
      body: <p>{t("Meridian reads {n} objects from the system and scores them.", { n: picked.length })}</p> },
  ];
  return <StepFlow steps={steps} label={t("Connect a system")} onFinish={onDone} />;
}
