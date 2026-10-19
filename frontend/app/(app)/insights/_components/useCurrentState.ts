"use client";

import { useMemo } from "react";
import { useRunList } from "@/hooks/use-run-list";
import { usePermissions } from "@/lib/permissions";
import { isScored, latestPerLineage, stateObjects, type StateObject } from "@/lib/current-state";
import type { Version } from "@/types/api";

export interface CurrentState {
  /** Scored runs, newest first. */
  finished: Version[];
  /** The latest scored run of each lineage that supplies an object, newest first. */
  runs: Version[];
  /** Each object once, at the latest run of its lineage. */
  objects: StateObject[];
  /** The newest of `runs`: the "latest run" the header names. */
  newest: Version | undefined;
  /** In-scope objects of a module-scoped user; null when unscoped. */
  modules: ReadonlySet<string> | null;
  loading: boolean;
}

const newestFirst = (a: Version, b: Version) => (a.run_at < b.run_at ? 1 : a.run_at > b.run_at ? -1 : 0);

/**
 * The current state from runs already read: the same set the homes and `/objects` summarise (lib/current-state.ts),
 * so "Current state of N objects" counts what the home counts.
 */
export function currentStateOf(versions: readonly Version[], modules: ReadonlySet<string> | null): Omit<CurrentState, "loading"> {
  const finished = versions.filter(isScored).sort(newestFirst);
  const objects = stateObjects(latestPerLineage(finished), modules);
  const used = new Set(objects.map((o) => o.run.id));
  const runs = latestPerLineage(finished).filter((r) => used.has(r.id));
  return { finished, runs, objects, newest: runs[0], modules };
}

/** The tenant's current state for an insight page; a module-scoped user sees only in-scope objects, as on the home. */
export function useCurrentState(): CurrentState {
  const list = useRunList();
  // A partial permissions object (tests, public pages) means no scope.
  const scope = usePermissions().scopeFilter;
  const modules = scope?.modules ?? null;
  const versions = list.data?.versions;
  const state = useMemo(() => currentStateOf(versions ?? [], modules), [versions, modules]);
  return { ...state, loading: list.isLoading };
}
