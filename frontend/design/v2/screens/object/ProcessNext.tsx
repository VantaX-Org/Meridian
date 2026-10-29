"use client";

import { useQueries } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getProcessDocument } from "@/lib/api/v2/mdm";
import type { Landscape } from "@/lib/api/v2/types";
import { mdmKeys } from "@/lib/v2/mdm-queries";
import { firstBlockedStep, PROCESS_MODULES, stepRef } from "@/lib/v2/process-tree";
import { moduleSlug, systemSlug } from "@/lib/v2/score";
import { V2Link } from "../../parts";
import { t } from "@/lib/v2/i18n";

/**
 * The process analyst's next step: the first blocked process step of the objects that have a process definition.
 * Until the readings land (or when nothing is blocked) it opens the first such object's Processes tab.
 */
export function ProcessNextStep({ landscape }: { landscape: Landscape }) {
  const fixture = useFixture();
  const cells = landscape.cells.filter((c) => PROCESS_MODULES.has(c.module) && c.run_id).slice(0, 6);
  const reads = useQueries({
    queries: cells.map((c) => ({
      queryKey: mdmKeys.process(fixture, c.run_id, c.module),
      queryFn: () => getProcessDocument(c.run_id, c.module),
      staleTime: 30_000,
      retry: false,
    })),
  });
  const base = (i: number): string => {
    const c = cells[i];
    const s = landscape.systems.find((x) => x.id === c.system_id);
    return `/v2/o/${systemSlug(s?.name ?? c.system_id)}/${moduleSlug(c.module)}/processes`;
  };
  for (let i = 0; i < cells.length; i++) {
    const step = firstBlockedStep(reads[i]?.data?.processes ?? []);
    if (step) {
      return (
        <V2Link href={`${base(i)}?open=step:${stepRef(cells[i].module, step.id)}`} className="m2-btn m2-next">
          {t("Open {l1Id} step {number}", { l1Id: step.l1Id, number: step.number })}
        </V2Link>
      );
    }
  }
  if (cells.length === 0) return null;
  return (
    <V2Link href={base(0)} className="m2-btn m2-next">
      {t("Open the process readiness")}
    </V2Link>
  );
}
