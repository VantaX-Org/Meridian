"use client";

/**
 * The load options of a load file: full or incremental, the date an incremental load starts from, and whether every
 * entity is included. Drop it into any screen that builds a load file; `toLoadOptions` gives the API parameters and
 * `loadOptionsProblem` the sentence to show while the choice cannot be sent (an incremental load needs a date).
 */
import { useId } from "react";
import { SegmentedControl } from "@/design/next/kit";
import type { LoadOptions as ApiLoadOptions } from "@/lib/api/v2/migration";
import { t } from "@/lib/v2/i18n";
import "./load.css";

export interface LoadChoice {
  load_mode: "full" | "incremental";
  /** ISO date (yyyy-mm-dd), or "" until one is picked. */
  since: string;
  all_entities: boolean;
}

export const DEFAULT_LOAD: LoadChoice = { load_mode: "full", since: "", all_entities: false };

export const loadOptionsProblem = (v: LoadChoice): string | null =>
  v.load_mode === "incremental" && !v.since ? t("Pick the date an incremental load starts from.") : null;

export const toLoadOptions = (v: LoadChoice): ApiLoadOptions => ({ load_mode: v.load_mode, since: v.load_mode === "incremental" && v.since ? v.since : null });

export function LoadOptions({ value, onChange, showEntities = true }: { value: LoadChoice; onChange: (v: LoadChoice) => void; showEntities?: boolean }) {
  const id = useId();
  const problem = loadOptionsProblem(value);
  const explain = value.load_mode === "full" ? t("Full load: the file replaces what the target holds for each record.") : t("Incremental load: the file carries only rows changed on or after the date.");
  return (
    <fieldset className="nx-load-opts" data-testid="load-options">
      <legend className="nx-load-legend">{t("Load options")}</legend>
      <SegmentedControl
        label={t("Load mode")}
        value={value.load_mode}
        onChange={(load_mode) => onChange({ ...value, load_mode })}
        items={[{ value: "full", label: t("Full load") }, { value: "incremental", label: t("Incremental load") }]}
      />
      <p className="nx-load-note">{explain}</p>
      {value.load_mode === "incremental" && (
        <div className="nx-load-since">
          <label htmlFor={`${id}-since`}>{t("Changed on or after")}</label>
          <input id={`${id}-since`} type="date" value={value.since} required aria-invalid={!!problem} aria-describedby={problem ? `${id}-err` : undefined} onChange={(e) => onChange({ ...value, since: e.target.value })} />
          {problem && <p id={`${id}-err`} role="alert" className="nx-load-error">{problem}</p>}
        </div>
      )}
      {showEntities && (
        <div className="nx-load-entities">
          <label className="nx-load-check">
            <input type="checkbox" checked={value.all_entities} onChange={(e) => onChange({ ...value, all_entities: e.target.checked })} />
            <span>{t("Include every entity")}</span>
          </label>
          <p className="nx-load-note">{t("Adds every SuccessFactors entity the dictionary describes, not only those this object's rules cover. Each is marked as generated.")}</p>
        </div>
      )}
    </fieldset>
  );
}
