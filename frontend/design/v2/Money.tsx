"use client";

import type { ReactNode } from "react";
import { useStatus } from "@/lib/v2/queries";
import { moneyCompactText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "./parts";

/**
 * Money is an estimate, never a measurement: every amount comes from the tenant's cost model (cost per failing record
 * by severity), so every amount says so. While the cost model is the shipped starting assumptions
 * (`cost_model_source === "default"` on the status strip or the receipt), the words say that instead and point to
 * Administration, Settings, where the tenant sets its own.
 */
export const COST_MODEL_HREF = "/admin/settings#cost-model";

export interface CostModel {
  /** The currency the tenant's cost model prices in (the status strip's `cost_model`). */
  currency: string | null;
  /** True while the figures come from the shipped default assumptions. */
  isDefault: boolean;
}

/** The cost model as the status strip states it. */
export function useCostModel(source?: "default" | "tenant" | null): CostModel {
  const s = useStatus().data;
  return { currency: s?.cost_model ?? null, isDefault: (source ?? s?.cost_model_source) === "default" };
}

/** The words for the hover title of an amount. */
export function estimateTitle(isDefault: boolean): string {
  return isDefault ? t("Estimate from default assumptions, set your cost model in Administration") : t("Estimated from your cost model");
}

/** One amount with its unit and its marker: "ZAR 4.2 m est." in a table cell, the marker's words on hover. */
export function Money({ amount, currency, compact = true, source }: { amount: number | null | undefined; currency?: string | null; compact?: boolean; source?: "default" | "tenant" | null }) {
  const model = useCostModel(source);
  if (amount == null) return null;
  const unit = currency ?? model.currency;
  const text = compact ? moneyCompactText(amount, unit) : `${unit ? `${unit} ` : ""}${int(amount)}`;
  return (
    <span className="m2-money" title={estimateTitle(model.isDefault)} data-testid="money">
      {text}{" "}
      <span className="m2-est" data-default={model.isDefault ? "true" : undefined}>{model.isDefault ? t("default estimate") : t("est.")}</span>
    </span>
  );
}

/** The sentence beside a headline amount: what the estimate rests on, with the way to change it when it is the default. */
export function EstimateNote({ source }: { source?: "default" | "tenant" | null }): ReactNode {
  const model = useCostModel(source);
  return model.isDefault ? (
    <span className="m2-estnote" data-testid="estimate-note">
      {t("an estimate from default assumptions;")}{" "}
      <V2Link href={COST_MODEL_HREF}>{t("set your cost model in Administration")}</V2Link>
    </span>
  ) : (
    <span className="m2-estnote" data-testid="estimate-note">{t("estimated from your cost model")}</span>
  );
}
