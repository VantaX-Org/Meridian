"use client";

import { useSyncExternalStore } from "react";
import type { WorkRow } from "@/lib/api/v2/types";
import { overrideKey } from "./work";

/**
 * Optimistic changes: what a decision will do to a row, applied the moment it is made and dropped when the server
 * has answered (the refetch then carries the real state) or has refused (the row goes back as it was). The ledger
 * and the record inspector both read them, so a change shows in both at once.
 */
export interface Patch {
  status?: WorkRow["status"];
  new_value?: string | null;
  assigned_to?: string | null;
  assignee_email?: string | null;
  resolution?: WorkRow["resolution"];
}

let patches: ReadonlyMap<string, Patch> = new Map();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setPatches(keys: readonly string[], patch: Patch): void {
  const next = new Map(patches);
  for (const k of keys) next.set(k, { ...next.get(k), ...patch });
  patches = next;
  emit();
}

export function dropPatches(keys: readonly string[]): void {
  if (!keys.some((k) => patches.has(k))) return;
  const next = new Map(patches);
  for (const k of keys) next.delete(k);
  patches = next;
  emit();
}

export function clearPatches(): void {
  if (patches.size === 0) return;
  patches = new Map();
  emit();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** The optimistic changes now in force, keyed by `module|record_key`. */
export function usePatches(): ReadonlyMap<string, Patch> {
  return useSyncExternalStore(subscribe, () => patches, () => patches);
}

/** The row with its optimistic change laid over it. */
export function patched<T extends Pick<WorkRow, "module" | "record_key">>(row: T, map: ReadonlyMap<string, Patch>): T {
  const p = map.get(overrideKey(row));
  return p ? ({ ...row, ...p } as T) : row;
}
