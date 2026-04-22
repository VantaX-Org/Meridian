"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionHeaderProps {
  title: ReactNode;
  caption?: ReactNode;
  right?: ReactNode;
  className?: string;
  /** When true, renders as `h2` (default). Use `h3` for nested sections. */
  as?: "h2" | "h3";
}

/**
 * Compact section header: heading + caption on the left, free-slot on the right.
 *
 * Used to split a page into tight sections without wrapping every section in a
 * card — keeps density high while preserving information scent.
 */
export function SectionHeader({
  title,
  caption,
  right,
  className,
  as = "h2",
}: SectionHeaderProps) {
  const Heading = as;
  return (
    <div className={cn("flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <Heading
          className={cn(
            "truncate font-display font-semibold text-foreground",
            as === "h2" ? "text-base" : "text-sm",
          )}
        >
          {title}
        </Heading>
        {caption ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{caption}</p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}
