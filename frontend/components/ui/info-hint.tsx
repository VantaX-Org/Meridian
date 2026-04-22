"use client";

import { HelpCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface InfoHintProps {
  /** Tooltip body. */
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

/**
 * Small "?" icon that reveals a tooltip on hover / focus. Used next to terse
 * column headers and KPI labels where expanding the label would harm density.
 */
export function InfoHint({ children, className, ariaLabel = "More information" }: InfoHintProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={ariaLabel}
            className={cn(
              "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              className,
            )}
          />
        }
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{children}</TooltipContent>
    </Tooltip>
  );
}
