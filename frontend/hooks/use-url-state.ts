"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

/**
 * Lightweight URL-synced state hook.
 *
 * Reads the initial value from a query-string parameter and pushes updates
 * back via `router.replace` (no scroll, no history clutter). When `key` is
 * absent from the URL the `initial` value is used. Values are coerced to
 * strings; callers are expected to parse them as needed.
 *
 * This intentionally avoids adding `nuqs` as a dependency — the URL contract
 * is tiny and bespoke to Meridian filters.
 */
export function useUrlState(key: string, initial: string = ""): [string, (v: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const initialValue = search.get(key) ?? initial;
  const [value, setValue] = useState<string>(initialValue);

  // Keep local state in sync when the URL changes from outside the hook
  // (e.g. a SavedView switch).
  useEffect(() => {
    const current = search.get(key) ?? initial;
    if (current !== value) setValue(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const update = useCallback(
    (next: string) => {
      setValue(next);
      const params = new URLSearchParams(search.toString());
      if (!next) {
        params.delete(key);
      } else {
        params.set(key, next);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [key, pathname, router, search],
  );

  return [value, update];
}

/** Comma-separated URL-synced multi-value helper. */
export function useUrlMultiState(
  key: string,
  initial: string[] = [],
): [string[], (v: string[]) => void] {
  const [raw, setRaw] = useUrlState(key, initial.join(","));
  const values = raw ? raw.split(",").filter(Boolean) : [];
  const setValues = useCallback(
    (next: string[]) => {
      setRaw(next.filter(Boolean).join(","));
    },
    [setRaw],
  );
  return [values, setValues];
}
