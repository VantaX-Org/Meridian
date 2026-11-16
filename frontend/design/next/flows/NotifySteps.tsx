"use client";

/** Admin: set the notification schedule. Who, what, save. */
import { useState } from "react";
import { StepFlow, type FlowStep } from "@/design/next/kit";
import { saveNotificationSettings, type NotificationConfig } from "@/lib/api/settings";
import { t } from "@/lib/v2/i18n";

/** `initial` is the stored config: the fields start from it and the Teams webhook is sent back unchanged, since the save replaces the whole config. */
export function NotifySteps({ save = saveNotificationSettings, initial, onDone }: { save?: (c: NotificationConfig) => Promise<void>; initial?: NotificationConfig | null; onDone?: () => void }) {
  const [email, setEmail] = useState(initial?.email ?? "");
  const [daily, setDaily] = useState(initial?.daily_digest ?? false);
  const [weekly, setWeekly] = useState(initial?.weekly_summary ?? true);
  const [monthly, setMonthly] = useState(initial?.monthly_report ?? false);
  const box = (label: string, v: boolean, set: (b: boolean) => void) => <label className="nx-field"><span><input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} /> {label}</span></label>;
  const steps: FlowStep[] = [
    { id: "who", label: t("Recipient"), blocked: /^\S+@\S+\.\S+$/.test(email) ? undefined : t("Enter a valid email address."),
      body: <label className="nx-field">{t("Email")}<input className="nx-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label> },
    { id: "what", label: t("Schedule"), blocked: daily || weekly || monthly ? undefined : t("Choose at least one schedule."),
      body: <>{box(t("Daily digest"), daily, setDaily)}{box(t("Weekly summary"), weekly, setWeekly)}{box(t("Monthly report"), monthly, setMonthly)}</> },
    { id: "save", label: t("Save"), next: { label: t("Save settings"), run: () => save({ email, teams_webhook: initial?.teams_webhook ?? "", daily_digest: daily, weekly_summary: weekly, monthly_report: monthly }) }, body: <p>{t("Meridian sends the chosen reports to {email}.", { email })}</p> },
  ];
  return <StepFlow steps={steps} label={t("Notification schedule")} onFinish={onDone} />;
}
