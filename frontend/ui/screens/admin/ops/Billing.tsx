"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { useBilling } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { Card, DataTable, Field, Input, StatTile } from "@/ui/kit";
import { Row, Sec } from "./shared";

const thisMonth = () => new Date().toISOString().slice(0, 7);

export function Billing() {
  const [period, setPeriod] = useState(thisMonth());
  const q = useBilling(period);
  const b = q.data;
  const cur = b?.currency ?? "USD";
  const tiers = b ? [1, 2, 3, 4].map((n) => ({
    tier: n,
    count: b[`tier${n}_count` as "tier1_count"],
    amount: b[`tier${n}_amount` as "tier1_amount"],
  })) : [];
  return (
    <Sec title={t("Billing")} scope="billing" q={[q]} facts={b ? [t("Total for {period} is {total}.", { period, total: formatMoney(b.total_amount, cur) })] : []}
      context={t("Exception billing by tier for one month.")}>
      <Row>
        <Field label={t("Period")} hint={t("Month as YYYY-MM")}><Input value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
      </Row>
      {b ? (
        <>
          <div className="mx-tiles">
            <StatTile label={t("Base fee")} value={formatMoney(b.base_fee, cur)} />
            <StatTile label={t("Total")} value={formatMoney(b.total_amount, cur)} />
            <StatTile label={t("Invoice")} value={b.stripe_invoice_id ?? t("Not invoiced")} />
          </div>
          <Card title={t("Exceptions by tier")}>
            <DataTable label={t("Exceptions by tier")} rows={tiers} rowKey={(r) => String(r.tier)} height={200}
              columns={[
                { key: "tier", label: t("Tier"), render: (r) => t("Tier {n}", { n: r.tier }) },
                { key: "count", label: t("Exceptions"), align: "end", render: (r) => r.count },
                { key: "amount", label: t("Amount"), align: "end", render: (r) => formatMoney(r.amount, cur) },
              ]} />
          </Card>
        </>
      ) : null}
    </Sec>
  );
}
