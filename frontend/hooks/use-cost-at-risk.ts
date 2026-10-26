"use client";

import { useQuery } from "@tanstack/react-query";
import { getFindingsAggregate } from "@/lib/api/findings";
import { getCostModel } from "@/lib/api/settings";
import { formatMoneyShort } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

/**
 * Two money figures, two meanings, one source each. Every surface names the one it shows with these words:
 *  - cost at risk: every failing record times its cost per record in the cost model (`findings.cost_at_risk`,
 *    summed by GET /findings/aggregate). Priced from the first run, with the default model until the tenant sets one.
 *  - value at risk: the records that block an SAP feature times the value the tenant gives that feature
 *    (GET /insights/impact). Nothing until a feature is priced.
 */
export const COST_AT_RISK = "Cost at risk";
export const COST_AT_RISK_HINT = "Failing records times their cost per record";
export const VALUE_AT_RISK_HINT = "Records blocking an SAP feature times the feature's value";

export interface CostAtRisk {
  /** The amount, or null while loading or when the aggregate carries none. */
  amount: number | null;
  currency: string | undefined;
  /** "ZAR 4.84 bn" once both the amount and its currency are known and the amount is above zero; else null. */
  text: string | null;
  loading: boolean;
}

/**
 * The cost at risk of one run (`run`), or of the current state (none: every object at its latest run, the scope of
 * Home). Reads the same cached aggregate Home's hero reads (`queryKeys.findingsAggregate`), so Home, the
 * executive summary and Value at risk print one figure.
 */
export function useCostAtRisk(run?: string, enabled = true): CostAtRisk {
  const agg = useQuery({ queryKey: queryKeys.findingsAggregate(run ?? "current"), queryFn: () => getFindingsAggregate(run), enabled });
  const amount = agg.data?.cost_at_risk ?? null;
  const model = useQuery({
    queryKey: ["cost-model"], queryFn: getCostModel, enabled: enabled && amount != null && amount > 0,
    retry: false, meta: { ignoreError: true }, staleTime: 300_000,
  });
  const currency = model.data?.currency;
  return {
    amount,
    currency,
    // Held until the cost model names the currency, so the figure never reads as a bare number.
    text: amount != null && amount > 0 && currency ? formatMoneyShort(amount, currency) : null,
    loading: agg.isLoading,
  };
}
