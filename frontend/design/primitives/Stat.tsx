import type { ReactNode } from "react";
import Link from "next/link";
import { clsx } from "clsx";

export type StatTone = "go" | "at-risk" | "no-go";

/** KPI tile. `delta` is a ReactNode so legacy string call sites keep working. */
export function Stat({
  label, value, delta, hint, href, tone,
}: { label: string; value: ReactNode; delta?: ReactNode; hint?: ReactNode; href?: string; tone?: StatTone }) {
  const body = (
    <>
      {tone && <span data-tone={tone} aria-hidden className="absolute inset-x-0 top-0" style={{ height: 3, background: `var(--m-${tone})` }} />}
      <span className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>{label}</span>
      <span className="m-numeric font-semibold" style={{ fontSize: "var(--m-text-stat)", lineHeight: "var(--m-leading-stat)", letterSpacing: "var(--m-tracking-tight)", color: "var(--m-ink)" }}>{value}</span>
      {(delta != null || hint != null) && (
        <span className="flex items-center gap-2 text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>
          {delta != null && <span>{delta}</span>}{hint != null && <span>{hint}</span>}
        </span>
      )}
    </>
  );
  const cls = clsx("m-stat relative flex flex-col gap-1 overflow-hidden", href && "m-stat-link m-motion-colors");
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
