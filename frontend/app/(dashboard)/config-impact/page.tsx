"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Config impact is the feature table on the Process workspace's Readiness tab. */
export default function ConfigImpactRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/process?tab=readiness"), [router]);
  return null;
}
