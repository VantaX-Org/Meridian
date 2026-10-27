"use client";

import { useSyncExternalStore } from "react";

/** Viewport widths below which a list → detail pair has no room for the detail beside the list. */
export const BELOW_LG = "(max-width: 1023px)";
export const BELOW_XL = "(max-width: 1279px)";

function hasMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

/** True while `query` matches. False on the server and where matchMedia is missing (jsdom), so the wide layout is the default. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (!hasMatchMedia()) return () => undefined;
      const mq = window.matchMedia(query);
      mq.addEventListener?.("change", cb);
      return () => mq.removeEventListener?.("change", cb);
    },
    () => hasMatchMedia() && window.matchMedia(query).matches,
    () => false,
  );
}
