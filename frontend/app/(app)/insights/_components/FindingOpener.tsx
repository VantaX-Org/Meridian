"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FindingDrawer } from "@/design";
import { getFindings } from "@/lib/api/findings";

/**
 * Rule rows carry a check id, the drawer wants a finding id. Opening a row looks the finding up
 * for that check, module and run first.
 */
export function useFindingOpener(run?: string) {
  const [id, setId] = useState<string | null>(null);
  const open = async (row: { check_id: string; module: string }) => {
    try {
      const list = await getFindings({ check_id: row.check_id, module: row.module, version_id: run, limit: 1 });
      if (list.findings[0]) setId(list.findings[0].id);
      else toast.error("No finding for this rule in this run");
    } catch {
      toast.error("Could not open the finding");
    }
  };
  return { open, drawer: <FindingDrawer findingId={id} versionId={run} onClose={() => setId(null)} /> };
}
