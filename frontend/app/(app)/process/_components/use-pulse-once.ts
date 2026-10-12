import { useEffect, useRef, useState } from "react";

/** True from first data until `ms` later, and never again: a later params change or remount-by-key cannot replay it. */
export function usePulseOnce(key: string, ready: boolean, ms = 1500): boolean {
  const [pulse, setPulse] = useState(true);
  const first = useRef<string | null>(null);
  if (ready) first.current ??= key;
  useEffect(() => {
    if (first.current !== null && key !== first.current) setPulse(false);
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setPulse(false), ms);
    return () => clearTimeout(t);
  }, [ready, ms]);
  return pulse;
}
