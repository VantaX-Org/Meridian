"use client";

import { useId, type ReactNode } from "react";
import { formatDate } from "@/lib/format";
import type { TimelineRun } from "@/lib/api/v2/runs";
import { runLabel, runStatusWord } from "@/lib/v2/run-label";
import { useRunPicker } from "@/lib/v2/scope";
import { t } from "@/lib/v2/i18n";
import { Coded } from "./parts";
import "./runs.css";

/** A code with the words for it beside it, words first. The one way a table shows a code. */
export function CodeWithText({ code, text }: { code: string; text?: string | null }) {
  return <Coded code={code} text={text} />;
}

/** Marks a system that is switched off but still holds finished runs: its numbers stay, labelled. */
export function InactiveChip() {
  return (
    <span className="m2-rp-inactive" title={t("This system is switched off. Its finished runs stay readable; no new run starts.")}>
      {t("Inactive")}
    </span>
  );
}

/** One plain sentence at the top of a screen: what it shows, for which object, system and run. */
export function Lede({ children }: { children: ReactNode }) {
  return <p className="m2-lede" data-testid="lede">{children}</p>;
}

/** The one next action, with the reason for it beside. */
export function PrimaryAction({ action, why }: { action: ReactNode; why: ReactNode }) {
  return (
    <div className="m2-primary" data-testid="primary-action">
      {action}
      <span className="m2-why1">{why}</span>
    </div>
  );
}

/** Says an older run is on screen, and why actions are off. The way back is one button. */
export function OldRunBand({ shown, system, latest }: { shown: Pick<TimelineRun, "run_number" | "run_at" | "status"> | null; system: string | null; latest: Pick<TimelineRun, "id" | "run_number"> | null }) {
  const pick = useRunPicker(latest?.id ?? null);
  const name = shown ? runLabel(system, shown.run_number) : t("An earlier run");
  return (
    <div className="m2-rp-band" role="status" data-testid="old-run-band">
      <p>
        <b>{name}</b>
        {shown?.run_at ? <>{" "}{t("from {date}", { date: formatDate(shown.run_at, "date") })}</> : null}
        {". "}
        {t("This is not the current run, so actions are off. Open the current run to act.")}
      </p>
      {latest ? (
        <button type="button" className="m2-btn m2-sm m2-strong" onClick={() => pick(latest.id)}>
          {t("Open the current run ({name})", { name: runLabel(system, latest.run_number) })}
        </button>
      ) : null}
    </div>
  );
}

/** Reason actions carry when an older run is shown. */
export const OLD_RUN_REASON = () => t("Open the current run to act");

/** Picks among one object's own finished runs; the newest is named current. */
export function RunPicker({ runs, system, selectedId }: { runs: readonly TimelineRun[]; system: string | null; selectedId: string | null }) {
  const id = useId();
  const latest = runs.length ? runs[runs.length - 1] : null;
  const pick = useRunPicker(latest?.id ?? null);
  if (runs.length === 0) return null;
  const newestFirst = [...runs].reverse();
  return (
    <label className="m2-rp-pick" htmlFor={id}>
      <span>{t("Run")}</span>
      <select id={id} value={selectedId ?? latest?.id ?? ""} onChange={(e) => pick(e.target.value)} data-testid="run-picker">
        {newestFirst.map((r) => (
          <option key={r.id} value={r.id}>
            {runLabel(system, r.run_number)}, {formatDate(r.run_at, "date")}, {runStatusWord(r.status)}{r.id === latest?.id ? `, ${t("current")}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

