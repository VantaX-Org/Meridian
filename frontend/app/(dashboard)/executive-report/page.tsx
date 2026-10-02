"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** The executive report is a Command Centre tab. */
export default function ExecutiveReportRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/?tab=report"), [router]);
  return null;
}
