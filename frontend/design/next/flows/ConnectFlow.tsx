"use client";

import { useState } from "react";
import { t } from "@/lib/v2/i18n";
import { moduleText, systemTypeText } from "@/lib/v2/labels";
import { MODES } from "@/lib/v2/cron";
import { useV2Session } from "@/lib/v2/hooks";
import { Denied } from "../more/states";
import { ConnectDetails } from "./ConnectDetails";
import { useSystemObjectList } from "@/lib/v2/runs-queries";
import { useRefreshV2 } from "@/lib/v2/sys-queries";
import { createProfile } from "@/lib/api/v2/sys";
import { testSystemConnection } from "@/lib/api/v2/runs";
import { Button, Chip, Code, EmptyState, ErrorState, Sheet, Skeleton, useToast } from "../kit";
import type { SheetCtx } from "../shell/SheetHost";
import type { SystemType } from "@/types/api";

export const CONNECT_TYPES: SystemType[] = ["ecc", "s4hana_onprem", "s4hana_cloud", "successfactors", "concur", "ariba", "btp", "ewm"];
const CRON: Record<string, string | null> = { manual: null, daily: "0 2 * * *", weekly: "0 2 * * 1" };

/** Connect a system in six steps. The details step is the native OAuth form; no password is ever sent. */
export function ConnectFlow({ ctx }: { ctx: SheetCtx }) {
  const { step, setStep, close, under } = ctx;
  const toast = useToast();
  const refresh = useRefreshV2();
  const [type, setType] = useState<SystemType | null>(null);
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);
  const [checks, setChecks] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [when, setWhen] = useState<"manual" | "daily" | "weekly">("manual");
  const [mode, setMode] = useState<"full" | "delta">("delta");
  const [saving, setSaving] = useState(false);
  const { can } = useV2Session();
  const objects = useSystemObjectList(saved?.id ?? "", !!saved);

  const steps = [
    { id: "type", label: t("System type") },
    { id: "details", label: t("Connection details") },
    { id: "test", label: t("Test") },
    { id: "objects", label: t("Objects to license") },
    { id: "schedule", label: t("Schedule") },
    { id: "done", label: t("Done") },
  ];

  const test = async () => {
    if (!saved) return;
    setTesting(true);
    try {
      const r = await testSystemConnection(saved.id);
      setChecks({ ok: r.connected, message: r.message });
    } catch {
      setChecks({ ok: false, message: t("The test could not run.") });
    } finally {
      setTesting(false);
    }
  };

  const finish = async () => {
    if (!saved) return;
    setSaving(true);
    try {
      const tables = new Map((objects.data?.objects ?? []).map((o) => [o.object, o.tables]));
      for (const domain of picked) await createProfile(saved.id, { system_id: saved.id, domain, tables: tables.get(domain) ?? [], schedule_cron: CRON[when] ?? undefined, active: true, extraction_mode: mode });
      refresh();
      toast({ text: t("System connected."), tone: "good" });
      setStep(6);
    } catch {
      toast({ text: t("The schedule could not be saved."), tone: "bad" });
    } finally {
      setSaving(false);
    }
  };

  let body: React.ReactNode;
  let primary: React.ReactNode = null;
  if (step <= 1) {
    body = (
      <div role="radiogroup" aria-label={t("System type")} className="nx-pick">
        {CONNECT_TYPES.map((x) => (
          <label key={x} className="nx-check"><input type="radio" name="nx-connect-type" checked={type === x} onChange={() => setType(x)} />{systemTypeText(x)}</label>
        ))}
      </div>
    );
    primary = <Button variant="primary" disabled={!type} reason={t("Pick a system type first.")} onClick={() => setStep(2)}>{t("Next")}</Button>;
  } else if (step === 2) {
    body = (
      <ConnectDetails initialType={type ?? undefined} saveLabel={t("Save and continue")} onSaved={(s) => { setSaved(s); setStep(3); }} />
    );
  } else if (step === 3) {
    body = (
      <div>
        <p>{saved ? saved.name : ""}</p>
        <ul className="nx-checklist" aria-label={t("Connection checks")}>
          <li>{checks ? <Chip tone={checks.ok ? "good" : "bad"}>{checks.ok ? t("Passed") : t("Failed")}</Chip> : <Chip tone="neutral">{t("Not run")}</Chip>} {t("Reach the system and sign in")}</li>
        </ul>
        {checks ? <p role="status">{checks.message}</p> : null}
        <Button variant="secondary" loading={testing} loadingLabel={t("Testing")} onClick={test}>{checks ? t("Test again") : t("Run the test")}</Button>
      </div>
    );
    primary = <Button variant="primary" disabled={!checks?.ok} reason={t("The test has to pass first.")} onClick={() => setStep(4)}>{t("Next")}</Button>;
  } else if (step === 4) {
    body = <ObjectsStep q={objects} picked={picked} setPicked={setPicked} />;
    primary = <Button variant="primary" disabled={!picked.length} reason={t("Pick at least one object.")} onClick={() => setStep(5)}>{t("Next")}</Button>;
  } else if (step === 5) {
    body = (
      <>
        <div role="radiogroup" aria-label={t("Schedule")} className="nx-pick">
          {(["manual", "daily", "weekly"] as const).map((x) => (
            <label key={x} className="nx-check"><input type="radio" name="nx-connect-when" checked={when === x} onChange={() => setWhen(x)} />{x === "manual" ? t("Only when I pull") : x === "daily" ? t("Every day at 02:00") : t("Every Monday at 02:00")}</label>
          ))}
        </div>
        <div role="radiogroup" aria-label={t("Extraction mode")} className="nx-pick">
          {MODES.map((m) => (
            <label key={m.value} className="nx-check"><input type="radio" name="nx-connect-mode" checked={mode === m.value} onChange={() => setMode(m.value)} />{m.label}</label>
          ))}
        </div>
      </>
    );
    primary = <Button variant="primary" loading={saving} loadingLabel={t("Saving")} onClick={finish}>{t("Connect")}</Button>;
  } else {
    body = <EmptyState icon="check" heading={t("System connected")}>{saved?.name}</EmptyState>;
    primary = <Button variant="primary" onClick={close}>{t("Close")}</Button>;
  }

  if (!can("manage_systems")) {
    return (
      <Sheet open onClose={close} title={t("Connect a system")} size="medium" under={under}>
        <Denied what={t("Connecting a system")} />
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={close} title={t("Connect a system")} size="medium" steps={steps} step={Math.max(1, Math.min(step, 6))} onStep={(n) => (n < step && step < 6 ? setStep(n) : undefined)} primary={primary} under={under}>
      {body}
    </Sheet>
  );
}

function ObjectsStep({ q, picked, setPicked }: { q: ReturnType<typeof useSystemObjectList>; picked: string[]; setPicked: (v: string[]) => void }) {
  const objs = q.data?.objects ?? [];
  if (q.isError) return <ErrorState error={q.error} fallback={t("The objects could not be read.")} onRetry={() => q.refetch()} />;
  if (q.isLoading) return <Skeleton lines={4} />;
  if (!objs.length) return <EmptyState heading={t("No objects to license")} />;
  return (
    <ul className="nx-pick" aria-label={t("Objects to license")}>
      {objs.map((o) => {
        const ok = o.licensed !== false;
        return (
          <li key={o.object}>
            <label className="nx-check">
              <input type="checkbox" disabled={!ok} checked={picked.includes(o.object)} onChange={(e) => setPicked(e.target.checked ? [...picked, o.object] : picked.filter((x) => x !== o.object))} />
              <Code code={o.object} text={moduleText(o.object)} />
              {ok ? null : <Chip tone="warn">{t("Not in your licence")}</Chip>}
            </label>
          </li>
        );
      })}
    </ul>
  );
}
