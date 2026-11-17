"use client";

import { useMutation } from "@tanstack/react-query";
import { apiDetail, createPlan, type MoveMode } from "@/lib/api/next/move";
import { useLicence } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Chip, FieldChip } from "@/ui/kit";
import { humanize } from "../common";
import { useLoadPlan } from "../hooks";
import type { Pick } from "./Systems";

export interface Scope { modules: string[]; mode: MoveMode; pilot?: boolean }

/** Out of scope in the target tenant; matches the server default. */
export const EXCLUDED_COUNTRIES = ["ZMB"];

/** Step 2: which objects move (all licensed ones by default), cleaned or as they are, with the same IDs and full history. */
export function Scope({ pick, scope, onScope, onBack, onPlan }: { pick: Pick; scope: Scope; onScope: (s: Scope) => void; onBack: () => void; onPlan: (planId: string) => void }) {
  const lic = useLicence().data?.enabled_modules ?? [];
  const known = (useLoadPlan().data?.objects ?? []).map((o) => o.module);
  const licensed = lic.length && !lic.includes("*") ? lic : known;
  const chosen = scope.modules.length ? scope.modules : licensed;
  const make = useMutation({
    mutationFn: () => createPlan({ source_system_id: pick.source, target_system_id: pick.target, modules: chosen, mode: scope.mode, exclude_countries: EXCLUDED_COUNTRIES, ...(scope.pilot ? { sample: { per_cell: 10 } } : {}) }),
    onSuccess: (p) => onPlan(p.id),
  });
  const flip = (m: string) => onScope({ ...scope, modules: chosen.includes(m) ? chosen.filter((x) => x !== m) : [...chosen, m] });

  return (
    <Card title={t("Choose what moves")} sub={t("Every licensed object moves with its full history unless you narrow it.")}>
      <div className="mx-col">
        <div role="group" aria-label={t("Objects to move")} className="mx-actions">
          {licensed.map((m) => <Chip key={m} selected={chosen.includes(m)} onClick={() => flip(m)}>{humanize(m)}</Chip>)}
        </div>
        <div role="group" aria-label={t("Data to move")} className="mx-actions">
          <Chip selected={scope.mode === "cleansed"} onClick={() => onScope({ ...scope, mode: "cleansed" })}>{t("Cleaned values")}</Chip>
          <Chip selected={scope.mode === "as_is"} onClick={() => onScope({ ...scope, mode: "as_is" })}>{t("As is, no cleaning")}</Chip>
        </div>
        <p className="mx-muted">{scope.mode === "cleansed" ? t("Uses the data after cleaning, with the fixes you approved.") : t("Copies the data exactly as the source holds it, problems included.")}</p>
        <div role="group" aria-label={t("Pilot sample")} className="mx-actions">
          <Chip selected={!!scope.pilot} onClick={() => onScope({ ...scope, pilot: !scope.pilot })}>{t("Pilot sample")}</Chip>
        </div>
        {scope.pilot ? <p className="mx-muted">{t("Moves 10 people per country, pay band and status, plus their managers, instead of everyone.")}</p> : null}
        <p><FieldChip code={EXCLUDED_COUNTRIES.join(", ")} description={t("Excluded countries: people here are never loaded.")} /></p>
        <p><FieldChip code={t("Keep the same IDs")} description={t("User IDs and keys stay as they are in the source.")} /></p>
        <p><FieldChip code={t("Full history")} description={t("Every module moves with all of its history. This is not optional.")} /></p>
        {make.isError ? <p className="mx-field-e" role="alert">{apiDetail(make.error) ?? t("The plan could not be made.")}</p> : null}
        <div className="mx-actions">
          <Button onClick={onBack}>{t("Back")}</Button>
          <Button variant="primary" disabled={!chosen.length || make.isPending} onClick={() => make.mutate()}>{make.isPending ? t("Making the plan") : t("Make the plan")}</Button>
          <span className="mx-muted"><FieldChip code={String(chosen.length)} description={t("objects chosen")} /></span>
        </div>
      </div>
    </Card>
  );
}
