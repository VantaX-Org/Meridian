"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** Progress is a Workbench tab. */
export default function ProgressRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/workbench?tab=progress"), [router]);
  return null;
}
