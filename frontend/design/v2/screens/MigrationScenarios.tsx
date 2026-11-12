"use client";

import { int } from "@/lib/v2/score";
import { t, tx } from "@/lib/v2/i18n";
import type { MigrationRelevance, MigrationScenario, MigrationScenarioId } from "@/lib/api/v2/rulelib";
import { Field } from "../forms";
import { ScrollFrame } from "./object/ScrollFrame";
import { TableExport } from "@/design/v2/TableExport";

/** The name of each migration scenario. The id is the API's; the words are the interface's, in the reader's language. */
export function scenarioName(id: MigrationScenarioId): string {
  switch (id) {
    case "new_implementation": return t("New implementation");
    case "system_conversion": return t("System conversion");
    case "selective_transition": return t("Selective data transition");
    case "carve_out": return t("Carve-out");
  }
}

/** What each scenario means, written for the buyer; the API sends the same sentence in English. */
export function scenarioText(s: Pick<MigrationScenario, "id" | "description">): string {
  switch (s.id) {
    case "new_implementation": return t("A fresh S/4HANA system loaded through the migration cockpit, with no history carried over.");
    case "system_conversion": return t("The existing ECC system is converted in place and must pass the conversion pre-checks.");
    case "selective_transition": return t("Chosen objects and organisational units are copied into S/4HANA while the rest stays behind.");
    case "carve_out": return t("One company code or business unit is extracted into its own S/4HANA system.");
    default: return tx(s.description);
  }
}

export function relevanceLabel(r: MigrationRelevance): string {
  switch (r) {
    case "required": return t("Required");
    case "recommended": return t("Recommended");
    case "not_applicable": return t("Not applicable");
  }
}

/** The four scenarios with the number of enabled shipped rules that are required, recommended or not applicable to each. */
export function ScenarioPanel({ scenarios, chosen, onChoose }: { scenarios: MigrationScenario[]; chosen: MigrationScenarioId | ""; onChoose: (id: MigrationScenarioId | "") => void }) {
  return (
    <section className="m2-cc-card" aria-label={t("Migration scenarios")} data-testid="migration-scenarios">
      <h3>{t("Which rules matter for your S/4HANA path")}</h3>
      <ScrollFrame label={t("Table 3, scrollable")}>
        <TableExport><table className="m2-tbl">
          <thead>
            <tr>
              <th scope="col">{t("Scenario")}</th>
              <th scope="col">{t("What it is")}</th>
              <th scope="col">{t("Required")}</th>
              <th scope="col">{t("Recommended")}</th>
              <th scope="col">{t("Not applicable")}</th>
              <th scope="col">{t("Blocking")}</th>
              <th scope="col"><span className="m2-sr">{t("Actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.id} data-active={chosen === s.id || undefined}>
                <th scope="row">{scenarioName(s.id)}</th>
                <td>{scenarioText(s)}</td>
                <td className="m2-num">{int(s.counts.required)}</td>
                <td className="m2-num">{int(s.counts.recommended)}</td>
                <td className="m2-num">{int(s.counts.not_applicable)}</td>
                <td className="m2-num">{int(s.blocking)}</td>
                <td>
                  <button type="button" className="m2-btn m2-sm" aria-pressed={chosen === s.id} aria-label={t("Show the rules for {name}", { name: scenarioName(s.id) })} onClick={() => onChoose(chosen === s.id ? "" : s.id)}>
                    {chosen === s.id ? t("Showing") : t("Show rules")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></TableExport>
      </ScrollFrame>
      <p className="m2-prov">{t("Counts are the enabled shipped rules. A rule flagged as a migration blocker is required for a system conversion and a selective data transition.")}</p>
    </section>
  );
}

/** The scenario and relevance selects of the rules filter; the chosen scenario's description sits under its name. */
export function ScenarioFilter({ scenarios, scenario, relevance, onScenario, onRelevance }: { scenarios: MigrationScenario[]; scenario: MigrationScenarioId | ""; relevance: MigrationRelevance | ""; onScenario: (id: MigrationScenarioId | "") => void; onRelevance: (r: MigrationRelevance | "") => void }) {
  const chosen = scenarios.find((s) => s.id === scenario);
  return (
    <div className="m2-filters" role="search" aria-label={t("Filter by migration scenario")}>
      <Field label={t("Migration scenario")} hint={chosen ? scenarioText(chosen) : t("Show only the rules that matter for one path to S/4HANA.")}>
        {(p) => (
          <select {...p} value={scenario} onChange={(e) => { onScenario(e.target.value as MigrationScenarioId | ""); onRelevance(""); }}>
            <option value="">{t("Any scenario")}</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{scenarioName(s.id)}</option>
            ))}
          </select>
        )}
      </Field>
      {scenario ? (
        <Field label={t("Relevance")}>
          {(p) => (
            <select {...p} value={relevance} onChange={(e) => onRelevance(e.target.value as MigrationRelevance | "")}>
              <option value="">{t("All")}</option>
              {(["required", "recommended", "not_applicable"] as const).map((r) => (
                <option key={r} value={r}>{relevanceLabel(r)}</option>
              ))}
            </select>
          )}
        </Field>
      ) : null}
    </div>
  );
}
