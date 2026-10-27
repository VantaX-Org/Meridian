"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Async, Button, Field, Input, toast } from "@/design";
import { SettingsSection } from "@/components/mdm/ledger";
import { getCostModel, updateCostModel } from "@/lib/api/settings";
import { apiErrorMessage } from "@/lib/error";
import type { CostModel, ImpactCost } from "@/types/api";

/** Business-impact defect types (api/services/analytics_engine.py), in the order the ledger reads. */
export const IMPACT_LABELS: Record<string, string> = {
  duplicate_payment: "Duplicate payment",
  warranty_miss: "Missed warranty claim",
  compliance_penalty: "Compliance penalty",
  blocked_invoice: "Blocked invoice",
  failed_posting: "Failed posting",
  inventory_write_off: "Inventory write-off",
  labour_displacement: "Manual correction time",
  contract_violation: "Contract violation",
};

/** Config Intelligence alignment finding types (api/services/config_intelligence/alignment_validator.py). */
export const ALIGNMENT_LABELS: Record<string, string> = {
  ghost_config: "Unused configured value",
  bottleneck_exception: "Exception at a process bottleneck",
  shadow_process_step: "Process step missing from the data",
  licence_waste_module: "Licensed module barely used",
  licence_waste_process: "Inactive configured process",
  conflict_mrp_cross_plant: "Material with conflicting MRP settings",
  conflict_vendor_bank: "Vendor without bank details",
  mismatch_customer_sales_area: "Customer without a sales area",
  number_range_exhaustion: "Number range near exhaustion",
  org_gap_plant_purch: "Plant without a purchasing organisation",
  integration_oneway_idoc: "One-way IDoc integration",
  integration_idoc_errors: "IDoc in error",
  ghost_z_object: "Unused custom object",
  z_field_null: "Empty custom field value",
};

interface ImpactDraft { unit_cost: string; factor: string; mitigation_pct: string }

/** The form: every amount as typed, so a field can be cleared while editing. */
export interface PricingDraft {
  currency: string;
  subscription: string;
  impact: Record<string, ImpactDraft>;
  alignment: Record<string, string>;
}

const pct = (share: number | undefined) => String(Math.round((share ?? 0) * 1000) / 10);

export function toDraft(m: CostModel): PricingDraft {
  const impact: Record<string, ImpactDraft> = {};
  Object.entries(m.impact ?? {}).forEach(([k, c]) => {
    impact[k] = { unit_cost: String(c.unit_cost ?? 0), factor: String(c.factor ?? 1), mitigation_pct: pct(c.mitigation) };
  });
  const alignment: Record<string, string> = {};
  Object.entries(m.config_alignment ?? {}).forEach(([k, v]) => { alignment[k] = String(v); });
  return {
    currency: m.currency ?? "",
    subscription: m.subscription_monthly != null ? String(m.subscription_monthly) : "",
    impact,
    alignment,
  };
}

const amount = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
const isAmount = (s: string) => Number.isFinite(amount(s)) && amount(s) >= 0;

/** Every field that cannot be saved, by field key; empty when the draft is valid. */
export function draftErrors(d: PricingDraft): Record<string, string> {
  const out: Record<string, string> = {};
  if (!/^[A-Z]{3}$/.test(d.currency)) out.currency = "A three-letter ISO 4217 code, such as ZAR, EUR or USD";
  if (d.subscription.trim() !== "" && !isAmount(d.subscription)) out.subscription = "An amount of 0 or more, or empty";
  Object.entries(d.impact).forEach(([k, c]) => {
    if (!isAmount(c.unit_cost)) out[`impact.${k}.unit_cost`] = "0 or more";
    if (!isAmount(c.factor)) out[`impact.${k}.factor`] = "0 or more";
    if (!isAmount(c.mitigation_pct) || amount(c.mitigation_pct) > 100) out[`impact.${k}.mitigation`] = "0 to 100";
  });
  Object.entries(d.alignment).forEach(([k, v]) => { if (!isAmount(v)) out[`alignment.${k}`] = "0 or more"; });
  return out;
}

/** The cost model to PUT: the effective model with the draft laid over its currency, subscription and unit costs. */
export function applyPricingDraft(base: CostModel, d: PricingDraft): CostModel {
  const impact: Record<string, ImpactCost> = {};
  Object.entries(d.impact).forEach(([k, c]) => {
    impact[k] = { unit_cost: amount(c.unit_cost), factor: amount(c.factor), mitigation: Math.round(amount(c.mitigation_pct) * 10) / 1000 };
  });
  const alignment: Record<string, number> = {};
  Object.entries(d.alignment).forEach(([k, v]) => { alignment[k] = amount(v); });
  return {
    ...base,
    currency: d.currency,
    subscription_monthly: d.subscription.trim() === "" ? null : amount(d.subscription),
    impact,
    config_alignment: alignment,
  };
}

const label = (labels: Record<string, string>, key: string) => labels[key] ?? key.replace(/_/g, " ");

/**
 * The tenant's cost model for risk and ROI: the currency every amount is in, the monthly subscription the ROI divides
 * by, the unit cost of each business-impact defect type and of each configuration finding type. Severity and feature
 * values are set under Rules, Scoring and alerts.
 */
