"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/design";
import { useRunList } from "@/hooks/use-run-list";
import { formatModuleName } from "@/lib/format";
import { isFinished } from "@/lib/runs";
import { hrefWithRun, runChoiceLabels } from "@/lib/run-scope";
import {
  CURRENT_STATE_LABEL, isCrossObjectView, isCurrentStateView, isModuleScoped, isRunScoped, latestPerLineage, opensOnCurrentState, stateObjects,
} from "@/lib/current-state";
import type { Version } from "@/types/api";

/**
 * Where the chosen run and object are kept between screens: this tab's session only (sessionStorage), so a run
 * picked yesterday never pins today's screens.
 */
export const RUN_KEY = "m-selected-run";
export const OBJECT_KEY = "m-selected-object";
const LATEST = "latest";
const EVERY = "all";
const CHOICES = 50;
/** Screens whose `?run=` is their own (a process-discovery run) or whose path names the run. */
const OWN_RUN = ["/process", "/runs/"];
const under = (path: string, p: string) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`);
const ownsRun = (path: string) => OWN_RUN.some((p) => under(path, p));
/** An object page names its object in the path: that is the chosen object, and no `?module=` is added. */
const objectOfPath = (path: string): string | null => /^\/objects\/([^/?#]+)/.exec(path)?.[1] ?? null;

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable: the choice holds through the URL alone */
  }
}

export const readSelectedRun = () => read(RUN_KEY);
export const writeSelectedRun = (run: string | null) => write(RUN_KEY, run);
export const readSelectedObject = () => read(OBJECT_KEY);

/**
 * A choice the scope bar holds across screens: its URL parameter, where it is kept, screens that own it (never read
 * nor written) and screens it is never carried onto. A screen that does not read the parameter at all (outside
 * `RUN_SCOPED` / `MODULE_SCOPED` in lib/current-state.ts) is treated as owning it, so nothing is carried onto it.
 * Cross-object screens (`isCrossObjectView`: the homes, the objects, Fix work, every insight view, the rules list)
 * open on their default, the current state, unless the link the user followed names a run or an object: a run or
 * object carried from the page before would silently narrow them (Fix work said "No records match" to a steward
 * with open work because the material master run of the object page before was carried onto it).
 */
const CARRIED: { param: string; key: string; owned: (path: string) => boolean; notCarried: (path: string) => boolean }[] = [
  { param: "run", key: RUN_KEY, owned: (path) => ownsRun(path) || isCurrentStateView(path) || !isRunScoped(path), notCarried: isCrossObjectView },
  { param: "module", key: OBJECT_KEY, owned: (path) => ownsRun(path) || !!objectOfPath(path) || !isModuleScoped(path), notCarried: isCrossObjectView },
];

/**
 * One run and one object for every screen. Pages read `?run=` and `?module=`; this keeps them on the URL as the
 * user moves: a value on the URL becomes the choice, opening another screen without one carries the choice onto
 * it, and removing it on the same screen ("Back to latest", "Every object") clears the choice. An object page
 * (/objects/<object>) makes its object the choice.
 */
export function RunCarrier() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const prev = useRef<{ path: string; values: (string | null)[] } | null>(null);
  const values = CARRIED.map((c) => search?.get(c.param) ?? null);
  const signature = values.join("\u0000");
  useEffect(() => {
    const p = prev.current;
    prev.current = { path: pathname, values };
    const fromPath = objectOfPath(pathname);
    if (fromPath) write(OBJECT_KEY, decodeURIComponent(fromPath));
    const params = new URLSearchParams(search?.toString() ?? "");
    let carried = false;
    CARRIED.forEach((c, i) => {
      if (c.owned(pathname)) return;
      const v = values[i];
      if (v) write(c.key, v);
      else if (p?.path === pathname) {
        if (p.values[i]) write(c.key, null);
      } else if (!c.notCarried(pathname)) {
        const kept = read(c.key);
        if (kept) { params.set(c.param, kept); carried = true; }
      }
    });
    if (carried) router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `values` is read through its signature
  }, [pathname, signature, search, router]);
  return null;
}

/**
 * The objects the picker offers: every object of the current state (each at the latest run of its lineage: the set
 * Home and the objects list count), never only the newest run's objects, plus the object applied on the URL when it
 * is not among them, so the picker always names the object that is applied.
 */
export function pickerObjects(versions: readonly Version[], chosen: string | null): { module: string; label: string }[] {
  const modules = stateObjects(latestPerLineage(versions.filter((v) => !v.metadata?.archived))).map((o) => o.module);
  if (chosen && !modules.includes(chosen)) modules.push(chosen);
  return modules.map((module) => ({ module, label: formatModuleName(module) })).sort((a, b) => a.label.localeCompare(b.label));
}

/** The scope bar's object picker: every object, or one, held across the screens that read `?module=` (`MODULE_SCOPED`). */
export function GlobalObjectPicker() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const { data } = useRunList();
  const fromPath = objectOfPath(pathname);
  const chosen = fromPath ? decodeURIComponent(fromPath) : search?.get("module") || null;
  const objects = pickerObjects(data?.versions ?? [], chosen);
  if (!objects.length || ownsRun(pathname) || !isModuleScoped(pathname)) return null;
  const value = chosen ?? EVERY;
  const pick = (m: string) => {
    if (fromPath) {
      write(OBJECT_KEY, m === EVERY ? null : m);
      router.push(m === EVERY ? "/objects" : pathname.replace(/^\/objects\/[^/?#]+/, `/objects/${encodeURIComponent(m)}`).replace(/\/records\/.*$/, ""));
      return;
    }
    const params = new URLSearchParams(search?.toString() ?? "");
    if (m === EVERY) params.delete("module"); else params.set("module", m);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return (
    <span data-testid="global-object" className="inline-flex items-center gap-2">
      <span className="m-text-meta m-ink-3">Object</span>
      <Select
        label="Object"
        value={value}
        onValueChange={(m) => { if (m && m !== value) pick(m); }}
        options={[{ value: EVERY, label: "Every object" }, ...objects.map((o) => ({ value: o.module, label: o.label }))]}
        className="m-input inline-flex max-w-[240px] items-center justify-between gap-2"
      />
    </span>
  );
}

/**
 * The scope bar's run picker: the screen's default, or any finished run, held across the screens that read `?run=`
 * (`RUN_SCOPED`). The default is named for what it shows: "Current state" where the screen opens on every object at
 * its own latest run (`opensOnCurrentState`: the objects, an object, Fix work), else "Latest run".
 */
export function GlobalRunPicker() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const { data } = useRunList();
  const runs = (data?.versions ?? [])
    .filter((v) => isFinished(v) && !v.metadata?.archived)
    .slice(0, CHOICES);
  const run = search?.get("run") ?? null;
  // A kept run that is gone (deleted, archived) falls back to the latest.
  useEffect(() => {
    if (
      run &&
      data &&
      !data.versions.some((v) => v.id === run) &&
      readSelectedRun() === run
    ) {
      writeSelectedRun(null);
      router.replace(hrefWithRun(pathname, search, null), { scroll: false });
    }
  }, [run, data, pathname, search, router]);
  // Three Fix tabs work across all runs - approval batches, monitoring and duplicate clusters are
  // fleet-level, not per-run. The picker used to show on them anyway, so choosing a run changed
  // nothing and read as a broken control. Offer it only where a run is actually read.
  const RUN_BLIND_FIX_TABS = new Set(["batches", "dedup"]);
  const runBlind = pathname === "/fix" && RUN_BLIND_FIX_TABS.has(search.get("tab") ?? "work");
  // A current-state view's own header picker owns its scope ("Current state" or one run): no second run picker.
  if (!runs.length || ownsRun(pathname) || !isRunScoped(pathname) || isCurrentStateView(pathname) || runBlind)
    return null;
  const labels = runChoiceLabels(runs);
  const value = run && runs.some((r) => r.id === run) ? run : LATEST;
  return (
    <span data-testid="global-run" className="inline-flex items-center gap-2">
      <span className="m-text-meta m-ink-3">Run</span>
      <Select
        label="Run"
        value={value}
        onValueChange={(id) => {
          if (id && id !== value)
            router.replace(
              hrefWithRun(pathname, search, id === LATEST ? null : id),
              { scroll: false },
            );
        }}
        options={[
          { value: LATEST, label: opensOnCurrentState(pathname) ? CURRENT_STATE_LABEL : "Latest run" },
          ...runs.map((r) => ({
            value: r.id,
            label: labels.get(r.id) ?? r.id,
          })),
        ]}
        className="m-input inline-flex max-w-[320px] items-center justify-between gap-2"
      />
    </span>
  );
}
