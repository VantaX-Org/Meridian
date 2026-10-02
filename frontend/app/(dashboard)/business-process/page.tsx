"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Process readiness is the Process workspace's Readiness tab. */
export default function BusinessProcessRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/process?tab=readiness"), [router]);
  return null;
}
