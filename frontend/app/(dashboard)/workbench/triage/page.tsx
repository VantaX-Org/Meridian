"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** My queue is a Workbench tab. */
export default function MyQueueRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/workbench?tab=my-queue"), [router]);
  return null;
}
