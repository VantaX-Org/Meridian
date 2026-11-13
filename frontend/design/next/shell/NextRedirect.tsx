"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { redirectFor } from "@/lib/next/nav-defaults";
import { useUiNext } from "../useUiNext";

/** Sends an old address to its new home, only when the new interface is on. The run and fixture parameters travel along. */
export function NextRedirect() {
  const on = useUiNext();
  const path = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    if (!on) return;
    const to = redirectFor(path);
    if (!to) return;
    const [base, own] = to.split("?");
    const q = new URLSearchParams(own ?? "");
    sp.forEach((v, k) => { if (!q.has(k)) q.set(k, v); });
    const s = q.toString();
    router.replace(s ? `${base}?${s}` : base);
  }, [on, path, sp, router]);
  return null;
}
