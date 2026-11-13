"use client";

/** The columns of one sheet that the source has no field for. Accept the proposed field, or choose another pair; with no proposal the column stays absent in source. */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { saveTemplateMapping } from "@/lib/api/v2/migration";
import { loadKeys, useTemplateFields, useTemplates } from "@/lib/api/next/load";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { Button, EmptyState, ErrorState, Skeleton, useToast } from "../kit";
import { filledBefore, mappingKey, proposal, rowsOf } from "./templates";
import { Denied, Trunc, useGuard } from "./states";

export function DecisionsPanel({ module, sheet }: { module: string; sheet: string }) {
  const session = useV2Session();
  const q = useTemplates(module);
  const fields = useTemplateFields(module);
  const qc = useQueryClient();
  const toast = useToast();
  const guard = useGuard();
  const [pick, setPick] = useState<Record<string, string>>({});

  if (!session.can("analyse")) return <Denied right={t("analyse")} />;
  if (q.isLoading) return <Skeleton lines={4} label={t("Loading the decisions")} />;
  if (q.isError) return <ErrorState sentence={t("The decisions could not be loaded.")} error={q.error} onRetry={() => void q.refetch()} />;
  const tpl = q.data?.templates[0] ?? null;
  const row = tpl ? rowsOf(tpl.coverage, filledBefore(tpl)).find((r) => r.name === sheet) : undefined;
  if (!tpl || !row) {
    return <div data-testid="decisions-empty"><EmptyState heading={t("This sheet is not in the workbook")}>{t("Open the templates and pick a sheet that is listed.")}</EmptyState></div>;
  }
  if (row.missing.length === 0) {
    return <div data-testid="decisions-done"><EmptyState icon="check" heading={t("Nothing to decide")}>{t("Every column of this sheet has a source field.")}</EmptyState></div>;
  }

  const save = (header: string, id: string) =>
    guard.run(async () => {
      try {
        await saveTemplateMapping(module, tpl.id, { ...tpl.column_map, [mappingKey(sheet, header)]: id });
        await qc.invalidateQueries({ queryKey: loadKeys.all });
        toast({ text: t("Decision saved"), tone: "good" });
      } catch {
        toast({ text: t("The decision could not be saved. Try again."), tone: "bad" });
      }
    });

  return (
    <ul className="nx-ld-people" data-testid="decisions" aria-label={t("Columns to decide")}>
      {row.missing.map((c) => {
        const p = proposal(c);
        const chosen = pick[c.header] ?? "";
        return (
          <li key={c.header} data-testid="decision-row">
            <strong><Trunc text={c.label || c.header} /></strong>
            <span className="nx-ld-meta">{c.mandatory ? t("Required by the new system") : t("Optional")}</span>
            {p ? (
              <>
                <span>{t("Proposed: {field}", { field: p })}</span>
                <Button variant="primary" size={32} loading={guard.busy} onClick={() => void save(c.header, p)}>{t("Accept")}</Button>
              </>
            ) : (
              <span data-testid="absent">{t("Absent in source")}</span>
            )}
            <label className="nx-field-label">
              {t("Choose another field pair")}
              <select className="nx-field" value={chosen} onChange={(e) => setPick((cur) => ({ ...cur, [c.header]: e.target.value }))}>
                <option value="">{t("Choose a field")}</option>
                {(fields.data?.fields ?? []).map((f) => (
                  <option key={f.field} value={f.field}>{f.description ? `${f.field}: ${f.description}` : f.field}</option>
                ))}
              </select>
            </label>
            <Button variant="secondary" size={32} disabled={!chosen} reason={chosen ? undefined : t("Choose a field first.")} onClick={() => void save(c.header, chosen)}>{t("Use this field")}</Button>
          </li>
        );
      })}
    </ul>
  );
}
