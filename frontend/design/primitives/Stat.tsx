"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { Skeleton } from "./Skeleton";
import { usePrefetch } from "../hooks/usePrefetch";

export type StatTone = "go" | "at-risk" | "no-go";

export interface StatProps {
  label: string;
  value: ReactNode;
  /** A ReactNode so legacy string call sites keep working. */
  delta?: ReactNode;
  hint?: ReactNode;
  /** Renders a Link and prefetches the route on hover or focus. */
  href?: string;
  /** Renders a `<button className="m-stat m-stat-link">`. Ignored when `href` is set. */
  onClick?: () => void;
  tone?: StatTone;
  /** Shows a 28px skeleton in the value slot. */
  loading?: boolean;
}

/** KPI tile. */
export function Stat({ label, value, delta, hint, href, onClick, tone, loading }: StatProps) {
  const prefetch = usePrefetch(href);
  const body = (
    <>
      {tone && <span data-tone={tone} aria-hidden className="absolute inset-x-0 top-0" style={{ height: 3, background: `var(--m-${tone})` }} />}
      <span className="text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>{label}</span>
      <span className="m-numeric font-semibold" style={{ minWidth: "4ch", fontSize: "var(--m-text-stat)", lineHeight: "var(--m-leading-stat)", letterSpacing: "var(--m-tracking-tight)", color: "var(--m-ink)" }}>
        {loading ? <Skeleton width="4ch" height={28} /> : value}
      </span>
      {(delta != null || hint != null) && (
        <span className="flex items-center gap-2 text-[12px] leading-4" style={{ color: "var(--m-ink-3)" }}>
          {delta != null && <span>{delta}</span>}{hint != null && <span>{hint}</span>}
        </span>
      )}
    </>
  );
  const interactive = Boolean(href || onClick);
  const cls = clsx("m-stat relative flex flex-col gap-1 overflow-hidden", interactive && "m-stat-link m-motion-colors");
  if (href) return <Link href={href} className={cls} {...prefetch}>{body}</Link>;
  if (onClick) return <button type="button" className={cls} onClick={onClick}>{body}</button>;
  return <div className={cls}>{body}</div>;
}
