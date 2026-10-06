"use client";

import Link from "next/link";
import { DepthCrumb, type DepthSegment } from "@/components/aurora";

/** The DepthCrumb a detail page renders itself (the shell crumb stays quiet on those routes). */
export function PageCrumb({ segments }: { segments: ReadonlyArray<DepthSegment> }) {
  return (
    <DepthCrumb segments={segments}
      renderLink={({ children: c, ...props }) => <Link {...props}>{c}</Link>} />
  );
}

/** Routes whose pages draw their own crumb. */
export const SELF_CRUMB = /^\/(analyse\/(finding|object|rule)\/[^/]+|systems\/[^/]+|data\/runs\/[^/]+|workbench\/record\/[^/]+|golden-records\/[^/]+|glossary\/[^/]+)$/;
