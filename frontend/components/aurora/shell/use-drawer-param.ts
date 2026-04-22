/**
 * useDrawerParam — WS4.
 *
 * Binds a drawer's open/close + payload to a single URL search param. Back /
 * Forward navigate drawer state without a custom router.
 *
 *   const { value, open, close, setValue } = useDrawerParam("record");
 *
 * `value` mirrors `?record=<id>` (null when absent).
 * `open(id)` pushes a new history entry with `?record=<id>`.
 * `close()` replaces the URL with the param removed.
 * `setValue(id | null)` pushes a new entry.
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
  setValue: (id: string | null) => void;
}

export function useDrawerParam(param: string): UseDrawerParamResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get(param);

  const setValue = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (id === null || id === "") {
        next.delete(param);
      } else {
        next.set(param, id);
      }
      const queryString = next.toString();
      router.push(`${pathname}${queryString ? `?${queryString}` : ""}`);
    },
    [param, pathname, router, searchParams],
  );

  return useMemo(
    () => ({
      value,
      open: (id: string) => setValue(id),
      close: () => setValue(null),
      setValue,
    }),
    [value, setValue],
  );
}
