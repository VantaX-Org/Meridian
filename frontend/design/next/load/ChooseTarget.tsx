"use client";

import { MODULE_LABELS } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import type { MigrationRun } from "@/lib/api/v2/migration";
import { Button, Chip, EmptyState } from "../kit";
import { runOption, TARGETS, type TargetId } from "./tabs";

function targetCopy(id: TargetId): { name: string; text: string } {
  switch (id) {
    case "s4": return { name: t("SAP S/4HANA"), text: t("Migration Cockpit templates, one sheet per target table.") };
    case "sf": return { name: t("SAP SuccessFactors"), text: t("Import templates, one per portlet.") };
    case "ecc": return { name: t("SAP ECC or another SAP system"), text: t("Files from the corrected records. LSMW, BAPI and IDoc layouts are review only: check them before you rely on them.") };
    case "workbook": return { name: t("Workbook from the new system"), text: t("Upload the target team's template and get your data back in its columns.") };
  }
}

/** Step 1: where the data is going, which run and which objects. Nothing is loaded from here. */
export function ChooseTarget({ runs, target, runId, objects, onTarget, onRun, onObjects, onNext, onWorkbook }: {
  runs: MigrationRun[];
  target: TargetId;
  runId: string | null;
  objects: string[];
  onTarget: (t: TargetId) => void;
  onRun: (id: string) => void;
  onObjects: (m: string[]) => void;
  onNext: () => void;
  onWorkbook: () => void;
}) {
  const run = runs.find((r) => r.id === runId) ?? null;
  const toggle = (m: string) => onObjects(objects.includes(m) ? objects.filter((x) => x !== m) : [...objects, m]);
  return (
    <section className="nx-ld-step" data-testid="choose-target" aria-labelledby="nx-ld-h-target">
      <h2 id="nx-ld-h-target">{t("Where is this data going?")}</h2>
      <p className="nx-ld-lede">{t("Meridian builds the files in the format the target expects. You load them with the target's own tool; nothing is loaded from here.")}</p>
      <div className="nx-ld-cards" role="radiogroup" aria-label={t("Target")}>
        {TARGETS.map((id) => {
          const c = targetCopy(id);
          return (
            <button key={id} type="button" role="radio" aria-checked={target === id} className="nx-ld-card" data-selected={target === id} data-testid={`target-${id}`} onClick={() => onTarget(id)}>
              <strong>{c.name}</strong>
              <span>{c.text}</span>
              {id === "ecc" ? <Chip tone="warn">{t("LSMW, BAPI, IDoc: review only")}</Chip> : null}
            </button>
          );
        })}
      </div>

      {target === "workbook" ? (
        <div className="nx-ld-note">
          <p>{t("The workbook flow lives on the Analysis tab, where you upload the target team's template and download your data in its columns.")}</p>
          <Button variant="primary" onClick={onWorkbook}>{t("Open the workbook flow")}</Button>
        </div>
      ) : runs.length === 0 ? (
        <EmptyState heading={t("No analysis to load from yet")} action={<Button variant="secondary" onClick={onWorkbook}>{t("Open the Analysis tab")}</Button>}>
          {t("Run an analysis against the target first. Its result is what the files are built from.")}
        </EmptyState>
      ) : (
        <>
          <div className="nx-ld-fields">
            <label className="nx-field">
              <span>{t("Source run")}</span>
              <select className="nx-input" value={runId ?? ""} onChange={(e) => onRun(e.target.value)} data-testid="run-select">
                {runs.map((r) => <option key={r.id} value={r.id}>{runOption(r)}</option>)}
              </select>
            </label>
            {run ? (
              <p className="nx-ld-meta">
                {run.target_connected ? t("A target system is connected, so the load is simulated against it.") : t("No target system is connected. Checks use the bundled dictionary of the target release.")}
              </p>
            ) : null}
          </div>
          <fieldset className="nx-ld-objects">
            <legend>{t("Objects")}</legend>
            {(run?.modules ?? []).map((m) => (
              <label key={m} className="nx-check-row">
                <input type="checkbox" className="nx-check" checked={objects.includes(m)} onChange={() => toggle(m)} />
                {MODULE_LABELS[m] ?? m}
              </label>
            ))}
          </fieldset>
          <div className="nx-ld-actions">
            <Button variant="primary" disabled={objects.length === 0 || !run} reason={t("Choose a run and at least one object.")} onClick={onNext}>{t("Check what fits")}</Button>
          </div>
        </>
      )}
    </section>
  );
}
