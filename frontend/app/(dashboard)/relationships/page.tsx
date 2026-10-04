"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** This tab lives in its workspace hub now; the query (lens, filters) travels with it. */
function Redirect() {
  const router = useRouter();
  const sp = useSearchParams();
  useEffect(() => {
    const q = new URLSearchParams(sp.toString());
    q.set("tab", "relationships");
    router.replace(`/process?${q.toString()}`);
  }, [router, sp]);
  return null;
}

export default function LegacyRedirect() {
  return <Suspense><Redirect /></Suspense>;
}
