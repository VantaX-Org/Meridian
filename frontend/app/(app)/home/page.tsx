"use client";

// /home lands each role on the view that answers its question.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/design";
import { useRole, type Role } from "@/hooks/use-role";

export const HOME_FOR: Record<Role, string> = {
  admin: "/home/basis",
  manager: "/home/lead",
  steward: "/home/steward",
  approver: "/home/steward",
  analyst: "/insights/rules",
  process_analyst: "/home/process",
  auditor: "/insights/reports",
  ai_reviewer: "/insights/reports",
  viewer: "/insights/exec",
};

export default function HomeRedirect() {
  const router = useRouter();
  const { role, loading } = useRole();
  useEffect(() => { if (!loading) router.replace(HOME_FOR[role]); }, [role, loading, router]);
  return <div aria-busy="true" className="flex flex-col gap-4" style={{ padding: "var(--m-page-pad)" }}><Skeleton height={56} /><Skeleton height={240} /></div>;
}
