"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** File import lives in Data → Import now. */
export default function LegacyRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/data?tab=import"), [router]);
  return null;
}
