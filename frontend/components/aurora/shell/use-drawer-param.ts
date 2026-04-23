/**
 * useDrawerParam — WS4.
 *
 * Binds a drawer's open/close + payload to a single URL search param. Back /
 * Forward navigate drawer state without a custom router.
 *
 *   const { value, open, close, setValue } = useDrawerParam("record");
 *
 * `value` mirrors `?record=<id>` (null when absent).
 * `open(id)` pushes a new history entry with `?record=<id>` so Back / Forward
 *   step through drawer states.
 * `close()` replaces the URL with the param removed, so pressing Back after
 *   closing goes to the previous page — not back into the drawer.
 * `setValue(id | null, { replace })` — generic form, push by default.
 *
 * Uses Next.js `useSearchParams` + `usePathname` + `useRouter`.
 */

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export interface UseDrawerParamResult {
  value: string | null;
  open: (id: string) => void;
  close: () => void;
  setValue: (id: string | null, options?: { replace?: boolean }) => void;
}

export function useDrawerParam(param: string): UseDrawerParamResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get(param);

  const setValue = useCallback(
    (id: string | null, options?: { replace?: boolean }) => {
      const next = new URLSearchParams(searchParams.toString());
      if (id === null || id === "") {
        next.delete(param);
      } else {
        next.set(param, id);
      }
      const queryString = next.toString();
      const url = `${pathname}${queryString ? `?${queryString}` : ""}`;
      if (options?.replace) {
        router.replace(url);
      } else {
        router.push(url);
      }
    },
    [param, pathname, router, searchParams],
  );

  return useMemo(
    () => ({
      value,
      open: (id: string) => setValue(id),
      // Replace so Back after close navigates to the previous page rather
      // than re-opening the drawer.
      close: () => setValue(null, { replace: true }),
      setValue,
    }),
    [value, setValue],
  );
}
