"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** Pair constraints is a view of the Match rules tab in Admin. */
export default function PairConstraintsRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/admin?tab=match-rules&view=constraints"), [router]);
  return null;
}
