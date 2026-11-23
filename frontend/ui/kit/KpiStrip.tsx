import Link from "next/link";
import type { ReactNode } from "react";

export interface KpiCell {
  label: string;
  /** Already formatted by the caller. null shows a dash, never zero. */
  value: ReactNode | null;
  /** Signed change in words, "+1.4 since run 7". `dir` draws the arrow; `tone` colours it only when the direction means something. */
  delta?: { text: string; dir?: "up" | "down"; tone?: "good" | "bad" };
  note?: string;
  href?: string;
}

/** One card, 4 to 6 cells split by hairlines: label, value, optional delta and note. A cell with an href is one link. */
export function KpiStrip({ label, cells }: { label: string; cells: KpiCell[] }) {
  return (
    <dl className="mx-kpis" aria-label={label}>
      {cells.slice(0, 6).map((c) => {
        const body = (
          <>
            <dt>{c.label}</dt>
            <dd className="mx-kpi-v mx-num">{c.value === null || c.value === undefined ? "—" : c.value}</dd>
            {c.delta ? <dd className="mx-kpi-d" data-tone={c.delta.tone}>{c.delta.dir ? <span aria-hidden="true">{c.delta.dir === "up" ? "↑" : "↓"} </span> : null}{c.delta.text}</dd> : null}
            {c.note ? <dd className="mx-kpi-n">{c.note}</dd> : null}
          </>
        );
        return c.href ? <Link key={c.label} href={c.href} className="mx-kpi">{body}</Link> : <div key={c.label} className="mx-kpi">{body}</div>;
      })}
    </dl>
  );
}
