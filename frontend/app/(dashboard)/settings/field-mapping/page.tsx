"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Field mapping is an Admin tab. */
export default function FieldMappingRedirect() {
  const router = useRouter();
  useEffect(() => router.replace("/admin?tab=field-mapping"), [router]);
  return null;
}
