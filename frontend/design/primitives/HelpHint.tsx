"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { GLOSSARY, type GlossaryKey } from "@/lib/help/glossary";
import { Card } from "./Card";
import { Tooltip } from "./Tooltip";

/**
 * A 14px info button for a glossary term. Hover or focus shows the short
 * definition in a tooltip; a click opens a popover with the long text and a
 * "Learn more" link when the entry has one.
 */
export function HelpHint({ term, onHero = false }: { term: GlossaryKey; /** Hero tiles sit on the dark hero zone in both themes. */ onHero?: boolean }) {
  const entry = GLOSSARY[term];
  if (!entry) return null;
  return (
    <Popover.Root>
      <Tooltip
        label={entry.short}
        maxWidth={280}
        render={
          <Popover.Trigger
            aria-label={`About ${entry.term}`}
            className="m-motion-colors inline-flex shrink-0 items-center justify-center rounded-full"
            style={{ width: 14, height: 14, color: onHero ? "var(--m-hero-ink-2)" : "var(--m-ink-3)" }}
          />
        }
      >
        <Info size={14} aria-hidden />
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup className="m-motion-scale-in" style={{ width: 320, maxWidth: "calc(100vw - 32px)", boxShadow: "var(--m-elev-2)", borderRadius: "var(--m-radius-sheet)" }}>
            <Card title={entry.term} padding="sm">
              <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-2)" }}>{entry.long}</p>
              {entry.href && (
                <p className="mt-2 text-[13px] leading-[18px]">
                  <Link href={entry.href} style={{ color: "var(--m-accent)" }}>Learn more</Link>
                </p>
              )}
            </Card>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
