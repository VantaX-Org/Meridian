"use client";
import "./insights.css";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { Button, EmptyState, ErrorState, FieldChip, Skeleton, type Severity } from "@/ui/kit";

/** One read, keyed with the fixture flag so ?fixture=1 never shares a cache with live data. */
export function useQ<T>(key: string, fn: () => Promise<T>, extra: unknown[] = []) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["b8", key, fixture, ...extra], queryFn: fn });
}

export const n0 = (n: number | null | undefined): string => (n === null || n === undefined ? t("n/a") : new Intl.NumberFormat("en").format(Math.round(n)));
export const n1 = (n: number | null | undefined): string => (n === null || n === undefined ? t("n/a") : (Math.round(n * 10) / 10).toFixed(1));
export const pc = (n: number | null | undefined): string => (n === null || n === undefined ? t("n/a") : `${Math.round(n)}%`);
export const money = (n: number | null | undefined, cur?: string | null): string => {
  if (n === null || n === undefined) return t("n/a");
  const v = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  return cur ? `${cur} ${v}` : v;
};
export const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : t("n/a"));

const SEV = new Set(["critical", "high", "medium", "low", "info"]);
export const sevOf = (s: string | null | undefined): Severity => (s && SEV.has(s) ? (s as Severity) : "info");
export const sevLabel = (s: string | null | undefined): string => {
  const v = sevOf(s);
  return v === "critical" ? t("Critical") : v === "high" ? t("High") : v === "medium" ? t("Medium") : v === "low" ? t("Low") : t("Info");
};

/** Human text for a module code: material_master reads "Material master". The code stays beside it. */
export const modText = (m: string): string => {
  const s = m.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : m;
};
export const Mod = ({ code }: { code: string }) => <FieldChip code={code} description={modText(code)} />;

/** Loading, error and empty in one place so every tab handles all three. */
export function Gate({ q, empty, emptyHeading, emptyBody, children }: {
  q: { isLoading: boolean; isError: boolean; refetch: () => unknown };
  empty: boolean;
  emptyHeading: string;
  emptyBody?: string;
  children: ReactNode;
}) {
  if (q.isLoading) return <Skeleton lines={5} label={t("Loading")} />;
  if (q.isError) return <ErrorState heading={t("This could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  if (empty) return <EmptyState heading={emptyHeading} body={emptyBody} />;
  return <>{children}</>;
}

export interface Col<T> { key: string; label: string; render: (r: T) => ReactNode; end?: boolean }

/** A plain small table. Kit DataTable is for long lists; these are short and need no scroll box. */
export function Tbl<T>({ cols, rows, rowKey, label }: { cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string; label: string }) {
  return (
    <div className="mx-table">
      <table className="b8-tbl" aria-label={label}>
        <thead><tr>{cols.map((c) => <th key={c.key} scope="col" data-end={c.end ? "" : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={rowKey(r)}>{cols.map((c) => <td key={c.key} data-end={c.end ? "" : undefined}>{c.render(r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** Links between the sibling insight screens, so every one is one click from the others. */
export function InsightsNav({ here }: { here: "insights" | "score" | "forecast" | "value" | "monitor" }) {
  const items: { id: typeof here; href: string; label: string }[] = [
    { id: "insights", href: "/insights", label: t("Insights") },
    { id: "score", href: "/insights/score", label: t("Score lens") },
    { id: "forecast", href: "/insights/forecast", label: t("Forecast") },
    { id: "value", href: "/insights/value", label: t("Value") },
    { id: "monitor", href: "/monitor", label: t("Monitor") },
  ];
  return (
    <nav className="b8-nav" aria-label={t("Insight screens")}>
      {items.map((i) => <Button key={i.id} variant={i.id === here ? "primary" : "ghost"} href={i.id === here ? undefined : i.href} aria-current={i.id === here ? "page" : undefined}>{i.label}</Button>)}
    </nav>
  );
}
