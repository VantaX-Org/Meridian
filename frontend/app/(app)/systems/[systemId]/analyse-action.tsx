"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/design";

/** The empty-state action of a system tab whose data comes from an analysis: the Objects tab, where Extract and Analyse are. */
export function AnalyseAction({ label = "Run an analysis" }: { label?: string }) {
  const pathname = usePathname();
  return <Button render={<Link href={`${pathname}?tab=objects`}>{label}</Link>} />;
}
