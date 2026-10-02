"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Download history lives in Data → Runs now. */
export default function SyncRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/data?tab=runs"), [router]);
  return null;
}
