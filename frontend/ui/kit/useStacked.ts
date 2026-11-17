"use client";

import { useSyncExternalStore } from "react";

const Q = "(max-width: 900px)";

/** True while the layout is stacked to one column (the same breakpoint as kit.css). False without matchMedia. */
export function useStacked(): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const m = window.matchMedia(Q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(Q).matches,
    () => false,
  );
}
