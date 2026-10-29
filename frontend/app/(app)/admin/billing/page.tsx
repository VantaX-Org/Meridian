"use client";

/**
 * Admin, Exception billing: what a month of resolved exceptions costs, by
 * billing tier, on top of the base fee. Read only; the first read of a month
 * records it.
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, EmptyState, Field, Input, PageHeader, ReportPage, Skeleton, Stat } from "@/design";
import { SettingsTabs } from "@/components/admin/settings-tabs";
import { useRole } from "@/hooks/use-role";
import { getExceptionBilling } from "@/lib/api/exceptions";
import { isListFailure } from "@/lib/error";
import { formatNumber } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { ExceptionBilling } from "@/types/api";

const TIERS = [1, 2, 3, 4] as const;
type Tier = (typeof TIERS)[number];
/** An amount in the period's currency in the user's locale ("ZAR 8,000.00", "R 8 000,00"); a bad or missing code shows the plain number. */
const money = (v: number, currency: string | undefined) => {
  const digits = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  if (currency) {
    try {
      return formatNumber(Number(v), { style: "currency", currency, ...digits });
    } catch {
      // unknown ISO code: fall through to the plain number
    }
  }
  return formatNumber(Number(v), digits);
};
const thisMonth = () => new Date().toISOString().slice(0, 7);

interface TierRow { tier: Tier; count: number; amount: number }

export default function ExceptionBillingPage() {
  const [period, setPeriod] = useState(thisMonth);
  const { can, loading } = useRole();
  // GET /exceptions/billing needs manage_settings (api/routes/exceptions.py); without it the read would only answer 403.
  const allowed = can("manage_settings");
  const q = useQuery({
    queryKey: queryKeys.exceptionBilling(period),
    queryFn: () => getExceptionBilling(period),
    enabled: allowed && /^\d{4}-\d{2}$/.test(period),
  });
  const b = q.data;
  const tierCount = (bb: ExceptionBilling, t: Tier) => bb[`tier${t}_count` as keyof ExceptionBilling] as number;
  const tierAmount = (bb: ExceptionBilling, t: Tier) => bb[`tier${t}_amount` as keyof ExceptionBilling] as number;
  const rows: TierRow[] = b ? TIERS.map((t) => ({ tier: t, count: tierCount(b, t), amount: tierAmount(b, t) })) : [];

  const columns: ColumnDef<TierRow>[] = [
    { id: "tier", header: "Tier", cell: ({ row }) => `Tier ${row.original.tier}` },
    { id: "count", header: "Resolved", cell: ({ row }) => row.original.count },
    { id: "amount", header: b?.currency ? `Amount (${b.currency})` : "Amount", cell: ({ row }) => money(row.original.amount, b?.currency) },
  ];

  let state: "loading" | "empty" | "error" | undefined;
  if (q.isLoading) state = "loading";
  else if (isListFailure(q)) state = "error";
  else if (!b) state = "empty";

  if (loading) return <Skeleton height={240} />;
  if (!allowed) {
    return (
      <EmptyState
        title="Exception billing needs the manage-settings permission"
        detail="Ask an administrator for the manage-settings permission to see what resolved exceptions cost."
        ghost="table"
        action={<Button variant="secondary" render={<Link href="/home">Back to home</Link>} />}
      />
    );
  }
  return (
    <ReportPage
      header={<PageHeader tabs={<SettingsTabs />} title="Exception billing" meta="Resolved exceptions by billing tier, on top of the base fee. Read only." />}
      narrative={null}
      charts={
        <div className="flex flex-col gap-4">
          <div className="flex gap-6">
            <Stat label="Total" value={b ? money(b.total_amount, b.currency) : q.isLoading ? "–" : "Pick a month"} delta={b?.currency ? `All amounts in ${b.currency}` : undefined} />
            {/* Not the "Monthly subscription" of Risk and ROI pricing under Settings: that is the cost the ROI divides by. */}
            <Stat label="Meridian base fee" value={b ? money(b.base_fee, b.currency) : q.isLoading ? "–" : "—"} delta="What Meridian bills each month before exceptions" />
          </div>
          <div className="[max-width:200px]">
            <Field label="Month">
              <Input type="month" value={period} max={thisMonth()} onChange={(e) => setPeriod(e.target.value)} />
            </Field>
          </div>
        </div>
      }
      tables={
        b ? (
          <div className="flex flex-col gap-2">
            {/* The payment provider's internal id means nothing to a reader; the invoice itself is in Meridian HQ. */}
            {b.stripe_invoice_id ? <span className="m-text-meta m-ink-3">Invoiced. The invoice is in Meridian HQ</span> : null}
            <DataTable columns={columns} data={rows} getRowId={(r) => String(r.tier)} />
          </div>
        ) : null
      }
      state={state}
      emptyProps={{ title: "No billable exceptions this period", detail: "Try an earlier month, or check back after the next billing run.", action: <Button variant="secondary" onClick={() => setPeriod(thisMonth())}>Back to this month</Button> }}
      errorProps={{ error: q.error, onRetry: () => q.refetch() }}
    />
  );
}
