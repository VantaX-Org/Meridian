"use client";

import { COUNT_DEFS } from "@/lib/counts";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import Link from "next/link";
import type { ComponentType } from "react";
import { Button, PageHeader, Skeleton, Tabs } from "@/design";
import { oneOf, useUrlState } from "@/hooks/use-url-state";
import { BatchesTab } from "./batches-tab";
import { DedupTab } from "./monitor-dedup-tabs";
import { FixWork } from "@/components/work/fix-work";
import { HomeOnboarding } from "@/components/help/home-onboarding";
import { useRole } from "@/hooks/use-role";
import { approvesOnly } from "@/lib/persona";
import { personaForRole } from "@/lib/persona";

const TABS: { value: string; label: string; Content: ComponentType }[] = [
  { value: "work", label: COUNT_DEFS.records_to_fix.label, Content: FixWork },
  // Approving is done in Inbox › Approvals (the one approvals page); this tab keeps the batches and their export.
  { value: "batches", label: "Batches and export", Content: BatchesTab },
];
/** Old tab names that now live elsewhere: duplicate pairs are reviewed in MDM › Match review (DedupTab redirects). */
const MOVED_TABS = ["dedup", "duplicates"];
/** The Monitor tab is gone: monitoring is per object, on the object page and the Objects list's monitoring view. */
const MONITOR_HREF = "/objects?view=monitoring";
/** The Cleaning proposals tab is gone: its value proposals are records with a suggested value in Records to fix. The run
 *  and object a link was scoped to ride along. */
const cleaningHref = (search: URLSearchParams | null) => {
  const out = new URLSearchParams({ sugg: "1" });
  for (const key of ["run", "module"]) {
    const v = search?.get(key);
    if (v) out.set(key, v);
  }
  return `/fix?${out.toString()}`;
};

export default function FixPage() {
  // An approver who may not apply has every control disabled on "Records to fix", so the nav entry
  // used to drop them on a dead screen. Land them where their work is, unless the URL says otherwise.
  const { can, homeRole } = useRole();
  const approverOnly = approvesOnly(can);
  const [tabRaw, setTab] = useUrlState("tab", approverOnly ? "batches" : "work");
  const tab = oneOf(tabRaw, TABS.map((t) => t.value), "work");
  // Stewards land here rather than on a persona home (lib/persona.ts homeHrefForRole), so the first-run offer is here too.
  const steward = !!homeRole && personaForRole(homeRole) === "steward";
  const router = useRouter();
  const search = useSearchParams();
  const cleaningMoved = tabRaw === "cleaning";
  const monitorMoved = tabRaw === "monitor";
  useEffect(() => {
    if (monitorMoved) router.replace(MONITOR_HREF);
    else if (cleaningMoved) router.replace(cleaningHref(search));
  }, [monitorMoved, cleaningMoved, router, search]);
  if (monitorMoved || cleaningMoved) return <div aria-busy="true"><Skeleton height={240} /></div>;
  if (MOVED_TABS.includes(tabRaw)) return <DedupTab />;

  return (
    <div className="flex flex-col gap-4">
    <PageHeader
      title="Fix work"
      meta="Every record that fails a check, worst first: see what is wrong, set the right value, and send it for approval."
      actions={<Button variant="secondary" render={<Link href="/fix/what-if">What-if</Link>} />}
    />
    {steward && <HomeOnboarding />}
    <Tabs
      value={tab}
      onValueChange={setTab}
      items={TABS.map(({ value, label, Content }) => ({ value, label, content: <Content /> }))}
    />
    </div>
  );
}
