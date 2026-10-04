"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Patterns are a lens of the Process workspace's Relationships graph. */
function Redirect() {
  const router = useRouter();
  const sp = useSearchParams();
  useEffect(() => {
    const q = new URLSearchParams(sp.toString());
    q.set("tab", "relationships");
    if (!q.has("lens")) q.set("lens", "patterns");
    router.replace(`/process?${q.toString()}`);
  }, [router, sp]);
  return null;
}

export default function LegacyRedirect() {
  return <Suspense><Redirect /></Suspense>;
}
