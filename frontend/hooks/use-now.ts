"use client";

import { useEffect, useState } from "react";

/** Current time in Unix seconds, ticking every `intervalMs` while `active`. Safe for render purity. */
export function useNowSec(active = true, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
