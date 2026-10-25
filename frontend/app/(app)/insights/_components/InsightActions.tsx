"use client";

// The same ways out of every insight page: run an analysis, review fixes (the fix queue), present,
// and export the failing-records list for manual cleaning. Reports is a tab of the Summary view.
// None of them is primary: the page's one primary action is its "Do next" button in the InsightHeader.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Button, ExportMenu, type ExportOption } from "@/design";
import { exportFindings } from "@/lib/api/findings";
import { withScope } from "./useInsightScope";
import { RunAnalysis } from "./RunAnalysis";

/** `current`: the page shows the current state across objects, so the failing-records list is the current state's too. */
export function InsightActions({ run, module, options = [], current = false }: { run?: string; module?: string; options?: ExportOption[]; current?: boolean }) {
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const presentHref = `${pathname}?${new URLSearchParams({ ...Object.fromEntries(search?.entries() ?? []), present: "1" })}`;
  // On a boardroom screen only the content shows; Exit presentation floats at the corner.
  if (search?.get("present") === "1") return null;
  const list: ExportOption[] = current
    ? [...options, { format: "xlsx", label: "Failing records list, current state (Excel)", run: () => exportFindings("xlsx", { sort: "impact" }) }]
    : run
      ? [...options, { format: "xlsx", label: "Failing records list (Excel)", run: () => exportFindings("xlsx", { version_id: run, module, sort: "impact" }) }]
      : options;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <RunAnalysis variant="secondary" />
      <Button variant="ghost" render={<Link href={withScope("/fix", { run })}>Review fixes</Link>} />
      <Button variant="ghost" render={<Link href={presentHref}>Present</Link>} />
      <ExportMenu options={list} />
    </div>
  );
}
