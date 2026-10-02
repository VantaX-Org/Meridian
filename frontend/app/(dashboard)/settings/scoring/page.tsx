"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Scoring & alerts is an Admin tab. */
export default function ScoringRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/admin?tab=scoring"), [router]);
  return null;
}
