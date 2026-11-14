"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { t } from "@/lib/v2/i18n";
import { failureText } from "@/lib/v2/errors";
import { createSchedule, runScheduleNow } from "@/lib/api/v2/reports";
import type { ScheduleCadence } from "@/lib/api/reports";
import { refreshAdmin, useScheduleOptions } from "@/lib/v2/admin-queries";
import { Button, ErrorState, Sheet, Skeleton, useToast } from "../kit";
import type { SheetCtx } from "../shell/SheetHost";
import { DraftNote, isSessionError, useDraft, useSubmitGuard } from "./states";

const INIT = { kind: "", module: "", scope: "latest", when: "now", cadence: "daily", time: "07:00" };

/** New report in three steps: which report, for which object and run, now or on a schedule. The format follows the report. */
export function ReportSheet({ ctx }: { ctx: SheetCtx }) {
  const { step, setStep, close, under } = ctx;
  const qc = useQueryClient();
  const toast = useToast();
  const opts = useScheduleOptions();
  const draft = useDraft("report", INIT);
  const guard = useSubmitGuard();
  const d = draft.value;
  const type = opts.data?.types.find((x) => x.id === d.kind);
  const n = Math.max(1, Math.min(step, 3));
  const expired = useExpired();

  const send = () =>
    guard.run(async () => {
      if (!type) return;
      try {
        const made = await createSchedule({
          name: type.name,
          kind: type.id,
          format: type.format,
          params: { scope: d.scope, module: d.module || null },
          cadence: d.cadence as ScheduleCadence,
          time_of_day: d.time,
          recipient_user_ids: [],
          recipient_channel_ids: [],
          enabled: d.when === "later",
        });
        if (d.when === "now") await runScheduleNow(made.id);
        await refreshAdmin(qc, "reports");
        draft.clear();
        toast({ text: d.when === "now" ? t("Report is being built.") : t("Report scheduled."), tone: "good" });
        close();
      } catch (e) {
        if (isSessionError(e)) expired.set(true);
        else toast({ text: failureText(e), tone: "bad" });
      }
    });

  const steps = [{ id: "kind", label: t("Report") }, { id: "scope", label: t("Object and run") }, { id: "when", label: t("When") }];
  const needMod = !!type?.needs_module;
  const primary =
    n === 1 ? <Button variant="primary" disabled={!type} reason={t("Pick a report first.")} onClick={() => setStep(2)}>{t("Next")}</Button>
    : n === 2 ? <Button variant="primary" disabled={needMod && !d.module} reason={t("Pick an object first.")} onClick={() => setStep(3)}>{t("Next")}</Button>
    : <Button variant="primary" loading={guard.busy} loadingLabel={t("Working")} onClick={send}>{d.when === "now" ? t("Build now") : t("Schedule")}</Button>;

  return (
    <Sheet open onClose={close} title={t("New report")} size="medium" steps={steps} step={n} onStep={(i) => (i < n ? setStep(i) : undefined)} dirty={!!d.kind} primary={primary} under={under}>
      <DraftNote expired={expired.value} restored={draft.restored} />
      {opts.isLoading ? <Skeleton lines={4} label={t("Loading report kinds")} /> : opts.error ? <ErrorState error={opts.error} onRetry={() => void opts.refetch()} /> : n === 1 ? (
        <div role="radiogroup" aria-label={t("Report")} className="nx-pick">
          {(opts.data?.types ?? []).map((x) => (
            <label key={x.id} className="nx-check"><input type="radio" name="nx-report-kind" checked={d.kind === x.id} onChange={() => draft.set({ kind: x.id })} />{x.name}<span className="nx-sub"> {x.format.toUpperCase()}</span></label>
          ))}
        </div>
      ) : n === 2 ? (
        <div className="nx-form">
          {needMod ? (
            <label className="nx-field">{t("Object")}
              <select className="nx-input" value={d.module} onChange={(e) => draft.set({ module: e.target.value })}>
                <option value="">{t("Pick an object")}</option>
                {(opts.data?.modules ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
          ) : <p className="nx-sub">{t("This report covers every object.")}</p>}
          <label className="nx-field">{t("Run")}
            <select className="nx-input" value={d.scope} onChange={(e) => draft.set({ scope: e.target.value })}>
              <option value="latest">{t("Latest finished run")}</option>
              {(opts.data?.systems ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <div className="nx-form">
          <div role="radiogroup" aria-label={t("When")} className="nx-pick">
            <label className="nx-check"><input type="radio" name="nx-report-when" checked={d.when === "now"} onChange={() => draft.set({ when: "now" })} />{t("Build it now")}</label>
            <label className="nx-check"><input type="radio" name="nx-report-when" checked={d.when === "later"} onChange={() => draft.set({ when: "later" })} />{t("Repeat on a schedule")}</label>
          </div>
          {d.when === "later" ? (
            <>
              <label className="nx-field">{t("Repeats")}
                <select className="nx-input" value={d.cadence} onChange={(e) => draft.set({ cadence: e.target.value })}>
                  <option value="daily">{t("Every day")}</option>
                  <option value="weekly">{t("Every week")}</option>
                  <option value="monthly">{t("Every month")}</option>
                </select>
              </label>
              <label className="nx-field">{t("At")}<input className="nx-input" type="time" value={d.time} onChange={(e) => draft.set({ time: e.target.value })} /></label>
            </>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

/** Whether a submit was refused because the session ended. */
function useExpired() {
  const [value, set] = useState(false);
  return { value, set };
}
