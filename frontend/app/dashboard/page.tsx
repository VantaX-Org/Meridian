"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Dashboard redirect — `/dashboard` → `/`
 * The actual dashboard is served by `(dashboard)/page.tsx` at the root.
 */
export default function DashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.push("/");
  }, [router]);

  return null;
}
