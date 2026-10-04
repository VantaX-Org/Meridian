"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** Pair constraints is a Workbench tab. */
export default function PairConstraintsRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/workbench?tab=pair-constraints"), [router]);
  return null;
}
