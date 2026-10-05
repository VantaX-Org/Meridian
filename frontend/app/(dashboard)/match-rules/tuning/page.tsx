"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** Match tuning is a view of the Match rules tab in Admin. */
export default function MatchTuningRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/admin?tab=match-rules&view=tuning"), [router]);
  return null;
}
