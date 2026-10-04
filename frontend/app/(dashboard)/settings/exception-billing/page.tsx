"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** Exception billing is an Admin tab. */
export default function ExceptionBillingRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/admin?tab=exception-billing"), [router]);
  return null;
}
