"use client";

/**
 * Admin, Exception billing: what a month of resolved exceptions costs, by
 * billing tier, on top of the base fee. Read only; the first read of a month
 * records it.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Field, ReportPage, Stat } from "@/design";
import { getExceptionBilling } from "@/lib/api/exceptions";
import { queryKeys } from "@/lib/query-keys";
import type { ExceptionBilling } from "@/types/api";

const TIERS = [1, 2, 3, 4] as const;
type Tier = (typeof TIERS)[number];
const money = (v: number) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thisMonth = () => new Date().toISOString().slice(0, 7);

interface TierRow { tier: Tier; count: number; amount: number }

export default function ExceptionBillingPage() {
  const [period, setPeriod] = useState(thisMonth);
  const q = useQuery({
    queryKey: queryKeys.exceptionBilling(period),
    queryFn: () => getExceptionBilling(period),
    enabled: /^\d{4}-\d{2}$/.test(period),
  });
  const b = q.data;
  const tierCount = (bb: ExceptionBilling, t: Tier) => bb[`tier${t}_count` as keyof ExceptionBilling] as number;
  const tierAmount = (bb: ExceptionBilling, t: Tier) => bb[`tier${t}_amount` as keyof ExceptionBilling] as number;
  const resolved = b ? TIERS.reduce((n, t) => n + tierCount(b, t), 0) : null;
  const rows: TierRow[] = b ? TIERS.map((t) => ({ tier: t, count: tierCount(b, t), amount: tierAmount(b, t) })) : [];

  const columns: ColumnDef<TierRow>[] = [
    { id: "tier", header: "Tier", cell: ({ row }) => `Tier ${row.original.tier}` },
    { id: "count", header: "Resolved", cell: ({ row }) => row.original.count },
    { id: "amount", header: "Amount", cell: ({ row }) => money(row.original.amount) },
  ];

  let state: "loading" | "empty" | "error" | undefined;
  if (q.isLoading) state = "loading";
  else if (q.isError) state = "error";
  else if (!b) state = "empty";

  return (
    <ReportPage
      narrative="Resolved exceptions by billing tier, on top of the base fee. Read only."
      charts={
        <div className="flex flex-col gap-4">
          <div className="flex gap-6">
            <Stat label="Total" value={b ? money(b.total_amount) : q.isLoading ? "–" : "Pick a month."} />
            <Stat label="Base fee" value={b ? money(b.base_fee) : q.isLoading ? "–" : "—"} delta="Charged every month." />
            <Stat label="Resolved exceptions" value={resolved ?? (q.isLoading ? "–" : "—")} delta={resolved ? "Billed by tier below." : "Nothing resolved this month."} />
          </div>
          <div style={{ maxWidth: 200 }}>
            <Field label="Month">
              <input type="month" value={period} max={thisMonth()} onChange={(e) => setPeriod(e.target.value)} />
            </Field>
          </div>
        </div>
      }
      tables={
        b ? (
          <div className="flex flex-col gap-2">
            {b.stripe_invoice_id ? <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Invoice {b.stripe_invoice_id}</span> : null}
            <DataTable columns={columns} data={rows} getRowId={(r) => String(r.tier)} />
          </div>
        ) : null
      }
      state={state}
      emptyProps={{ title: "Pick a month to see its billing." }}
      errorProps={{ message: q.error instanceof Error ? q.error.message : "Billing could not be read.", onRetry: () => q.refetch() }}
    />
  );
}
