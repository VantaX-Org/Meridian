"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Select } from "@/design";
import { plural } from "@/lib/format";
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

const ALL_RUNS = "all";

/**
 * The header meta of a page that combines runs (home's current state): a "Showing" switch between all runs and
 * any one of them, and, for all runs, the runs each number comes from, each with its system and a link to it alone.
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
        options={[{ value: ALL_RUNS, label: "All runs, current state" }, ...choices.map((c) => ({ value: c.id, label: source(c) }))]}
        className="m-input inline-flex max-w-[360px] items-center justify-between gap-2"
      />
      {pinned ? (
        <Link href={hrefFor(null)} className="underline-offset-2 hover:underline" style={{ color: "var(--m-accent)" }}>
          Back to all runs
        </Link>
      ) : (
        <span data-testid="run-sources">
          {plural(objectCount, "object")} from{" "}
          {runs.map((r, i) => (
            <Fragment key={r.id}>
              {i > 0 && "; "}
              <Link href={hrefFor(r.id)} className="underline-offset-2 hover:underline" style={{ color: "var(--m-accent)" }}>{source(r)}</Link>
            </Fragment>
          ))}
        </span>
      )}
    </span>
  );
}
