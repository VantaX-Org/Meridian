"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Lineage is the Process workspace's Lineage tab. */
export default function LineageRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/process?tab=lineage"), [router]);
  return null;
}