export function CostModelPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cost-model"], queryFn: getCostModel });
  const [draft, setDraft] = useState<PricingDraft | null>(null);
  const [loadedFrom, setLoadedFrom] = useState<CostModel | null>(null);
  // Load the saved model into the form once per fetched document (state adjusted during render, no effect).
  if (q.data && q.data !== loadedFrom) {
    setLoadedFrom(q.data);
    setDraft(toDraft(q.data));
  }

  const save = useMutation({
    mutationFn: (d: PricingDraft) => updateCostModel(applyPricingDraft(q.data as CostModel, d)),
    onSuccess: () => { toast.success("Cost model saved. Risk and ROI use it now; configuration findings from the next analysis"); void qc.invalidateQueries({ queryKey: ["cost-model"] }); },
    onError: (e) => toast.error(apiErrorMessage(e) || "Cost model not saved"),
  });

  const errors = draft ? draftErrors(draft) : {};
  const invalid = Object.keys(errors).length > 0;
  const cur = draft?.currency || q.data?.currency || "";
  const setImpact = (k: string, patch: Partial<ImpactDraft>) => draft && setDraft({ ...draft, impact: { ...draft.impact, [k]: { ...draft.impact[k], ...patch } } });
  const impactKeys = draft ? [...Object.keys(IMPACT_LABELS).filter((k) => k in draft.impact), ...Object.keys(draft.impact).filter((k) => !(k in IMPACT_LABELS))] : [];
  const alignmentKeys = draft ? [...Object.keys(ALIGNMENT_LABELS).filter((k) => k in draft.alignment), ...Object.keys(draft.alignment).filter((k) => !(k in ALIGNMENT_LABELS))] : [];

  return (
    <SettingsSection title="Risk and ROI pricing" hint="What a defect costs this business. Risk, ROI, value at risk and the planner print every amount in this currency">
      <Async query={q} skeleton={160}>{draft ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate(draft); }}>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Currency" error={errors.currency}>
              <Input value={draft.currency} maxLength={3} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={`Monthly subscription (${cur})`} error={errors.subscription}>
              <Input type="number" min={0} step="any" placeholder="Not set" value={draft.subscription} onChange={(e) => setDraft({ ...draft, subscription: e.target.value })} />
            </Field>
          </div>
          <p className="m-text-meta m-ink-3">
            Without a subscription the ROI states the cost avoided only: no multiple or payback is worked out from a made-up fee.
            Changing the currency relabels the amounts; it does not convert them, so restate the unit costs in the new currency.
          </p>

          <h3 className="m-text-body font-semibold">Business impact, by defect type</h3>
          <p className="m-text-meta m-ink-3">A year&rsquo;s risk is the failing records (or items) × unit cost × factor; the mitigated share is what fixing them avoids.</p>
          <table className="m-table">
            <thead><tr><th>Defect type</th><th>Unit cost ({cur})</th><th>Factor</th><th>Mitigated (%)</th></tr></thead>
            <tbody>
              {impactKeys.map((k) => {
                const name = label(IMPACT_LABELS, k);
                const c = draft.impact[k];
                return (
                  <tr key={k}>
                    <td>{name}</td>
                    <td><Input type="number" min={0} step="any" aria-label={`${name} unit cost`} aria-invalid={!!errors[`impact.${k}.unit_cost`]} value={c.unit_cost} onChange={(e) => setImpact(k, { unit_cost: e.target.value })} /></td>
                    <td><Input type="number" min={0} step="any" aria-label={`${name} factor`} aria-invalid={!!errors[`impact.${k}.factor`]} value={c.factor} onChange={(e) => setImpact(k, { factor: e.target.value })} /></td>
                    <td><Input type="number" min={0} max={100} step="any" aria-label={`${name} mitigated percent`} aria-invalid={!!errors[`impact.${k}.mitigation`]} value={c.mitigation_pct} onChange={(e) => setImpact(k, { mitigation_pct: e.target.value })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3 className="m-text-body font-semibold">Configuration findings, by type</h3>
          <p className="m-text-meta m-ink-3">The estimated impact of one unit of each configuration alignment finding. Applies from the next configuration analysis.</p>
          <table className="m-table">
            <thead><tr><th>Finding type</th><th>Impact per unit ({cur})</th></tr></thead>
            <tbody>
              {alignmentKeys.map((k) => {
                const name = label(ALIGNMENT_LABELS, k);
                return (
                  <tr key={k}>
                    <td>{name}</td>
                    <td><Input type="number" min={0} step="any" aria-label={`${name} impact per unit`} aria-invalid={!!errors[`alignment.${k}`]} value={draft.alignment[k]} onChange={(e) => setDraft({ ...draft, alignment: { ...draft.alignment, [k]: e.target.value } })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {invalid ? <p className="m-text-meta m-ink-3" role="status">Fix the highlighted amounts to save.</p> : null}
          <div><Button type="submit" disabled={invalid} pending={save.isPending}>Save pricing</Button></div>
        </form>
      ) : null}</Async>
    </SettingsSection>
  );
}
