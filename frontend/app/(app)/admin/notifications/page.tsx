"use client";

/** Admin › Notifications moved to Admin › Alerts. The permanent redirect is in next.config.ts; this covers client navigation. */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function NotificationsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/admin/alerts"); }, [router]);
  return null;
}
