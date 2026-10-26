"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { Select } from "@/design";
import { CURRENT_STATE_LABEL, stateScopeLine } from "@/lib/current-state";
import { formatDate, formatModuleName, plural } from "@/lib/format";
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
        <Link href={hrefFor(null)} className="m-ink-accent underline underline-offset-2">
          Back to latest
        </Link>
      )}
    </span>
  );
}

const ALL_RUNS = "all";

/** The objects a run measured, by name ("Controlling, Material master"); never the run's raw label or id. */
function runObjects(v: Version): string {
  const modules = v.metadata?.modules?.length ? v.metadata.modules : Object.keys(v.dqs_summary ?? {});
  return modules.length ? modules.map(formatModuleName).join(", ") : "Run";
}

/**
 * "15 runs": a disclosure listing the run each object's numbers come from, each a link to that run alone.
 * The trigger is a button and the panel holds plain links, so every run stays reachable by keyboard.
 */
function RunSources({ runs, systemName, hrefFor }: { runs: readonly Version[]; systemName: (v: Version) => string | undefined; hrefFor: RunScopeProps["hrefFor"] }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="m-ink-accent cursor-pointer underline underline-offset-2">
        {plural(runs.length, "run")}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
          <Popover.Popup aria-label="Runs behind these numbers" className="m-popup max-h-[360px] max-w-[calc(100vw-32px)] overflow-y-auto">
            <ul data-testid="run-source-list" className="flex flex-col">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link href={hrefFor(r.id)} className="m-popup-item h-auto flex-col items-start gap-0 py-1.5 hover:[background:var(--m-sheet-raised)]">
                    <span className="[color:var(--m-accent)]">{runObjects(r)}</span>
                    <span className="m-text-meta [color:var(--m-ink-3)]">{[systemName(r), formatDate(r.run_at, "date")].filter(Boolean).join(", ")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The header meta of a page that combines runs (home's current state): a "Showing" switch between the current state
 * (every object at its latest run) and any one run, and, for the current state, one line ("Current state of 15 objects,
 * latest run 16 Oct 2026") with the runs each number comes from behind a "15 runs" disclosure, each a link to it alone.
 */
export function StateScope({ runs, pinned, objectCount, systemName, hrefFor }: {
  /** The latest run of every lineage, newest first. */
  runs: readonly Version[];
  pinned: Version | undefined;
  objectCount: number;
  systemName: (v: Version) => string | undefined;
  hrefFor: RunScopeProps["hrefFor"];
}) {
  const router = useRouter();
  const choices = pinned && !runs.some((r) => r.id === pinned.id) ? [...runs, pinned] : runs;
  const labels = runChoiceLabels(choices);
  const source = (v: Version) => [systemName(v), labels.get(v.id) ?? runScopeLabel(v)].filter(Boolean).join(", ");
  return (
    <span data-testid="run-scope" className="inline-flex flex-wrap items-center gap-2">
      <Select
        label="Showing"
        value={pinned?.id ?? ALL_RUNS}
        onValueChange={(id) => { if (id) router.replace(hrefFor(id === ALL_RUNS ? null : id), { scroll: false }); }}
        options={[{ value: ALL_RUNS, label: CURRENT_STATE_LABEL }, ...choices.map((c) => ({ value: c.id, label: source(c) }))]}
        className="m-input inline-flex max-w-[360px] items-center justify-between gap-2"
      />
      {pinned ? (
        <Link href={hrefFor(null)} className="m-ink-accent underline underline-offset-2">
          Back to current state
        </Link>
      ) : runs[0] ? (
        <span data-testid="run-sources">
          {stateScopeLine(objectCount, runs[0].run_at)}, from{" "}
          <RunSources runs={runs} systemName={systemName} hrefFor={hrefFor} />
        </span>
      ) : null}
    </span>
  );
}
