"use client";

import { useWorkGroups } from "@/lib/v2/object-queries";
import { t } from "@/lib/v2/i18n";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { FixScreen } from "@/ui/screens/work/fix/FixScreen";
import { useTabChat } from "./TabFrame";

/** The fixes tab is the one fix screen scoped to this object. */
export function Fixes({ o, system, module }: { o: ObjectRun; system: string; module: string }) {
  const q = useWorkGroups(module, o.runId, !o.runsLoading);
  const rows = q.data ?? [];
  useTabChat(system, module, "fixes", o.label, [t("Where should we start fixing?")], () => {
    const top = [...rows].sort((a, b) => b.open - a.open)[0];
    return { text: top ? t("Start with {rule}: {n} records are open.", { rule: top.check_id, n: top.open }) : t("Nothing is open."), evidence: rows.slice(0, 3).map((r) => `${r.check_id}: ${r.open}`) };
  });
  return <FixScreen scope={module} />;
}
