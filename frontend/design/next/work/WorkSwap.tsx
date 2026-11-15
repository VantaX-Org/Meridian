"use client";

import type { ComponentType } from "react";
import { notFound } from "next/navigation";
import { Exceptions } from "@/design/v2/screens/Exceptions";
import { Triage } from "@/design/v2/screens/Triage";
import { WorkAnalytics } from "@/design/v2/screens/WorkAnalytics";
import { WorkMonitor } from "@/design/v2/screens/WorkMonitor";
import { useUiNext } from "../useUiNext";
import { Work } from "./Work";

/** The pages the earlier interface served under /work, kept at their addresses while the new interface is off. */
const OLD: Record<string, ComponentType> = { triage: Triage, monitor: WorkMonitor, exceptions: Exceptions, analytics: WorkAnalytics };

/** Every /work/<segment> address: the new Work tabs with the new interface on, the earlier page otherwise. */
export function WorkSwap({ slug }: { slug: string[] }) {
  const next = useUiNext();
  if (next) return <Work slug={slug} />;
  const Old = OLD[slug.join("/")];
  if (!Old) notFound();
  return <Old />;
}
