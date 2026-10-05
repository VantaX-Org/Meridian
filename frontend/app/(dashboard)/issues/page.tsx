"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Failing records is a tab of Analyse now; the query (filters, status) travels with it. */
function Redirect() {
  const router = useRouter();
  const sp = useSearchParams();
  useEffect(() => {
    const q = new URLSearchParams(sp.toString());
    q.set("tab", "records");
    router.replace(`/analyse?${q.toString()}`);
  }, [router, sp]);
  return null;
}

export default function LegacyRedirect() {
  return <Suspense><Redirect /></Suspense>;
}
