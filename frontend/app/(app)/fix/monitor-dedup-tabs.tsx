"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Notice } from "@/design";

/** Where the Duplicates tab sends people: Match review, cleaning engine source, keeping a record filter. */
export function dedupReviewHref(params: URLSearchParams | null): string {
  const out = new URLSearchParams({ source: "cleaning" });
  for (const k of ["object", "record"]) {
    const v = params?.get(k);
    if (v) out.set(k, v);
  }
  return `/mdm/golden/merge?${out.toString()}`;
}

/** Duplicate pairs from both engines are reviewed on one screen, Match review. This tab keeps old
 * `/fix?tab=dedup` links working: it says so and sends people there. */
export function DedupTab() {
  const router = useRouter();
  const href = dedupReviewHref(useSearchParams());
  useEffect(() => { router.replace(href); }, [router, href]);
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="info">
        Duplicate pairs are reviewed in one place now: Match review lists the pairs from the match engine and from the cleaning engine.
      </Notice>
      <div>
        <Button variant="secondary" render={<Link href={href}>Open Match review</Link>} />
      </div>
    </div>
  );
}
