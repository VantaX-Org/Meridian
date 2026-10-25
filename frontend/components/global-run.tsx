"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/design";
import { useRunList } from "@/hooks/use-run-list";
import { isFinished } from "@/lib/runs";
import { hrefWithRun, runChoiceLabels } from "@/lib/run-scope";

/** Where the chosen run is kept between screens, in this browser. */
export const RUN_KEY = "m-selected-run";
const LATEST = "latest";
const CHOICES = 50;
/** Screens whose `?run=` is their own (a process-discovery run) or whose path names the run. */
const OWN_RUN = ["/process", "/runs/"];
const ownsRun = (path: string) => OWN_RUN.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));

export function readSelectedRun(): string | null {
  try {
    return window.localStorage.getItem(RUN_KEY);
  } catch {
    return null;
  }
}

export function writeSelectedRun(run: string | null): void {
  try {
    if (run) window.localStorage.setItem(RUN_KEY, run);
    else window.localStorage.removeItem(RUN_KEY);
  } catch {
    /* storage unavailable: the run holds through the URL alone */
  }
}

/**
 * One run for every screen. Every page already reads `?run=`; this keeps it on the URL as the user moves:
 * a `?run=` on the URL becomes the chosen run, opening another screen without one carries the chosen run onto
 * it, and removing it on the same screen ("Back to latest", "Latest run" in the picker) goes back to the latest.
 */
export function RunCarrier() {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const prev = useRef<{ path: string; run: string | null } | null>(null);
  const run = search?.get("run") ?? null;
  useEffect(() => {
    const p = prev.current;
    prev.current = { path: pathname, run };
    if (ownsRun(pathname)) return;
    if (run) writeSelectedRun(run);
    else if (p?.path === pathname) {
      if (p.run) writeSelectedRun(null);
    } else {
      const kept = readSelectedRun();
      if (kept) router.replace(hrefWithRun(pathname, search, kept), { scroll: false });
    }
  }, [pathname, run, search, router]);
  return null;
}

/** The scope bar's run picker: the latest run, or any finished run, held on every screen. */
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
  if (!runs.length || ownsRun(pathname)) return null;
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
          { value: LATEST, label: "Latest run" },
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
