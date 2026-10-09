"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Dashboard redirect — `/dashboard` → `/`
 */
export default function DashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.push("/");
  }, [router]);

  return null;
}
