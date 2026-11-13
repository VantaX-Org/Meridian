"use client";

import { useRouter } from "next/navigation";
import type { ComponentType } from "react";
import { t } from "@/lib/v2/i18n";
import { Attention } from "@/design/v2/screens/Attention";
import { WorkCanvas } from "@/design/v2/screens/Work";
import { WorkAnalytics } from "@/design/v2/screens/WorkAnalytics";
import { FixDrafts } from "@/design/v2/screens/FixDrafts";
import { DataRequests } from "@/design/v2/screens/DataRequests";
import { Cleansing } from "@/design/v2/screens/Cleansing";
import { RequestsCanvas } from "@/design/v2/screens/Requests";
import { RequestFormCanvas } from "@/design/v2/screens/RequestForm";
import { ProcessAnalytics } from "@/design/v2/screens/ProcessAnalytics";
import { PeopleCanvas } from "@/design/v2/screens/People";
import { LegacyMount } from "../shell/LegacyMount";
import { EmptyState, Tabs, type TabItem } from "../kit";

const BASE = "/next/work";

function Queue() {
  return (
    <>
      <Attention />
      <WorkCanvas />
    </>
  );
}

type Part = { id: string; slug: string; label: () => string; Screen: ComponentType; manage?: boolean };

/** Every v2 screen that is work, in one place. The first part is the landing view. */
export const WORK_PARTS: Part[] = [
  { id: "queue", slug: "", label: () => t("Needs you"), Screen: Queue },
  { id: "fix-drafts", slug: "fix-drafts", label: () => t("Fix drafts"), Screen: FixDrafts },
  { id: "data-requests", slug: "data-requests", label: () => t("Data requests"), Screen: DataRequests },
  { id: "approve", slug: "approve", label: () => t("Approve"), Screen: Cleansing },
  { id: "requests", slug: "requests", label: () => t("Requests"), Screen: RequestsCanvas },
  { id: "people", slug: "people", label: () => t("People"), Screen: PeopleCanvas },
];

/** Deeper pages that hang off a part: they keep the part's tab selected. */
const DEEP: Array<{ slug: string; parent: string; Screen: ComponentType }> = [
  { slug: "requests/new", parent: "requests", Screen: RequestFormCanvas },
  { slug: "requests/analytics", parent: "requests", Screen: ProcessAnalytics },
  { slug: "analytics", parent: "queue", Screen: WorkAnalytics },
];

export function resolveWork(slug: string[] | undefined) {
  const key = (slug ?? []).join("/");
  const deep = DEEP.find((d) => d.slug === key);
  if (deep) return { parent: deep.parent, Screen: deep.Screen };
  const part = WORK_PARTS.find((p) => p.slug === key);
  return part ? { parent: part.id, Screen: part.Screen } : null;
}

/** The decisions waiting on you: one strip of parts, the existing screens mounted underneath unchanged. */
export function Work({ slug }: { slug?: string[] }) {
  const router = useRouter();
  const hit = resolveWork(slug);
  const items: TabItem[] = WORK_PARTS.map((p) => ({ id: p.id, label: p.label() }));
  const go = (id: string) => {
    const p = WORK_PARTS.find((x) => x.id === id);
    if (p) router.push(p.slug ? `${BASE}/${p.slug}` : BASE);
  };
  return (
    <div className="nx-work">
      <header className="nx-strip">
        <h1>{t("Work")}</h1>
        <Tabs items={items} value={hit?.parent ?? "queue"} onChange={go} label={t("Work")} idBase="nx-work" />
      </header>
      <div id={`nx-work-panel-${hit?.parent ?? "queue"}`} role="tabpanel">
        {hit ? (
          <LegacyMount>
            <hit.Screen />
          </LegacyMount>
        ) : (
          <EmptyState heading={t("Nothing at this address")} />
        )}
      </div>
    </div>
  );
}
