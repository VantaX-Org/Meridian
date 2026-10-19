"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Select } from "@/design";
import { runChoiceLabels, runScopeLabel } from "@/lib/run-scope";
import type { Version } from "@/types/api";

export interface RunScopeState {
  /** The run the page's numbers belong to; nothing renders until it is known. */
  run: Version | undefined;
  /** The run the page shows without `?run=`. */
  latestId: string | undefined;
  /** The page shows a run other than the latest: "Back to latest" is offered. */
  pinned: boolean;
  /** Runs of the same lineage to switch to, the shown run included. */
  choices: readonly Version[];
}

export interface RunScopeProps {
  scope: RunScopeState;
  /** This page showing run `id`, or the latest run when `id` is null (for a `?run=` page: `?run=` removed). */
  hrefFor: (id: string | null) => string;
  /** Offer the other runs of the lineage (pages where an older run matters). */
  picker?: boolean;
}

function RunPicker({ run, choices, latestId, hrefFor }: { run: Version; choices: readonly Version[]; latestId: string | undefined; hrefFor: RunScopeProps["hrefFor"] }) {
  const router = useRouter();
  const labels = runChoiceLabels(choices);
  return (
    <Select
      label="Showing run"
      value={run.id}
      onValueChange={(id) => {
        if (id && id !== run.id) router.replace(hrefFor(id === latestId ? null : id), { scroll: false });
      }}
      options={choices.map((c) => ({ value: c.id, label: labels.get(c.id) ?? runScopeLabel(c) }))}
      className="m-input inline-flex max-w-[320px] items-center justify-between gap-2"
    />
  );
}

/**
 * The header meta that names the run a page's numbers belong to: "As of material_master_25k, 16 Oct 2026",
 * a picker of the other runs of the same lineage where an older run matters, and "Back to latest" when the
 * page is pinned to an older run. Rendered inside `PageHeader` meta, so it holds phrasing content only.
 */
export function RunScope({ scope, hrefFor, picker = false }: RunScopeProps) {
  const { run, choices, latestId, pinned } = scope;
  if (!run) return null;
  return (
    <span data-testid="run-scope" className="inline-flex flex-wrap items-center gap-2">
      {picker && choices.length > 1 ? (
        <>
          <span>As of</span>
          <RunPicker run={run} choices={choices} latestId={latestId} hrefFor={hrefFor} />
        </>
      ) : (
        <span>As of {runScopeLabel(run)}</span>
      )}
      {pinned && (
        <Link href={hrefFor(null)} className="underline-offset-2 hover:underline" style={{ color: "var(--m-accent)" }}>
          Back to latest
        </Link>
      )}
    </span>
  );
}
