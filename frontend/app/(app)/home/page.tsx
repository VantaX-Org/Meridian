"use client";

// /home lands each role on its own persona home (lib/persona.ts decides which).
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/design";
import { useRole } from "@/hooks/use-role";
import { homeHrefForRole } from "@/lib/persona";

export default function HomeRedirect() {
  const router = useRouter();
  const { role, loading } = useRole();
  useEffect(() => { if (!loading) router.replace(homeHrefForRole(role)); }, [role, loading, router]);
  return <div aria-busy="true" className="flex flex-col gap-4" style={{ padding: "var(--m-page-pad)" }}><Skeleton height={56} /><Skeleton height={240} /></div>;
}
