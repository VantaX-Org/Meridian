// frontend/app/(app)/objects/[object]/rules/[ruleId]/page.tsx
"use client";

import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/design";

/** This route is superseded by the object page's records tab (T24); it now
 * only redirects so old links and bookmarks keep working. */
export default function RuleDetailRedirect() {
  const params = useParams<{ object: string; ruleId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const run = search.get("run") ?? "";

  useEffect(() => {
    router.replace(`/objects/${params.object}?run=${run}&tab=records&check_id=${params.ruleId}`);
  }, [params.object, params.ruleId, run, router]);

  return <Skeleton height={240} />;
}
