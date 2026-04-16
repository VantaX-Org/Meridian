"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Login redirect — `/login` → `/sign-in`
 * The sign-in page is at `/sign-in`.
 */
export default function LoginRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.push("/sign-in");
  }, [router]);

  return null;
}
