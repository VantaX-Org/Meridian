"use client";

/** Admin: update the platform. Check, start, watch. Never offered while the updater is not set up. */
import { useQuery } from "@tanstack/react-query";
import { StepFlow, type FlowStep } from "@/design/next/kit";
import { getUpdateProgress, getUpdateStatus, triggerUpdate } from "@/lib/api/system-update";
import { t } from "@/lib/v2/i18n";

export function UpdateFlow({ start = triggerUpdate, onDone }: { start?: () => Promise<unknown>; onDone?: () => void }) {
  const s = useQuery({ queryKey: ["update-flow-status"], queryFn: getUpdateStatus });
  const p = useQuery({ queryKey: ["update-flow-progress"], queryFn: getUpdateProgress, refetchInterval: 3000 });
  const d = s.data;
  const steps: FlowStep[] = [
    { id: "check", label: t("Version"), blocked: !d ? t("Reading the version.") : !d.updater_configured ? t("The updater is not set up on this system.") : !d.update_available ? t("Already on the newest version.") : undefined,
      body: <p>{d ? t("Version {current}, newest {latest}.", { current: d.current_version, latest: d.latest_version }) : null}</p> },
    { id: "start", label: t("Update"), next: { label: t("Update now"), run: async () => { await start(); } }, body: <p>{t("Meridian restarts during the update. Do not start it while an extraction runs.")}</p> },
    { id: "watch", label: t("Progress"), blocked: p.data && ["done", "rolled_back", "failed"].includes(p.data.status) ? undefined : t("The update is still running."),
      body: <p data-testid="update-progress">{p.data?.message ?? p.data?.status ?? ""}</p> },
  ];
  return <StepFlow steps={steps} label={t("Update the platform")} onFinish={onDone} />;
}
