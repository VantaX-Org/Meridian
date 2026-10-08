"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const ROLE_KEY = "meridian:home";

export default function HomeRedirect() {
  const router = useRouter();
  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(ROLE_KEY) : null;
    const role = stored === "steward" || stored === "basis" ? stored : "lead";
    router.replace(`/home/${role}`);
  }, [router]);
  return null;
}
