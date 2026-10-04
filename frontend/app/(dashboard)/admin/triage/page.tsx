"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** Triage is an Admin tab. */
export default function TriageRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/admin?tab=triage"), [router]);
  return null;
}
