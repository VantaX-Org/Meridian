"use client";

import { useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { getTemplates } from "@/lib/api/v2/migration";
import type { ExtractTargetChoice } from "@/lib/api/v2/extract-target";
import { useFixture } from "@/lib/api/v2/fixture";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { labelText } from "@/lib/v2/labels";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "../parts";
import { Fld } from "./kit";

/** The choice the API takes: the system only when it differs from the paired one, a template only when it was picked by hand. */
export function buildChoice(paired: string | null, system: string | null, picks: Record<string, string>, modules: string[]): ExtractTargetChoice | undefined {
  const out: ExtractTargetChoice = {};
  if (system && system !== paired) out.target_system_id = system;
  const ids = Object.fromEntries(modules.filter((m) => m in picks).map((m) => [m, picks[m]]));
  if (Object.keys(ids).length) out.target_template_ids = ids;
  return Object.keys(out).length ? out : undefined;
}

/** "Will fill: Material load v2 for Material, Customer load for Customer." */
export function previewLine(rows: { module: string; name: string | null }[]): string {
  const named = rows.filter((r) => r.name);
  return named.length ? t("Will fill: {list}", { list: named.map((r) => t("{template} for {object}", { template: r.name ?? "", object: labelText(r.module) })).join(", ") }) : t("No template will be filled automatically.");
}

/**
 * The Target step of starting an extraction: which target system the run is for (the paired one unless changed) and,
 * per picked object, which of its target templates Meridian fills when the run is stored (the newest unless changed,
 * or none). Reports the choice up; `undefined` means the API defaults apply.
 */
export function ExtractTargetStep({ system, modules, disabled, onChange }: { system: string; modules: string[]; disabled?: boolean; onChange: (c: ExtractTargetChoice | undefined) => void }) {
  const fixture = useFixture();
  const systems = useSystemsExtended();
  const [sys, setSys] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const all = systems.data ?? [];
  const paired = all.find((s) => s.id === system)?.target_system_id ?? null;
  const options = all.filter((s) => s.id !== system && (s.role === "target" || s.id === paired));
  const chosenSystem = sys ?? paired ?? "";
  const tpls = useQueries({
    queries: modules.map((m) => ({ queryKey: ["v2", "extract-target-templates", fixture, m], queryFn: () => getTemplates(m), retry: false, staleTime: 30_000 })),
  });
  const rows = modules.map((m, i) => {
    const list = [...(tpls[i]?.data?.templates ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const picked = m in picks ? picks[m] : list[0]?.id ?? "";
    return { module: m, list, loading: !!tpls[i]?.isLoading, picked, name: list.find((x) => x.id === picked)?.name ?? null };
  });
  const key = JSON.stringify(buildChoice(paired, chosenSystem || null, picks, modules) ?? null);
  useEffect(() => onChange(JSON.parse(key) ?? undefined), [key, onChange]);
  if (modules.length === 0) return null;
  return (
    <fieldset className="m2-target" data-testid="extract-target-step" disabled={disabled}>
      <legend>{t("Target")}</legend>
      <Fld label={t("Target system")} hint={t("The system the extracted data is being prepared for. Defaults to the one paired with this system.")}>
        <select value={chosenSystem} onChange={(e) => setSys(e.target.value)} data-testid="extract-target-system">
          {options.length === 0 && !chosenSystem ? <option value="">{t("No target system")}</option> : null}
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {`${s.name} (${s.role === "target" ? t("target system") : t("source system")}${s.id === paired ? t(", paired") : ""})`}
            </option>
          ))}
        </select>
      </Fld>
      {!paired && options.length === 0 ? <p className="m2-prov" data-testid="extract-target-nopair">{t("No target system is paired with this system. Pair one under Systems to prepare data for it.")}</p> : null}
      <ul className="m2-pick" aria-label={t("Target templates")}>
        {rows.map((r) => (
          <li key={r.module}>
            <label data-bar="">
              <span>{labelText(r.module)}</span>
              {r.loading ? (
                <span className="m2-meta">{t("Reading templates…")}</span>
              ) : r.list.length === 0 ? (
                <span className="m2-meta" data-testid={`extract-target-none-${r.module}`}>
                  {t("No template uploaded yet.")}{" "}
                  <V2Link href="/migration">{t("Upload a template")}</V2Link>
                </span>
              ) : (
                <select value={r.picked} aria-label={t("Template for {object}", { object: labelText(r.module) })} onChange={(e) => setPicks((p) => ({ ...p, [r.module]: e.target.value }))} data-testid={`extract-target-tpl-${r.module}`}>
                  <option value="">{t("None")}</option>
                  {r.list.map((x) => (
                    <option key={x.id} value={x.id}>
                      {`${x.name}, ${t("version {v}", { v: x.version })}`}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </li>
        ))}
      </ul>
      <p className="m2-meta" data-testid="extract-target-preview">{previewLine(rows)}</p>
    </fieldset>
  );
}
