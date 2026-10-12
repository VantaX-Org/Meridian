"use client";

// frontend/design/shell/DrillLink.tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { usePrefetch } from "../hooks/usePrefetch";

export interface DrillTarget {
  object: string;
  dimension?: string;
  ruleId?: string;
  filters?: Record<string, string>;
}

export function buildDrillHref(target: DrillTarget & { run?: string }): string {
  const { object, dimension, ruleId, filters, run } = target;
  const path = ruleId ? `/objects/${object}/rules/${ruleId}` : `/objects/${object}`;
  const params = new URLSearchParams();
  if (run) params.set("run", run);
  // Dimension and filter drills list rules, so land on the object's rules tab, not its overview.
  if (!ruleId && (dimension || filters)) params.set("tab", "rules");
  if (dimension) params.set("dimension", dimension);
  for (const [k, v] of Object.entries(filters ?? {})) params.set(k, v);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

type DrillLinkProps = ((DrillTarget & { run?: string; href?: undefined }) | { href: string; object?: undefined }) & { children: ReactNode };

/** Drills to an object (object/dimension/ruleId/filters) or, with `href`, to any route. Numbers stay tabular and never trigger the row click. */
export function DrillLink(props: DrillLinkProps) {
  const href = props.href ?? buildDrillHref(props as DrillTarget & { run?: string });
  const prefetch = usePrefetch(href);
  return (
    <Link href={href} {...prefetch} className="m-numeric underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
      {props.children}
    </Link>
  );
}
