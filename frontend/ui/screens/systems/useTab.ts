"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** The open tab, kept in `?tab=` so a link or reload lands on it. Other params (fixture, run) stay. Local until the kit has one. */
export function useTab<T extends string>(ids: readonly T[], fallback: T): [T, (next: T) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const raw = params.get("tab");
  const tab = (ids as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;
  const set = useCallback((next: T) => {
    const q = new URLSearchParams(params.toString());
    q.set("tab", next);
    router.replace(`${path}?${q.toString()}`, { scroll: false });
  }, [params, router, path]);
  return [tab, set];
}
