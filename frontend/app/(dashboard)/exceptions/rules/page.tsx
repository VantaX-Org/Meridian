"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** Exception rules is a Workbench tab. */
export default function ExceptionRulesRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/workbench?tab=exception-rules"), [router]);
  return null;
}
