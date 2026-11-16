"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { redirectFor } from "@/lib/next/nav-defaults";

/** Sends an old address to its new home. The run and fixture parameters travel along. */
export function NextRedirect() {
  const path = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const to = redirectFor(path);
    if (!to) return;
    const [base, own] = to.split("?");
    const q = new URLSearchParams(own ?? "");
    sp.forEach((v, k) => { if (!q.has(k)) q.set(k, v); });
    const s = q.toString();
    router.replace(s ? `${base}?${s}` : base);
  }, [path, sp, router]);
  return null;
}
