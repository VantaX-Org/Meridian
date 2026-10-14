"use client";

// The same three ways out of every insight page: auto clean (the fix queue), export the
// failing-records list for manual cleaning, and the report library.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Button, ExportMenu, type ExportOption } from "@/design";
import { exportFindings } from "@/lib/api/findings";
import { withScope } from "./useInsightScope";
import { RunAnalysis } from "./RunAnalysis";

export function InsightActions({ run, module, options = [] }: { run?: string; module?: string; options?: ExportOption[] }) {
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const presentHref = `${pathname}?${new URLSearchParams({ ...Object.fromEntries(search?.entries() ?? []), present: "1" })}`;
  const list: ExportOption[] = run
    ? [...options, { format: "xlsx", label: "Failing records list (Excel)", run: () => exportFindings("xlsx", { version_id: run, module, sort: "impact" }) }]
    : options;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <RunAnalysis />
      <Button variant="secondary" render={<Link href={withScope("/fix", { run })}>Auto clean</Link>} />
      <Button variant="ghost" render={<Link href={withScope("/insights/reports", { run })}>Report library</Link>} />
      <Button variant="ghost" render={<Link href={presentHref}>Present</Link>} />
      <ExportMenu options={list} />
    </div>
  );
}
