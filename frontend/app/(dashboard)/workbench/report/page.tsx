"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Old record report links (?issue=<id>) land on the record page. */
function Redirect() {
  const router = useRouter();
  const issue = useSearchParams().get("issue");
  useEffect(() => router.replace(issue ? `/workbench/record/${encodeURIComponent(issue)}` : "/workbench"), [router, issue]);
  return null;
}

export default function LegacyRedirect() {
  return <Suspense><Redirect /></Suspense>;
}
