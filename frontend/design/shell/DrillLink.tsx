// frontend/design/shell/DrillLink.tsx
import type { ReactNode } from "react";
import Link from "next/link";

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
  if (dimension) params.set("dimension", dimension);
  for (const [k, v] of Object.entries(filters ?? {})) params.set(k, v);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function DrillLink({
  object, dimension, ruleId, filters, run, children,
}: DrillTarget & { run?: string; children: ReactNode }) {
  return <Link href={buildDrillHref({ object, dimension, ruleId, filters, run })}>{children}</Link>;
}
