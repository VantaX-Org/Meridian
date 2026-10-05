"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Version compare lives in Data → Analyses now; the pair, object and system carry over. */
function Redirect() {
  const router = useRouter();
  const search = useSearchParams();
  useEffect(() => {
    const q = new URLSearchParams(search.toString());
    q.set("tab", "analyses");
    router.replace(`/analyse?${q}`);
  }, [router, search]);
  return null;
}

export default function VersionsRedirect() {
  return <Suspense fallback={null}><Redirect /></Suspense>;
}
