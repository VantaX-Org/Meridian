"use client";

import { useState } from "react";
import { t } from "@/lib/v2/i18n";
import { f1 } from "@/lib/v2/score";
import type { PortfolioRow } from "@/lib/api/next/portfolio";
import { Skeleton, StatCard } from "../kit";

const WEEK = 7 * 86_400_000;

/** Five figures over every object. ponytail: computed from one page of up to 500 rows; a server summary endpoint is
 *  the upgrade path past 500 objects. "Runs this week" has no source, so the card counts objects run this week. */
export function StatRow({ rows, loading, now: at }: { rows: PortfolioRow[]; loading?: boolean; now?: number }) {
  const [mounted] = useState(() => Date.now());
  const now = at ?? mounted;
  if (loading) return <Skeleton lines={2} label={t("Loading the portfolio")} />;
  const scored = rows.filter((r) => r.composite_score != null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const avg = mean(scored.map((r) => r.composite_score as number));
  const prev = scored.filter((r) => r.previous_score != null);
  const before = mean(prev.map((r) => r.previous_score as number));
  const delta = prev.length ? avg - before : null;
  const sum = (k: "new_issues" | "regressed") => rows.reduce((a, r) => a + r[k], 0);
  return (
    <div className="nx-pf-stats" data-testid="pf-stats">
      <StatCard label={t("Average DQS")} value={avg} format={f1} delta={delta == null ? undefined : { value: delta, tone: delta > 0 ? "good" : delta < 0 ? "bad" : "neutral", against: t("against each object's previous run") }} />
      <StatCard label={t("Ready to load")} value={rows.filter((r) => r.readiness === "pass").length} />
      <StatCard label={t("New issues")} value={sum("new_issues")} />
      <StatCard label={t("Regressed")} value={sum("regressed")} />
      <StatCard label={t("Objects run this week")} value={rows.filter((r) => r.run_at && now - Date.parse(r.run_at) < WEEK).length} />
    </div>
  );
}
