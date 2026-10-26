"use client";

/**
 * The day-one state of every process page (process-discovery spec §7.4): a system with no discovery run yet. One of
 * three panels, chosen in one place:
 * - the system has no event source (every L1 carries a §10 reason, e.g. S/4HANA Cloud or BTP): say discovery needs
 *   a connected SAP system that exposes its document tables, and link to Systems;
 * - the viewer may run discovery: one primary "Run discovery" that opens the new-run dialog, with what it reads;
 * - the viewer may not: who to ask (lib/who-grants), with the disabled primary and its Request access link.
 */
import { useState } from "react";
import Link from "next/link";
import { Button, EmptyState } from "@/design";
import { GatedPrimary } from "@/components/gated-primary";
import { useRole } from "@/hooks/use-role";
import type { CatalogueRow } from "@/lib/api/process-discovery";
import { askToRun } from "@/lib/who-grants";
import { NewRunDialog, discoveryReads } from "./new-run-dialog";

/** The sentence every process page uses when the viewer cannot run discovery. */
export const ASK_TO_RUN_DISCOVERY = askToRun("run_process_discovery", "run discovery");

/** True when the system can mine at least one L1: the API gives a reason for each L1 it cannot (spec §10). */
export const canMine = (rows: readonly CatalogueRow[]): boolean => rows.some((r) => !r.reason);

/** No L1 has a discovered result and none is running: the catalogue is the reference only. */
export const isDayOne = (rows: readonly CatalogueRow[]): boolean =>
  !rows.some((r) => (r.last_run && r.coverage !== "reference") || r.in_progress);

/** Spec §10 / §7.4: discovery has nothing to read on this system. */
export const NOT_MINABLE = "Process discovery reads SAP document tables, so it needs a connected SAP system";

export function DiscoveryStart({ system, rows, only }: {
  system: { id: string; name: string };
  rows: CatalogueRow[];
  /** The L1 page: preselect that process alone in the dialog. */
  only?: string;
}) {
  const { can } = useRole();
  const [open, setOpen] = useState(false);
  if (!canMine(rows)) {
    return (
      <EmptyState title="Discovery needs a connected SAP system" ghost="stepper"
        detail={`${NOT_MINABLE}. ${system.name} does not expose its document tables, so each process shows its reference model.`}
        action={<Button variant="secondary" render={<Link href="/systems">Open systems</Link>} />} />
    );
  }
  if (!can("run_process_discovery")) {
    return (
      <EmptyState title="No discovery run yet" ghost="stepper"
        detail={`${ASK_TO_RUN_DISCOVERY} ${discoveryReads(system.name)}`}
        action={<GatedPrimary kind="discover" allowed={false} systemId={system.id} scopeLabel={system.name}>Run discovery</GatedPrimary>} />
    );
  }
  return (
    <>
      <EmptyState title="No discovery run yet" ghost="stepper" detail={discoveryReads(system.name)}
        action={<Button onClick={() => setOpen(true)}>Run discovery</Button>} />
      <NewRunDialog open={open} onOpenChange={setOpen} systemId={system.id} systemName={system.name} rows={rows} only={only} />
    </>
  );
}
