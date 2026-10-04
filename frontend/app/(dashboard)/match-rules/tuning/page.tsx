"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** Match tuning is a Workbench tab. */
export default function MatchTuningRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/workbench?tab=match-tuning"), [router]);
  return null;
}
