"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Match rules live in the Workbench. */
export default function MatchRulesRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/admin?tab=match-rules"), [router]);
  return null;
}
