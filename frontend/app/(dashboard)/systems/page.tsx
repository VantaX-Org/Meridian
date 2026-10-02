"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Connected systems live in Data → Systems now. */
export default function LegacyRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/data?tab=systems"), [router]);
  return null;
}
