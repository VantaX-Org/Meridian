"use client";

/** Connect a system and extract: details, test, objects, extract. Admin.tsx and ConnectCanvas stay as they are; mount this beside them. */
import { useState } from "react";
import { StepFlow, type FlowStep } from "@/design/next/kit";
import { registerSystem, testDraftConnection, type ConnectionBody } from "@/lib/api/v2/sys";
import { extractObjects } from "@/lib/api/v2/runs";
import { t } from "@/lib/v2/i18n";

export interface ConnectApi {
  test: (b: ConnectionBody) => Promise<{ ok?: boolean; message?: string }>;
  save: (b: ConnectionBody) => Promise<{ id: string }>;
  extract: (id: string, objects: string[]) => Promise<unknown>;
}
const LIVE: ConnectApi = {
  test: (b) => testDraftConnection(b) as Promise<{ ok?: boolean; message?: string }>,
  save: (b) => registerSystem(b),
  extract: (id, objects) => extractObjects(id, objects, true),
};

export function ConnectSteps({ api = LIVE, objects: choices, onDone }: { api?: ConnectApi; objects: string[]; onDone?: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ConnectionBody["system_type"]>("ecc");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [secret, setSecret] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [id, setId] = useState<string | null>(null);
  const body = (): ConnectionBody => ({ name, system_type: type, environment: "production", host, username: user, credentials: secret ? { password: secret } : {} });
  const field = (label: string, v: string, set: (s: string) => void, type = "text") => (
    <label className="nx-field">{label}<input className="nx-input" type={type} value={v} onChange={(e) => { set(e.target.value); }} /></label>
  );
  const steps: FlowStep[] = [
    { id: "details", label: t("System details"), blocked: name && host ? undefined : t("Enter a name and a host."),
      body: <><label className="nx-field">{t("System type")}<select className="nx-input" value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="ecc">{t("ECC")}</option><option value="s4hana_onprem">{t("S/4HANA on premise")}</option></select></label>{field(t("Name"), name, setName)}{field(t("Host"), host, setHost)}{field(t("User"), user, setUser)}{field(t("Password"), secret, setSecret, "password")}</> },
    { id: "test", label: t("Test the connection"), body: <p>{t("Meridian logs on with these details. Nothing is saved yet. The next step opens only if the logon works.")}</p>,
      next: { label: t("Test connection"), run: async () => { const r = await api.test(body()); if (r.ok === false) throw new Error(r.message || t("The system did not accept the logon.")); } } },
    { id: "objects", label: t("Choose objects"), blocked: picked.length ? undefined : t("Choose at least one object."),
      next: { label: t("Save and continue"), run: async () => setId((await api.save(body())).id) },
      body: <ul className="nx-checks">{choices.map((o) => <li key={o}><label><input type="checkbox" checked={picked.includes(o)} onChange={(e) => setPicked(e.target.checked ? [...picked, o] : picked.filter((x) => x !== o))} /> {o}</label></li>)}</ul> },
    { id: "extract", label: t("Extract"), next: { label: t("Start extraction"), run: async () => { if (id) await api.extract(id, picked); } },
      body: <p>{t("Meridian reads {n} objects from the system and scores them.", { n: picked.length })}</p> },
  ];
  return <StepFlow steps={steps} label={t("Connect a system")} onFinish={onDone} />;
}
